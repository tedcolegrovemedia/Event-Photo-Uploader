import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createStorage,
  expiresAt,
  galleryUrl,
  logoKey,
  companyLogoKey,
  normalizeFacebook,
  normalizeInstagram,
  normalizeTiktok,
  normalizeUrl,
  normalizeHexColor,
  makeLogoPng,
  manifestKey,
  pageKey,
  photoFilename,
  photoKey,
  processImage,
  renderStaticGallery,
  type AppSettings,
  type Database,
  type EventRow,
  type GalleryManifest,
  type GalleryRow,
  type ManifestPhoto,
  type StorageProvider,
} from '@eps/core';

/** Retry schedule for flaky event wifi. Index clamps at the last entry. */
const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

const UPLOAD_CONCURRENCY = 4;

export interface PipelineDeps {
  db: Database;
  getSettings: () => AppSettings;
  getEvent: () => EventRow;
  onChange: () => void;
  onLog: (line: string) => void;
}

/**
 * Everything between "Finish Group" and "QR code".
 *
 * Galleries are published one at a time on a serial queue — the photographer is
 * already shooting the next guest, so throughput matters less than never
 * saturating the uplink and never blocking the UI.
 */
export class PublishPipeline {
  private queue: string[] = [];
  private running = false;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private deps: PipelineDeps) {}

  enqueue(galleryId: string): void {
    if (!this.queue.includes(galleryId)) this.queue.push(galleryId);
    void this.drain();
  }

  /** Re-queues anything left mid-flight by a crash or quit. */
  resumeIncomplete(): void {
    const event = this.deps.getEvent();
    for (const g of this.deps.db.listResumable(event.id)) {
      this.deps.onLog(`Resuming gallery ${g.gallery_code} (${g.status})`);
      this.enqueue(g.id);
    }
  }

  retry(galleryId: string): void {
    const timer = this.timers.get(galleryId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(galleryId);
    }
    this.enqueue(galleryId);
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.queue = [];
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const id = this.queue.shift()!;
        await this.publish(id);
      }
    } finally {
      this.running = false;
    }
  }

  private async publish(galleryId: string): Promise<void> {
    const { db, getSettings, getEvent, onChange, onLog } = this.deps;
    const gallery = db.getGallery(galleryId);
    if (!gallery || gallery.status === 'ready') return;

    const settings = getSettings();
    const event = getEvent();
    const storage = createStorage(settings.storage);

    try {
      await this.processPhotos(gallery, settings);
      await this.uploadPhotos(gallery, settings, storage, event);
      db.markGalleryReady(gallery.id);
      onLog(`Gallery ${gallery.gallery_code} is ready`);
      onChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = db.incrementAttempts(gallery.id);
      db.setGalleryStatus(gallery.id, 'failed', message);
      onLog(`Gallery ${gallery.gallery_code} failed (attempt ${attempts}): ${message}`);
      onChange();
      this.scheduleRetry(gallery.id, attempts);
    }
  }

  private async processPhotos(
    gallery: GalleryRow,
    settings: AppSettings,
  ): Promise<void> {
    const { db, onChange, onLog } = this.deps;
    db.setGalleryStatus(gallery.id, 'processing');
    onChange();

    const outDir = join(settings.workDir, 'processed', gallery.gallery_code);
    mkdirSync(outDir, { recursive: true });

    const photos = db.listPhotosForGallery(gallery.id);
    for (const [index, photo] of photos.entries()) {
      // Skip work already done by a previous, failed attempt.
      if (photo.processed_path && photo.width && photo.height) continue;

      const dest = join(outDir, photoFilename(index, settings.photoNamePrefix));
      const result = await processImage({
        sourcePath: photo.original_path,
        destPath: dest,
        longestEdge: settings.longestEdge,
        quality: settings.jpegQuality,
        rotation: photo.rotation,
        watermark: settings.watermarkPath.trim()
          ? {
              path: settings.watermarkPath.trim(),
              widthPercent: settings.watermarkWidthPercent,
              margin: settings.watermarkMargin,
            }
          : undefined,
      });
      db.updatePhotoProcessed(photo.id, { processed_path: dest, ...result });
    }
    onLog(`Resized ${photos.length} photo(s) for ${gallery.gallery_code}`);
  }

  private async uploadPhotos(
    gallery: GalleryRow,
    settings: AppSettings,
    storage: StorageProvider,
    event: EventRow,
  ): Promise<void> {
    const { db, onChange } = this.deps;
    db.setGalleryStatus(gallery.id, 'uploading');
    onChange();

    const photos = db.listPhotosForGallery(gallery.id);
    const manifestPhotos: ManifestPhoto[] = new Array(photos.length);

    await mapLimit(photos, UPLOAD_CONCURRENCY, async (photo, index) => {
      const key = photoKey(event.slug, gallery.gallery_code, index, settings.photoNamePrefix);
      if (!photo.processed_path) {
        throw new Error(`No processed file for ${photo.original_filename}`);
      }

      // A retry after a partial upload should not re-send what already landed.
      if (photo.status !== 'uploaded' || !(await storage.exists(key))) {
        const body = await readFile(photo.processed_path);
        await storage.upload(key, body, {
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=31536000, immutable',
        });
        db.updatePhotoUploaded(photo.id, key);
      }

      manifestPhotos[index] = {
        filename: photoFilename(index, settings.photoNamePrefix),
        key,
        url: storage.getPublicUrl(key),
        width: photo.width ?? 0,
        height: photo.height ?? 0,
        bytes: photo.bytes ?? 0,
      };
    });

    // The watermark doubles as the gallery's header logo. It is uploaded per
    // gallery so each folder is self-contained and cleanup stays one prefix.
    let logo: GalleryManifest['logo'] = null;
    if (settings.watermarkPath.trim()) {
      const key = logoKey(event.slug, gallery.gallery_code);
      await storage.upload(key, await makeLogoPng(settings.watermarkPath.trim()), {
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000, immutable',
      });
      logo = { filename: 'logo.png', url: storage.getPublicUrl(key) };
    }

    // Footer branding and links. Blank settings produce no entry at all, and
    // the page renders nothing for a missing entry.
    const links: GalleryManifest['links'] = {};
    const eventLogoHref = normalizeUrl(settings.eventLogoUrl);
    if (eventLogoHref) links.eventLogoHref = eventLogoHref;
    const instagram = normalizeInstagram(settings.instagramHandle);
    if (instagram) links.instagram = instagram;
    const facebook = normalizeFacebook(settings.facebookPage);
    if (facebook) links.facebook = facebook;
    const tiktok = normalizeTiktok(settings.tiktokHandle);
    if (tiktok) links.tiktok = tiktok;
    if (settings.companyLogoPath.trim()) {
      const key = companyLogoKey(event.slug, gallery.gallery_code);
      await storage.upload(key, await makeLogoPng(settings.companyLogoPath.trim(), 400), {
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000, immutable',
      });
      const href = normalizeUrl(settings.companyLogoUrl);
      links.company = {
        filename: 'company.png',
        url: storage.getPublicUrl(key),
        ...(href ? { href } : {}),
      };
    }

    const manifest: GalleryManifest = {
      version: 1,
      code: gallery.gallery_code,
      event: { name: event.name, slug: event.slug },
      createdAt: gallery.created_at,
      expiresAt: expiresAt(gallery.created_at, settings.expiresInDays),
      photos: manifestPhotos,
      logo,
      links,
      theme: { buttonColor: normalizeHexColor(settings.buttonColor) ?? undefined },
    };

    // The manifest is written after the photos: in server mode it is what makes
    // the gallery URL resolve, so a guest can never scan into a half-uploaded
    // gallery. In static mode it is kept as a private record of what shipped.
    await storage.upload(
      manifestKey(gallery.gallery_code),
      Buffer.from(JSON.stringify(manifest), 'utf8'),
      { contentType: 'application/json', cacheControl: 'public, max-age=60' },
    );

    // Static delivery: the page itself is the last object written, for the same
    // reason. Short cache so a re-publish after a retry shows up promptly.
    if (settings.deliveryMode === 'static') {
      await storage.upload(
        pageKey(event.slug, gallery.gallery_code),
        Buffer.from(renderStaticGallery(manifest), 'utf8'),
        { contentType: 'text/html; charset=utf-8', cacheControl: 'public, max-age=60' },
      );
    }
  }

  private scheduleRetry(galleryId: string, attempts: number): void {
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
    this.deps.onLog(`Retrying in ${Math.round(delay / 1000)}s`);
    const timer = setTimeout(() => {
      this.timers.delete(galleryId);
      this.enqueue(galleryId);
    }, delay);
    // Do not hold the app open just for a pending retry.
    timer.unref?.();
    this.timers.set(galleryId, timer);
  }
}

/** Bounded-concurrency map that preserves index, so manifest order is stable. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
}

/** The URL the QR code encodes. */
export function publicGalleryUrl(
  settings: AppSettings,
  eventSlug: string,
  code: string,
): string {
  if (settings.deliveryMode === 'static') {
    return createStorage(settings.storage).getPublicUrl(pageKey(eventSlug, code));
  }
  return galleryUrl(settings.publicBaseUrl, settings.galleryPathPrefix, code);
}
