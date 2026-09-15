import express from 'express';
// archiver 8 dropped the callable factory in favour of per-format classes.
import { ZipArchive, type ArchiverError } from 'archiver';
import {
  createStorage,
  isExpired,
  isValidGalleryCode,
  manifestKey,
  renderExpired,
  renderGallery,
  renderNotFound,
  type GalleryManifest,
  type StorageSettings,
} from '@eps/core';

const PORT = Number(process.env.PORT ?? 8080);
const PATH_PREFIX = process.env.GALLERY_PATH_PREFIX ?? 'g';

const storageSettings: StorageSettings = {
  provider: (process.env.STORAGE_PROVIDER as 's3' | 'local') ?? 's3',
  region: process.env.AWS_REGION ?? 'us-east-1',
  bucket: process.env.AWS_BUCKET ?? '',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  endpoint: process.env.S3_ENDPOINT || undefined,
  publicAssetBaseUrl: process.env.PUBLIC_ASSET_BASE_URL || undefined,
  localDir: process.env.LOCAL_STORAGE_DIR,
};

const storage = createStorage(storageSettings);
const app = express();

app.disable('x-powered-by');

app.use((_req, res, next) => {
  // The QR code is the guest's only credential — keep these pages out of search
  // indexes and out of Referer headers.
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

/**
 * Fetches a gallery manifest straight from object storage. There is no database
 * here on purpose: the desktop app owns all state, and this service just
 * resolves a code to the JSON the app published.
 */
async function loadManifest(code: string): Promise<GalleryManifest | null> {
  const body = await storage.getObject(manifestKey(code));
  if (!body) return null;
  try {
    return JSON.parse(body.toString('utf8')) as GalleryManifest;
  } catch {
    console.error('[gallery] corrupt manifest for', code);
    return null;
  }
}

app.get(`/${PATH_PREFIX}/:code`, async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!isValidGalleryCode(code)) {
    res.status(404).type('html').send(renderNotFound());
    return;
  }

  try {
    const manifest = await loadManifest(code);
    if (!manifest) {
      res.status(404).type('html').send(renderNotFound());
      return;
    }
    if (isExpired(manifest)) {
      res.status(410).type('html').send(renderExpired(manifest));
      return;
    }

    res.setHeader('Cache-Control', 'private, max-age=60');
    res.type('html').send(renderGallery(manifest, `/${PATH_PREFIX}/${code}/download`));
  } catch (err) {
    console.error('[gallery] failed to load', code, err);
    res.status(500).type('html').send(renderNotFound());
  }
});

/** Streams every photo as one zip so guests get a single tap on mobile. */
app.get(`/${PATH_PREFIX}/:code/download`, async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!isValidGalleryCode(code)) {
    res.status(404).send('Not found');
    return;
  }

  const manifest = await loadManifest(code);
  if (!manifest || isExpired(manifest)) {
    res.status(404).send('Not found');
    return;
  }

  res.attachment(`${manifest.event.slug}-${code}.zip`);
  const archive = new ZipArchive({ zlib: { level: 0 } }); // JPEGs do not recompress
  archive.on('error', (err: ArchiverError) => {
    console.error('[gallery] zip failed', err);
    res.destroy();
  });
  archive.pipe(res);

  // Read through the storage layer rather than the public URL, so the zip keeps
  // working even if the bucket is fronted by a CDN or locked down entirely.
  for (const photo of manifest.photos) {
    const body = await storage.getObject(photo.key);
    if (body) archive.append(body, { name: photo.filename });
  }

  await archive.finalize();
});

/** Dev convenience: serve the local-provider "bucket" so rehearsal works offline. */
if (storageSettings.provider === 'local' && storageSettings.localDir) {
  app.use('/files', express.static(storageSettings.localDir));
}

app.use((_req, res) => {
  res.status(404).type('html').send(renderNotFound());
});

app.listen(PORT, () => {
  console.log(`[gallery] listening on http://localhost:${PORT}`);
  console.log(`[gallery] storage: ${storageSettings.provider}`);
});
