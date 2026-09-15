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

## Setting up S3 on AWS, step by step

This is everything the default static delivery mode needs. Budget about 30
minutes the first time. [docs/aws-setup.md](docs/aws-setup.md) has the same
steps with cost estimates, a CloudFront option, and troubleshooting.

Replace `YOUR-BUCKET-NAME` everywhere below. Bucket names are global across
all of AWS, so pick something like `acme-event-photos-2026`.

### 1. Lock down the root account

1. Sign in at [console.aws.amazon.com](https://console.aws.amazon.com/) with the account email.
2. Click your account name (top right) → **Security credentials**.
3. Under **Multi-factor authentication**, click **Assign MFA device** and set one up.
4. Under **Access keys**, make sure there are none. Delete any that exist. The app never uses root keys.

### 2. Set a budget alert

1. **Billing and Cost Management** → **Budgets** → **Create budget**.
2. Choose **Zero spend budget** (alert at the first cent) or a **Monthly cost budget** such as US$10.
3. Enter your email and create it.

A typical event of 300 guests costs well under a dollar. The alert is there in
case a gallery goes viral.

### 3. Create the bucket

1. **S3** → **Create bucket**.
2. **Bucket name**: `YOUR-BUCKET-NAME`.
3. **Region**: pick the one closest to your events, for example `us-east-2`. Write it down.
4. **Block Public Access**: leave all four boxes **checked** for now. Step 6 opens exactly what guests need.
5. **Bucket Versioning**: Disable.
6. **Default encryption**: leave SSE-S3 on.
7. Click **Create bucket**.

### 4. Create a least-privilege IAM user for the app

1. **IAM** → **Users** → **Create user**.
2. **User name**: `event-uploader-app`. Do **not** tick "Provide user access to the AWS Management Console".
3. On **Set permissions**, choose **Attach policies directly** → **Create policy**.
4. Switch to the **JSON** tab and paste this, replacing the bucket name in all three places:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadWriteEventPhotoObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME/events/*",
        "arn:aws:s3:::YOUR-BUCKET-NAME/g/*"
      ]
    },
    {
      "Sid": "CheckBucketReachable",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME",
      "Condition": {
        "StringLike": { "s3:prefix": ["events/*", "g/*"] }
      }
    }
  ]
}
```

5. Name the policy `EventUploaderBucketAccess`, create it, then go back to the user tab, refresh the policy list, tick it, and finish creating the user.

The policy allows writing and deleting objects only under the two prefixes the
app uses, and never allows listing the whole bucket.

### 5. Create the access key

1. Open the new user → **Security credentials** → **Create access key**.
2. Choose **Application running outside AWS** → **Next** → **Create access key**.
3. Copy the **Access key ID** and the **Secret access key**. The secret is shown once.

Enter both straight into the app under **Settings → Storage**. The app encrypts
the secret into the macOS Keychain. Do not put them in a file in this repo,
and do not paste them into chat or email.

### 6. Let guests' phones read the galleries

Everything under `events/*` (the photos and each gallery's `index.html`) must
be readable by a phone. The private manifests under `g/*` stay locked down.

1. **S3** → your bucket → **Permissions** → **Block public access** → **Edit** → untick **Block all public access** → **Save changes** and confirm.
2. Still under **Permissions**, scroll to **Bucket policy** → **Edit** and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadEventImages",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/events/*"
    }
  ]
}
```

3. Save.

Do not enable "Static website hosting". The app links to the HTTPS object URL
directly, and that feature would only add an HTTP-only endpoint.

### 7. Automatic cleanup (optional but recommended)

The expiry the app stamps into each gallery only hides the page. To actually
delete the files and stop paying for them:

1. **S3** → your bucket → **Management** → **Lifecycle rules** → **Create lifecycle rule**.
2. Name: `expire-event-photos`. Choose **Limit the scope**, prefix `events/`.
3. Tick **Expire current versions of objects**, days after creation: `90`.
4. Create it, then create a second rule with prefix `g/` and the same window.

Keep this longer than the expiry set in the app so a page never outlives its photos.

### 8. Point the app at the bucket

In Event Uploader → **Settings**:

| Field | Value |
| --- | --- |
| Delivery | Static page in the bucket |
| Provider | Amazon S3 |
| Bucket | `YOUR-BUCKET-NAME` |
| Region | the region from step 3 |
| Access key ID / Secret | from step 5 |
| CDN / custom domain | blank |
| Custom endpoint | blank |

Click **Save**, then **Test connection**. It writes and deletes a tiny probe
object under `g/` using the same permissions a real upload needs, and shows
S3's own reason if anything is off.

Then do a real run: drop a JPEG in the capture folder, press **Finish Group**,
wait for *Gallery Ready*, and scan the QR with a phone on mobile data. You
should see the gallery, be able to tap a photo, and get a zip from
**Download all photos**.

### If a key ever leaks

**IAM** → **Users** → `event-uploader-app` → **Security credentials**:
deactivate the exposed key, create a new one, update the app, then delete the
old key. It takes under a minute.

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

---

## License

[GPL-3.0](LICENSE).
