# Event Uploader — project story

Notes for a writeup. Facts below come from the spec, the repo history, and the
build sessions; the interpretation is left for you.

Repo: https://github.com/tedcolegrovemedia/Event-Photo-Uploader (GPL-3.0)

---

## What it is

Event Uploader is a Mac app for event photographers. You shoot a guest, press
**Finish Group**, and hand them a QR code. Behind that one button the app
resizes and watermarks the photos, uploads web-size copies to an S3 bucket,
writes a self-contained gallery page next to them, and shows a QR code that
points at it. The guest opens a private, mobile-first gallery of just their
photos and can save one or download all of them as a zip.

Two things define it:

- **Originals never leave the event machine.** Only 2000 px JPEGs go to the
  cloud. Full-resolution delivery is explicitly out of scope.
- **The QR code is the whole credential.** There is no login, no guest
  account, no index page. Gallery codes are six random characters from an
  alphabet with no ambiguous letters, about a billion possibilities, and the
  bucket refuses to list its contents.

## How it started

It began on 13 August 2026 as a written spec, `event-photo-delivery-app-spec.md`,
describing "a lightweight event photography delivery system" for fast event use
rather than full client delivery. The spec laid out the whole workflow: watch a
capture folder, hold new photos in an *unassigned* state, let staff review them,
and make a single **Finish Group** action turn everything since the last group
into a gallery with a QR code. It listed a 15-item MVP, a set of "later"
features, and a suggested stack that leaned toward Node for its filesystem
watching, image processing, AWS SDK, and QR libraries.

The initial build happened the same day. By the end of 13 August every MVP item
was checked off: folder watching, the review grid with rotate and exclude,
Finish Group, local resizing, S3 upload, SQLite metadata, unique IDs, QR
generation on screen and for print, the mobile gallery, per-photo and zip
download, upload status, and automatic retry. The two docs that ship with the
repo, the AWS setup guide and the event-Mac deployment guide, were written
that afternoon too.

## The pieces

A TypeScript monorepo with three workspaces:

| Workspace | Role |
| --- | --- |
| `apps/desktop` | The Electron app that runs on the event Mac. React UI, main process owns all state. |
| `packages/core` | Shared library: storage abstraction, image pipeline, SQLite, ID generation, manifest layout, and the gallery page renderer. |
| `apps/gallery` | Optional Express server that resolves `/g/CODE` from the private manifest. Only needed in server delivery mode. |

Stack: Electron 43, React 19, Vite 7 via electron-vite, sharp for imaging,
better-sqlite3, chokidar, the AWS SDK v3, `qrcode`, Express 5, archiver.
About 3,900 lines of TypeScript excluding config.

The pipeline for one gallery is a serial queue: process photos, upload with
bounded concurrency, upload the logos, write the private manifest, and finally
write the public `index.html`. The page is deliberately the last object
written, so a guest who scans early gets a 404 rather than a half-uploaded
gallery.

## Decisions worth writing about

**Static delivery instead of a server.** The spec assumed a hosted web app at
`photos.company.com/g/ABC123`, and the first build shipped one. On 2 September
the app gained a second mode, now the default, where it writes a complete
`index.html` into the bucket next to the photos and the QR points straight at
S3. Nothing to host, nothing to keep running. The zip is built in the guest's
browser with JSZip loaded on demand under a subresource-integrity hash. The
reasoning at the time: "I just need this to work", and cleaning a bucket later
is easier than keeping a server alive during an event. The server mode still
exists for short custom-domain URLs.

**Privacy model.** Random codes, `noindex` and `no-referrer` on every page,
no listing permission on the bucket, manifests kept private under a prefix the
public-read rule never touches, optional expiry stamped into each gallery with
an S3 lifecycle rule doing the actual deletion.

**Least-privilege AWS.** The IAM policy in the docs allows object writes only
under `events/*` and `g/*` and never lets the app list the bucket. The app's
"Test connection" button writes and deletes a probe object using exactly those
permissions and reports S3's own explanation on failure, because HeadBucket
turned out to be denied by the very policy that is recommended.

**Where the code lives.** Development is on the local SSD with the NAS as a
synced backup, because the SMB share writes small files roughly 900× slower
than local disk. Measured: 300 files in 44.6 s versus 0.049 s. Installing
`node_modules` on the share was on track to take over two hours.

## Things that only show up when you ship

- **Camera writes are slow.** A tethered camera creates the file and then
  streams 40 MB into it. The watcher waits for the size to hold steady for
  1.5 s, and thumbnail generation retries three times because a card import
  can stall longer than that window and sharp reads a truncated file.
- **RAW files.** sharp cannot decode them, so on macOS the app shells out to
  the built-in `sips`. HEIC goes the same way. This is the reason the app is
  Mac-only for RAW.
- **Corporate HTTPS interception.** Node trusts only its bundled root CAs, so
  security software that re-signs TLS breaks S3 uploads with "self signed
  certificate in chain". The S3 client merges the macOS Keychain's trusted CAs
  into Node's list.
- **Native modules and notarization.** Both native dependencies are N-API, so
  the build skips `node-gyp` entirely. That matters because rebuilding needs a
  full Xcode toolchain and fails on any machine that has not accepted the Xcode
  license, which happened during the September build. The workaround was
  pointing `DEVELOPER_DIR` at the Command Line Tools.
- **The localhost trap.** If the "CDN domain" setting pointed at localhost, every
  upload succeeded, the QR resolved, and every photo was broken on the guest's
  phone because their browser was told to fetch from *its own* localhost.
  Validation now refuses that combination.
- **Renamed app, lost secret.** When "Event Photo Share" became "Event
  Uploader", settings migrated across but the AWS secret could not, because
  Electron's safeStorage keys are tied to the app name.

## Timeline

| Date | What happened |
| --- | --- |
| 13 Aug 2026 | Spec written. Full MVP built and documented the same day. Server delivery mode. |
| 2 Sep 2026 | Static delivery mode added and made the default. Confirmed end to end against a real bucket after fixing IAM name mismatches. Bottom-left PNG watermark added; it doubles as the gallery logo. App renamed Event Uploader. First signed, notarized arm64 DMG. |
| 15 Sep 2026 | Guest page redesigned to a Figma mock: dark header with clickable event logo, square grid, full-width download button, footer row of Instagram, Facebook, TikTok, and company logo. Every element is a setting and disappears when blank; button colour is configurable with automatic text contrast. Version 0.2.0. Security pass: renderer sandbox on, external links restricted to http(s), gallery codes validated at the IPC boundary. Git history created, README gained a step-by-step S3 walkthrough, pushed to GitHub under GPL-3.0. |
| 18 Sep 2026 | Photo files can be named after the event (Settings → Event → Photo file name), the settings sheet no longer closes on a stray click outside it, and the app got its own icon: Ted's camera-with-upload-arrow mark on a teal gradient, drawn in Illustrator. Version 1.2.0, signed, notarized and stapled. |

## Gallery page design

The September redesign was driven from a Figma frame rather than described in
words. The page is always dark so white-on-transparent brand logos, which also
serve as the photo watermark, read correctly. Two-column square grid on
phones, wider grid on desktop. One accent colour on the whole page, the
download button, defaulting to an olive `#8a9a2b`. The footer row and the
logo link exist only when configured, so an operator with no social presence
gets a page with just the event name, the photos, and the button.

## What was deliberately not built

From the spec's "later" list: multiple photographers, SMS and email delivery,
guest name entry, password-protected galleries, an admin dashboard, analytics,
and an auto-updater. Also still open: an app icon (the build uses Electron's
default), and a "Save to Photos" button using the Web Share API, which is the
only route that puts images straight into an iPhone camera roll in one tap.

## Numbers that might be useful

- 6-character gallery code, 32-symbol alphabet, ≈1.07 billion values
- Default delivered size 2000 px longest edge, JPEG quality 85
- Watermark default 15 % of photo width, 20 px margin
- Typical event cost estimate from the AWS doc: 300 guests × 5 photos ≈ 0.9 GB
  stored, about $0.30 in egress, under a dollar all in
- Retry backoff for uploads: 5 s, 15 s, 45 s, 2 min, 5 min
- Upload concurrency 4, galleries published one at a time
