# Getting the app onto the event Mac

The event Mac needs **no Node, no Homebrew, no terminal**. It gets a `.dmg` you
drag into Applications. Everything the app needs — the Node runtime, sharp,
SQLite — is inside the bundle.

Node is only required on the *build* machine.

---

## Build the .dmg

On your development Mac:

```bash
npm install
```

```bash
npm run dist:mac
```

Takes about two minutes. No compiler toolchain is required: `npmRebuild` is off
because both native dependencies (better-sqlite3 and sharp) are N-API, so their
prebuilt binaries work unchanged under Electron. Leaving it on makes
electron-builder call node-gyp, which needs Python *and* an accepted Xcode
licence — a needless failure on a fresh machine.

The installer lands in `apps/desktop/release/`:

```
Event Uploader-0.2.0-arm64.dmg
```

### Apple Silicon vs Intel

`npm run dist:mac` builds **arm64 only** (M1 and later). If the event Mac is an
Intel machine, or you don't know, build a universal binary instead:

```bash
npm run dist:mac:universal
```

Universal builds need sharp's Intel binaries present, which npm will not install
on an Apple Silicon machine by default. Install them alongside first:

```bash
npm install --workspace @eps/desktop --cpu=x64 --os=darwin sharp
```

Then re-run the universal build. The bundle roughly doubles in size (~400 MB).

---

## Gatekeeper: the part that will bite you

An unsigned app copied to another Mac gets quarantined. macOS shows
*"Event Uploader is damaged and can't be opened"* — which is a lie; it just
means unsigned.

### Option 1 — sign and notarize properly (this is how releases are built)

Requires an **Apple Developer Program** membership (US$99/year) and a Developer
ID Application certificate in the login keychain. Signing then happens on every
`dist:mac` build automatically.

Notarization uses a **notarytool keychain profile**, so no password ever sits in
a shell or a file. Create the profile once (it prompts for an app-specific
password, generated at appleid.apple.com → Sign-In and Security → App-Specific
Passwords):

```bash
xcrun notarytool store-credentials notary --apple-id you@example.com --team-id ABCDE12345
```

Then build with:

```bash
npm run dist:mac:notarized
```

electron-builder signs the app, uploads it to Apple, waits for the verdict
(usually one to five minutes) and staples the ticket. `scripts/notarize-dmg.sh`
then does the same for the `.dmg` itself, which electron-builder leaves
unsigned. The result opens on any Mac with a normal double-click, even offline.
Verify with:

```bash
spctl -a -vv -t open --context context:primary-signature "apps/desktop/release/Event Uploader-0.2.0-arm64.dmg"
```

which should end in `source=Notarized Developer ID`.

### Option 2 — unsigned, one-time override on the event Mac

Fine for a machine you control. After dragging the app to Applications, run this
once on the event Mac:

```bash
xattr -dr com.apple.quarantine "/Applications/Event Uploader.app"
```

That does need Terminal once. If you would rather avoid it entirely: right-click
the app → **Open** → **Open** in the dialog. On macOS 15 and later that path has
been removed for unsigned apps, so you may have to go to **System Settings →
Privacy & Security** and click **Open Anyway** after the first failed launch.

Note the tradeoff you are accepting: no signature means macOS cannot tell you
whether the bundle was modified in transit. Transfer it over AirDrop or a cable,
not a public download link.

---

## First run on the event Mac

1. Drag the app to **Applications** and launch it.
2. macOS will ask for permission the first time the app reads the capture folder
   (Photos / Desktop / Documents / removable volumes, depending where you point
   it). Approve it. If you dismiss it by accident: **System Settings → Privacy &
   Security → Files and Folders**.
3. Open **Settings** in the app and fill in:
   - **Event name** — becomes the folder name in S3 and the heading guests see.
   - **Capture folder** — where tethered capture or the card import writes.
   - **Working folder** — where processed JPEGs and the database live. Needs a
     few GB free.
   - **Public gallery URL** — the deployed gallery web app, e.g.
     `https://photos.company.com`. Not the S3 bucket.
   - **Storage** — see [aws-setup.md](aws-setup.md).
4. Click **Save**, then **Test connection**.
5. Shoot one test frame. Confirm it appears in the Unassigned grid, press
   **Finish Group**, and scan the QR with your own phone.

Do step 5 before the event, on the venue's actual wifi if you can.

---

## Rehearsing without AWS

Set **Provider** to *Local folder* in Settings and run the gallery server with:

```bash
STORAGE_PROVIDER=local LOCAL_STORAGE_DIR=~/Pictures/"Event Uploader"/local-bucket npm run dev:gallery
```

The whole shoot → Finish Group → QR → guest-gallery loop then works with no
internet and no AWS account. Point **Public gallery URL** at
`http://localhost:8080`.

---

## Updating the app later

There is no auto-updater wired up. Rebuild the `.dmg`, copy it over, and replace
the app in Applications. Settings and the event database live in
`~/Library/Application Support/Event Uploader/` and the working folder
respectively, so they survive a reinstall.
