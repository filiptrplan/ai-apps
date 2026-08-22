import * as api from "../api.js";
import { strings, resolveError } from "../strings.js";
import { theme, Sheet, ConfirmSheet, EmojiPicker } from "../ui.jsx";
import { IconBtn, addButtonStyle } from "./Chores.jsx";

const { useState, useCallback, useMemo } = React;

const fieldStyle = {
  width: "100%", height: 46, borderRadius: 14, border: `1.5px solid ${theme.cardBorder}`, background: "#FFFCF7",
  padding: "0 14px", fontSize: 14.5, color: theme.ink, fontFamily: theme.fontBody, marginTop: 4,
};
const labelStyle = { fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft };

function emptyForm() { return { emoji: "", title: "", description: "", cost: "" }; }

export function AdminRewards({ token, callAdmin, rewards, onSaved, onFailed }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);

  const active = useMemo(() => rewards.filter((r) => r.active), [rewards]);
  const archived = useMemo(() => rewards.filter((r) => !r.active), [rewards]);

  const openNew = useCallback(() => { setForm(emptyForm()); setError(null); setEditing("new"); }, []);
  const openEdit = useCallback((r) => { setForm({ emoji: r.emoji, title: r.title, description: r.description || "", cost: String(r.cost) }); setError(null); setEditing(r); }, []);
  const close = useCallback(() => setEditing(null), []);

  const save = useCallback(async () => {
    if (busy) return;
    if (!form.title.trim()) return setError(strings.adminRewards.validationTitle);
    const cost = parseInt(form.cost, 10);
    if (!Number.isInteger(cost) || cost <= 0) return setError(strings.adminRewards.validationCost);
    setBusy(true); setError(null);
    try {
      if (editing === "new") await callAdmin(api.adminCreateReward, form.emoji.trim() || "🎁", form.title.trim(), form.description.trim(), cost);
      else await callAdmin(api.adminUpdateReward, editing.id, form.emoji.trim() || "🎁", form.title.trim(), form.description.trim(), cost);
      onSaved(strings.adminRewards.saveSuccess);
      setEditing(null);
    } catch (err) {
      setError(resolveError(err));
    } finally {
      setBusy(false);
    }
  }, [busy, form, editing, callAdmin, onSaved]);

  const toggleActive = useCallback(async (reward) => {
    try {
      await callAdmin(api.adminSetRewardActive, reward.id, !reward.active);
      onSaved(strings.adminRewards.saveSuccess);
    } catch (err) {
      onFailed(resolveError(err));
    } finally {
      setArchiveTarget(null);
    }
  }, [callAdmin, onSaved, onFailed]);

  const move = useCallback(async (list, index, dir) => {
    const next = index + dir;
    if (next < 0 || next >= list.length) return;
    const ids = list.map((r) => r.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    try { await callAdmin(api.adminReorderRewards, ids); } catch (err) { onFailed(resolveError(err)); }
  }, [callAdmin, onFailed]);

  return (
    <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div role="button" tabIndex={0} onClick={openNew} style={addButtonStyle}>+ {strings.common.add}</div>

      <Section title={strings.adminRewards.active} empty={active.length === 0 && strings.adminRewards.empty}>
        {active.map((r, i) => (
          <RewardRow key={r.id} reward={r} onEdit={() => openEdit(r)} onArchive={() => setArchiveTarget(r)}
            onUp={() => move(active, i, -1)} onDown={() => move(active, i, 1)} canUp={i > 0} canDown={i < active.length - 1} />
        ))}
      </Section>

      {archived.length > 0 && (
        <Section title={strings.adminRewards.archived}>
          {archived.map((r) => <RewardRow key={r.id} reward={r} archived onEdit={() => openEdit(r)} onArchive={() => setArchiveTarget(r)} />)}
        </Section>
      )}

      <Sheet open={!!editing} onClose={close}>
        {editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink }}>
              {editing === "new" ? strings.adminRewards.addTitle : strings.adminRewards.editTitle}
            </div>
            <div style={labelStyle}>{strings.adminRewards.emojiLabel}
              <div><EmojiPicker value={form.emoji} onChange={(v) => setForm({ ...form, emoji: v })} ariaLabel={strings.adminRewards.emojiLabel} /></div>
            </div>
            <label style={labelStyle}>{strings.adminRewards.titleLabel}
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={fieldStyle} />
            </label>
            <label style={labelStyle}>{strings.adminRewards.descriptionLabel}
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} style={{ ...fieldStyle, height: "auto", padding: 10, resize: "vertical" }} />
            </label>
            <label style={labelStyle}>{strings.adminRewards.costLabel}
              <input type="number" inputMode="numeric" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} style={fieldStyle} />
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
        title={archiveTarget && (archiveTarget.active ? strings.adminRewards.archiveConfirm(archiveTarget.title) : strings.adminRewards.unarchiveConfirm(archiveTarget.title))}
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

function RewardRow({ reward, archived, onEdit, onArchive, onUp, onDown, canUp, canDown }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: "10px 12px", opacity: archived ? 0.6 : 1 }}>
      <span style={{ fontSize: 20 }}>{reward.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: theme.ink }}>{reward.title}</div>
        <div style={{ fontSize: 11.5, color: theme.muted }}>{reward.cost} točk</div>
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

const cancelBtn = { flex: 1, height: 48, borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#7C6A5C", cursor: "pointer" };
const saveBtn = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };
