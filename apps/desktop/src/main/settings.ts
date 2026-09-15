import { app, safeStorage } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeSettings, type AppSettings } from '@eps/core';

/**
 * Settings live in ~/Library/Application Support/Event Uploader/settings.json.
 *
 * A double-clicked .app inherits no shell environment, so .env is useless on the
 * event machine — everything has to be reachable from the Settings panel. The
 * AWS secret is the one value we refuse to leave in plaintext: it goes through
 * Electron's safeStorage, which on macOS wraps a Keychain-backed key.
 */

interface StoredSettings extends Omit<AppSettings, 'storage'> {
  storage: Omit<AppSettings['storage'], 'secretAccessKey'> & {
    /** base64 of the safeStorage-encrypted secret. Never the raw value. */
    secretAccessKeyEnc?: string;
    /** Only ever written when OS encryption is unavailable. */
    secretAccessKeyPlain?: string;
  };
}

export class SettingsStore {
  private file: string;
  private cache: AppSettings | null = null;

  constructor() {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'settings.json');

    // The app used to be called "Event Photo Share". On first launch under the
    // new name, carry the old settings across so folders, bucket and event name
    // survive. The encrypted AWS secret cannot follow — safeStorage keys are
    // tied to the app name — so it has to be re-entered once.
    const legacy = join(app.getPath('appData'), 'Event Photo Share', 'settings.json');
    if (!existsSync(this.file) && existsSync(legacy)) {
      try {
        copyFileSync(legacy, this.file);
        console.log('[settings] migrated settings from Event Photo Share');
      } catch (err) {
        console.error('[settings] could not migrate legacy settings:', err);
      }
    }
  }

  get path(): string {
    return this.file;
  }

  get(): AppSettings {
    if (this.cache) return this.cache;

    let stored: Partial<StoredSettings> | null = null;
    if (existsSync(this.file)) {
      try {
        stored = JSON.parse(readFileSync(this.file, 'utf8')) as StoredSettings;
      } catch (err) {
        console.error('[settings] unreadable, falling back to defaults:', err);
      }
    }

    const settings = mergeSettings(stored as Partial<AppSettings> | null);
    settings.storage.secretAccessKey = this.decryptSecret(stored);

    // In dev only, let a shell environment seed blank fields.
    if (!app.isPackaged) this.applyDevEnv(settings);

    this.cache = settings;
    return settings;
  }

  save(next: AppSettings): AppSettings {
    const { secretAccessKey, ...storageRest } = next.storage;

    const stored: StoredSettings = {
      ...next,
      storage: { ...storageRest },
    };

    if (secretAccessKey) {
      if (safeStorage.isEncryptionAvailable()) {
        stored.storage.secretAccessKeyEnc = safeStorage
          .encryptString(secretAccessKey)
          .toString('base64');
      } else {
        // Better to work than to silently drop the operator's credentials
        // mid-event, but make the compromise visible.
        console.warn('[settings] OS encryption unavailable; storing secret in plaintext');
        stored.storage.secretAccessKeyPlain = secretAccessKey;
      }
    }

    writeFileSync(this.file, JSON.stringify(stored, null, 2), { mode: 0o600 });
    this.cache = next;
    return next;
  }

  private decryptSecret(stored: Partial<StoredSettings> | null): string {
    const s = stored?.storage;
    if (!s) return '';
    if (s.secretAccessKeyEnc && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(s.secretAccessKeyEnc, 'base64'));
      } catch (err) {
        console.error('[settings] could not decrypt AWS secret:', err);
        return '';
      }
    }
    return s.secretAccessKeyPlain ?? '';
  }

  private applyDevEnv(s: AppSettings): void {
    const env = process.env;
    if (env.AWS_BUCKET && !s.storage.bucket) {
      s.storage.bucket = env.AWS_BUCKET;
      s.storage.provider = 's3';
    }
    if (env.AWS_REGION && !s.storage.region) s.storage.region = env.AWS_REGION;
    if (env.AWS_ACCESS_KEY_ID && !s.storage.accessKeyId) {
      s.storage.accessKeyId = env.AWS_ACCESS_KEY_ID;
    }
    if (env.AWS_SECRET_ACCESS_KEY && !s.storage.secretAccessKey) {
      s.storage.secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
    }
    if (env.PUBLIC_ASSET_BASE_URL && !s.storage.publicAssetBaseUrl) {
      s.storage.publicAssetBaseUrl = env.PUBLIC_ASSET_BASE_URL;
    }
    if (env.PUBLIC_BASE_URL) s.publicBaseUrl = env.PUBLIC_BASE_URL;
  }
}
