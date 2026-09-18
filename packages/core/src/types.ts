/** Lifecycle of a gallery from "Finish Group" to a scannable QR code. */
export type GalleryStatus =
  | 'pending'
  | 'processing'
  | 'uploading'
  | 'ready'
  | 'failed';

/**
 * A photo is UNASSIGNED until a gallery claims it. Everything downstream of
 * that is bookkeeping for the upload pipeline.
 */
export type PhotoStatus =
  | 'unassigned'
  | 'assigned'
  | 'processed'
  | 'uploaded'
  | 'failed';

export interface EventRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface GalleryRow {
  id: string;
  event_id: string;
  gallery_code: string;
  status: GalleryStatus;
  attempts: number;
  error: string | null;
  created_at: string;
  published_at: string | null;
}

export interface PhotoRow {
  id: string;
  gallery_id: string | null;
  event_id: string;
  original_path: string;
  original_filename: string;
  processed_path: string | null;
  storage_key: string | null;
  status: PhotoStatus;
  /** Extra clockwise rotation in degrees applied on top of EXIF orientation. */
  rotation: number;
  rejected: 0 | 1;
  width: number | null;
  height: number | null;
  bytes: number | null;
  created_at: string;
}

/** What the guest's phone downloads. Written to S3 so the web app holds no DB. */
export interface GalleryManifest {
  version: 1;
  code: string;
  event: { name: string; slug: string };
  createdAt: string;
  expiresAt: string | null;
  photos: ManifestPhoto[];
  /** Optional brand logo shown at the top of the gallery page. */
  logo?: { filename: string; url: string } | null;
  /**
   * Optional links and secondary branding for the gallery page. Every field is
   * independent: anything blank is simply left off the page.
   */
  links?: GalleryLinks;
  /** Page styling chosen in Settings. Missing = the built-in defaults. */
  theme?: GalleryTheme;
}

export interface GalleryTheme {
  /** Background colour of the "Download all photos" button, as #rrggbb. */
  buttonColor?: string;
}

export interface GalleryLinks {
  /** Where tapping the event logo at the top of the page goes. */
  eventLogoHref?: string;
  /** Full Instagram profile URL. */
  instagram?: string;
  /** Full Facebook page URL. */
  facebook?: string;
  /** Full TikTok profile URL. */
  tiktok?: string;
  /** Company logo shown in the footer, optionally linking to the company site. */
  company?: { filename: string; url: string; href?: string } | null;
}

export interface ManifestPhoto {
  filename: string;
  key: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
}

export type StorageProviderName = 's3' | 'local';

/**
 * How guests reach a gallery.
 *  - `static`: the app writes a self-contained index.html next to the photos
 *    and the QR points straight at the bucket. No server to host.
 *  - `server`: the QR points at the gallery web app (apps/gallery), which
 *    renders pages from the private manifest and streams zips.
 */
export type DeliveryMode = 'static' | 'server';

export interface StorageSettings {
  provider: StorageProviderName;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Set for S3-compatible services (R2, B2, Wasabi, Spaces). */
  endpoint?: string;
  /** CDN or custom domain fronting the bucket. Blank = default S3 URL. */
  publicAssetBaseUrl?: string;
  /** Only used by the `local` provider in development. */
  localDir?: string;
}

export interface AppSettings {
  eventName: string;
  /** Folder the app watches for tethered capture / card imports. */
  watchFolder: string;
  /** Where processed JPEGs and the SQLite DB live. */
  workDir: string;
  longestEdge: number;
  jpegQuality: number;
  deliveryMode: DeliveryMode;
  /** Server mode only: base URL of the guest gallery web app — never the bucket. */
  publicBaseUrl: string;
  /** Path segment before the code: /g/ABC123 */
  galleryPathPrefix: string;
  expiresInDays: number | null;
  /** Copy originals into workDir/originals instead of leaving them in place. */
  copyOriginals: boolean;
  /**
   * Base name for delivered photo files, e.g. "spring-gala" gives
   * spring-gala-001.jpg on the guest's phone. Blank = photo-001.jpg.
   */
  photoNamePrefix: string;
  /** PNG with transparency, composited bottom-left on every delivered photo. Blank = off. */
  watermarkPath: string;
  /** Watermark width as a percentage of the delivered photo's width. */
  watermarkWidthPercent: number;
  /** Distance in pixels from the left and bottom edges. */
  watermarkMargin: number;
  /** Where the event logo at the top of the gallery page links. Blank = not a link. */
  eventLogoUrl: string;
  /** Instagram handle or profile URL. Blank = no Instagram icon on the page. */
  instagramHandle: string;
  /** Facebook page name or URL. Blank = no Facebook icon on the page. */
  facebookPage: string;
  /** TikTok handle or profile URL. Blank = no TikTok icon on the page. */
  tiktokHandle: string;
  /** PNG shown in the gallery footer (e.g. the company mark). Blank = none. */
  companyLogoPath: string;
  /** Where the company logo links. Blank = logo shown without a link. */
  companyLogoUrl: string;
  /** "Download all photos" button colour on the gallery page, as #rrggbb. */
  buttonColor: string;
  storage: StorageSettings;
}

export const RESIZE_PRESETS = {
  small: 1200,
  standard: 2000,
  large: 3000,
} as const;
