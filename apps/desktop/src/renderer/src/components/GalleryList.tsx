import { eps, type GalleryView } from '../api';

interface Props {
  galleries: GalleryView[];
  onSelect: (code: string) => void;
}

const STATUS_LABEL: Record<GalleryView['status'], string> = {
  pending: 'Queued',
  processing: 'Processing',
  uploading: 'Uploading',
  ready: 'Ready',
  failed: 'Failed',
};

export default function GalleryList({ galleries, onSelect }: Props) {
  return (
    <div className="panel">
      <h2>Galleries</h2>

      {galleries.length === 0 && (
        <p className="hint">Published galleries will show up here.</p>
      )}

      <ul className="gallery-list">
        {galleries.map((g) => (
          <li key={g.id} className={`gallery ${g.status}`}>
            <button className="gallery-main" onClick={() => onSelect(g.code)}>
              <span className="code">{g.code}</span>
              <span className="meta">
                {g.photoCount} photo{g.photoCount === 1 ? '' : 's'}
              </span>
              <span className={`status ${g.status}`}>{STATUS_LABEL[g.status]}</span>
            </button>

            {g.status === 'failed' && (
              <div className="failure">
                <p title={g.error ?? ''}>{g.error ?? 'Upload failed'}</p>
                <button onClick={() => void eps.retryGallery(g.id)}>
                  Retry now
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
