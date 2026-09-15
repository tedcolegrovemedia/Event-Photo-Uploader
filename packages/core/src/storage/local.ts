import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StorageSettings } from '../types';
import type { StorageProvider, UploadOptions } from './index';

/**
 * Writes "uploads" to a folder on disk and serves them through the gallery web
 * app. Lets the whole shoot → QR → guest flow be tested with no AWS account and
 * no internet, which is also how you rehearse before an event.
 */
export class LocalStorage implements StorageProvider {
  private root: string;
  private publicBase: string;

  constructor(settings: StorageSettings) {
    this.root = settings.localDir || join(process.cwd(), '.local-storage');
    this.publicBase = (settings.publicAssetBaseUrl || '/files').replace(/\/+$/, '');
  }

  async upload(key: string, body: Buffer, _opts: UploadOptions): Promise<void> {
    const dest = join(this.root, key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, body);
  }

  async delete(key: string): Promise<void> {
    await rm(join(this.root, key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(join(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.root, key));
    } catch {
      return null;
    }
  }

  getPublicUrl(key: string): string {
    return `${this.publicBase}/${key}`;
  }

  async healthCheck(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }
}
