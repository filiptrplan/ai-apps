import { supabase } from "../shared/supabaseClient.js";
import { CATS, uid, parseIng } from "./format.js";
import { SectionEditor, blankSection, cleanSections } from "./SectionEditor.jsx";
import { drawScaled, compressPhoto, uploadPhoto, removePhoto, usePhotoUrl } from "./photos.js";

const { useState, useRef, useEffect } = React;

const MAX_IMAGES = 8;
const MAX_IMAGE_SIDE = 1600;
const emptyForm = () => ({
  name: "",
  cat: "Dinner",
  time: "",
  serves: "",
  ingredients: [blankSection("ing")],
  method: [blankSection("step")],
  notes: "",
});
const EMPTY_MAGIC = { images: [], link: "", text: "", loading: false, error: "" };

// The editor always shows at least one section to type into.
const orBlank = (kind, sections) => (sections.length ? sections : [blankSection(kind)]);

function toForm(r) {
  return {
    name: r.name,
    cat: r.cat,
    time: String(r.time),
    serves: String(r.serves),
    ingredients: orBlank("ing", r.ingredients),
    method: orBlank("step", r.method),
    notes: r.notes || "",
  };
}

// Magic returns sections of plain strings; older versions of the function
// returned flat `ings` and `steps` lists.
function magicSections(kind, sections, flat, toItem) {
  const secs = sections || [{ name: "", items: flat || [] }];
  return orBlank(
    kind,
    secs.map((sec) => ({ id: uid(), name: sec.name || "", items: (sec.items || []).map(toItem) }))
  );
}

// Shrinks a screenshot to a JPEG no larger than MAX_IMAGE_SIDE so a handful
// of them fit in one Magic request.
async function readImage(file) {
  const canvas = await drawScaled(file, MAX_IMAGE_SIDE);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { id: uid(), url: dataUrl, media: "image/jpeg", data: dataUrl.split(",")[1] };
}

// The recipe photo slot. Signed out, it only says photos need an account.
// `photo` is { path } for the saved photo, { blob, preview } for a newly
// picked one (uploaded on save), or null.
function PhotoField({ photo, setPhoto, session, disabled }) {
  const savedUrl = usePhotoUrl(photo && photo.path, session);
  const [error, setError] = useState("");
  const url = photo ? photo.preview || savedUrl : null;

  if (!session) {
    return (
      <div className="ra-ph ra-photo-field">
        {session === null && (
          <span className="ra-photo-hint">
            <a href="./">Sign in</a> to add photos
          </span>
        )}
      </div>
    );
  }

  async function pick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      setPhoto(await compressPhoto(file));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="ra-photo-wrap">
      <label className={`ra-ph ra-photo-field${disabled ? " disabled" : ""}`}>
        <input type="file" accept="image/*" onChange={pick} disabled={disabled} />
        {url ? <img className="ra-photo" src={url} alt="" /> : !photo && <span className="ra-photo-hint">+ add photo</span>}
        {photo && <span className="ra-photo-change">Change</span>}
      </label>
      {photo && !disabled && (
        <button className="ra-photo-remove" onClick={() => setPhoto(null)} aria-label="Remove photo">✕</button>
      )}
      {error && <p className="ra-error">{error}</p>}
    </div>
  );
}

// New / edit recipe screen. "Manual" is the form; "✦ Magic" sends
// screenshots, text or a link to the recipe-import function and drops the
// result into the form for checking before saving.
export function Compose({ initial, session, onCancel, onSave, onDelete }) {
  const [form, setFormState] = useState(() => (initial ? toForm(initial) : emptyForm()));
  const [mode, setMode] = useState("manual");
  const [magic, setMagicState] = useState(EMPTY_MAGIC);
  const [fromMagic, setFromMagic] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photo, setPhoto] = useState(() => (initial && initial.photo ? { path: initial.photo } : null));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const magicRef = useRef(magic);
  magicRef.current = magic;

  const setForm = (k, v) => setFormState((f) => ({ ...f, [k]: v }));
  const setMagic = (p) => setMagicState((m) => ({ ...m, ...p }));
  const canSave = !!form.name.trim() && !saving;

  // Frees the preview of a picked photo once it's replaced or we leave.
  useEffect(() => () => photo && photo.preview && URL.revokeObjectURL(photo.preview), [photo]);
  const hasSources = magic.images.length > 0 || !!magic.link.trim() || !!magic.text.trim();
  const canRunMagic = !!session && !magic.loading && hasSources;

  async function save() {
    if (!canSave) return;
    const oldPath = initial && initial.photo;
    let path = photo && photo.path;
    if (photo && photo.blob) {
      setSaving(true);
      setSaveError("");
      try {
        path = await uploadPhoto(session, photo.blob);
      } catch (err) {
        setSaving(false);
        setSaveError(err.message);
        return;
      }
    }
    if (oldPath && oldPath !== path) removePhoto(oldPath);
    const notes = form.notes.trim();
    onSave({
      id: initial ? initial.id : uid(),
      ...(path ? { photo: path } : {}),
      name: form.name.trim(),
      cat: form.cat,
      tags: initial && initial.cat === form.cat ? initial.tags : [form.cat],
      time: parseInt(form.time, 10) || 20,
      serves: parseInt(form.serves, 10) || 2,
      ingredients: cleanSections("ing", form.ingredients),
      method: cleanSections("step", form.method),
      ...(notes ? { notes } : {}),
    });
  }

  function addFiles(files) {
    const room = MAX_IMAGES - magicRef.current.images.length;
    [...files]
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, Math.max(0, room))
      .forEach((file) =>
        readImage(file).then(
          (im) => setMagicState((m) => ({ ...m, images: [...m.images, im].slice(0, MAX_IMAGES) })),
          (err) => setMagic({ error: err.message })
        )
      );
  }

  async function runMagic() {
    if (!canRunMagic) return;
    setMagic({ loading: true, error: "" });
    try {
      const { data, error } = await supabase.functions.invoke("recipe-import", {
        body: {
          images: magic.images.map((im) => ({ media: im.media, data: im.data })),
          link: magic.link.trim(),
          text: magic.text.trim(),
        },
      });
      if (error) {
        // Non-2xx responses carry the function's { error } message in the body.
        const details = await error.context?.json?.().catch(() => null);
        throw new Error(details?.error ?? error.message);
      }
      setFormState({
        name: data.name || "",
        cat: CATS.includes(data.cat) ? data.cat : "Dinner",
        time: data.time ? String(data.time) : "",
        serves: data.serves ? String(data.serves) : "",
        ingredients: magicSections("ing", data.ingredients, data.ings, (line) => ({ id: uid(), ...parseIng(line) })),
        method: magicSections("step", data.method, data.steps, (text) => ({ id: uid(), text })),
        notes: data.notes || "",
      });
      setMagicState(EMPTY_MAGIC);
      setFromMagic(true);
      setMode("manual");
    } catch (err) {
      setMagic({ loading: false, error: err.message || "Couldn't read a recipe from that." });
    }
  }

  return (
    <main className="ra-screen ra-slide">
      <div className="ra-compose-bar">
        <button className="ra-text-btn" onClick={onCancel}>Cancel</button>
        <button className={`ra-pill-btn${canSave ? " accent" : ""}`} disabled={!canSave} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <h1 className="ra-title">{initial ? "Edit recipe" : "New recipe"}</h1>
      {saveError && <p className="ra-error ra-save-error">{saveError}</p>}

      <div className="ra-segmented">
        <button className={mode === "manual" ? "on" : ""} onClick={() => setMode("manual")}>Manual</button>
        <button className={mode === "magic" ? "on magic" : ""} onClick={() => setMode("magic")}>✦ Magic</button>
      </div>

      {mode === "magic" && (
        <div className="ra-form">
          <p className="ra-muted">
            Add screenshots, photos of a cookbook page, pasted text or a link. It gets turned into a recipe you can check
            before saving.
          </p>
          <label className="ra-drop">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <span className="ra-drop-plus">+</span>
            <strong>Add screenshots or photos</strong>
            <span className="ra-muted sm">Or paste images into the text box</span>
          </label>
          {magic.images.length > 0 && (
            <div className="ra-thumbs">
              {magic.images.map((im) => (
                <div key={im.id} className="ra-thumb">
                  <img src={im.url} alt="" />
                  <button
                    onClick={() => setMagicState((m) => ({ ...m, images: m.images.filter((x) => x.id !== im.id) }))}
                    aria-label="Remove image"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            className="ra-field"
            value={magic.link}
            onChange={(e) => setMagic({ link: e.target.value })}
            placeholder="Paste a recipe link"
            inputMode="url"
          />
          <textarea
            className="ra-field"
            value={magic.text}
            onChange={(e) => setMagic({ text: e.target.value })}
            onPaste={(e) => {
              const fl = e.clipboardData && e.clipboardData.files;
              if (fl && fl.length) {
                e.preventDefault();
                addFiles(fl);
              }
            }}
            rows={6}
            placeholder="Paste recipe text, notes, anything"
          />
          {magic.error && <p className="ra-error">{magic.error}</p>}
          {session === null && (
            <p className="ra-muted sm">
              <a href="./">Sign in on the home page</a> to use Magic.
            </p>
          )}
          <button className={`ra-big-btn${canRunMagic ? " accent" : ""}`} disabled={!canRunMagic} onClick={runMagic}>
            {magic.loading ? "Reading your recipe…" : "✦ Create recipe"}
          </button>
        </div>
      )}

      {mode === "manual" && (
        <div className="ra-form">
          {fromMagic && <div className="ra-notice">Draft filled in from your sources. Check it over, then save.</div>}
          <PhotoField photo={photo} setPhoto={setPhoto} session={session} disabled={saving} />
          <label className="ra-label">
            Name
            <input
              className="ra-field"
              value={form.name}
              onChange={(e) => setForm("name", e.target.value)}
              placeholder="e.g. Roasted veggie traybake"
            />
          </label>
          <div className="ra-label">
            Meal
            <div className="ra-chips tight">
              {CATS.map((c) => (
                <button key={c} className={`ra-chip sm${form.cat === c ? " on" : ""}`} onClick={() => setForm("cat", c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="ra-two">
            <label className="ra-label">
              Time (min)
              <input className="ra-field" value={form.time} onChange={(e) => setForm("time", e.target.value)} inputMode="numeric" placeholder="30" />
            </label>
            <label className="ra-label">
              Serves
              <input className="ra-field" value={form.serves} onChange={(e) => setForm("serves", e.target.value)} inputMode="numeric" placeholder="2" />
            </label>
          </div>
          <div className="ra-label">
            Ingredients
            <SectionEditor
              kind="ing"
              sections={form.ingredients}
              setSections={(fn) => setFormState((f) => ({ ...f, ingredients: fn(f.ingredients) }))}
              disabled={saving}
            />
          </div>
          <div className="ra-label">
            Method
            <SectionEditor
              kind="step"
              sections={form.method}
              setSections={(fn) => setFormState((f) => ({ ...f, method: fn(f.method) }))}
              disabled={saving}
            />
          </div>
          <label className="ra-label">
            Notes
            <textarea
              className="ra-field"
              value={form.notes}
              onChange={(e) => setForm("notes", e.target.value)}
              rows={4}
              placeholder="Tips, substitutions, what to change next time…"
              disabled={saving}
            />
          </label>
          {initial && (
            <button
              className={`ra-delete${confirmDelete ? " confirm" : ""}`}
              onClick={() => (confirmDelete ? onDelete(initial.id) : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
            >
              {confirmDelete ? "Tap again to delete" : "Delete recipe"}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
