import * as api from "../api.js";
import { strings, resolveError } from "../strings.js";
import { formatPoints, formatTime, formatDayLabel } from "../format.js";
import { theme, Sheet, ConfirmSheet } from "../ui.jsx";

const { useState, useCallback, useMemo } = React;

const STATUS_LABEL = {
  pending: () => strings.rewards.statusPending,
  approved: () => strings.rewards.statusApproved,
  declined: () => strings.rewards.statusDeclined,
  cancelled: () => strings.rewards.statusCancelled,
  fulfilled: () => strings.rewards.statusFulfilled,
};

export function AdminRequests({ token, callAdmin, requests, points, onSaved, onFailed }) {
  const [action, setAction] = useState(null); // { kind: 'approve'|'decline'|'fulfill', request }
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => requests.filter((r) => r.status === "pending").sort((a, b) => new Date(a.requested_at) - new Date(b.requested_at)), [requests]);
  const history = useMemo(() => requests.filter((r) => r.status !== "pending"), [requests]);

  const open = useCallback((kind, request) => { setAction({ kind, request }); setMessage(""); }, []);
  const close = useCallback(() => setAction(null), []);

  const confirm = useCallback(async () => {
    if (!action || busy) return;
    setBusy(true);
    try {
      if (action.kind === "approve") await callAdmin(api.adminApproveRequest, action.request.id, message.trim());
      else if (action.kind === "decline") await callAdmin(api.adminDeclineRequest, action.request.id, message.trim());
      else await callAdmin(api.adminFulfillRequest, action.request.id);
      onSaved(strings.adminChores.saveSuccess);
      setAction(null);
    } catch (err) {
      onFailed(resolveError(err));
      setAction(null);
    } finally {
      setBusy(false);
    }
  }, [action, message, busy, callAdmin, onSaved, onFailed]);

  const previewAvailable = action && action.kind === "decline" ? points.available + action.request.cost : points.available;

  return (
    <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
      {requests.length === 0 && <div style={{ fontSize: 13, color: theme.muted }}>{strings.adminRequests.empty}</div>}

      {pending.length > 0 && (
        <section>
          <div style={sectionTitle}>{strings.adminRequests.pendingSection} ({pending.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pending.map((r) => (
              <div key={r.id} style={card}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 22 }}>{r.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: theme.ink }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: theme.muted }}>{formatPoints(r.cost)} točk · {strings.adminRequests.requestedAt(formatTime(r.requested_at))}</div>
                  </div>
                  <div style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 16, color: theme.rose }}>{r.cost}</div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <div role="button" tabIndex={0} onClick={() => open("decline", r)} style={declineBtn}>{strings.adminRequests.decline}</div>
                  <div role="button" tabIndex={0} onClick={() => open("approve", r)} style={approveBtn}>{strings.adminRequests.approve}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(() => {
        const approvedNotFulfilled = requests.filter((r) => r.status === "approved");
        if (approvedNotFulfilled.length === 0) return null;
        return (
          <section>
            <div style={sectionTitle}>{strings.rewards.statusApproved}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {approvedNotFulfilled.map((r) => (
                <div key={r.id} style={card}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 22 }}>{r.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: theme.ink }}>{r.title}</div>
                      <div style={{ fontSize: 12, color: theme.muted }}>{formatPoints(r.cost)} točk · {formatDayLabel(r.decided_at)}</div>
                    </div>
                  </div>
                  <div role="button" tabIndex={0} onClick={() => open("fulfill", r)} style={{ ...approveBtn, marginTop: 10 }}>{strings.adminRequests.fulfill}</div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {history.length > 0 && (
        <section>
          <div style={sectionTitle}>{strings.adminRequests.historySection}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: "10px 12px", opacity: 0.85 }}>
                <span style={{ fontSize: 18 }}>{r.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: theme.ink }}>{r.title}</div>
                  <div style={{ fontSize: 11.5, color: theme.muted }}>{STATUS_LABEL[r.status]()} · {formatTime(r.decided_at || r.fulfilled_at || r.requested_at)}</div>
                  {r.admin_message && <div style={{ fontSize: 11.5, color: theme.mutedSoft, fontStyle: "italic", marginTop: 2 }}>“{r.admin_message}”</div>}
                </div>
                <div style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 14, color: theme.muted }}>{r.cost}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Sheet open={!!action} onClose={close}>
        {action && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink }}>
              {action.kind === "approve" ? strings.adminRequests.approveConfirm : action.kind === "decline" ? strings.adminRequests.declineConfirm : strings.adminRequests.fulfillConfirm}
            </div>
            <div style={{ fontSize: 13.5, color: "#7C6A5C" }}>{action.request.emoji} {action.request.title} · {formatPoints(action.request.cost)} točk</div>
            {(action.kind === "approve" || action.kind === "decline") && (
              <label style={{ fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft }}>
                {strings.adminRequests.messageLabel}
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder={strings.adminRequests.messagePlaceholder}
                  style={{ width: "100%", marginTop: 4, borderRadius: 14, border: `1.5px solid ${theme.cardBorder}`, background: "#FFFCF7", padding: 10, fontSize: 14, fontFamily: theme.fontBody, resize: "vertical" }} />
              </label>
            )}
            {action.kind === "decline" && (
              <div style={{ fontSize: 12, color: theme.muted }}>{strings.adminRequests.resultingBalance(formatPoints(previewAvailable))}</div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <div role="button" tabIndex={0} onClick={close} style={cancelBtn}>{strings.common.cancel}</div>
              <div role="button" tabIndex={0} onClick={confirm} style={{ ...saveBtn, opacity: busy ? 0.6 : 1 }}>
                {action.kind === "approve" ? strings.adminRequests.approve : action.kind === "decline" ? strings.adminRequests.decline : strings.adminRequests.fulfill}
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

const sectionTitle = { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 20, color: "#7C6A5C", marginBottom: 8 };
const card = { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 18, padding: 12 };
const declineBtn = { flex: 1, height: 42, borderRadius: 14, background: theme.badBg, border: `1px solid ${theme.bad}33`, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, color: theme.bad, cursor: "pointer" };
const approveBtn = { flex: 1, height: 42, borderRadius: 14, background: theme.sageBg, border: `1px solid ${theme.sageBorder}`, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, color: theme.sage, cursor: "pointer" };
const cancelBtn = { flex: 1, height: 48, borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#7C6A5C", cursor: "pointer" };
const saveBtn = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };
