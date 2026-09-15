/**
 * Operators type links the way they think of them — "@omsystem", "omsystem",
 * "facebook.com/OMSystemCameras" — so each is normalised to a full https URL
 * once, at save time and again at publish time. Every helper returns null for
 * input it cannot make sense of, and callers treat null as "leave it off".
 */

const HANDLE = /^[A-Za-z0-9._-]{1,64}$/;

/** A full web address. Bare domains are accepted and upgraded to https. */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** "@handle", "handle", or any instagram.com URL → https://www.instagram.com/handle/ */
export function normalizeInstagram(input: string): string | null {
  const raw = input.trim().replace(/^@/, '');
  if (!raw) return null;
  if (HANDLE.test(raw)) return `https://www.instagram.com/${raw}/`;
  const url = normalizeUrl(raw);
  if (!url) return null;
  const u = new URL(url);
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
  const handle = u.pathname.split('/').filter(Boolean)[0];
  return handle && HANDLE.test(handle) ? `https://www.instagram.com/${handle}/` : null;
}

/** "@handle", "handle", or any tiktok.com URL → https://www.tiktok.com/@handle */
export function normalizeTiktok(input: string): string | null {
  const raw = input.trim().replace(/^@/, '');
  if (!raw) return null;
  if (HANDLE.test(raw)) return `https://www.tiktok.com/@${raw}`;
  const url = normalizeUrl(raw);
  if (!url) return null;
  const u = new URL(url);
  if (!/(^|\.)tiktok\.com$/i.test(u.hostname)) return null;
  const handle = (u.pathname.split('/').filter(Boolean)[0] ?? '').replace(/^@/, '');
  return handle && HANDLE.test(handle) ? `https://www.tiktok.com/@${handle}` : null;
}

/** A page name or any facebook.com URL → https://www.facebook.com/<page> */
export function normalizeFacebook(input: string): string | null {
  const raw = input.trim().replace(/^@/, '');
  if (!raw) return null;
  if (HANDLE.test(raw)) return `https://www.facebook.com/${raw}`;
  const url = normalizeUrl(raw);
  if (!url) return null;
  const u = new URL(url);
  if (!/(^|\.)(facebook|fb)\.com$/i.test(u.hostname)) return null;
  const path = u.pathname.replace(/\/+$/, '');
  return path.length > 1 ? `https://www.facebook.com${path}${u.search}` : null;
}
