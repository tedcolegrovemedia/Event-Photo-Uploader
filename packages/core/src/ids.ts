import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Crockford base32: no I, L, O or U. Unambiguous when read off a printed card,
 * and exactly 32 symbols — which divides 256 evenly, so `byte % 32` is uniform
 * without rejection sampling.
 */
const CROCKFORD32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A short, unguessable gallery code.
 *
 * 6 chars over 32 symbols = 32^6 ≈ 1.07 billion values, so a guest cannot walk
 * into someone else's gallery by editing the URL. Callers must still check the
 * DB for a collision before committing — see `Database.createGallery`.
 */
export function generateGalleryCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CROCKFORD32[bytes[i]! % 32];
  }
  return out;
}

export function newId(): string {
  return randomUUID();
}

/** Filesystem- and URL-safe slug for an event name. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'event';
}

/** Guards the guest-facing route so junk codes never reach storage. */
export function isValidGalleryCode(code: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{4,12}$/.test(code);
}
