import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateGalleryCode, newId, slugify } from './ids';
import type {
  EventRow,
  GalleryRow,
  GalleryStatus,
  PhotoRow,
  PhotoStatus,
} from './types';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS galleries (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  gallery_code  TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TEXT NOT NULL,
  published_at  TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id                 TEXT PRIMARY KEY,
  gallery_id         TEXT REFERENCES galleries(id) ON DELETE SET NULL,
  event_id           TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  original_path      TEXT NOT NULL UNIQUE,
  original_filename  TEXT NOT NULL,
  processed_path     TEXT,
  storage_key        TEXT,
  status             TEXT NOT NULL DEFAULT 'unassigned',
  rotation           INTEGER NOT NULL DEFAULT 0,
  rejected           INTEGER NOT NULL DEFAULT 0,
  width              INTEGER,
  height             INTEGER,
  bytes              INTEGER,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_gallery  ON photos(gallery_id);
CREATE INDEX IF NOT EXISTS idx_photos_unassigned
  ON photos(event_id, status) WHERE gallery_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_galleries_event ON galleries(event_id, created_at DESC);
`;

const now = () => new Date().toISOString();

export class Database {
  private db: BetterSqlite3.Database;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new BetterSqlite3(filePath);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------- events

  /** Returns the existing event with this name, or creates it. */
  getOrCreateEvent(name: string): EventRow {
    const existing = this.db
      .prepare<[string], EventRow>('SELECT * FROM events WHERE name = ?')
      .get(name);
    if (existing) return existing;

    const row: EventRow = {
      id: newId(),
      name,
      slug: slugify(name),
      created_at: now(),
    };
    this.db
      .prepare(
        'INSERT INTO events (id, name, slug, created_at) VALUES (@id, @name, @slug, @created_at)',
      )
      .run(row);
    return row;
  }

  // ---------------------------------------------------------------- photos

  /**
   * Records a freshly detected file. Returns null if we have seen this path
   * before — the watcher can fire twice for the same file.
   */
  addPhoto(eventId: string, originalPath: string, filename: string): PhotoRow | null {
    const row: PhotoRow = {
      id: newId(),
      gallery_id: null,
      event_id: eventId,
      original_path: originalPath,
      original_filename: filename,
      processed_path: null,
      storage_key: null,
      status: 'unassigned',
      rotation: 0,
      rejected: 0,
      width: null,
      height: null,
      bytes: null,
      created_at: now(),
    };
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO photos
           (id, gallery_id, event_id, original_path, original_filename,
            processed_path, storage_key, status, rotation, rejected,
            width, height, bytes, created_at)
         VALUES
           (@id, @gallery_id, @event_id, @original_path, @original_filename,
            @processed_path, @storage_key, @status, @rotation, @rejected,
            @width, @height, @bytes, @created_at)`,
      )
      .run(row);
    return res.changes > 0 ? row : null;
  }

  /** Everything shot since the last gallery was created, newest first. */
  listUnassigned(eventId: string): PhotoRow[] {
    return this.db
      .prepare<[string], PhotoRow>(
        `SELECT * FROM photos
          WHERE event_id = ? AND gallery_id IS NULL
          ORDER BY created_at DESC`,
      )
      .all(eventId);
  }

  listPhotosForGallery(galleryId: string): PhotoRow[] {
    return this.db
      .prepare<[string], PhotoRow>(
        'SELECT * FROM photos WHERE gallery_id = ? ORDER BY created_at ASC',
      )
      .all(galleryId);
  }

  getPhoto(id: string): PhotoRow | undefined {
    return this.db
      .prepare<[string], PhotoRow>('SELECT * FROM photos WHERE id = ?')
      .get(id);
  }

  setRotation(id: string, rotation: number): void {
    const normalized = ((rotation % 360) + 360) % 360;
    this.db.prepare('UPDATE photos SET rotation = ? WHERE id = ?').run(normalized, id);
  }

  setRejected(id: string, rejected: boolean): void {
    this.db
      .prepare('UPDATE photos SET rejected = ? WHERE id = ?')
      .run(rejected ? 1 : 0, id);
  }

  /** Drops an unassigned photo from the queue. The file on disk is untouched. */
  discardPhoto(id: string): void {
    this.db
      .prepare('DELETE FROM photos WHERE id = ? AND gallery_id IS NULL')
      .run(id);
  }

  updatePhotoProcessed(
    id: string,
    data: { processed_path: string; width: number; height: number; bytes: number },
  ): void {
    this.db
      .prepare(
        `UPDATE photos
            SET processed_path = @processed_path, width = @width,
                height = @height, bytes = @bytes, status = 'processed'
          WHERE id = @id`,
      )
      .run({ ...data, id });
  }

  updatePhotoUploaded(id: string, storageKey: string): void {
    this.db
      .prepare(
        `UPDATE photos SET storage_key = ?, status = 'uploaded' WHERE id = ?`,
      )
      .run(storageKey, id);
  }

  setPhotoStatus(id: string, status: PhotoStatus): void {
    this.db.prepare('UPDATE photos SET status = ? WHERE id = ?').run(status, id);
  }

  // ------------------------------------------------------------- galleries

  /**
   * The central "Finish Group" transaction: claim every unassigned, unrejected
   * photo for a brand-new gallery. Atomic, so photos arriving mid-click land in
   * the next group rather than being lost.
   */
  createGalleryFromUnassigned(eventId: string): { gallery: GalleryRow; photos: PhotoRow[] } | null {
    const tx = this.db.transaction((): { gallery: GalleryRow; photos: PhotoRow[] } | null => {
      const claimable = this.db
        .prepare<[string], PhotoRow>(
          `SELECT * FROM photos
            WHERE event_id = ? AND gallery_id IS NULL AND rejected = 0
            ORDER BY created_at ASC`,
        )
        .all(eventId);
      if (claimable.length === 0) return null;

      const gallery: GalleryRow = {
        id: newId(),
        event_id: eventId,
        gallery_code: this.reserveCode(),
        status: 'pending',
        attempts: 0,
        error: null,
        created_at: now(),
        published_at: null,
      };
      this.db
        .prepare(
          `INSERT INTO galleries
             (id, event_id, gallery_code, status, attempts, error, created_at, published_at)
           VALUES
             (@id, @event_id, @gallery_code, @status, @attempts, @error, @created_at, @published_at)`,
        )
        .run(gallery);

      const assign = this.db.prepare(
        `UPDATE photos SET gallery_id = ?, status = 'assigned' WHERE id = ?`,
      );
      for (const p of claimable) assign.run(gallery.id, p.id);

      // Rejected leftovers should not haunt the next group either.
      this.db
        .prepare(
          `DELETE FROM photos WHERE event_id = ? AND gallery_id IS NULL AND rejected = 1`,
        )
        .run(eventId);

      return { gallery, photos: claimable.map((p) => ({ ...p, gallery_id: gallery.id })) };
    });
    return tx();
  }

  private reserveCode(): string {
    const exists = this.db.prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM galleries WHERE gallery_code = ?',
    );
    for (let attempt = 0; attempt < 20; attempt++) {
      // Widen the code after repeated collisions rather than spinning forever.
      const code = generateGalleryCode(attempt < 10 ? 6 : 8);
      if ((exists.get(code)?.n ?? 0) === 0) return code;
    }
    throw new Error('Could not allocate a unique gallery code');
  }

  setGalleryStatus(id: string, status: GalleryStatus, error?: string | null): void {
    this.db
      .prepare('UPDATE galleries SET status = ?, error = ? WHERE id = ?')
      .run(status, error ?? null, id);
  }

  markGalleryReady(id: string): void {
    this.db
      .prepare(
        `UPDATE galleries SET status = 'ready', error = NULL, published_at = ? WHERE id = ?`,
      )
      .run(now(), id);
  }

  incrementAttempts(id: string): number {
    this.db.prepare('UPDATE galleries SET attempts = attempts + 1 WHERE id = ?').run(id);
    return (
      this.db
        .prepare<[string], { attempts: number }>(
          'SELECT attempts FROM galleries WHERE id = ?',
        )
        .get(id)?.attempts ?? 0
    );
  }

  getGallery(id: string): GalleryRow | undefined {
    return this.db
      .prepare<[string], GalleryRow>('SELECT * FROM galleries WHERE id = ?')
      .get(id);
  }

  listGalleries(eventId: string, limit = 50): GalleryRow[] {
    return this.db
      .prepare<[string, number], GalleryRow>(
        'SELECT * FROM galleries WHERE event_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(eventId, limit);
  }

  /** Galleries that were mid-flight when the app quit, plus anything failed. */
  listResumable(eventId: string): GalleryRow[] {
    return this.db
      .prepare<[string], GalleryRow>(
        `SELECT * FROM galleries
          WHERE event_id = ? AND status IN ('pending','processing','uploading','failed')
          ORDER BY created_at ASC`,
      )
      .all(eventId);
  }
}
