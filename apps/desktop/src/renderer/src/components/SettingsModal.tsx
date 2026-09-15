import { useState } from 'react';
import type { AppSettings } from '@eps/core';
import { eps, type TestResult } from '../api';

interface Props {
  settings: AppSettings;
  onClose: () => void;
}

const PRESETS = [
  { label: 'Small — 1200 px', value: 1200 },
  { label: 'Standard — 2000 px', value: 2000 },
  { label: 'Large — 3000 px', value: 3000 },
];

const EXPIRY = [
  { label: 'Never', value: null },
  { label: '24 hours', value: 1 },
  { label: '3 days', value: 3 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
];

// The renderer only takes types from @eps/core (its runtime pulls in sharp and
// Node APIs), so this mirrors normalizeHexColor from packages/core/src/theme.ts.
const DEFAULT_BUTTON_COLOR = '#8a9a2b';
const normalizeHexColor = (input: string): string | null => {
  const raw = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) return '#' + raw.split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(raw)) return '#' + raw;
  return null;
};

export default function SettingsModal({ settings, onClose }: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [test, setTest] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const setStorage = <K extends keyof AppSettings['storage']>(
    key: K,
    value: AppSettings['storage'][K],
  ) => setDraft((d) => ({ ...d, storage: { ...d.storage, [key]: value } }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await eps.saveSettings(draft);
      if (res.ok) {
        onClose();
      } else {
        setIssues(
          Object.fromEntries(res.issues.map((i) => [i.field, i.message])),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const pickFolder = async (key: 'watchFolder' | 'workDir') => {
    const picked = await eps.chooseFolder(draft[key]);
    if (picked) set(key, picked);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <section>
          <h3>Event</h3>
          <label>
            Event name
            <input
              value={draft.eventName}
              onChange={(e) => set('eventName', e.target.value)}
            />
          </label>
          {issues.eventName && <p className="error">{issues.eventName}</p>}

          <label>
            Capture folder to watch
            <div className="row">
              <input
                value={draft.watchFolder}
                onChange={(e) => set('watchFolder', e.target.value)}
              />
              <button onClick={() => void pickFolder('watchFolder')}>Choose…</button>
            </div>
          </label>
          {issues.watchFolder && <p className="error">{issues.watchFolder}</p>}

          <label>
            Working folder (processed cache + database)
            <div className="row">
              <input
                value={draft.workDir}
                onChange={(e) => set('workDir', e.target.value)}
              />
              <button onClick={() => void pickFolder('workDir')}>Choose…</button>
            </div>
          </label>
        </section>

        <section>
          <h3>Image size</h3>
          <label>
            Longest edge
            <select
              value={
                PRESETS.some((p) => p.value === draft.longestEdge)
                  ? String(draft.longestEdge)
                  : 'custom'
              }
              onChange={(e) => {
                if (e.target.value !== 'custom') {
                  set('longestEdge', Number(e.target.value));
                }
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>

          <label>
            Custom longest edge (px)
            <input
              type="number"
              min={600}
              max={6000}
              value={draft.longestEdge}
              onChange={(e) => set('longestEdge', Number(e.target.value))}
            />
          </label>
          {issues.longestEdge && <p className="error">{issues.longestEdge}</p>}

          <label>
            JPEG quality: {draft.jpegQuality}
            <input
              type="range"
              min={50}
              max={100}
              value={draft.jpegQuality}
              onChange={(e) => set('jpegQuality', Number(e.target.value))}
            />
          </label>
        </section>

        <section>
          <h3>Watermark</h3>
          <label>
            Watermark PNG (leave blank for none)
            <div className="row">
              <input
                value={draft.watermarkPath}
                placeholder="/path/to/watermark.png"
                onChange={(e) => set('watermarkPath', e.target.value)}
              />
              <button
                onClick={() =>
                  void eps.chooseFile(draft.watermarkPath).then((p) => {
                    if (p) set('watermarkPath', p);
                  })
                }
              >
                Choose…
              </button>
              {draft.watermarkPath && (
                <button className="ghost" onClick={() => set('watermarkPath', '')}>
                  Clear
                </button>
              )}
            </div>
          </label>
          {issues.watermarkPath && <p className="error">{issues.watermarkPath}</p>}

          {draft.watermarkPath && (
            <>
              <label>
                Width: {draft.watermarkWidthPercent}% of the photo
                <input
                  type="range"
                  min={2}
                  max={60}
                  value={draft.watermarkWidthPercent}
                  onChange={(e) => set('watermarkWidthPercent', Number(e.target.value))}
                />
              </label>
              {issues.watermarkWidthPercent && (
                <p className="error">{issues.watermarkWidthPercent}</p>
              )}

              <label>
                Margin from left and bottom edges (px)
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={draft.watermarkMargin}
                  onChange={(e) => set('watermarkMargin', Number(e.target.value))}
                />
              </label>
              {issues.watermarkMargin && <p className="error">{issues.watermarkMargin}</p>}
              <p className="hint">
                Placed bottom-left on every photo, and shown as the logo at the top
                of each gallery page. Applies to galleries published after you save;
                already-published galleries are not changed.
              </p>
            </>
          )}
        </section>

        <section>
          <h3>Gallery page</h3>
          <p className="hint">
            Links and branding on the page guests open from the QR code. Anything
            left blank is simply not shown.
          </p>

          <label>
            Event logo links to (optional)
            <input
              value={draft.eventLogoUrl}
              placeholder="https://example.com/event"
              onChange={(e) => set('eventLogoUrl', e.target.value)}
            />
          </label>
          {issues.eventLogoUrl && <p className="error">{issues.eventLogoUrl}</p>}
          {!draft.watermarkPath && draft.eventLogoUrl && (
            <p className="hint">
              The event logo is the watermark PNG above — set one for this link to
              have something to attach to.
            </p>
          )}

          <label>
            Instagram handle (optional)
            <input
              value={draft.instagramHandle}
              placeholder="@yourhandle"
              onChange={(e) => set('instagramHandle', e.target.value)}
            />
          </label>
          {issues.instagramHandle && <p className="error">{issues.instagramHandle}</p>}

          <label>
            Facebook page (optional)
            <input
              value={draft.facebookPage}
              placeholder="YourPage or https://facebook.com/YourPage"
              onChange={(e) => set('facebookPage', e.target.value)}
            />
          </label>
          {issues.facebookPage && <p className="error">{issues.facebookPage}</p>}

          <label>
            TikTok handle (optional)
            <input
              value={draft.tiktokHandle}
              placeholder="@yourhandle"
              onChange={(e) => set('tiktokHandle', e.target.value)}
            />
          </label>
          {issues.tiktokHandle && <p className="error">{issues.tiktokHandle}</p>}

          <label>
            Company logo PNG (optional, shown in the page footer)
            <div className="row">
              <input
                value={draft.companyLogoPath}
                placeholder="/path/to/company-logo.png"
                onChange={(e) => set('companyLogoPath', e.target.value)}
              />
              <button
                onClick={() =>
                  void eps.chooseFile(draft.companyLogoPath).then((p) => {
                    if (p) set('companyLogoPath', p);
                  })
                }
              >
                Choose…
              </button>
              {draft.companyLogoPath && (
                <button className="ghost" onClick={() => set('companyLogoPath', '')}>
                  Clear
                </button>
              )}
            </div>
          </label>
          {issues.companyLogoPath && <p className="error">{issues.companyLogoPath}</p>}

          {draft.companyLogoPath && (
            <>
              <label>
                Company logo links to (optional)
                <input
                  value={draft.companyLogoUrl}
                  placeholder="https://www.company.com"
                  onChange={(e) => set('companyLogoUrl', e.target.value)}
                />
              </label>
              {issues.companyLogoUrl && <p className="error">{issues.companyLogoUrl}</p>}
            </>
          )}
          <label>
            "Download all photos" button colour
            <div className="row">
              <input
                type="color"
                className="swatch"
                value={normalizeHexColor(draft.buttonColor) ?? DEFAULT_BUTTON_COLOR}
                onChange={(e) => set('buttonColor', e.target.value)}
              />
              <input
                value={draft.buttonColor}
                placeholder={DEFAULT_BUTTON_COLOR}
                onChange={(e) => set('buttonColor', e.target.value)}
              />
              {normalizeHexColor(draft.buttonColor) !== DEFAULT_BUTTON_COLOR && (
                <button className="ghost" onClick={() => set('buttonColor', DEFAULT_BUTTON_COLOR)}>
                  Reset
                </button>
              )}
            </div>
          </label>
          {issues.buttonColor && <p className="error">{issues.buttonColor}</p>}
          <p className="hint">
            Applies to galleries published after you save; already-published
            galleries are not changed.
          </p>
        </section>

        <section>
          <h3>Delivery</h3>
          <label>
            How guests open a gallery
            <select
              value={draft.deliveryMode}
              onChange={(e) =>
                set('deliveryMode', e.target.value as AppSettings['deliveryMode'])
              }
            >
              <option value="static">Static page in the bucket (no server needed)</option>
              <option value="server">Gallery web app (self-hosted server)</option>
            </select>
          </label>
          {issues.deliveryMode && <p className="error">{issues.deliveryMode}</p>}

          {draft.deliveryMode === 'static' ? (
            <p className="hint">
              Each gallery is written as an index.html next to its photos. The
              QR code points straight at the bucket (or your CDN domain, if set
              below). The bucket policy must allow public read on{' '}
              <code>events/*</code>.
            </p>
          ) : (
            <>
              <label>
                Public gallery URL (the web app, not the bucket)
                <input
                  value={draft.publicBaseUrl}
                  placeholder="https://photos.company.com"
                  onChange={(e) => set('publicBaseUrl', e.target.value)}
                />
              </label>
              {issues.publicBaseUrl && <p className="error">{issues.publicBaseUrl}</p>}
            </>
          )}

          <label>
            Galleries expire after
            <select
              value={String(draft.expiresInDays)}
              onChange={(e) =>
                set(
                  'expiresInDays',
                  e.target.value === 'null' ? null : Number(e.target.value),
                )
              }
            >
              {EXPIRY.map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section>
          <h3>Storage</h3>
          <label>
            Provider
            <select
              value={draft.storage.provider}
              onChange={(e) =>
                setStorage('provider', e.target.value as 's3' | 'local')
              }
            >
              <option value="s3">Amazon S3 (or S3-compatible)</option>
              <option value="local">Local folder (testing / rehearsal)</option>
            </select>
          </label>

          {draft.storage.provider === 's3' && (
            <>
              <label>
                Bucket
                <input
                  value={draft.storage.bucket}
                  onChange={(e) => setStorage('bucket', e.target.value)}
                />
              </label>
              {issues['storage.bucket'] && (
                <p className="error">{issues['storage.bucket']}</p>
              )}

              <label>
                Region
                <input
                  value={draft.storage.region}
                  placeholder="us-east-1"
                  onChange={(e) => setStorage('region', e.target.value)}
                />
              </label>

              <label>
                Access key ID
                <input
                  value={draft.storage.accessKeyId}
                  autoComplete="off"
                  onChange={(e) => setStorage('accessKeyId', e.target.value)}
                />
              </label>

              <label>
                Secret access key
                <input
                  type="password"
                  value={draft.storage.secretAccessKey}
                  autoComplete="off"
                  onChange={(e) => setStorage('secretAccessKey', e.target.value)}
                />
              </label>
              <p className="hint">
                Stored encrypted in your macOS Keychain, never in the project
                folder.
              </p>

              <label>
                CDN / custom domain for images (optional)
                <input
                  value={draft.storage.publicAssetBaseUrl ?? ''}
                  placeholder="https://cdn.company.com"
                  onChange={(e) => setStorage('publicAssetBaseUrl', e.target.value)}
                />
              </label>
              {issues['storage.publicAssetBaseUrl'] && (
                <p className="error">{issues['storage.publicAssetBaseUrl']}</p>
              )}

              <label>
                Custom endpoint (R2 / B2 / Wasabi — leave blank for AWS)
                <input
                  value={draft.storage.endpoint ?? ''}
                  onChange={(e) => setStorage('endpoint', e.target.value)}
                />
              </label>
            </>
          )}

          <div className="row">
            <button onClick={() => void eps.testStorage().then(setTest)}>
              Test connection
            </button>
            {test && (
              <span className={test.ok ? 'ok' : 'error'}>{test.message}</span>
            )}
          </div>
          <p className="hint">
            Save first — the test uses the last saved credentials.
          </p>
        </section>

        <footer className="modal-actions">
          <button className="ghost" onClick={() => void eps.revealWorkDir()}>
            Open working folder
          </button>
          <div className="spacer" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
