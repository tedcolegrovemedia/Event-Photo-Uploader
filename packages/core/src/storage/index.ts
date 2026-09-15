import type { StorageSettings } from '../types';
import { S3Storage } from './s3';
import { LocalStorage } from './local';

/**
 * The whole cloud surface of the app. Swapping S3 for R2/B2/Wasabi means
 * writing one new class here, not touching the pipeline.
 */
export interface UploadOptions {
  contentType: string;
  cacheControl?: string;
}

export interface StorageProvider {
  upload(key: string, body: Buffer, opts: UploadOptions): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * Authenticated read. The gallery service uses this for manifests so the
   * `g/*.json` prefix never has to be publicly readable — only the image
   * objects themselves do.
   */
  getObject(key: string): Promise<Buffer | null>;
  getPublicUrl(key: string): string;
  /** Cheap credential/bucket check for the Settings panel. */
  healthCheck(): Promise<void>;
}

export function createStorage(settings: StorageSettings): StorageProvider {
  switch (settings.provider) {
    case 's3':
      return new S3Storage(settings);
    case 'local':
      return new LocalStorage(settings);
    default: {
      const exhaustive: never = settings.provider;
      throw new Error(`Unknown storage provider: ${String(exhaustive)}`);
    }
  }
}

export { S3Storage, LocalStorage };
