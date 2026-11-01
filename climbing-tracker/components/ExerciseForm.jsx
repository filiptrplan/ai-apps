import { s, C } from "../styles.js";
import { EXERCISE_TYPES, defaultFieldsForType } from "../format.js";
import { NumberField } from "./NumberField.jsx";
import { Icon } from "./Icons.jsx";
import { StretchLibraryPicker } from "./StretchLibraryPicker.jsx";
import { useSession } from "../../shared/auth.js";
import { compressPhoto, exercisePhotoUrls } from "../photos.js";

const { useState } = React;

export function Segmented({ options, value, onChange }) {
  return (
    <div style={s.segmented}>
      {options.map(o => (
        <button
          key={o.value}
          style={{ ...s.segment, ...(value === o.value ? s.segmentActive : {}) }}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const WEIGHT_MODES = [{ value: "added", label: "Bodyweight + kg" }, { value: "total", label: "Total weight" }];
const SIDES = [{ value: false, label: "One side" }, { value: true, label: "Both sides" }];

// The exercise's picture: a stretch library photo or an uploaded one.
// A newly picked file sits in draft.photoUpload ({ blob, preview }) and is
// uploaded on save. Uploads need an account; library photos don't.
function PictureField({ draft, set }) {
  const session = useSession();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [error, setError] = useState("");
  const url = draft.photoUpload?.preview || exercisePhotoUrls(draft, session)[0];
  const hasPhoto = !!(draft.photoUpload || draft.photo);

  async function pick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      set({ photoUpload: await compressPhoto(file) });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={s.field}>
      <label style={s.label}>Picture</label>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ ...s.thumb, width: 96, height: 72, cursor: "default" }}>
          {url ? <img src={url} alt="" style={s.thumbImg} /> : <span style={{ color: C.dim, display: "flex" }}><Icon.image size={26} /></span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={{ ...s.btnSecondary, ...s.btnSmall }} onClick={() => setLibraryOpen(true)}>
              <Icon.library size={16} /> Library
            </button>
            <label style={{ ...s.btnSecondary, ...s.btnSmall, ...(!session && { opacity: 0.5, cursor: "default" }) }}>
              <input type="file" accept="image/*" onChange={pick} disabled={!session} style={{ display: "none" }} />
              <Icon.image size={16} /> Upload
            </label>
            {hasPhoto && (
              <button style={{ ...s.btnDangerText, ...s.btnSmall, padding: "0 8px" }} onClick={() => set({ photo: null, photoUpload: null })}>
                Remove
              </button>
            )}
          </div>
          {session === null && <span style={{ fontSize: 12, color: C.muted }}>Sign in to upload your own photos.</span>}
        </div>
      </div>
      {error && <div style={{ ...s.error, margin: "8px 0 0" }}>{error}</div>}
      {libraryOpen && (
        <StretchLibraryPicker
          title="Picture from the library"
          onPick={stretch => { set({ photo: { library: stretch.id }, photoUpload: null }); setLibraryOpen(false); }}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  );
}

// Rendered inside a bottom sheet; onDelete is only passed when editing.
// While saving (uploading a picked photo) the save button waits; saveError
// is why the last save failed.
export function ExerciseForm({ draft, categories = [], saving = false, saveError = "", onChange, onSave, onDelete }) {
  const set = (patch) => onChange({ ...draft, ...patch });

  return (
    <div>
      <div style={s.field}>
        <label style={s.label}>Name</label>
        <input
          style={s.input}
          placeholder="e.g. Max hangs 20mm"
          value={draft.name}
          onChange={e => set({ name: e.target.value })}
          onKeyDown={e => e.key === "Enter" && e.target.blur()}
          autoFocus={!draft.name}
        />
      </div>

      <div style={s.field}>
        <label style={s.label}>Type</label>
        <Segmented
          options={EXERCISE_TYPES}
          value={draft.type}
          onChange={type => set({ type, ...defaultFieldsForType(type) })}
        />
      </div>

      {categories.length > 0 && (
        <div style={s.field}>
          <label style={s.label}>Category</label>
          <div style={s.chipRow}>
            {[{ id: null, name: "None" }, ...categories].map(c => (
              <button
                key={c.id ?? "none"}
                style={{ ...s.chip, ...((draft.categoryId || null) === c.id ? s.chipActive : {}) }}
                onClick={() => set({ categoryId: c.id })}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {draft.type === "reps" && (
        <div style={s.fieldGrid}>
          <NumberField label="Sets" value={draft.sets} onChange={v => set({ sets: v })} min={1} />
          <NumberField label="Reps" value={draft.reps} onChange={v => set({ reps: v })} min={1} />
          <NumberField label="Rest" value={draft.restSec} onChange={v => set({ restSec: v })} min={0} inc={15} suffix="s" />
        </div>
      )}

      {draft.type === "weighted" && (
        <>
          <div style={s.field}>
            <Segmented
              options={WEIGHT_MODES}
              value={draft.weightMode}
              onChange={weightMode => set({ weightMode })}
            />
          </div>
          <div style={s.fieldGrid}>
            <NumberField label="Sets" value={draft.sets} onChange={v => set({ sets: v })} min={1} />
            <NumberField label="Reps" value={draft.reps} onChange={v => set({ reps: v })} min={1} />
            <NumberField label="Weight" value={draft.weight} onChange={v => set({ weight: v })} min={0} step={0.5} inc={2.5} suffix="kg" />
            <NumberField label="Rest" value={draft.restSec} onChange={v => set({ restSec: v })} min={0} inc={15} suffix="s" />
          </div>
        </>
      )}

      {draft.type === "stretch" && (
        <>
          <div style={s.field}>
            <Segmented options={SIDES} value={!!draft.twoSided} onChange={twoSided => set({ twoSided })} />
          </div>
          <div style={s.fieldGrid}>
            <NumberField label={draft.twoSided ? "Hold per side" : "Hold"} value={draft.holdSec} onChange={v => set({ holdSec: v })} min={1} inc={5} suffix="s" />
          </div>
        </>
      )}

      {(draft.type === "interval" || draft.type === "weightedInterval") && (
        <>
          {draft.type === "weightedInterval" && (
            <div style={s.field}>
              <Segmented
                options={WEIGHT_MODES}
                value={draft.weightMode}
                onChange={weightMode => set({ weightMode })}
              />
            </div>
          )}
          <div style={s.fieldGrid}>
            <NumberField label="Work" value={draft.workSec} onChange={v => set({ workSec: v })} min={1} suffix="s" />
            <NumberField label="Rest" value={draft.restSec} onChange={v => set({ restSec: v })} min={0} suffix="s" />
            <NumberField label="Sets" value={draft.sets} onChange={v => set({ sets: v })} min={1} />
            {draft.type === "weightedInterval" && (
              <NumberField label="Weight" value={draft.weight} onChange={v => set({ weight: v })} min={0} step={0.5} inc={2.5} suffix="kg" />
            )}
          </div>
        </>
      )}

      <PictureField draft={draft} set={set} />

      <div style={s.field}>
        <label style={s.label}>Notes</label>
        <textarea
          style={s.notesArea}
          placeholder="Grip, setup, cues, how it went…"
          value={draft.notes || ""}
          onChange={e => set({ notes: e.target.value })}
          rows={3}
        />
      </div>

      {saveError && <div style={s.error}>{saveError}</div>}
      <button style={{ ...s.btnPrimary, ...s.btnBlock }} onClick={onSave} disabled={!draft.name.trim() || saving}>
        {saving ? "Saving…" : "Save exercise"}
      </button>
      {onDelete && (
        <button style={{ ...s.btnDangerText, ...s.btnBlock, marginTop: 8 }} onClick={onDelete}>
          <Icon.trash size={18} /> Delete exercise
        </button>
      )}
    </div>
  );
}
