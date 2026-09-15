import { useEffect, useState } from 'react';
import { eps, type GalleryView } from '../api';

interface Props {
  code: string;
  gallery: GalleryView | null;
  onClose: () => void;
}

/**
 * What the guest actually sees. The QR is rendered as soon as the gallery is
 * created, but stays visibly "not ready" until the upload lands — scanning early
 * would hit a 404 because the manifest is written last.
 */
export default function QrPanel({ code, gallery, onClose }: Props) {
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void eps.getQr(code).then((res) => {
      if (!cancelled) setQr(res);
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const ready = gallery?.status === 'ready';
  const failed = gallery?.status === 'failed';

  const copy = async () => {
    if (!qr) return;
    await eps.copyText(qr.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="panel qr-panel">
      <div className="qr-head">
        <h2>{ready ? 'Gallery Ready' : failed ? 'Upload Failed' : 'Preparing…'}</h2>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>

      <div className={`qr ${ready ? '' : 'dim'}`}>
        {qr ? <img src={qr.dataUrl} alt={`QR code for gallery ${code}`} /> : null}
        {!ready && !failed && <div className="qr-overlay">Uploading…</div>}
      </div>

      <div className="qr-code">{code}</div>
      <div className="qr-url">{qr?.url}</div>

      {failed && (
        <div className="failure">
          <p>{gallery?.error ?? 'Upload failed'}</p>
          <button onClick={() => gallery && void eps.retryGallery(gallery.id)}>
            Retry now
          </button>
        </div>
      )}

      <div className="qr-actions">
        <button onClick={copy} disabled={!qr}>
          {copied ? 'Copied' : 'Copy URL'}
        </button>
        <button onClick={() => void eps.printQr(code)} disabled={!qr}>
          Print QR
        </button>
        <button
          onClick={() => qr && void eps.openExternal(qr.url)}
          disabled={!qr || !ready}
        >
          Open
        </button>
      </div>

      <button className="next" onClick={onClose}>
        Start Next Guest
      </button>
    </div>
  );
}
