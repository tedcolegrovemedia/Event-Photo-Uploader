import { eps, type PhotoView } from '../api';

interface Props {
  photos: PhotoView[];
}

/**
 * Review is deliberately shallow: rotate, reject, remove. Anything more and the
 * queue backs up while a guest waits.
 */
export default function PhotoGrid({ photos }: Props) {
  if (photos.length === 0) {
    return (
      <div className="grid empty">
        <p>No photos yet. Shoot a guest and they will appear here.</p>
      </div>
    );
  }

  return (
    <div className="grid">
      {photos.map((photo) => (
        <figure
          key={photo.id}
          className={`tile ${photo.rejected ? 'rejected' : ''}`}
        >
          <div className="thumb">
            {photo.thumbnailUrl ? (
              <img
                src={photo.thumbnailUrl}
                alt={photo.filename}
                style={{ transform: `rotate(${photo.rotation}deg)` }}
                draggable={false}
              />
            ) : (
              <div className="pending">Loading…</div>
            )}
          </div>

          <figcaption>{photo.filename}</figcaption>

          <div className="tile-actions">
            <button
              title="Rotate left"
              onClick={() => void eps.rotatePhoto(photo.id, -90)}
            >
              ⟲
            </button>
            <button
              title="Rotate right"
              onClick={() => void eps.rotatePhoto(photo.id, 90)}
            >
              ⟳
            </button>
            <button
              title={photo.rejected ? 'Include in gallery' : 'Exclude from gallery'}
              className={photo.rejected ? 'active' : ''}
              onClick={() => void eps.rejectPhoto(photo.id, !photo.rejected)}
            >
              {photo.rejected ? '↩' : '✕'}
            </button>
            <button
              title="Remove from queue (keeps the original file)"
              onClick={() => void eps.discardPhoto(photo.id)}
            >
              🗑
            </button>
          </div>
        </figure>
      ))}
    </div>
  );
}
