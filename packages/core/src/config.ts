import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizeFacebook, normalizeInstagram, normalizeTiktok, normalizeUrl } from './links';
import { DEFAULT_BUTTON_COLOR, normalizeHexColor } from './theme';
import type { AppSettings } from './types';

export function defaultSettings(): AppSettings {
  const home = homedir();
  return {
    eventName: 'Untitled Event',
    watchFolder: join(home, 'Pictures', 'Event Capture'),
    workDir: join(home, 'Pictures', 'Event Uploader'),
    longestEdge: 2000,
    jpegQuality: 85,
    deliveryMode: 'static',
    publicBaseUrl: 'http://localhost:8080',
    galleryPathPrefix: 'g',
    expiresInDays: 30,
    copyOriginals: false,
    watermarkPath: '',
    watermarkWidthPercent: 15,
    watermarkMargin: 20,
    eventLogoUrl: '',
    instagramHandle: '',
    facebookPage: '',
    tiktokHandle: '',
    companyLogoPath: '',
    companyLogoUrl: '',
    buttonColor: DEFAULT_BUTTON_COLOR,
    storage: {
      provider: 'local',
      region: 'us-east-1',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      publicAssetBaseUrl: '',
      localDir: join(home, 'Pictures', 'Event Uploader', 'local-bucket'),
    },
  };
}

/** Deep-merges stored settings over the defaults so new keys appear on upgrade. */
export function mergeSettings(
  stored: Partial<AppSettings> | null | undefined,
): AppSettings {
  const base = defaultSettings();
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    storage: { ...base.storage, ...(stored.storage ?? {}) },
  };
}

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Blocking problems only — things that would fail mid-event. */
export function validateSettings(s: AppSettings): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!s.eventName.trim()) {
    issues.push({ field: 'eventName', message: 'Event name is required.' });
  }
  if (!s.watchFolder.trim()) {
    issues.push({ field: 'watchFolder', message: 'Pick a folder to watch.' });
  }
  if (s.deliveryMode === 'server' && !/^https?:\/\//.test(s.publicBaseUrl)) {
    issues.push({
      field: 'publicBaseUrl',
      message: 'Gallery URL must start with http:// or https://',
    });
  }
  if (s.deliveryMode === 'static' && s.storage.provider !== 's3') {
    issues.push({
      field: 'deliveryMode',
      message:
        'Static pages need S3 (or S3-compatible) storage. Use the gallery web app for local-folder rehearsals.',
    });
  }
  if (s.longestEdge < 600 || s.longestEdge > 6000) {
    issues.push({ field: 'longestEdge', message: 'Longest edge must be 600–6000 px.' });
  }
  if (s.jpegQuality < 50 || s.jpegQuality > 100) {
    issues.push({ field: 'jpegQuality', message: 'JPEG quality must be 50–100.' });
  }

  if (s.watermarkPath.trim()) {
    if (!existsSync(s.watermarkPath)) {
      issues.push({ field: 'watermarkPath', message: 'Watermark file not found.' });
    } else if (!/\.png$/i.test(s.watermarkPath)) {
      issues.push({ field: 'watermarkPath', message: 'Watermark must be a PNG (for transparency).' });
    }
    if (s.watermarkWidthPercent < 2 || s.watermarkWidthPercent > 60) {
      issues.push({ field: 'watermarkWidthPercent', message: 'Watermark width must be 2–60% of the photo.' });
    }
    if (s.watermarkMargin < 0 || s.watermarkMargin > 500) {
      issues.push({ field: 'watermarkMargin', message: 'Watermark margin must be 0–500 px.' });
    }
  }

  if (s.eventLogoUrl.trim() && !normalizeUrl(s.eventLogoUrl)) {
    issues.push({ field: 'eventLogoUrl', message: 'Event logo link must be a web address (e.g. https://example.com).' });
  }
  if (s.instagramHandle.trim() && !normalizeInstagram(s.instagramHandle)) {
    issues.push({ field: 'instagramHandle', message: 'Enter an Instagram handle (e.g. @omsystem) or profile URL.' });
  }
  if (s.facebookPage.trim() && !normalizeFacebook(s.facebookPage)) {
    issues.push({ field: 'facebookPage', message: 'Enter a Facebook page name or URL.' });
  }
  if (s.tiktokHandle.trim() && !normalizeTiktok(s.tiktokHandle)) {
    issues.push({ field: 'tiktokHandle', message: 'Enter a TikTok handle (e.g. @omsystem) or profile URL.' });
  }
  if (s.companyLogoPath.trim()) {
    if (!existsSync(s.companyLogoPath)) {
      issues.push({ field: 'companyLogoPath', message: 'Company logo file not found.' });
    } else if (!/\.png$/i.test(s.companyLogoPath)) {
      issues.push({ field: 'companyLogoPath', message: 'Company logo must be a PNG (for transparency).' });
    }
  }
  if (s.buttonColor.trim() && !normalizeHexColor(s.buttonColor)) {
    issues.push({ field: 'buttonColor', message: 'Button colour must be a hex colour like #8a9a2b.' });
  }
  if (s.companyLogoUrl.trim() && !normalizeUrl(s.companyLogoUrl)) {
    issues.push({ field: 'companyLogoUrl', message: 'Company link must be a web address (e.g. https://example.com).' });
  }

  if (s.storage.provider === 's3') {
    if (!s.storage.bucket.trim()) {
      issues.push({ field: 'storage.bucket', message: 'S3 bucket name is required.' });
    }
    if (!s.storage.region.trim()) {
      issues.push({ field: 'storage.region', message: 'AWS region is required.' });
    }
    // An empty key pair is legal — the AWS default credential chain may supply
    // them — but half a pair is always a mistake.
    const hasId = Boolean(s.storage.accessKeyId.trim());
    const hasSecret = Boolean(s.storage.secretAccessKey.trim());
    if (hasId !== hasSecret) {
      issues.push({
        field: 'storage.accessKeyId',
        message: 'Provide both an access key ID and a secret, or neither.',
      });
    }

    // A localhost asset URL with a real bucket is the quiet killer: uploads all
    // succeed, the QR resolves, and every image is broken on the guest's phone
    // because their browser is asked to fetch from *their* localhost.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(s.storage.publicAssetBaseUrl ?? '')) {
      issues.push({
        field: 'storage.publicAssetBaseUrl',
        message:
          'Image URL points at localhost while storage is S3 — guests would see broken photos. Clear it to use the bucket URL, or set your CDN domain.',
      });
    }
  }

  return issues;
}
