# Event Uploader

Shoot a guest, press **Finish Group**, hand them a QR code.

Originals never leave the event machine. Web-size JPEGs go to S3, and the guest
gets a private, mobile-first gallery at a URL that cannot be guessed or browsed.

Built from [event-photo-delivery-app-spec.md](event-photo-delivery-app-spec.md).

---

## The pieces

| | What it is | Where it runs |
| --- | --- | --- |
| `apps/desktop` | The event app — watches the capture folder, review grid, Finish Group, resize, upload, QR | The event Mac, as a standalone `.app`. **No Node required.** |
| `packages/core` | Storage abstraction, image pipeline, SQLite, ID generation, manifest and page rendering | Shared |
| `apps/gallery` | Optional: a guest-facing web app that resolves `/g/ABC123` | A small always-on host, **only in server delivery mode** |

The desktop app is the only thing that holds state.

### Two delivery modes

**Static (default).** On Finish Group the app writes a self-contained
`index.html` into the bucket next to the photos, and the QR code points
straight at that object. Nothing to host, nothing to keep running. Per-photo
download and "Download all" (zipped in the browser) both work because page and
photos share an origin. Expiry is shown by the page and enforced by the bucket
lifecycle rule.

**Server.** The QR points at `apps/gallery`, which renders pages on request from
the private manifest and streams zips server-side. Use this if you want short
`/g/CODE` URLs on your own domain, manifests kept private, or an offline
rehearsal with the local-folder provider.

Switch between them in Settings → Delivery.

---

## Flow

```
CAPTURE FOLDER → watcher → UNASSIGNED queue → review → [FINISH GROUP]
                                                             ↓
                                          resize 2000px ─→ upload to S3
                                                             ↓
                                                  write g/CODE.json manifest
                                                             ↓
                              (static mode) write events/<event>/g/CODE/index.html
                                                             ↓
                                                    gallery URL + QR code
```

The object that makes the URL resolve — the page in static mode, the manifest
in server mode — is written **last**, on purpose: until it exists the gallery
URL 404s, so a guest who scans early never lands on a half-uploaded gallery.

---

## Working from a network share

If the checkout lives on a NAS or other SMB share, develop from a local copy.
SMB is dramatically slower for small-file writes — measured at roughly 900×
slower than local disk — and `node_modules` is tens of thousands of files, so
`npm install`, typechecks and builds all crawl on the share.

`scripts/sync-to-nas.sh` pushes source (never `node_modules`, build output or
the event database) from the local copy back to the share. Set `EPS_NAS_PATH`
to the share's path, run it without arguments for a dry run, then:

```bash
./scripts/sync-to-nas.sh --go
```

---

## Quick start (development)

Requires Node 20.19+ on the development machine only. Verified on Node 26.7.

```bash
npm install
```

Electron 43 downloads its binary lazily on first use rather than in a
postinstall hook. If you want to pre-fetch it (~110 MB):

```bash
node node_modules/electron/install.js
```

Run the desktop app:

```bash
npm run dev
```

For an offline rehearsal, set Delivery to *Gallery web app* and Storage to
*Local folder* in Settings, then run the guest gallery in another terminal:

```bash
npm run dev:gallery
```

For real events, static delivery with S3 is the default — see
[docs/aws-setup.md](docs/aws-setup.md). It needs no second process at all.

To simulate a shoot, drop JPEGs into the capture folder shown in Settings.

---

## Shipping it to the event Mac

```bash
npm run dist:mac:notarized
```

Produces `apps/desktop/release/Event Uploader-0.2.0-arm64.dmg`, signed and
notarized (plain `npm run dist:mac` signs but skips notarization). It bundles
its own Node runtime. Read
[docs/deploying-to-the-event-mac.md](docs/deploying-to-the-event-mac.md) first —
the Gatekeeper section matters, and universal (Intel) builds need one extra step.

---

## Deploying the gallery service (server mode only)

Skip this section in static mode. Otherwise, any host that runs Node will do.
It needs read access to the bucket:

```bash
npm run build
```

```bash
AWS_REGION=us-east-1 AWS_BUCKET=your-bucket \
AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
PORT=8080 node apps/gallery/dist/server.js
```

| Variable | Purpose |
| --- | --- |
| `STORAGE_PROVIDER` | `s3` (default) or `local` |
| `AWS_REGION` / `AWS_BUCKET` | Bucket to read manifests and photos from |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Same IAM user as the desktop app, or a read-only one |
| `S3_ENDPOINT` | For R2 / B2 / Wasabi / Spaces |
| `PUBLIC_ASSET_BASE_URL` | CDN domain fronting the bucket |
| `GALLERY_PATH_PREFIX` | Defaults to `g`, giving `/g/ABC123` |

Point your domain at it and set the same domain as **Public gallery URL** in the
desktop app's settings.

---

## The guest page

What a guest sees after scanning is rendered by `packages/core/src/page.ts` in
both delivery modes: a dark, mobile-first page with the event logo and name up
top, a square photo grid, a full-width **Download all photos** button, and a
footer row of icons. Everything on it is configured under Settings → Gallery
page, and anything left blank is simply not rendered:

| Setting | On the page |
| --- | --- |
| Watermark PNG | Composited on each photo, and shown as the event logo at the top |
| Event logo link | Makes the event logo a tap target |
| Instagram / Facebook / TikTok | One icon each, linking to the profile. Accepts a handle, an @handle, or a full URL |
| Company logo PNG + link | A second logo at the end of the icon row, optionally linking to your site |
| Button colour | The download button. Text flips between dark and white automatically for contrast |

Settings apply to galleries published after you save; pages already in the
bucket are not rewritten.

---

## Privacy model

The QR code *is* the credential. That shapes several choices:

- Gallery codes are 6 random Crockford-base32 characters (~1.07 billion values),
  never sequential.
- `Disallow: /` in robots.txt plus `X-Robots-Tag: noindex` on every response.
- `Referrer-Policy: no-referrer`, so a guest tapping a link cannot leak their
  gallery URL to a third-party site.
- No index page, no way to list galleries, and the IAM policy denies bucket
  listing so codes cannot be enumerated from S3 either.
- Manifests (`g/*.json`) are written with credentials and stay private; only
  objects under `events/*` — the photos and, in static mode, each gallery's
  `index.html` — are publicly readable.
- Optional expiry (24h / 3d / 7d / 30d) is stamped into the manifest, with an S3
  lifecycle rule for the actual deletion.

---

## What is built

Every MVP item from the spec:

- [x] Watch capture/import folder (chokidar, waits for writes to settle)
- [x] Detect new photos
- [x] Display unassigned photos
- [x] Review photos — rotate, exclude, remove
- [x] Finish/create gallery button (plus <kbd>Space</kbd>)
- [x] Resize images locally (sharp; RAW and HEIC via macOS `sips`)
- [x] Upload resized images to S3
- [x] Store gallery metadata (SQLite)
- [x] Generate unique gallery ID
- [x] Generate public gallery URL
- [x] Generate QR code (on screen and printable)
- [x] Mobile guest gallery
- [x] Individual photo download + zip of all
- [x] Upload status (pending / processing / uploading / ready / failed)
- [x] Retry failed uploads (automatic backoff + manual retry)

Deliberately not built yet — the "Later Features" list from the spec: multiple
photographers, SMS/email delivery, guest name entry, password-protected
galleries, admin dashboard, analytics, auto-updater.

---

## Known rough edges

- **RAW and HEIC decoding is macOS-only.** It shells out to the built-in `sips`,
  which uses ImageIO. Plain JPEG/PNG/TIFF work anywhere.
- **Universal (Intel) builds need an extra npm install** for sharp's x64
  binaries. See the deployment doc.
- **No app icon yet.** The build uses the default Electron icon. Drop a 1024×1024
  `icon.png` into `apps/desktop/build/` and electron-builder will pick it up.
- **No auto-update.** Rebuild and copy the `.dmg`.
- **Electron's version must stay pinned** in `apps/desktop/package.json`
  (`"electron": "43.4.0"`, no caret). electron-builder downloads a
  platform-specific binary and refuses to resolve a range.
- **Originals are never uploaded or deleted.** Clearing `workDir/processed` after
  an event is a manual job.
- **One event at a time.** Changing the event name in Settings switches events;
  the schema supports many but the UI exposes one.
