import * as api from "../api.js";
import { strings, resolveError } from "../strings.js";
import { theme, Sheet, ConfirmSheet } from "../ui.jsx";

const { useState, useCallback, useMemo } = React;

const fieldStyle = {
  width: "100%", height: 46, borderRadius: 14, border: `1.5px solid ${theme.cardBorder}`, background: "#FFFCF7",
  padding: "0 14px", fontSize: 14.5, color: theme.ink, fontFamily: theme.fontBody, marginTop: 4,
};
const labelStyle = { fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft };

function emptyForm(categories) {
  return { emoji: "", title: "", description: "", category_id: categories[0] ? categories[0].id : "", points: "" };
}

export function AdminChores({ token, callAdmin, chores, categories, onSaved, onFailed }) {
  const [editing, setEditing] = useState(null); // null | 'new' | chore object
  const [form, setForm] = useState(() => emptyForm(categories));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);

  const catById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const active = useMemo(() => chores.filter((c) => c.active), [chores]);
  const archived = useMemo(() => chores.filter((c) => !c.active), [chores]);

  const openNew = useCallback(() => { setForm(emptyForm(categories)); setError(null); setEditing("new"); }, [categories]);
  const openEdit = useCallback((c) => {
    setForm({ emoji: c.emoji, title: c.title, description: c.description || "", category_id: c.category_id || "", points: String(c.points) });
    setError(null); setEditing(c);
  }, []);
  const close = useCallback(() => setEditing(null), []);

  const save = useCallback(async () => {
    if (busy) return;
    if (!form.emoji.trim()) return setError(strings.adminChores.validationEmoji);
    if (!form.title.trim()) return setError(strings.adminChores.validationTitle);
    const points = parseInt(form.points, 10);
    if (!Number.isInteger(points) || points <= 0) return setError(strings.adminChores.validationPoints);
    setBusy(true); setError(null);
    try {
      if (editing === "new") {
        await callAdmin(api.adminCreateChore, form.emoji.trim(), form.title.trim(), form.description.trim(), form.category_id || null, points);
      } else {
        await callAdmin(api.adminUpdateChore, editing.id, form.emoji.trim(), form.title.trim(), form.description.trim(), form.category_id || null, points);
      }
      onSaved(strings.adminChores.saveSuccess);
      setEditing(null);
    } catch (err) {
      setError(resolveError(err));
    } finally {
      setBusy(false);
    }
  }, [busy, form, editing, callAdmin, onSaved]);

  const toggleActive = useCallback(async (chore) => {
    try {
      await callAdmin(api.adminSetChoreActive, chore.id, !chore.active);
      onSaved(strings.adminChores.saveSuccess);
    } catch (err) {
      onFailed(resolveError(err));
    } finally {
      setArchiveTarget(null);
    }
  }, [callAdmin, onSaved, onFailed]);

  const move = useCallback(async (list, index, dir) => {
    const next = index + dir;
    if (next < 0 || next >= list.length) return;
    const ids = list.map((c) => c.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    try { await callAdmin(api.adminReorderChores, ids); } catch (err) { onFailed(resolveError(err)); }
  }, [callAdmin, onFailed]);

  return (
    <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div role="button" tabIndex={0} onClick={openNew} style={addButtonStyle}>+ {strings.common.add}</div>

      <Section title={strings.adminChores.active} empty={active.length === 0 && strings.adminChores.empty}>
        {active.map((c, i) => (
          <ChoreRow key={c.id} chore={c} category={catById[c.category_id]} onEdit={() => openEdit(c)}
            onArchive={() => setArchiveTarget(c)} onUp={() => move(active, i, -1)} onDown={() => move(active, i, 1)}
            canUp={i > 0} canDown={i < active.length - 1} />
        ))}
      </Section>

      {archived.length > 0 && (
        <Section title={strings.adminChores.archived}>
          {archived.map((c) => (
            <ChoreRow key={c.id} chore={c} category={catById[c.category_id]} archived onEdit={() => openEdit(c)} onArchive={() => setArchiveTarget(c)} />
          ))}
        </Section>
      )}

      <Sheet open={!!editing} onClose={close}>
        {editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink }}>
              {editing === "new" ? strings.adminChores.addTitle : strings.adminChores.editTitle}
            </div>
            <label style={labelStyle}>{strings.adminChores.emojiLabel}
              <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} style={{ ...fieldStyle, width: 70 }} maxLength={4} />
            </label>
            <label style={labelStyle}>{strings.adminChores.titleLabel}
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={fieldStyle} />
            </label>
            <label style={labelStyle}>{strings.adminChores.descriptionLabel}
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} style={{ ...fieldStyle, height: "auto", padding: 10, resize: "vertical" }} />
            </label>
            <label style={labelStyle}>{strings.adminChores.categoryLabel}
              <select value={form.category_id || ""} onChange={(e) => setForm({ ...form, category_id: e.target.value })} style={fieldStyle}>
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            </label>
            <label style={labelStyle}>{strings.adminChores.pointsLabel}
              <input type="number" inputMode="numeric" value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} style={fieldStyle} />
            </label>
            {error && <div style={{ fontSize: 12.5, color: theme.bad, fontWeight: 700 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <div role="button" tabIndex={0} onClick={close} style={cancelBtn}>{strings.common.cancel}</div>
              <div role="button" tabIndex={0} onClick={save} style={{ ...saveBtn, opacity: busy ? 0.6 : 1 }}>{strings.common.save}</div>
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={!!archiveTarget}
        title={archiveTarget && (archiveTarget.active ? strings.adminChores.archiveConfirm(archiveTarget.title) : strings.adminChores.unarchiveConfirm(archiveTarget.title))}
        confirmLabel={archiveTarget && archiveTarget.active ? strings.common.archive : strings.common.unarchive}
        onConfirm={() => toggleActive(archiveTarget)}
        onCancel={() => setArchiveTarget(null)}
        danger={archiveTarget && archiveTarget.active}
      />
    </div>
  );
}

function Section({ title, empty, children }) {
  return (
    <section>
      <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 20, color: "#7C6A5C", marginBottom: 8 }}>{title}</div>
      {empty ? <div style={{ fontSize: 13, color: theme.muted }}>{empty}</div> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>}
    </section>
  );
}

function ChoreRow({ chore, category, archived, onEdit, onArchive, onUp, onDown, canUp, canDown }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: "10px 12px", opacity: archived ? 0.6 : 1 }}>
      <span style={{ fontSize: 20 }}>{chore.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: theme.ink }}>{chore.title}</div>
        <div style={{ fontSize: 11.5, color: theme.muted }}>{category ? `${category.emoji} ${category.name} · ` : ""}+{chore.points}</div>
      </div>
      {!archived && onUp && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <IconBtn label={strings.adminChores.moveUp} disabled={!canUp} onClick={onUp}>▲</IconBtn>
          <IconBtn label={strings.adminChores.moveDown} disabled={!canDown} onClick={onDown}>▼</IconBtn>
        </div>
      )}
      <IconBtn label={strings.common.edit} onClick={onEdit}>✎</IconBtn>
      <IconBtn label={archived ? strings.common.unarchive : strings.common.archive} onClick={onArchive}>{archived ? "↺" : "🗄"}</IconBtn>
    </div>
  );
}

export function IconBtn({ label, onClick, disabled, children }) {
  return (
    <div role="button" tabIndex={disabled ? -1 : 0} aria-label={label} onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}
      style={{ width: 30, height: 30, borderRadius: 9, background: "#F6E9DC", border: "1px solid #EBD8C6", display: "grid", placeItems: "center", fontSize: 12, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1, color: "#8A6F5E" }}>
      {children}
    </div>
  );
}

export const addButtonStyle = {
  alignSelf: "flex-start", padding: "10px 16px", borderRadius: 14, background: theme.ink, color: "#FBF3EA",
  fontWeight: 800, fontSize: 13.5, cursor: "pointer",
};
const cancelBtn = { flex: 1, height: 48, borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#7C6A5C", cursor: "pointer" };
const saveBtn = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };
