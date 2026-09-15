# AWS setup — from a brand-new account

Everything here is done in the AWS Console by you. The app never creates AWS
resources and never asks for your root credentials.

Work through this in order. Budget about 30 minutes the first time.

Replace `YOUR-BUCKET-NAME` throughout — bucket names are globally unique across
all of AWS, so pick something like `acme-event-photos-2026`.

---

## 1. Secure the root account first

The root account (the email you signed up with) can do anything, including
closing the account and running up unlimited charges. Lock it down before
anything else.

1. Sign in as root → click your account name (top right) → **Security credentials**.
2. **Multi-factor authentication (MFA)** → *Assign MFA device*. Use an
   authenticator app or a passkey.
3. On the same page, confirm there are **no root access keys**. If any exist,
   delete them. Nothing should ever use root keys.

From here on, do not use root for daily work.

---

## 2. Set a budget alert before you upload anything

New accounts get 12 months of free tier, but S3 charges are easy to
underestimate once you are shipping thousands of photos.

1. **Billing and Cost Management** → **Budgets** → *Create budget*.
2. Choose **Zero spend budget** to be alerted at the first cent, or **Monthly
   cost budget** with a figure you are comfortable with (US$10 is a sane start).
3. Enter your email for alerts.

Also turn on **Billing alerts**: Billing → *Billing preferences* → check
*Receive Billing Alerts*.

### What this actually costs

For a typical event — 300 guests, 5 photos each, ~600 KB per 2000 px JPEG:

| Item | Volume | Cost |
| --- | --- | --- |
| Storage | ~0.9 GB/month | ~$0.02/month |
| Upload (PUT) | 1,500 requests | ~$0.01 |
| Guest downloads | ~3 GB egress | ~$0.27 |

Under a dollar per event. The thing that could surprise you is egress if a
gallery goes viral or a bot crawls it — hence the noindex headers and the
expiration setting.

---

## 3. Create the S3 bucket

1. **S3** → *Create bucket*.
2. **Bucket name**: `YOUR-BUCKET-NAME`
3. **Region**: pick the one closest to your events (e.g. `us-east-1`,
   `us-west-2`, `eu-west-2`). Write it down — the app needs it.
4. **Block Public Access**: leave **all four boxes checked** for now. Step 5
   decides how guests actually read the images.
5. **Bucket Versioning**: Disable. (Doubles storage for no benefit here.)
6. **Default encryption**: leave on SSE-S3.
7. Create.

---

## 4. Create an IAM user for the app

The app needs its own identity with only the permissions it uses. Never give it
your login.

1. **IAM** → **Users** → *Create user*.
2. Name: `event-photo-share-app`.
3. **Do not** check "Provide user access to the AWS Management Console" — this
   identity is for the API only.
4. On permissions, choose **Attach policies directly** → *Create policy* →
   **JSON** tab, and paste this, replacing the bucket name in both places:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadWriteEventPhotoObjects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
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
        "StringLike": {
          "s3:prefix": ["events/*", "g/*"]
        }
      }
    }
  ]
}
```

   Name it `EventPhotoShareBucketAccess` and create it, then attach it to the user.

5. Open the user → **Security credentials** → **Create access key** → choose
   *Application running outside AWS*.
6. You will see an **Access key ID** and a **Secret access key**. The secret is
   shown exactly once.

**Enter these two values directly into the app's Settings panel** (Storage
section). The app encrypts the secret into your macOS Keychain. Do not paste
them into a file in the project folder, and do not send them over chat or email.

---

## 5. Let guests' phones load the gallery

The manifest (`g/*.json`) is only ever written and read with the IAM
credentials above, so it stays private. Everything under `events/*` needs to be
readable by a phone: the photos, and in static delivery mode each gallery's
`index.html` as well. The rules below cover both. Pick one:

### Option A — public-read on the image prefix (simplest)

Guests' browsers fetch images straight from S3. The gallery codes are random, so
a URL is unguessable, and listing is never permitted.

1. S3 → your bucket → **Permissions** → **Block public access** → *Edit* →
   uncheck **Block all public access**, confirm.
2. Still under Permissions → **Bucket policy** → paste:

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

Note the resource is `events/*` only. The `g/*` manifests stay private, and
nobody can list the bucket to discover gallery codes.

In static mode this is the whole hosting setup. The gallery URL the QR encodes
looks like:

```
https://YOUR-BUCKET-NAME.s3.REGION.amazonaws.com/events/EVENT/g/A7KD92/index.html
```

It is served over HTTPS by S3 directly. You do **not** need to enable "Static
website hosting" on the bucket — that feature only adds HTTP-only endpoints and
directory index behaviour, neither of which the app relies on.

### Option B — CloudFront with Origin Access Control (recommended later)

Keeps Block Public Access fully on, adds a CDN so guests on venue wifi load
faster, and gives you a custom domain like `cdn.company.com`. More setup; worth
doing once the workflow is proven. Set the resulting domain as **CDN / custom
domain for images** in the app's settings.

---

## 6. CORS

Only needed if you later fetch images with JavaScript (the current gallery uses
plain `<img>` tags and the server-side zip, which do not require CORS). Add it
now if you plan to build a client-side downloader:

S3 → bucket → **Permissions** → **Cross-origin resource sharing (CORS)**:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["https://photos.company.com"],
    "ExposeHeaders": ["Content-Length"],
    "MaxAgeSeconds": 3000
  }
]
```

---

## 7. Automatic cleanup (optional)

The app writes an `expiresAt` into each manifest, which makes the gallery page
stop serving. That does not delete the files. To actually remove them and stop
paying for storage, add a lifecycle rule:

S3 → bucket → **Management** → **Lifecycle rules** → *Create rule*:

- Name: `expire-event-photos`
- Prefix: `events/`
- Action: **Expire current versions of objects** → *Days after object creation*: `90`

Add a second rule with prefix `g/` and the same window so manifests go too.

Keep the lifecycle window comfortably longer than the expiration you set in the
app, so a guest never gets a broken image on a page that still claims to work.

---

## 8. Fill in the app

In Event Uploader → **Settings** → **Storage**:

| Field | Value |
| --- | --- |
| Delivery (section above Storage) | Static page in the bucket |
| Provider | Amazon S3 |
| Bucket | `YOUR-BUCKET-NAME` |
| Region | the region from step 3 |
| Access key ID | from step 4 |
| Secret access key | from step 4 |
| CDN / custom domain | blank for Option A, CloudFront domain for Option B |
| Custom endpoint | blank for AWS |

Click **Save**, then **Test connection**. It writes and deletes a tiny probe
object under `g/` — the same permissions a real upload needs — and reports S3's
own reason if that fails.

Then do the real test: drop one JPEG in the capture folder, press **Finish
Group**, wait for *Gallery Ready*, and scan the QR with your phone on mobile
data rather than the same wifi. You should see the page, tap a photo, and get a
zip from *Download all*.

---

## Troubleshooting

**`Access denied` on test connection** — the bucket name in the IAM policy's
object ARNs does not match the bucket in Settings, or the policy is not attached
to the user whose key you pasted. The object ARNs must end in `/events/*` and
`/g/*`.

**The access key ID is not recognised** — the key was deleted or belongs to a
different AWS account. **The secret access key is wrong** — it was truncated on
paste; create a new key and re-enter both halves.

**Uploads work but guests see broken images** — two causes, check both.

First, **"CDN / custom domain for images" must be blank** unless you really have
a CDN. If it points at `localhost`, uploads succeed and the QR resolves, but the
manifest tells the *guest's* phone to fetch images from *its own* localhost — so
every photo is broken while everything looks healthy on the event machine. The
app now refuses to save that combination, but any gallery published before that
check existed has bad URLs baked into its manifest and must be re-published.

Second, the bucket policy from step 5 may be missing or pointed at the wrong
prefix. Open one image URL from the manifest in a private browser window to tell
the two apart: a 403 means the bucket policy, a connection refused means the
localhost problem.

**`The bucket you are attempting to access must be addressed using the specified
endpoint`** — the region in Settings does not match the bucket's actual region.

---

## If a key leaks

1. IAM → Users → `event-photo-share-app` → Security credentials.
2. **Deactivate** the exposed key, create a new one, update the app, then
   **Delete** the old key.

Rotating takes under a minute. Do it any time a key has touched a shared
machine, a screenshot, or a chat window.
