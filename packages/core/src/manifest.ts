import type { GalleryManifest } from './types';

/**
 * Storage layout.
 *
 * Photos are filed under the event so post-event cleanup is one prefix delete:
 *   events/2026-spring-gala/g/A7KD92/photo-001.jpg
 *
 * The manifest is ALSO written flat, keyed by code:
 *   g/A7KD92.json
 *
 * That flat copy is what makes the guest web app stateless — one GET resolves a
 * scanned code to a full gallery, with no database and no bucket listing.
 */
export function galleryPrefix(eventSlug: string, code: string): string {
  return `events/${eventSlug}/g/${code}`;
}

/**
 * The base name guests see on their downloads. The operator's prefix is
 * reduced to a URL- and filesystem-safe slug so it can double as the S3 key;
 * blank (or all punctuation) falls back to the generic "photo".
 */
export function photoBaseName(prefix: string): string {
  const slug = prefix
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'photo';
}

/** photo-001.jpg, spring-gala-012.jpg, … */
export function photoFilename(index: number, prefix = '', ext = 'jpg'): string {
  const n = String(index + 1).padStart(3, '0');
  return `${photoBaseName(prefix)}-${n}.${ext}`;
}

export function photoKey(
  eventSlug: string,
  code: string,
  index: number,
  prefix = '',
  ext = 'jpg',
): string {
  return `${galleryPrefix(eventSlug, code)}/${photoFilename(index, prefix, ext)}`;
}

export function logoKey(eventSlug: string, code: string): string {
  return `${galleryPrefix(eventSlug, code)}/logo.png`;
}

export function companyLogoKey(eventSlug: string, code: string): string {
  return `${galleryPrefix(eventSlug, code)}/company.png`;
}

export function manifestKey(code: string): string {
  return `g/${code}.json`;
}

export function expiresAt(createdAt: string, days: number | null): string | null {
  if (!days) return null;
  const d = new Date(createdAt);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function isExpired(manifest: GalleryManifest, at = new Date()): boolean {
  return manifest.expiresAt !== null && new Date(manifest.expiresAt) <= at;
}

/** Guest-facing URL. Points at the web app, never at the bucket. */
export function galleryUrl(
  publicBaseUrl: string,
  pathPrefix: string,
  code: string,
): string {
  const base = publicBaseUrl.replace(/\/+$/, '');
  const prefix = pathPrefix.replace(/^\/+|\/+$/g, '');
  return `${base}/${prefix}/${code}`;
}

/**
 * Static delivery: the gallery page lives in the same folder as its photos, so
 * one public-read rule on `events/*` covers both and the page can reference
 * photos by bare filename.
 */
export function pageKey(eventSlug: string, code: string): string {
  return `${galleryPrefix(eventSlug, code)}/index.html`;
}
