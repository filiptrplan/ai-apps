import * as api from "./api.js";
import { strings, resolveError } from "./strings.js";
import { formatPoints, formatTime } from "./format.js";
import { describeEntry } from "./activity.js";
import { theme, Sheet, ConfirmSheet, SkeletonList } from "./ui.jsx";
import { AdminPin } from "./AdminPin.jsx";
import { AdminChores } from "./admin/Chores.jsx";
import { AdminCategories } from "./admin/Categories.jsx";
import { AdminRewards } from "./admin/Rewards.jsx";
import { AdminRequests } from "./admin/Requests.jsx";

const { useState, useEffect, useCallback, useMemo } = React;

const MARS_IDLE = "./marsova-opravila/mars-idle.jpg";

const TABS = [
  { id: "pregled", name: () => strings.adminNav.pregled, icon: "🏡" },
  { id: "opravila", name: () => strings.adminNav.opravila, icon: "🧹" },
  { id: "kategorije", name: () => strings.adminNav.kategorije, icon: "🏷️" },
  { id: "nagrade", name: () => strings.adminNav.nagrade, icon: "🎁" },
  { id: "zahtevki", name: () => strings.adminNav.zahtevki, icon: "📮" },
  { id: "dogajanje", name: () => strings.adminNav.dogajanje, icon: "🕰️" },
  { id: "nastavitve", name: () => strings.adminNav.nastavitve, icon: "⚙" },
];

export function AdminApp({ onExit }) {
  const [session, setSession] = useState(() => api.getAdminSession());
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const local = api.getAdminSession();
    if (!local) { setChecked(true); return undefined; }
    api.adminSessionValid(local.token)
      .then((valid) => {
        if (cancelled) return;
        if (!valid) { api.clearAdminSession(); setSession(null); }
        setChecked(true);
      })
      .catch(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, []);

  const onExpired = useCallback(() => { api.clearAdminSession(); setSession(null); }, []);

  if (!checked) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: theme.bgGrad }} />;
  }
  if (!session) {
    return <AdminPin onSuccess={() => setSession(api.getAdminSession())} onCancel={onExit} />;
  }
  return <AdminShell session={session} onExpired={onExpired} onExit={onExit} />;
}

function AdminShell({ session, onExpired, onExit }) {
  const [tab, setTab] = useState("pregled");

  const [categories, setCategories] = useState([]);
  const [chores, setChores] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [requests, setRequests] = useState([]);
  const [log, setLog] = useState([]);
  const [points, setPoints] = useState({ current_balance: 0, reserved: 0, available: 0, lifetime: 0 });
  const [settings, setSettings] = useState({ display_name: "" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      const [cats, chs, rws, reqs, lg, pts, st] = await Promise.all([
        api.fetchCategories(), api.fetchChores(), api.fetchRewards(),
        api.fetchRewardRequests(), api.fetchActivityLog(), api.fetchPointsSummary(), api.fetchSettings(),
      ]);
      setCategories(cats); setChores(chs); setRewards(rws); setRequests(reqs); setLog(lg); setPoints(pts); setSettings(st);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const unsubscribe = api.subscribeToChanges(({ table }) => {
      if (table === "mo_categories") api.fetchCategories().then(setCategories).catch(() => {});
      if (table === "mo_chores") api.fetchChores().then(setChores).catch(() => {});
      if (table === "mo_rewards") api.fetchRewards().then(setRewards).catch(() => {});
      if (table === "mo_settings") api.fetchSettings().then(setSettings).catch(() => {});
      if (table === "mo_reward_requests") { api.fetchRewardRequests().then(setRequests).catch(() => {}); api.fetchPointsSummary().then(setPoints).catch(() => {}); }
      if (table === "mo_activity_log") { api.fetchActivityLog().then(setLog).catch(() => {}); api.fetchPointsSummary().then(setPoints).catch(() => {}); }
    });
    return unsubscribe;
  }, []);

  const flashToast = useCallback((text, bad) => {
    setToast({ text, bad });
    setTimeout(() => setToast(null), 3200);
  }, []);

  // Wraps every admin RPC call: on `unauthorized` it drops back to the PIN
  // screen (session expired/invalid elsewhere); any other error is
  // rethrown for the calling screen's own try/catch to show inline.
  const callAdmin = useCallback(async (fn, ...args) => {
    try {
      return await fn(session.token, ...args);
    } catch (err) {
      if (err.code === "unauthorized") onExpired();
      throw err;
    }
  }, [session.token, onExpired]);

  const lock = useCallback(async () => {
    try { await api.adminLogout(session.token); } catch {}
    onExpired();
  }, [session.token, onExpired]);

  const pendingCount = useMemo(() => requests.filter((r) => r.status === "pending").length, [requests]);

  return (
    <div style={{ minHeight: "100vh", background: theme.bgGrad }}>
      <div style={{ maxWidth: 720, margin: "0 auto", minHeight: "100vh", background: theme.panel, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "max(16px, env(safe-area-inset-top)) 20px 12px", background: theme.headerGrad, borderBottom: `1px solid ${theme.headerBorder}`, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src={MARS_IDLE} alt="" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", border: "2px solid #fff", flex: "0 0 auto" }} />
            <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 22, color: theme.ink, lineHeight: 1 }}>{strings.adminPin.titleLogin}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 50 }}>
            <div role="button" tabIndex={0} onClick={onExit} style={navLinkStyle}>{strings.adminNav.backToApp}</div>
            <div role="button" tabIndex={0} onClick={lock} style={{ ...navLinkStyle, color: theme.bad }}>{strings.adminNav.lock}</div>
          </div>
        </div>

        <div className="mo-hs" style={{ display: "flex", gap: 8, padding: "12px 20px", overflowX: "auto", borderBottom: `1px solid ${theme.headerBorder}` }}>
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <div key={t.id} role="button" tabIndex={0} onClick={() => setTab(t.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTab(t.id); } }}
                style={{
                  position: "relative", flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, height: 38, padding: "0 14px",
                  borderRadius: 13, cursor: "pointer", fontWeight: on ? 800 : 700, fontSize: 13.5,
                  background: on ? theme.ink : "#FFFCF7", color: on ? "#FBF3EA" : "#6E5A4E",
                  border: on ? "none" : `1px solid ${theme.cardBorder}`,
                }}>
                <span>{t.icon}</span>{t.name()}
                {t.id === "zahtevki" && pendingCount > 0 && (
                  <span style={{ position: "absolute", top: -5, right: -5, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 9, background: theme.rose, color: "#fff", fontSize: 10.5, fontWeight: 800, display: "grid", placeItems: "center" }}>
                    {pendingCount}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="mo-hs" style={{ flex: 1, overflowY: "auto", position: "relative" }}>
          {loadError && (
            <div style={{ margin: "12px 20px 0", background: theme.badBg, borderRadius: 16, padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
              <span>🙈</span>
              <div style={{ flex: 1, fontSize: 13, color: theme.bad }}>{strings.common.genericError}</div>
              <div role="button" tabIndex={0} onClick={loadAll} style={{ fontWeight: 800, fontSize: 13, color: theme.bad, cursor: "pointer" }}>{strings.common.retry}</div>
            </div>
          )}

          {loading ? <SkeletonList count={3} /> : (
            <>
              {tab === "pregled" && (
                <Pregled points={points} requests={requests} log={log} onGoto={setTab}
                  onAddChore={() => setTab("opravila")} onAddReward={() => setTab("nagrade")} onAdjust={() => setTab("nastavitve")} />
              )}
              {tab === "opravila" && (
                <AdminChores token={session.token} callAdmin={callAdmin} chores={chores} categories={categories}
                  onSaved={(msg) => flashToast(msg)} onFailed={(msg) => flashToast(msg, true)} />
              )}
              {tab === "kategorije" && (
                <AdminCategories token={session.token} callAdmin={callAdmin} categories={categories} chores={chores}
                  onSaved={(msg) => flashToast(msg)} onFailed={(msg) => flashToast(msg, true)} />
              )}
              {tab === "nagrade" && (
                <AdminRewards token={session.token} callAdmin={callAdmin} rewards={rewards}
                  onSaved={(msg) => flashToast(msg)} onFailed={(msg) => flashToast(msg, true)} />
              )}
              {tab === "zahtevki" && (
                <AdminRequests token={session.token} callAdmin={callAdmin} requests={requests} points={points}
                  onSaved={(msg) => flashToast(msg)} onFailed={(msg) => flashToast(msg, true)} />
              )}
              {tab === "dogajanje" && <AdminLog log={log} available={points.available} />}
              {tab === "nastavitve" && (
                <Nastavitve token={session.token} callAdmin={callAdmin} settings={settings} points={points} onLock={lock}
                  onSaved={(msg) => flashToast(msg)} onFailed={(msg) => flashToast(msg, true)} />
              )}
            </>
          )}
        </div>

        {toast && (
          <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 80, background: toast.bad ? theme.bad : theme.ink, color: "#fff", padding: "10px 18px", borderRadius: 14, fontWeight: 700, fontSize: 13.5, boxShadow: "0 10px 24px -8px rgba(0,0,0,.35)", maxWidth: "90vw", textAlign: "center" }}>
            {toast.text}
          </div>
        )}
      </div>
    </div>
  );
}

const navLinkStyle = { fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft, cursor: "pointer", whiteSpace: "nowrap" };

function StatCard({ label, value, color }) {
  return (
    <div style={{ flex: 1, padding: "12px 14px", borderRadius: 16, background: theme.sand, border: `1px solid ${theme.sandBorder}` }}>
      <div style={{ fontFamily: theme.fontScript, fontWeight: 600, fontSize: 15, color: "#9A8A76" }}>{label}</div>
      <div style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 22, color: color || theme.inkSoft }}>{formatPoints(value)}</div>
    </div>
  );
}

function Pregled({ points, requests, log, onGoto, onAddChore, onAddReward, onAdjust }) {
  const pending = requests.filter((r) => r.status === "pending");
  return (
    <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
      <section>
        <div style={sectionTitle}>{strings.adminOverview.pendingTitle}</div>
        {pending.length === 0 ? (
          <div style={emptyNote}>{strings.adminOverview.pendingEmpty}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.slice(0, 3).map((r) => (
              <div key={r.id} style={rowCard}>
                <span style={{ fontSize: 20 }}>{r.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: theme.ink }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: theme.muted }}>{formatPoints(r.cost)} · {formatTime(r.requested_at)}</div>
                </div>
              </div>
            ))}
            <div role="button" tabIndex={0} onClick={() => onGoto("zahtevki")} style={{ ...navLinkStyle, alignSelf: "flex-start", marginTop: 2 }}>
              {strings.adminOverview.pendingCta} ({pending.length})
            </div>
          </div>
        )}
      </section>

      <section>
        <div style={sectionTitle}>{strings.adminOverview.pointsTitle}</div>
        <div style={{ display: "flex", gap: 9 }}>
          <StatCard label={strings.adminOverview.current} value={points.current_balance} color={theme.inkSoft} />
          <StatCard label={strings.adminOverview.reserved} value={points.reserved} color="#7C6A5C" />
          <StatCard label={strings.adminOverview.available} value={points.available} color={theme.rose} />
        </div>
      </section>

      <section>
        <div style={sectionTitle}>{strings.adminOverview.quickActions}</div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <QuickAction label={strings.adminOverview.addChore} onClick={onAddChore} />
          <QuickAction label={strings.adminOverview.addReward} onClick={onAddReward} />
          <QuickAction label={strings.adminOverview.adjustPoints} onClick={onAdjust} />
        </div>
      </section>

      <section>
        <div style={sectionTitle}>{strings.adminOverview.recentActivity}</div>
        {log.length === 0 ? (
          <div style={emptyNote}>{strings.adminOverview.recentEmpty}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {log.slice(0, 6).map((e) => {
              const d = describeEntry(e, new Set(), points.available);
              return (
                <div key={e.id} style={rowCard}>
                  <span style={{ fontSize: 18 }}>{d.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: theme.ink }}>{d.title}</div>
                    <div style={{ fontSize: 11.5, color: theme.muted }}>{d.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function QuickAction({ label, onClick }) {
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      style={{ padding: "12px 16px", borderRadius: 15, background: theme.roseBgFlat, border: `1px solid ${theme.roseBorder}`, fontWeight: 800, fontSize: 13.5, color: theme.rose, cursor: "pointer" }}>
      {label}
    </div>
  );
}

function AdminLog({ log, available }) {
  const undoneRefIds = useMemo(() => new Set(log.filter((e) => e.kind === "chore_undone").map((e) => e.ref_id)), [log]);
  if (log.length === 0) return <div style={{ padding: 24 }}><div style={emptyNote}>{strings.log.emptyBody}</div></div>;
  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
      {log.map((e) => {
        const d = describeEntry(e, undoneRefIds, available);
        const color = d.amountClass === "pos" ? theme.sage : d.amountClass === "neg" ? theme.rose : "#B0A093";
        return (
          <div key={e.id} style={rowCard}>
            <span style={{ fontSize: 18 }}>{d.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: theme.ink }}>{d.title}</div>
              <div style={{ fontSize: 11.5, color: theme.muted }}>{d.sub}</div>
            </div>
            <div style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 14, color }}>{d.amountText}</div>
          </div>
        );
      })}
    </div>
  );
}

function Nastavitve({ token, callAdmin, settings, points, onLock, onSaved, onFailed }) {
  const [name, setName] = useState(settings.display_name || "");
  const [savingName, setSavingName] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  useEffect(() => { setName(settings.display_name || ""); }, [settings.display_name]);

  const saveName = useCallback(async () => {
    if (!name.trim() || savingName) return;
    setSavingName(true);
    try {
      await callAdmin(api.adminUpdateSettings, name.trim());
      onSaved(strings.adminSettings.displayNameSaved);
    } catch (err) {
      onFailed(resolveError(err));
    } finally {
      setSavingName(false);
    }
  }, [name, savingName, callAdmin, onSaved, onFailed]);

  return (
    <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
      <section>
        <div style={sectionTitle}>{strings.adminSettings.displayNameLabel}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
          <div role="button" tabIndex={0} onClick={saveName}
            style={{ padding: "0 18px", borderRadius: 14, background: theme.ink, color: "#FBF3EA", fontWeight: 800, fontSize: 13.5, display: "grid", placeItems: "center", cursor: "pointer", opacity: savingName ? 0.6 : 1 }}>
            {strings.common.save}
          </div>
        </div>
      </section>

      <section>
        <div style={sectionTitle}>{strings.adminPointAdjust.title}</div>
        <QuickAction label={strings.adminOverview.adjustPoints} onClick={() => setAdjustOpen(true)} />
      </section>

      <section>
        <div style={sectionTitle}>{strings.adminNav.nastavitve}</div>
        <div style={emptyNote}>{strings.adminSettings.lockedNote}</div>
        <div role="button" tabIndex={0} onClick={onLock}
          style={{ marginTop: 10, padding: "12px 16px", borderRadius: 15, background: theme.badBg, border: `1px solid ${theme.bad}33`, fontWeight: 800, fontSize: 13.5, color: theme.bad, cursor: "pointer", display: "inline-block" }}>
          {strings.adminSettings.lockNow}
        </div>
      </section>

      <PointAdjustSheet open={adjustOpen} onClose={() => setAdjustOpen(false)} points={points} callAdmin={callAdmin} onSaved={onSaved} onFailed={onFailed} />
    </div>
  );
}

function PointAdjustSheet({ open, onClose, points, callAdmin, onSaved, onFailed }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const delta = parseInt(amount, 10);
  const valid = Number.isInteger(delta) && delta !== 0;
  const previewCurrent = valid ? points.current_balance + delta : points.current_balance;
  const previewAvailable = valid ? points.available + delta : points.available;

  useEffect(() => { if (open) { setAmount(""); setError(null); } }, [open]);

  const submit = useCallback(async () => {
    if (!valid || busy) { if (!valid) setError(strings.adminPointAdjust.invalidAmount); return; }
    if (previewAvailable < 0) { setError(strings.adminPointAdjust.negativeBlocked); return; }
    setBusy(true);
    try {
      await callAdmin(api.adminAdjustPoints, delta);
      onSaved(strings.adminPointAdjust.success);
      onClose();
    } catch (err) {
      setError(resolveError(err));
    } finally {
      setBusy(false);
    }
  }, [valid, busy, delta, previewAvailable, callAdmin, onSaved, onClose]);

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink }}>{strings.adminPointAdjust.title}</div>
        <input
          type="number" inputMode="numeric" placeholder="+10 / -10" value={amount}
          onChange={(e) => setAmount(e.target.value)} style={{ ...fieldStyle, fontSize: 20, textAlign: "center", fontFamily: theme.fontDisplay, fontWeight: 700 }}
          aria-label={strings.adminPointAdjust.amountLabel}
        />
        {error && <div style={{ fontSize: 12.5, color: theme.bad, fontWeight: 700, textAlign: "center" }}>{error}</div>}
        <div style={{ borderRadius: 16, background: "#F8F3EA", border: "1px solid #EDE4D6", padding: "10px 14px", display: "flex", justifyContent: "space-around", fontSize: 12.5, color: "#7C6A5C" }}>
          <div>{strings.adminPointAdjust.current}<br /><strong style={{ fontFamily: theme.fontDisplay, fontSize: 16, color: theme.inkSoft }}>{formatPoints(previewCurrent)}</strong></div>
          <div>{strings.adminPointAdjust.available}<br /><strong style={{ fontFamily: theme.fontDisplay, fontSize: 16, color: theme.rose }}>{formatPoints(previewAvailable)}</strong></div>
        </div>
        <div role="button" tabIndex={0} onClick={submit}
          style={{ height: 52, borderRadius: 17, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#FBF3EA", cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
          {strings.adminPointAdjust.submit}
        </div>
      </div>
    </Sheet>
  );
}

const sectionTitle = { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 20, color: "#7C6A5C", marginBottom: 8 };
const emptyNote = { fontSize: 13, color: theme.muted, padding: "10px 2px" };
const rowCard = { display: "flex", gap: 10, alignItems: "center", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: "10px 12px" };
export const fieldStyle = {
  flex: 1, height: 46, borderRadius: 14, border: `1.5px solid ${theme.cardBorder}`, background: "#FFFCF7",
  padding: "0 14px", fontSize: 14.5, color: theme.ink, fontFamily: theme.fontBody,
};
