import { DEFAULT_BUTTON_COLOR, contrastingText, normalizeHexColor } from './theme';
import type { GalleryLinks, GalleryManifest } from './types';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * The guest page is always dark: brand logos are white-on-transparent (they
 * double as the photo watermark), and the design keeps every section on black
 * so photos are the only colour on screen apart from the download button.
 */
const STYLE = `
:root { color-scheme: dark; --bg:#050505; --panel:#0f0f0f; --fg:#f2f2f2; --muted:#b8b8b8;
  --line:#1e1e1e; --tile:#d4d4d4; }
* { box-sizing: border-box; }
html { background:var(--bg); }
body { margin:0; background:var(--bg); color:var(--fg);
  font:15px/1.45 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; min-height:100vh; display:flex; flex-direction:column; }
header { padding:34px 24px 26px; text-align:center; border-bottom:1px solid var(--line); }
.logo-link { display:inline-block; }
.logo { display:block; margin:0 auto 26px; max-width:min(260px, 62vw); max-height:120px; width:auto; height:auto; }
h1 { margin:0 0 6px; font-size:24px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; line-height:1.15; }
.sub { color:var(--muted); font-size:14px; letter-spacing:.01em; }
main { background:var(--panel); padding:30px 30px 30px; flex:1; }
.grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; max-width:1100px; margin:0 auto; }
@media (min-width:700px) { .grid { grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px; } }
.grid a { display:block; aspect-ratio:1; overflow:hidden; background:var(--tile); }
.grid img { width:100%; height:100%; object-fit:cover; display:block; }
.actions { padding:34px 44px 30px; text-align:center; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
.btn { display:block; width:100%; max-width:480px; margin:0 auto; background:var(--accent); color:var(--accent-fg);
  text-decoration:none; border:0; font:inherit; font-weight:700; font-size:15px; letter-spacing:.06em;
  text-transform:uppercase; cursor:pointer; padding:19px 20px; }
.btn[disabled] { opacity:.6; cursor:default; }
.progress { color:var(--muted); font-size:13px; margin-top:10px; min-height:1.2em; }
.note { color:var(--fg); font-size:12.5px; line-height:1.45; margin:22px 0 0; }
.social { display:flex; justify-content:center; align-items:center; gap:14px; padding:26px 20px calc(26px + env(safe-area-inset-bottom)); }
.social a, .social span { display:inline-flex; align-items:center; justify-content:center; height:46px; min-width:46px; color:#fff; }
.social svg { width:44px; height:44px; display:block; }
.social img { display:block; max-height:44px; max-width:120px; width:auto; height:auto; }
dialog { border:0; background:#000; color:#fff; max-width:100vw; max-height:100vh; padding:0; }
dialog::backdrop { background:#000; }
dialog img { max-width:100vw; max-height:85vh; display:block; margin:auto; }
.viewer-bar { text-align:center; padding:12px; }
.viewer-bar a, .viewer-bar button { color:#fff; background:#2a2a2a; border:0;
  font:inherit; padding:10px 18px; text-decoration:none; cursor:pointer; margin:0 4px; }
.viewer-bar a:active, .viewer-bar button:active { background:#3a3a3a; }
.empty { text-align:center; color:var(--muted); padding:60px 20px; }
.empty h1 { color:var(--fg); }
`;

/** Per-gallery colours; everything else in STYLE is fixed by the design. */
function themeStyle(m?: GalleryManifest): string {
  const accent = normalizeHexColor(m?.theme?.buttonColor ?? '') ?? DEFAULT_BUTTON_COLOR;
  return `:root { --accent:${accent}; --accent-fg:${contrastingText(accent)}; }`;
}

const HEAD = (title: string, m?: GalleryManifest): string => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#050505">
<title>${esc(title)}</title>
<style>${STYLE}${themeStyle(m)}</style>`;

const VIEWER = `<dialog id="viewer">
  <img id="viewer-img" alt="">
  <div class="viewer-bar">
    <button id="prev">Prev</button>
    <a id="dl" download>Download</a>
    <button id="next">Next</button>
    <button id="close">Close</button>
  </div>
</dialog>`;

const VIEWER_SCRIPT = `
  var dlg = document.getElementById('viewer');
  var img = document.getElementById('viewer-img');
  var dl = document.getElementById('dl');
  var i = 0;

  function show(n) {
    i = (n + photos.length) % photos.length;
    img.src = photos[i].url;
    img.alt = 'Photo ' + (i + 1) + ' of ' + photos.length;
    dl.href = photos[i].url;
    dl.setAttribute('download', photos[i].name);
  }

  document.querySelectorAll('.grid a').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      show(Number(a.dataset.i));
      dlg.showModal();
    });
  });

  document.getElementById('next').onclick = function () { show(i + 1); };
  document.getElementById('prev').onclick = function () { show(i - 1); };
  document.getElementById('close').onclick = function () { dlg.close(); };
  document.addEventListener('keydown', function (e) {
    if (!dlg.open) return;
    if (e.key === 'ArrowRight') show(i + 1);
    if (e.key === 'ArrowLeft') show(i - 1);
  });
`;

const ICON_INSTAGRAM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="2.5" y="2.5" width="19" height="19" rx="5.2"/>
  <circle cx="12" cy="12" r="4.3"/>
  <circle cx="17.4" cy="6.6" r="1.15" fill="currentColor" stroke="none"/>
</svg>`;

const ICON_FACEBOOK = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z"/>
</svg>`;

const ICON_TIKTOK = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M16.6 2h-3.3v13.6a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.4a6.2 6.2 0 1 0 5.3 6.2V8.7a7.5 7.5 0 0 0 4.4 1.4V6.8a4.4 4.4 0 0 1-4.4-4.8z"/>
</svg>`;

function tiles(m: GalleryManifest, src: (p: GalleryManifest['photos'][number]) => string): string {
  const count = m.photos.length;
  return m.photos
    .map(
      (p, i) => `<a href="#" data-i="${i}" aria-label="Photo ${i + 1}">
      <img src="${esc(src(p))}" alt="Photo ${i + 1} of ${count}" loading="lazy"
           width="${p.width}" height="${p.height}"></a>`,
    )
    .join('\n');
}

/** Guest-facing links always open a new tab and never leak the gallery URL. */
const EXT = 'target="_blank" rel="noopener noreferrer"';

/**
 * Brand header. The event logo is the watermark PNG; when the operator has set
 * a link for it, the whole logo becomes the tap target.
 */
function header(m: GalleryManifest, logoSrc: string | null): string {
  const count = m.photos.length;
  const sub = `${count} photo${count === 1 ? '' : 's'} &middot; ${esc(m.code)}`;
  const href = m.links?.eventLogoHref;
  let logo = '';
  if (logoSrc) {
    const img = `<img class="logo" src="${esc(logoSrc)}" alt="${esc(m.event.name)}">`;
    logo = href
      ? `<a class="logo-link" href="${esc(href)}" ${EXT} aria-label="${esc(m.event.name)}">${img}</a>\n  `
      : `${img}\n  `;
  }
  return `<header>
  ${logo}<h1>${esc(m.event.name)}</h1>
  <div class="sub">${sub}</div>
</header>`;
}

/**
 * Footer icon row. Each item appears only when the operator has configured it;
 * with nothing configured the whole row is omitted.
 */
function social(links: GalleryLinks | undefined, companySrc: string | null): string {
  if (!links) return '';
  const items: string[] = [];
  if (links.instagram) {
    items.push(`<a href="${esc(links.instagram)}" ${EXT} aria-label="Instagram">${ICON_INSTAGRAM}</a>`);
  }
  if (links.facebook) {
    items.push(`<a href="${esc(links.facebook)}" ${EXT} aria-label="Facebook">${ICON_FACEBOOK}</a>`);
  }
  if (links.tiktok) {
    items.push(`<a href="${esc(links.tiktok)}" ${EXT} aria-label="TikTok">${ICON_TIKTOK}</a>`);
  }
  if (links.company && companySrc) {
    const img = `<img src="${esc(companySrc)}" alt="">`;
    items.push(
      links.company.href
        ? `<a href="${esc(links.company.href)}" ${EXT} aria-label="Company website">${img}</a>`
        : `<span>${img}</span>`,
    );
  }
  if (items.length === 0) return '';
  return `<footer class="social">
  ${items.join('\n  ')}
</footer>`;
}

function availability(m: GalleryManifest): string {
  return m.expiresAt
    ? `Available until ${new Date(m.expiresAt).toLocaleDateString()}.`
    : 'Save your photos to keep them.';
}

const NOTE = 'Tap a photo to view it full size, then use Download.';

/**
 * Server-rendered page: the gallery web app calls this per request and streams
 * the zip itself, so "Download all" is a plain link.
 */
export function renderGallery(m: GalleryManifest, downloadAllUrl: string): string {
  const photoData = JSON.stringify(m.photos.map((p) => ({ url: p.url, name: p.filename })));

  return `<!doctype html>
<html lang="en">
<head>
${HEAD(`${m.event.name} — Your Photos`, m)}
</head>
<body>
${header(m, m.logo?.url ?? null)}

<main>
  <div class="grid">${tiles(m, (p) => p.url)}</div>
</main>

<div class="actions">
  <a class="btn" href="${esc(downloadAllUrl)}">Download all photos</a>
  <p class="note">${availability(m)}<br>${NOTE}</p>
</div>

${social(m.links, m.links?.company?.url ?? null)}

${VIEWER}

<script>
(function () {
  var photos = ${photoData};
${VIEWER_SCRIPT}
})();
</script>
</body>
</html>`;
}

/**
 * Static page: written into the bucket next to the photos, so the QR code can
 * point straight at object storage with no server in between.
 *
 * Photos are referenced by relative filename, which keeps the page correct no
 * matter which hostname the bucket is reached through (raw S3, CloudFront, a
 * custom domain). Because page and photos share an origin, per-photo downloads
 * work with a plain `download` attribute and the zip is built in the browser
 * from same-origin fetches — no CORS configuration needed. Expiry is enforced
 * client-side for the message only; actual deletion is the bucket lifecycle
 * rule's job.
 */
export function renderStaticGallery(m: GalleryManifest): string {
  const photoData = JSON.stringify(m.photos.map((p) => ({ url: p.filename, name: p.filename })));
  const zipName = `${m.event.slug}-${m.code}.zip`;

  return `<!doctype html>
<html lang="en">
<head>
${HEAD(`${m.event.name} — Your Photos`, m)}
</head>
<body>
${header(m, m.logo?.filename ?? null)}

<main id="main">
  <div class="grid">${tiles(m, (p) => p.filename)}</div>
</main>

<div class="actions" id="actions">
  <button class="btn" id="zip" type="button">Download all photos</button>
  <div class="progress" id="progress"></div>
  <p class="note">${availability(m)}<br>${NOTE}</p>
</div>

${social(m.links, m.links?.company?.filename ?? null)}

${VIEWER}

<script>
(function () {
  var photos = ${photoData};
  var expiresAt = ${JSON.stringify(m.expiresAt)};
  var zipName = ${JSON.stringify(zipName)};

  if (expiresAt && new Date(expiresAt) <= new Date()) {
    document.body.innerHTML =
      '<div class="empty"><h1>This gallery has expired</h1>' +
      '<p>Photos from ${esc(m.event.name)} were available until ' +
      new Date(expiresAt).toLocaleDateString() +
      '.<br>Please contact the photography team if you still need them.</p></div>';
    return;
  }
${VIEWER_SCRIPT}

  // "Download all" — zip built in the browser. JSZip is loaded on demand so the
  // gallery itself never depends on a third-party script.
  var zipBtn = document.getElementById('zip');
  var progress = document.getElementById('progress');

  function loadJsZip() {
    return new Promise(function (resolve, reject) {
      if (window.JSZip) return resolve(window.JSZip);
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      // Subresource integrity: the browser refuses anything but this exact file.
      s.integrity = 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG';
      s.crossOrigin = 'anonymous';
      s.onload = function () { resolve(window.JSZip); };
      s.onerror = function () { reject(new Error('Could not load zip library')); };
      document.head.appendChild(s);
    });
  }

  zipBtn.addEventListener('click', function () {
    zipBtn.disabled = true;
    progress.textContent = 'Preparing…';
    loadJsZip()
      .then(function (JSZip) {
        var zip = new JSZip();
        var done = 0;
        return photos
          .reduce(function (chain, p) {
            return chain.then(function () {
              return fetch(p.url).then(function (r) {
                if (!r.ok) throw new Error('Failed to fetch ' + p.name);
                return r.arrayBuffer();
              }).then(function (buf) {
                zip.file(p.name, buf);
                done++;
                progress.textContent = 'Fetched ' + done + ' of ' + photos.length;
              });
            });
          }, Promise.resolve())
          .then(function () {
            progress.textContent = 'Packing…';
            return zip.generateAsync({ type: 'blob', compression: 'STORE' });
          });
      })
      .then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
        progress.textContent = 'Done — check your downloads.';
      })
      .catch(function (err) {
        progress.textContent = (err && err.message) || 'Download failed. Tap a photo to save it individually.';
      })
      .then(function () { zipBtn.disabled = false; });
  });
})();
</script>
</body>
</html>`;
}

export function renderNotFound(): string {
  return `<!doctype html>
<html lang="en">
<head>
${HEAD('Gallery not found')}
</head>
<body>
  <div class="empty">
    <h1>Gallery not found</h1>
    <p>This link may have expired, or the code was mistyped.<br>
       Please check with the photography team.</p>
  </div>
</body>
</html>`;
}

export function renderExpired(m: GalleryManifest): string {
  return `<!doctype html>
<html lang="en">
<head>
${HEAD('Gallery expired')}
</head>
<body>
  <div class="empty">
    <h1>This gallery has expired</h1>
    <p>Photos from ${esc(m.event.name)} were available until
       ${m.expiresAt ? new Date(m.expiresAt).toLocaleDateString() : ''}.<br>
       Please contact the photography team if you still need them.</p>
  </div>
</body>
</html>`;
}
