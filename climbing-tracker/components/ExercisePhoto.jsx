import { s, C } from "../styles.js";
import { useSession } from "../../shared/auth.js";
import { exercisePhotoUrls } from "../photos.js";
import { Icon } from "./Icons.jsx";

const { useState, useEffect } = React;

export function useExercisePhotos(exercise) {
  const session = useSession();
  return exercisePhotoUrls(exercise, session);
}

// Small square picture for list rows and card headers. Renders nothing for
// an exercise without a picture (or one that fails to load, e.g. offline
// and never seen); tapping it opens the viewer.
export function PhotoThumb({ exercise, size = 48, onOpen }) {
  const urls = useExercisePhotos(exercise);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [urls[0]]);
  if (urls.length === 0 || failed) return null;
  return (
    <button
      style={{ ...s.thumb, width: size, height: size }}
      onClick={e => { e.stopPropagation(); onOpen(); }}
      aria-label={`Show picture of ${exercise.name}`}
    >
      <img src={urls[0]} alt="" loading="lazy" style={s.thumbImg} onError={() => setFailed(true)} />
    </button>
  );
}

// Full-screen picture with the exercise's notes. Library stretches have two
// photos (held and start position); tapping the picture switches between them.
export function PhotoViewer({ exercise, onClose }) {
  const urls = useExercisePhotos(exercise);
  const [i, setI] = useState(0);

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div style={s.viewer} role="dialog" aria-modal="true" aria-label={exercise.name}>
      <div style={s.viewerHeader}>
        <span style={s.viewerTitle}>{exercise.name}</span>
        <button style={{ ...s.iconBtn, color: C.text }} onClick={onClose} aria-label="Close"><Icon.x /></button>
      </div>
      <div style={s.viewerBody}>
        {urls.length > 0 ? (
          <button style={s.viewerImgBtn} onClick={() => setI((i + 1) % urls.length)} aria-label={urls.length > 1 ? "Show the other picture" : undefined}>
            <img src={urls[i]} alt="" style={s.viewerImg} />
          </button>
        ) : (
          <div style={{ ...s.hint, textAlign: "center", padding: "40px 0" }}>No picture yet. Add one with Edit.</div>
        )}
        {urls.length > 1 && (
          <div style={s.viewerDots}>
            {urls.map((_, k) => <span key={k} style={{ ...s.viewerDot, ...(k === i && s.viewerDotActive) }} />)}
          </div>
        )}
        {exercise.notes && <div style={s.viewerNotes}>{exercise.notes}</div>}
      </div>
    </div>
  );
}
