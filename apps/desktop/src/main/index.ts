import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} from 'electron';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Database,
  createStorage,
  isValidGalleryCode,
  makeThumbnail,
  qrDataUrl,
  qrSvg,
  validateSettings,
  type AppSettings,
  type EventRow,
} from '@eps/core';
import { SettingsStore } from './settings';
import { CaptureWatcher } from './watcher';
import { PublishPipeline, publicGalleryUrl } from './pipeline';
import type { AppState, GalleryView, PhotoView } from './contract';

let win: BrowserWindow | null = null;
let db: Database;
let event: EventRow;
let pipeline: PublishPipeline;

const settingsStore = new SettingsStore();
const watcher = new CaptureWatcher();
const log: string[] = [];

const thumbCache = new Map<string, string>();

// ---------------------------------------------------------------- lifecycle

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Event Uploader',
    backgroundColor: '#14161a',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only touches contextBridge/ipcRenderer, so the renderer
      // can run inside Chromium's OS sandbox. Keep it that way: any Node API
      // the UI needs belongs behind an IPC handler in this file.
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win?.show());

  // Never let the renderer navigate away or spawn windows. Links go to the
  // default browser, and only web links: a compromised renderer must not be
  // able to launch file:// or custom-scheme handlers through this path.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * Creates the working folder layout. Must run on boot AND whenever the operator
 * points the app at a different working folder mid-event — otherwise thumbnail
 * writes fail against a directory that was never created.
 */
function ensureWorkDirs(settings: AppSettings): void {
  mkdirSync(settings.workDir, { recursive: true });
  mkdirSync(join(settings.workDir, 'processed'), { recursive: true });
  mkdirSync(join(settings.workDir, 'thumbs'), { recursive: true });
}

/**
 * Opens the event database inside the working folder and wires the pipeline to
 * it. Re-entrant: changing the working folder closes the old handle and moves
 * the whole app to the new location rather than leaving state split across two.
 */
function openWorkspace(settings: AppSettings): void {
  ensureWorkDirs(settings);

  pipeline?.dispose();
  db?.close();
  thumbCache.clear();

  db = new Database(join(settings.workDir, 'event-photo-share.sqlite'));
  event = db.getOrCreateEvent(settings.eventName);

  pipeline = new PublishPipeline({
    db,
    getSettings: () => settingsStore.get(),
    getEvent: () => event,
    onChange: pushState,
    onLog: addLog,
  });
  pipeline.resumeIncomplete();
}

function boot(): void {
  const settings = settingsStore.get();
  openWorkspace(settings);
  startWatching(settings);
}

/**
 * Review thumbnails live outside the app bundle, and a dev renderer served over
 * http:// cannot load file:// URLs. Rather than disabling webSecurity, we expose
 * exactly one read-only scheme that resolves `eps://thumb/<photoId>` against the
 * thumbnail cache and nothing else.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'eps',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

app.whenReady().then(() => {
  protocol.handle('eps', (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== 'thumb') return new Response('Not found', { status: 404 });

    const photoId = decodeURIComponent(pathname.replace(/^\//, ''));
    const file = thumbCache.get(photoId);
    if (!file) return new Response('Not found', { status: 404 });

    return net.fetch(pathToFileURL(file).toString());
  });

  boot();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  watcher.stop();
  pipeline?.dispose();
  db?.close();
});

// ------------------------------------------------------------------ helpers

/** Only http(s) may leave the app via shell.openExternal. */
function isWebUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const escHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function addLog(line: string): void {
  const stamped = `${new Date().toLocaleTimeString()}  ${line}`;
  log.unshift(stamped);
  if (log.length > 200) log.pop();
  console.log('[eps]', line);
  pushState();
}

function startWatching(settings: AppSettings): void {
  mkdirSync(settings.watchFolder, { recursive: true });
  watcher.start(settings.watchFolder, {
    onPhoto: (path, filename) => {
      const row = db.addPhoto(event.id, path, filename);
      if (row) {
        addLog(`New photo: ${filename}`);
        void warmThumbnail(row.id, path);
      }
    },
    onError: (message) => addLog(`Watcher error: ${message}`),
    onReady: () => addLog(`Watching ${settings.watchFolder}`),
  });
}

/**
 * The review grid must feel instant, so we never point an <img> at a 45 MP RAW.
 * Thumbnails are generated once into workDir/thumbs and served over eps://.
 *
 * Retries matter more than they look. chokidar reports a file once its size has
 * held steady, but a card import of 13 MB frames can stall mid-copy for longer
 * than that window — sharp then reads a truncated file and reports it as an
 * unsupported format. Without a retry the photo shows "Loading…" forever even
 * though the file is perfectly fine a second later.
 */
const THUMB_RETRY_DELAYS_MS = [750, 2000, 5000];

async function warmThumbnail(photoId: string, sourcePath: string): Promise<void> {
  if (thumbCache.has(photoId)) return;

  const settings = settingsStore.get();
  const thumbDir = join(settings.workDir, 'thumbs');
  const dest = join(thumbDir, `${photoId}.jpg`);

  for (let attempt = 0; attempt <= THUMB_RETRY_DELAYS_MS.length; attempt++) {
    try {
      // Re-created every time: the operator may have changed the working folder.
      mkdirSync(thumbDir, { recursive: true });
      await makeThumbnail(sourcePath, dest);
      thumbCache.set(photoId, dest);
      pushState();
      return;
    } catch (err) {
      const delay = THUMB_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        addLog(
          `Could not preview ${basename(sourcePath)}: ${err instanceof Error ? err.message : err}`,
        );
        return;
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function toPhotoView(p: ReturnType<Database['listUnassigned']>[number]): PhotoView {
  const thumb = thumbCache.get(p.id);
  return {
    id: p.id,
    filename: p.original_filename,
    thumbnailUrl: thumb ? `eps://thumb/${p.id}` : null,
    rotation: p.rotation,
    rejected: p.rejected === 1,
    createdAt: p.created_at,
  };
}

function buildState(): AppState {
  const settings = settingsStore.get();
  const unassigned = db.listUnassigned(event.id);

  const galleries: GalleryView[] = db.listGalleries(event.id, 30).map((g) => ({
    id: g.id,
    code: g.gallery_code,
    status: g.status,
    error: g.error,
    attempts: g.attempts,
    photoCount: db.listPhotosForGallery(g.id).length,
    url: publicGalleryUrl(settings, event.slug, g.gallery_code),
    createdAt: g.created_at,
    publishedAt: g.published_at,
  }));

  return {
    settings: redact(settings),
    event: { name: event.name, slug: event.slug },
    unassigned: unassigned.map(toPhotoView),
    galleries,
    watching: watcher.watching,
    log: log.slice(0, 50),
  };
}

/** The renderer never needs the AWS secret; send a placeholder instead. */
function redact(s: AppSettings): AppState['settings'] {
  return {
    ...s,
    storage: {
      ...s.storage,
      secretAccessKey: s.storage.secretAccessKey ? '••••••••' : '',
    },
  };
}

function pushState(): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', buildState());
}

// ---------------------------------------------------------------------- IPC

function registerIpc(): void {
  ipcMain.handle('state:get', () => buildState());

  ipcMain.handle('photo:rotate', (_e, id: string, delta: number) => {
    const photo = db.getPhoto(id);
    if (!photo) return;
    db.setRotation(id, photo.rotation + delta);
    pushState();
  });

  ipcMain.handle('photo:reject', (_e, id: string, rejected: boolean) => {
    db.setRejected(id, rejected);
    pushState();
  });

  ipcMain.handle('photo:discard', (_e, id: string) => {
    db.discardPhoto(id);
    pushState();
  });

  ipcMain.handle('gallery:finish', () => {
    const created = db.createGalleryFromUnassigned(event.id);
    if (!created) {
      addLog('Nothing to publish — no unassigned photos');
      return null;
    }
    addLog(
      `Created gallery ${created.gallery.gallery_code} with ${created.photos.length} photo(s)`,
    );
    pipeline.enqueue(created.gallery.id);
    pushState();
    return created.gallery.gallery_code;
  });

  ipcMain.handle('gallery:retry', (_e, id: string) => {
    pipeline.retry(id);
    pushState();
  });

  ipcMain.handle('gallery:qr', async (_e, code: string) => {
    if (!isValidGalleryCode(code)) throw new Error('Invalid gallery code');
    const url = publicGalleryUrl(settingsStore.get(), event.slug, code);
    return { url, dataUrl: await qrDataUrl(url) };
  });

  ipcMain.handle('gallery:print', async (_e, code: string) => {
    if (!isValidGalleryCode(code)) throw new Error('Invalid gallery code');
    const url = publicGalleryUrl(settingsStore.get(), event.slug, code);
    await printQrCard(code, url);
  });

  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('shell:open', async (_e, url: string) => {
    if (!isWebUrl(url)) throw new Error('Only http(s) links can be opened');
    await shell.openExternal(url);
  });

  ipcMain.handle('dialog:file', async (_e, current?: string) => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PNG image', extensions: ['png'] }],
      defaultPath: current || undefined,
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });

  ipcMain.handle('dialog:folder', async (_e, current?: string) => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: current,
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });

  ipcMain.handle('settings:save', (_e, incoming: AppSettings) => {
    const current = settingsStore.get();

    // The renderer holds a redacted secret; a placeholder means "unchanged".
    const secret =
      incoming.storage.secretAccessKey === '••••••••'
        ? current.storage.secretAccessKey
        : incoming.storage.secretAccessKey;

    const next: AppSettings = {
      ...incoming,
      storage: { ...incoming.storage, secretAccessKey: secret },
    };

    const issues = validateSettings(next);
    if (issues.length > 0) return { ok: false as const, issues };

    settingsStore.save(next);

    if (next.workDir !== current.workDir) {
      // Reopen everything at the new location. Without this the database stays
      // behind in the old folder while processed files are written to the new
      // one, silently splitting the event across two directories.
      openWorkspace(next);
      addLog(`Working folder moved to ${next.workDir}`);
    } else if (next.eventName !== current.eventName) {
      event = db.getOrCreateEvent(next.eventName);
      addLog(`Switched to event "${next.eventName}"`);
    }

    if (next.watchFolder !== current.watchFolder) startWatching(next);

    pushState();
    return { ok: true as const, issues: [] };
  });

  ipcMain.handle('settings:test', async () => {
    try {
      await createStorage(settingsStore.get().storage).healthCheck();
      addLog('Storage check passed');
      return { ok: true as const, message: 'Connected.' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Storage check failed: ${message}`);
      return { ok: false as const, message };
    }
  });

  ipcMain.handle('reveal:workdir', () => {
    shell.openPath(settingsStore.get().workDir);
  });
}

/** Prints a QR card via a hidden window — no extra dependency needed. */
async function printQrCard(code: string, url: string): Promise<void> {
  const svg = await qrSvg(url);
  const html = `<!doctype html><meta charset="utf-8">
<style>
  @page { margin: 12mm; }
  body { font: 16px -apple-system, system-ui, sans-serif; text-align: center; }
  svg { width: 62mm; height: 62mm; }
  .code { font-size: 30px; letter-spacing: 5px; font-weight: 700; margin-top: 8px; }
  .url { color: #444; margin-top: 6px; font-size: 13px; }
  .hint { color: #666; margin-top: 14px; font-size: 14px; }
</style>
<body>
  ${svg}
  <div class="code">${escHtml(code)}</div>
  <div class="url">${escHtml(url)}</div>
  <div class="hint">Scan to view and download your photos.</div>
</body>`;

  const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  printWin.webContents.print({ silent: false, printBackground: true }, () => {
    printWin.destroy();
  });
}
