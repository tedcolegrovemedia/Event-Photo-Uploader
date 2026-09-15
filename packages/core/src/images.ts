import { execFile } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import sharp, { type OutputInfo, type Sharp } from 'sharp';
import { newId } from './ids';

const run = promisify(execFile);

/**
 * Camera RAW. sharp/libvips cannot decode these, but macOS ImageIO can —
 * we shell out to the built-in `sips` to get a full-size JPEG first.
 */
const RAW_EXTENSIONS = new Set([
  '.arw', '.cr2', '.cr3', '.crw', '.dng', '.erf', '.nef', '.nrw',
  '.orf', '.pef', '.raf', '.raw', '.rw2', '.sr2', '.srw', '.x3f',
]);

/** sharp's prebuilt libvips has no HEIF decoder, so these take the sips path too. */
const SIPS_ONLY_EXTENSIONS = new Set(['.heic', '.heif']);

const DIRECT_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.gif', '.avif',
]);

export function isSupportedImage(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return (
    DIRECT_EXTENSIONS.has(ext) ||
    RAW_EXTENSIONS.has(ext) ||
    SIPS_ONLY_EXTENSIONS.has(ext)
  );
}

export function isRaw(filePath: string): boolean {
  return RAW_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function needsSips(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return RAW_EXTENSIONS.has(ext) || SIPS_ONLY_EXTENSIONS.has(ext);
}

export interface ProcessOptions {
  sourcePath: string;
  destPath: string;
  longestEdge: number;
  quality: number;
  /** Extra clockwise rotation applied on top of EXIF orientation. */
  rotation?: number;
  /** Composited bottom-left after resizing. Omit for none. */
  watermark?: WatermarkOptions;
}

export interface WatermarkOptions {
  path: string;
  /** Percent of the output image width. */
  widthPercent: number;
  /** Pixels from the left and bottom edges of the output image. */
  margin: number;
}

export interface ProcessResult {
  width: number;
  height: number;
  bytes: number;
}

/**
 * Produces the web-size JPEG that actually gets uploaded. The original is never
 * modified — it stays on the event machine exactly as the camera wrote it.
 */
export async function processImage(opts: ProcessOptions): Promise<ProcessResult> {
  const { sourcePath, destPath, longestEdge, quality, rotation = 0, watermark } = opts;

  let decodeFrom = sourcePath;
  let tempFile: string | null = null;

  if (needsSips(sourcePath)) {
    tempFile = await decodeWithSips(sourcePath);
    decodeFrom = tempFile;
  }

  try {
    // rotate() with no argument honours the camera's EXIF orientation flag.
    // rotate(angle) does NOT also apply EXIF, and the two do not compose in a
    // single pipeline — so an operator rotation costs a second pass. That only
    // happens when someone actually clicks rotate, which is rare.
    let input: string | Buffer = decodeFrom;
    if (rotation % 360 !== 0) {
      input = await sharp(decodeFrom, { failOn: 'none' }).rotate().toBuffer();
    }

    const pipeline = sharp(input, { failOn: 'none' });
    pipeline.rotate(rotation % 360 === 0 ? undefined : rotation);

    const resized = pipeline
      .resize({
        width: longestEdge,
        height: longestEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toColorspace('srgb');

    // The watermark is sized against the *output* dimensions, which are only
    // known after the resize — so it costs one intermediate buffer.
    const final = watermark
      ? await applyWatermark(await resized.toBuffer({ resolveWithObject: true }), watermark)
      : resized;

    const info = await final
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
      // No .withMetadata() — sharp strips EXIF by default, which is what we
      // want. GPS coordinates and camera serial numbers must not ship to a
      // guest's phone.
      .toFile(destPath);

    return { width: info.width, height: info.height, bytes: info.size };
  } finally {
    if (tempFile) await rm(tempFile, { force: true });
  }
}

/**
 * Bottom-left watermark. The PNG is scaled to `widthPercent` of the photo width
 * (never wider than the photo minus both margins) and placed `margin` px from
 * the left and bottom edges. Its own alpha channel does the blending.
 */
async function applyWatermark(
  base: { data: Buffer; info: OutputInfo },
  wm: WatermarkOptions,
): Promise<Sharp> {
  const { width: W, height: H } = base.info;
  const maxWidth = Math.max(1, W - wm.margin * 2);
  const targetWidth = Math.max(1, Math.min(maxWidth, Math.round((W * wm.widthPercent) / 100)));

  const overlay = await sharp(wm.path)
    .ensureAlpha()
    .resize({ width: targetWidth, fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = wm.margin;
  const top = Math.max(0, H - overlay.info.height - wm.margin);

  return sharp(base.data).composite([{ input: overlay.data, left, top }]);
}

/**
 * macOS-only RAW/HEIC decode via the system ImageIO stack. Costs one temp file
 * per photo but adds zero dependencies and handles every format Preview can.
 */
async function decodeWithSips(sourcePath: string): Promise<string> {
  const dir = join(tmpdir(), 'event-uploader');
  await mkdir(dir, { recursive: true });
  const out = join(dir, `${newId()}.jpg`);

  if (process.platform !== 'darwin') {
    throw new Error(
      `Cannot decode ${basename(sourcePath)}: RAW and HEIC support requires macOS.`,
    );
  }

  await run('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', 'best',
    sourcePath,
    '--out', out,
  ]);
  return out;
}

/**
 * Web-size copy of the brand PNG for the gallery header. Keeps transparency,
 * caps the width so a print-resolution logo does not ship to every guest.
 */
export async function makeLogoPng(sourcePath: string, maxWidth = 800): Promise<Buffer> {
  return sharp(sourcePath)
    .ensureAlpha()
    .resize({ width: maxWidth, withoutEnlargement: true, fit: 'inside' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Cheap "is the camera done writing this?" probe used by the watcher. */
export async function fileIsStable(path: string, waitMs = 400): Promise<boolean> {
  try {
    const first = await stat(path);
    await new Promise((r) => setTimeout(r, waitMs));
    const second = await stat(path);
    return first.size === second.size && second.size > 0;
  } catch {
    return false;
  }
}

/** Small JPEG for the review grid — decoding 45MP RAWs at full size is too slow. */
export async function makeThumbnail(
  sourcePath: string,
  destPath: string,
  edge = 480,
): Promise<void> {
  await processImage({
    sourcePath,
    destPath,
    longestEdge: edge,
    quality: 72,
  });
}
