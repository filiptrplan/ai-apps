import * as api from "../api.js";
import { strings, resolveError } from "../strings.js";
import { theme, Sheet, EmojiPicker } from "../ui.jsx";
import { IconBtn, addButtonStyle } from "./Chores.jsx";

const { useState, useCallback, useMemo } = React;

const fieldStyle = {
  width: "100%", height: 46, borderRadius: 14, border: `1.5px solid ${theme.cardBorder}`, background: "#FFFCF7",
  padding: "0 14px", fontSize: 14.5, color: theme.ink, fontFamily: theme.fontBody, marginTop: 4,
};
const labelStyle = { fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft };

function emptyForm() { return { emoji: "", name: "", color: "" }; }

export function AdminCategories({ token, callAdmin, categories, chores, onSaved, onFailed }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [reassignTo, setReassignTo] = useState("");

  const usageCount = useMemo(() => {
    const map = {};
    chores.forEach((c) => { if (c.category_id) map[c.category_id] = (map[c.category_id] || 0) + 1; });
    return map;
  }, [chores]);

  const openNew = useCallback(() => { setForm(emptyForm()); setError(null); setEditing("new"); }, []);
  const openEdit = useCallback((c) => { setForm({ emoji: c.emoji, name: c.name, color: c.color || "" }); setError(null); setEditing(c); }, []);
  const close = useCallback(() => setEditing(null), []);

  const save = useCallback(async () => {
    if (busy) return;
    if (!form.name.trim()) return setError(strings.adminCategories.validationName);
    setBusy(true); setError(null);
    try {
      if (editing === "new") await callAdmin(api.adminCreateCategory, form.emoji.trim() || "🏷️", form.name.trim(), form.color.trim());
      else await callAdmin(api.adminUpdateCategory, editing.id, form.emoji.trim() || "🏷️", form.name.trim(), form.color.trim());
      onSaved(strings.adminCategories.saveSuccess);
      setEditing(null);
    } catch (err) {
      setError(resolveError(err));
    } finally {
      setBusy(false);
    }
  }, [busy, form, editing, callAdmin, onSaved]);

  const move = useCallback(async (index, dir) => {
    const next = index + dir;
    if (next < 0 || next >= categories.length) return;
    const ids = categories.map((c) => c.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    try { await callAdmin(api.adminReorderCategories, ids); } catch (err) { onFailed(resolveError(err)); }
  }, [categories, callAdmin, onFailed]);

  const openDelete = useCallback((c) => { setDeleteTarget(c); setReassignTo(""); }, []);
  const confirmDelete = useCallback(async () => {
    const inUse = (usageCount[deleteTarget.id] || 0) > 0;
    if (inUse && !reassignTo) return;
    try {
      await callAdmin(api.adminDeleteCategory, deleteTarget.id, inUse ? reassignTo : null);
      onSaved(strings.adminCategories.saveSuccess);
    } catch (err) {
      onFailed(resolveError(err));
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, reassignTo, usageCount, callAdmin, onSaved, onFailed]);

  return (
    <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div role="button" tabIndex={0} onClick={openNew} style={addButtonStyle}>+ {strings.common.add}</div>

      {categories.length === 0 ? (
        <div style={{ fontSize: 13, color: theme.muted }}>{strings.adminCategories.empty}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {categories.map((c, i) => (
            <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: "10px 12px" }}>
              {c.color && <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, flex: "0 0 auto" }} />}
              <span style={{ fontSize: 20 }}>{c.emoji}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: theme.ink }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: theme.muted }}>{usageCount[c.id] || 0} opravil</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <IconBtn label={strings.adminChores.moveUp} disabled={i === 0} onClick={() => move(i, -1)}>▲</IconBtn>
                <IconBtn label={strings.adminChores.moveDown} disabled={i === categories.length - 1} onClick={() => move(i, 1)}>▼</IconBtn>
              </div>
              <IconBtn label={strings.common.edit} onClick={() => openEdit(c)}>✎</IconBtn>
              <IconBtn label={strings.common.delete} onClick={() => openDelete(c)}>🗑</IconBtn>
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!editing} onClose={close}>
        {editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink }}>
              {editing === "new" ? strings.adminCategories.addTitle : strings.adminCategories.editTitle}
            </div>
            <div style={labelStyle}>{strings.adminCategories.emojiLabel}
              <div><EmojiPicker value={form.emoji} onChange={(v) => setForm({ ...form, emoji: v })} ariaLabel={strings.adminCategories.emojiLabel} /></div>
            </div>
            <label style={labelStyle}>{strings.adminCategories.nameLabel}
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={fieldStyle} />
            </label>
            <label style={labelStyle}>{strings.adminCategories.colorLabel}
              <input type="color" value={form.color || "#EFE2D3"} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ ...fieldStyle, padding: 4, height: 40 }} />
            </label>
            {error && <div style={{ fontSize: 12.5, color: theme.bad, fontWeight: 700 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <div role="button" tabIndex={0} onClick={close} style={cancelBtn}>{strings.common.cancel}</div>
              <div role="button" tabIndex={0} onClick={save} style={{ ...saveBtn, opacity: busy ? 0.6 : 1 }}>{strings.common.save}</div>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        {deleteTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink }}>{strings.adminCategories.deleteTitle}</div>
            {(usageCount[deleteTarget.id] || 0) > 0 ? (
              <>
                <div style={{ fontSize: 13.5, color: "#7C6A5C" }}>{strings.adminCategories.inUseBody(usageCount[deleteTarget.id])}</div>
                <label style={labelStyle}>{strings.adminCategories.reassignLabel}
                  <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} style={fieldStyle}>
                    <option value="">—</option>
                    {categories.filter((c) => c.id !== deleteTarget.id).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <div style={{ fontSize: 13.5, color: "#7C6A5C" }}>{strings.adminCategories.deleteEmptyBody}</div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <div role="button" tabIndex={0} onClick={() => setDeleteTarget(null)} style={cancelBtn}>{strings.common.cancel}</div>
              <div role="button" tabIndex={0} onClick={confirmDelete}
                style={{ ...saveBtn, background: theme.bad, opacity: ((usageCount[deleteTarget.id] || 0) > 0 && !reassignTo) ? 0.5 : 1 }}>
                {strings.adminCategories.deleteConfirm}
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

const cancelBtn = { flex: 1, height: 48, borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#7C6A5C", cursor: "pointer" };
const saveBtn = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };
