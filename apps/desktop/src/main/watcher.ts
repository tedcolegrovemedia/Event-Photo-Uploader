import chokidar, { type FSWatcher } from 'chokidar';
import { basename } from 'node:path';
import { isSupportedImage } from '@eps/core';

export interface WatcherEvents {
  onPhoto: (absolutePath: string, filename: string) => void;
  onError: (message: string) => void;
  onReady: () => void;
}

/**
 * Watches the tethered-capture / card-import folder.
 *
 * The critical setting is awaitWriteFinish. A tethered camera creates the file
 * and then streams 40+ MB into it; without waiting for the size to settle we
 * would try to resize a half-written photo and fail on the guest who is already
 * standing there.
 */
export class CaptureWatcher {
  private watcher: FSWatcher | null = null;
  private folder: string | null = null;

  start(folder: string, events: WatcherEvents): void {
    this.stop();
    this.folder = folder;

    this.watcher = chokidar.watch(folder, {
      ignoreInitial: true,
      depth: 4,
      awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 150,
      },
      ignored: (path: string) =>
        basename(path).startsWith('.') || basename(path) === '@eaDir',
    });

    this.watcher
      .on('add', (path: string) => {
        if (!isSupportedImage(path)) return;
        events.onPhoto(path, basename(path));
      })
      .on('ready', () => events.onReady())
      .on('error', (err: unknown) =>
        events.onError(err instanceof Error ? err.message : String(err)),
      );
  }

  get watching(): string | null {
    return this.folder;
  }

  stop(): void {
    void this.watcher?.close();
    this.watcher = null;
    this.folder = null;
  }
}
