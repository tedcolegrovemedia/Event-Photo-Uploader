import { useCallback, useEffect, useState } from 'react';
import { eps, type AppState } from './api';
import PhotoGrid from './components/PhotoGrid';
import GalleryList from './components/GalleryList';
import QrPanel from './components/QrPanel';
import SettingsModal from './components/SettingsModal';

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void eps.getState().then(setState);
    return eps.onState(setState);
  }, []);

  const finishGroup = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const code = await eps.finishGroup();
      // Jump straight to the QR panel — the guest is waiting.
      if (code) setActiveCode(code);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Space is the fastest possible "Finish Group" for a photographer working
  // one-handed, but must not hijack typing in the settings sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';
      if (typing || showSettings) return;

      if (e.code === 'Space') {
        e.preventDefault();
        void finishGroup();
      }
      if (e.key === 'Escape') setActiveCode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finishGroup, showSettings]);

  if (!state) {
    return <div className="boot">Starting…</div>;
  }

  const keepers = state.unassigned.filter((p) => !p.rejected);
  const notConfigured =
    state.settings.storage.provider === 's3' && !state.settings.storage.bucket;

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-drag" />
        <div className="event">
          <span className="event-name">{state.event.name}</span>
          <span className={`watch ${state.watching ? 'on' : 'off'}`}>
            {state.watching ? 'Watching capture folder' : 'Not watching'}
          </span>
        </div>
        <button className="ghost" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </header>

      {notConfigured && (
        <div className="banner">
          No S3 bucket configured — open Settings before the event starts.
        </div>
      )}

      <main className="columns">
        <section className="review">
          <div className="review-head">
            <h2>
              Unassigned
              <span className="count">{keepers.length}</span>
            </h2>
            <p className="hint">
              Everything here goes into the next gallery. Press{' '}
              <kbd>Space</kbd> to finish the group.
            </p>
          </div>

          <PhotoGrid photos={state.unassigned} />

          <button
            className="finish"
            onClick={finishGroup}
            disabled={busy || keepers.length === 0}
          >
            {keepers.length === 0
              ? 'Waiting for photos…'
              : `Finish Group — ${keepers.length} photo${keepers.length === 1 ? '' : 's'}`}
          </button>
        </section>

        <aside className="sidebar">
          {activeCode ? (
            <QrPanel
              code={activeCode}
              gallery={state.galleries.find((g) => g.code === activeCode) ?? null}
              onClose={() => setActiveCode(null)}
            />
          ) : (
            <GalleryList galleries={state.galleries} onSelect={setActiveCode} />
          )}

          <details className="activity">
            <summary>Activity</summary>
            <ul>
              {state.log.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </details>
        </aside>
      </main>

      {showSettings && (
        <SettingsModal
          settings={state.settings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
