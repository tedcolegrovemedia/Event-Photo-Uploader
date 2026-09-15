# Event Photo Delivery App

## Project Overview

Build a lightweight event photography delivery system that allows staff to photograph attendees, group each attendee's images into a small gallery, upload optimized versions to cloud storage, and immediately provide the attendee with a QR code or URL to retrieve their photos.

The system is intended for fast event use rather than full-resolution client delivery.

---

## Core Workflow

1. Photographer shoots an attendee or group.
2. Images arrive on the event computer either:
   - through tethered capture, or
   - by copying/importing images from a memory card.
3. The app watches the capture/import folder for new images.
4. Newly detected images remain in a temporary **unassigned** state.
5. Staff review the most recent images.
6. Staff click a button such as:
   - `Finish Group`
   - `Create Gallery`
   - `Publish Photos`
7. The app groups every unassigned image since the previous gallery was created.
8. The app generates optimized web-size JPEG copies locally.
9. Only the optimized copies are uploaded to cloud storage.
10. The original/full-resolution images remain on the local event computer.
11. The app creates a unique gallery ID and URL.
12. A QR code is automatically generated for that gallery.
13. The guest scans the QR code or receives the URL.
14. The guest sees a lightweight gallery containing only their images.

---

## Example Guest URL

```text
https://photos.company.com/g/ABC123
```

Alternative:

```text
https://event.company.com/gallery/ABC123
```

The public URL should point to the application, not directly to the storage bucket.

---

## Gallery Grouping Logic

The application should maintain two basic image states:

```text
UNASSIGNED
ASSIGNED_TO_GALLERY
```

Example:

```text
Photo 001 -> Unassigned
Photo 002 -> Unassigned
Photo 003 -> Unassigned

[Finish Group]

Gallery ABC123
- Photo 001
- Photo 002
- Photo 003

Photo 004 -> Unassigned
Photo 005 -> Unassigned

[Finish Group]

Gallery DEF456
- Photo 004
- Photo 005
```

This avoids needing to manually select every image during a busy event.

---

## Review Stage

Before creating the gallery, staff should be able to quickly review the unassigned images.

Possible controls:

- Remove image from group
- Rotate image
- Mark image as rejected
- Select/deselect image
- Confirm gallery
- Cancel/reset group

The review interface should prioritize speed over advanced editing.

---

## Image Processing

Original files remain local.

Before uploading, generate a web-optimized JPEG copy.

Recommended defaults:

```text
Longest Edge: 2000 px
Format: JPEG
Quality: 80-90
Color Space: sRGB
Metadata: optional / minimal
```

The longest-edge value should be configurable.

Possible presets:

```text
Small: 1200 px
Standard: 2000 px
Large: 3000 px
```

For this event workflow, `2000 px` is probably the best default.

---

## Cloud Storage

### Recommended Architecture

Use an S3-compatible object storage service.

Initial implementation:

```text
Amazon AWS S3
```

Possible future alternatives:

```text
Cloudflare R2
Backblaze B2
Wasabi
DigitalOcean Spaces
```

The application should abstract the storage layer so switching providers later does not require rebuilding the application.

Example storage interface:

```text
upload()
delete()
exists()
getPublicUrl()
```

---

## Suggested S3 Structure

```text
event-photos/
    2026-event-name/
        ABC123/
            image-001.jpg
            image-002.jpg
            image-003.jpg

        DEF456/
            image-004.jpg
            image-005.jpg
```

Or:

```text
events/
    {event_id}/
        galleries/
            {gallery_id}/
                photo1.jpg
                photo2.jpg
```

---

## Local Storage Structure

Original photographs remain on the event machine.

Example:

```text
/event/
    originals/
    processed/
    queue/
```

Possible structure:

```text
/event/
    originals/
        DSC0001.ARW
        DSC0002.ARW

    processed/
        DSC0001.jpg
        DSC0002.jpg
```

The `processed` directory can be treated as temporary cache and cleaned after the event.

---

## Application Architecture

A simple architecture could look like:

```text
CAMERA
   |
   v
CAPTURE / IMPORT FOLDER
   |
   v
FOLDER WATCHER
   |
   v
UNASSIGNED IMAGE QUEUE
   |
   v
REVIEW SCREEN
   |
   v
[FINISH GROUP]
   |
   +----------------------+
   |                      |
   v                      v
RESIZE IMAGES        CREATE GALLERY
   |                      |
   v                      v
UPLOAD TO S3          DATABASE ENTRY
   |                      |
   +-----------+----------+
               |
               v
          GALLERY URL
               |
               v
            QR CODE
               |
               v
             GUEST
```

---

## Suggested Technology Stack

The system can remain relatively simple.

### Desktop / Event App

Possible options:

- Node.js
- Electron
- Tauri
- Local web application
- Python desktop utility

A Node-based application would work particularly well for:

- filesystem watching
- image processing
- AWS SDK integration
- QR generation
- background uploads

Useful Node packages could include equivalents for:

```text
Folder watching
Image resizing
AWS S3 uploads
QR generation
SQLite
```

Exact libraries can be selected during implementation.

---

## Database

SQLite should be sufficient for the event-side application.

Possible tables:

### events

```text
id
name
created_at
```

### galleries

```text
id
event_id
gallery_code
created_at
published_at
```

### photos

```text
id
gallery_id
original_filename
processed_filename
storage_key
created_at
```

---

## Gallery IDs

Gallery IDs should be:

- unique
- difficult to guess
- short enough for URLs
- QR friendly

Example:

```text
A7KD92
PX4M8Q
F3J9ZT
```

Avoid sequential IDs such as:

```text
/gallery/1
/gallery/2
/gallery/3
```

because guests could easily browse into another person's gallery.

---

## Guest Gallery

The guest-facing gallery should be extremely simple.

Recommended features:

- Event/company branding
- Photo thumbnails
- Tap/click to enlarge
- Download individual image
- Download all images
- Mobile-first layout
- Optional expiration message

The page should not require an account.

---

## Privacy

Since each QR code is effectively the guest's access credential:

- Use random gallery IDs.
- Avoid search engine indexing.
- Do not expose a directory of galleries.
- Consider automatically expiring galleries after a configured period.

Possible expiration options:

```text
24 hours
3 days
7 days
30 days
```

---

## QR Code Flow

Once upload and gallery creation are complete:

```text
Gallery created:
https://photos.company.com/g/A7KD92
```

Generate a QR code containing that URL.

The interface should immediately display:

```text
Gallery Ready

[ QR CODE ]

A7KD92

https://photos.company.com/g/A7KD92
```

Optional actions:

```text
Print QR
Copy URL
Text URL
Email URL
Start Next Guest
```

---

## Background Uploading

Uploading should not stop the photographer from continuing to shoot.

Ideal workflow:

```text
Guest A photographed
        |
Finish Group
        |
Upload begins
        |
Photographer immediately starts Guest B
        |
Guest A gallery finishes uploading
        |
QR becomes available
```

The UI should indicate upload state:

```text
Processing
Uploading
Ready
Failed
```

---

## Failure Handling

The app should gracefully handle unreliable event internet.

If upload fails:

```text
Gallery remains queued locally.
```

The system should retry automatically.

Suggested statuses:

```text
pending
processing
uploading
ready
failed
```

Manual retry should also be available.

---

## AWS Setup Notes

For AWS:

1. Create AWS account.
2. Enable multi-factor authentication.
3. Create an S3 bucket for event images.
4. Create a dedicated IAM identity/role for the application.
5. Grant only the permissions required for that bucket.
6. Store credentials in environment variables or secure application configuration.
7. Configure AWS billing/budget alerts.
8. Do not hardcode AWS credentials into the application.

Example environment configuration:

```text
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_BUCKET=
```

Do not commit these values to Git.

---

## MVP

The first version only needs to solve the event workflow.

### MVP Features

- [ ] Watch capture/import folder
- [ ] Detect new photos
- [ ] Display unassigned photos
- [ ] Review photos
- [ ] Finish/create gallery button
- [ ] Resize images locally
- [ ] Upload resized images to S3
- [ ] Store gallery metadata
- [ ] Generate unique gallery ID
- [ ] Generate public gallery URL
- [ ] Generate QR code
- [ ] Mobile guest gallery
- [ ] Individual photo download
- [ ] Upload status
- [ ] Retry failed uploads

---

## Later Features

Potential future additions:

- Automatic gallery expiration
- Event templates
- Custom company branding
- Multiple photographers
- Multiple tethered cameras
- SMS delivery
- Email delivery
- QR code printing
- Guest name entry
- Analytics
- Download tracking
- Password-protected galleries
- Automated deletion from S3
- Multiple storage providers
- Admin dashboard
- Gallery search
- Automated event cleanup
- Lightroom/watch-folder integration

---

## Important Design Principle

The system should treat the **Finish Group** button as the central action.

The photographer should not have to think about filenames, folders, storage keys, or cloud uploads while working.

The ideal experience is:

```text
SHOOT
   ↓
REVIEW
   ↓
FINISH GROUP
   ↓
QR CODE
```

Everything between **Finish Group** and **QR CODE** should happen automatically.

---

## Current Direction

For the initial build:

```text
Original files:
Local computer only

Web files:
~2000 px JPEG

Storage:
Amazon S3

Database:
SQLite

Delivery:
Unique gallery URL + QR code

Guest experience:
Simple mobile web gallery

Grouping method:
All unassigned images since the previous gallery
```

This keeps the system inexpensive, fast, and realistic for an event environment while leaving room to scale later.
