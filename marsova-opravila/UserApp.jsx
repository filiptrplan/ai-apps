import * as api from "./api.js";
import { strings, resolveError } from "./strings.js";
import { formatPoints, formatTime, formatDayLabel, dayKey } from "./format.js";
import { describeEntry, KIND_TO_GROUP } from "./activity.js";
import {
  theme, SoundProvider, useSound, useAnimatedNumber, useReducedMotionPref,
  HoldControl, Toast, Sheet, EmptyState, Chip, SkeletonList,
} from "./ui.jsx";

const { useState, useEffect, useCallback, useMemo, useRef } = React;

const MARS_IDLE = "./marsova-opravila/mars-idle.jpg";
const CHORE_HOLD_MS = 800;
const REWARD_HOLD_MS = 650;

function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export function UserApp({ onOpenAdmin }) {
  return (
    <SoundProvider>
      <UserAppInner onOpenAdmin={onOpenAdmin} />
    </SoundProvider>
  );
}

function UserAppInner({ onOpenAdmin }) {
  const sound = useSound();
  const reducedMotion = useReducedMotionPref();
  const online = useOnlineStatus();

  const [screen, setScreen] = useState("opravila");
  const [category, setCategory] = useState("vse");
  const [logFilter, setLogFilter] = useState("vse");

  const [categories, setCategories] = useState([]);
  const [chores, setChores] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [requests, setRequests] = useState([]);
  const [log, setLog] = useState([]);
  const [points, setPoints] = useState({ current_balance: 0, reserved: 0, available: 0, lifetime: 0 });
  const [settings, setSettings] = useState({ display_name: "…" });

  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasCompletedOnce, setHasCompletedOnce] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [sheet, setSheet] = useState(null); // { type: 'reward'|'undo'|'why', payload }
  const [marsHappy, setMarsHappy] = useState(false);
  const [fly, setFly] = useState(null);
  const flyTimer = useRef(null);
  const happyTimer = useRef(null);

  const showToast = useCallback((t) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), t.ms || 5500);
  }, []);

  const celebrate = useCallback((pointsGained) => {
    setMarsHappy(true);
    setFly("+" + pointsGained);
    clearTimeout(happyTimer.current);
    clearTimeout(flyTimer.current);
    happyTimer.current = setTimeout(() => setMarsHappy(false), 1400);
    flyTimer.current = setTimeout(() => setFly(null), 1000);
    sound.buzz(28);
    sound.beep("ok");
  }, [sound]);

  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(happyTimer.current); clearTimeout(flyTimer.current); }, []);

  const loadAll = useCallback(async () => {
    try {
      const [cats, chs, rws, reqs, lg, pts, st] = await Promise.all([
        api.fetchCategories(), api.fetchChores(), api.fetchRewards(),
        api.fetchRewardRequests(), api.fetchActivityLog(), api.fetchPointsSummary(), api.fetchSettings(),
      ]);
      setCategories(cats); setChores(chs); setRewards(rws); setRequests(reqs); setLog(lg); setPoints(pts); setSettings(st);
      setLoadError(false);
      if (lg.some((e) => e.kind === "chore_completed")) setHasCompletedOnce(true);
    } catch {
      setLoadError(true);
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const unsubscribe = api.subscribeToChanges(({ table }) => {
      if (table === "mo_categories") api.fetchCategories().then(setCategories).catch(() => {});
      if (table === "mo_chores") api.fetchChores().then(setChores).catch(() => {});
      if (table === "mo_rewards") api.fetchRewards().then(setRewards).catch(() => {});
      if (table === "mo_settings") api.fetchSettings().then(setSettings).catch(() => {});
      if (table === "mo_reward_requests") {
        api.fetchRewardRequests().then(setRequests).catch(() => {});
        api.fetchPointsSummary().then(setPoints).catch(() => {});
      }
      if (table === "mo_activity_log") {
        api.fetchActivityLog().then(setLog).catch(() => {});
        api.fetchPointsSummary().then(setPoints).catch(() => {});
      }
    });
    return unsubscribe;
  }, []);

  const shownAvail = useAnimatedNumber(points.available, reducedMotion);

  // ── chore completion ──────────────────────────────────────────────────
  const completeChore = useCallback(async (chore) => {
    const row = await api.completeChore(chore.id);
    setLog((l) => [row, ...l]);
    setHasCompletedOnce(true);
    const pts = await api.fetchPointsSummary();
    setPoints(pts);
    celebrate(chore.points);
    showToast({
      icon: "🎉", text: strings.chores.completedToast(chore.title, chore.points),
      actionLabel: strings.chores.undoAction, ms: 6000,
      action: async () => {
        try {
          const undoRow = await api.undoChoreCompletion(row.id);
          setLog((l) => [undoRow, ...l]);
          setPoints(await api.fetchPointsSummary());
          setToast(null);
          sound.beep("bad");
        } catch (err) {
          showToast({ bad: true, icon: "🙈", text: resolveError(err), ms: 4500 });
        }
      },
    });
  }, [celebrate, showToast, sound]);

  const handleChoreError = useCallback((chore) => (err) => {
    showToast({
      bad: true, icon: err.offline ? "📡" : "🙈", text: resolveError(err), ms: 5000,
      actionLabel: err.offline ? undefined : strings.chores.retryAction,
    });
  }, [showToast]);

  // ── undo from history ───────────────────────────────────────────────
  const confirmUndo = useCallback(async (entry) => {
    try {
      const undoRow = await api.undoChoreCompletion(entry.id);
      setLog((l) => [undoRow, ...l]);
      setPoints(await api.fetchPointsSummary());
      setSheet(null);
      sound.beep("bad");
    } catch (err) {
      setSheet(null);
      showToast({ bad: true, icon: "🙈", text: resolveError(err), ms: 5000 });
    }
  }, [showToast, sound]);

  // ── rewards ─────────────────────────────────────────────────────────
  const openReward = useCallback((reward) => setSheet({ type: "reward", payload: reward }), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const confirmReward = useCallback(async (reward) => {
    const row = await api.requestReward(reward.id);
    setRequests((r) => [row, ...r]);
    setPoints(await api.fetchPointsSummary());
    setLog(await api.fetchActivityLog());
    setSheet(null);
    sound.buzz(24); sound.beep("req");
    showToast({ icon: "💌", text: strings.rewards.requestedToast });
  }, [showToast, sound]);

  const cancelRequest = useCallback(async (req) => {
    try {
      await api.cancelRewardRequest(req.id);
      setRequests((r) => r.filter((x) => x.id !== req.id));
      setPoints(await api.fetchPointsSummary());
      setLog(await api.fetchActivityLog());
      showToast({ icon: "↩️", text: strings.rewards.cancelledToast });
    } catch (err) {
      showToast({ bad: true, icon: "🙈", text: resolveError(err), ms: 5000 });
    }
  }, [showToast]);

  const marsLine = initialLoading ? "" : (
    chores.filter((c) => c.active).length === 0 ? strings.header.marsEmpty :
    marsHappy ? strings.header.marsHappy : strings.header.marsIdle
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: theme.bgGrad }}>
      <div style={{
        position: "relative", flex: 1, display: "flex", flexDirection: "column",
        maxWidth: 560, width: "100%", margin: "0 auto", background: theme.panel,
        boxShadow: "0 0 0 1px rgba(210,191,169,.4)",
      }}>
        <Header
          name={settings.display_name} marsLine={marsLine} marsHappy={marsHappy}
          shownAvail={shownAvail} reserved={points.reserved} lifetime={points.lifetime} fly={fly}
          sound={sound} online={online} onOpenAdmin={onOpenAdmin}
        />

        <div className="mo-hs" style={{ position: "relative", flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 18 }}>
          {loadError && !initialLoading && (
            <ErrorBanner onRetry={loadAll} />
          )}
          {screen === "opravila" && (
            <Opravila
              loading={initialLoading} categories={categories} chores={chores} category={category} setCategory={setCategory}
              onComplete={completeChore} onError={handleChoreError} reducedMotion={reducedMotion}
              hasCompletedOnce={hasCompletedOnce}
            />
          )}
          {screen === "nagrade" && (
            <Nagrade
              loading={initialLoading} rewards={rewards} requests={requests} available={points.available}
              reserved={points.reserved} onOpen={openReward} onCancel={cancelRequest}
            />
          )}
          {screen === "dogajanje" && (
            <Dogajanje
              loading={initialLoading} log={log} filter={logFilter} setFilter={setLogFilter}
              available={points.available}
              onUndo={(entry) => setSheet({ type: "undo", payload: entry })}
              onWhy={() => setSheet({ type: "why" })}
            />
          )}
        </div>

        <Toast toast={toast} onAction={() => toast && toast.action && toast.action()} />

        <Sheet open={sheet && sheet.type === "reward"} onClose={closeSheet}>
          {sheet && sheet.type === "reward" && (
            <RewardSheet reward={sheet.payload} available={points.available} onConfirm={confirmReward} onError={(err) => {
              setSheet(null);
              showToast({ bad: true, icon: err.offline ? "📡" : "🙈", text: resolveError(err), ms: 5000 });
            }} />
          )}
        </Sheet>

        <Sheet open={sheet && sheet.type === "undo"} onClose={closeSheet}>
          {sheet && sheet.type === "undo" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
              <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 30, color: theme.ink, lineHeight: 1.1 }}>
                {strings.log.undoSheetTitle}
              </div>
              <div style={{ fontSize: 14, color: "#7C6A5C", lineHeight: 1.45 }}>
                {strings.log.undoSheetBody(sheet.payload.title, sheet.payload.delta)}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div role="button" tabIndex={0} onClick={closeSheet}
                  style={{ flex: 1, height: 52, borderRadius: 17, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#7C6A5C", cursor: "pointer" }}>
                  {strings.log.undoSheetKeep}
                </div>
                <div role="button" tabIndex={0} onClick={() => confirmUndo(sheet.payload)}
                  style={{ flex: 1, height: 52, borderRadius: 17, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#FBF3EA", cursor: "pointer" }}>
                  {strings.log.undoSheetConfirm}
                </div>
              </div>
            </div>
          )}
        </Sheet>

        <Sheet open={sheet && sheet.type === "why"} onClose={closeSheet}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 30, color: theme.ink, lineHeight: 1.1 }}>
              {strings.log.undoLockedTitle}
            </div>
            <div style={{ fontSize: 14, color: "#7C6A5C", lineHeight: 1.45 }}>{strings.log.undoLockedBody}</div>
            <div role="button" tabIndex={0} onClick={closeSheet}
              style={{ height: 52, borderRadius: 17, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#FBF3EA", cursor: "pointer" }}>
              {strings.log.undoLockedOk}
            </div>
          </div>
        </Sheet>

        <BottomNav screen={screen} setScreen={setScreen} />
      </div>
    </div>
  );
}

function ErrorBanner({ onRetry }) {
  return (
    <div style={{ margin: "12px 20px 0", background: theme.badBg, border: `1px solid ${theme.bad}33`, borderRadius: 16, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 15 }}>🙈</span>
      <div style={{ flex: 1, fontSize: 13, color: theme.bad, lineHeight: 1.4 }}>{strings.common.genericError}</div>
      <div role="button" tabIndex={0} onClick={onRetry} style={{ fontWeight: 800, fontSize: 13, color: theme.bad, cursor: "pointer" }}>
        {strings.common.retry}
      </div>
    </div>
  );
}

function Header({ name, marsLine, marsHappy, shownAvail, reserved, lifetime, fly, sound, online, onOpenAdmin }) {
  return (
    <div style={{ position: "relative", flex: "0 0 auto", padding: "max(20px, env(safe-area-inset-top)) 20px 18px", background: theme.headerGrad, borderBottom: `1px solid ${theme.headerBorder}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ position: "relative", width: 54, height: 54, flex: "0 0 auto" }}>
          <img src={MARS_IDLE} alt="Mars" style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", border: "2.5px solid #FFFFFF", boxShadow: "0 3px 10px rgba(120,80,50,.18)", display: "block" }} />
          {marsHappy && (
            <div style={{ position: "absolute", top: 0, left: 0, width: 54, height: 54, borderRadius: "50%", boxShadow: "0 0 0 4px rgba(226,140,162,.35)", animation: "msPop .5s ease-out" }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 28, lineHeight: 1, color: theme.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {strings.header.greeting(name)} <span style={{ fontSize: 19, color: theme.roseSoft }}>♥</span>
          </div>
          <div style={{ fontSize: 13, color: theme.muted, lineHeight: 1.25 }}>{marsLine}</div>
        </div>
        <div style={{ display: "flex", gap: 7, flex: "0 0 auto" }}>
          <div role="button" tabIndex={0} aria-label={sound.enabled ? strings.header.soundOn : strings.header.soundOff} onClick={sound.toggle}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sound.toggle(); } }}
            style={{ width: 38, height: 38, borderRadius: 13, background: theme.chip, border: `1px solid ${theme.chipBorder}`, display: "grid", placeItems: "center", fontSize: 15, cursor: "pointer" }}>
            {sound.enabled ? "🔊" : "🔇"}
          </div>
          <div role="button" tabIndex={0} aria-label={strings.header.settings} onClick={onOpenAdmin}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenAdmin(); } }}
            style={{ width: 38, height: 38, borderRadius: 13, background: theme.chip, border: `1px solid ${theme.chipBorder}`, display: "grid", placeItems: "center", fontSize: 14, color: "#9A8574", cursor: "pointer" }}>
            ⚙
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, position: "relative", background: theme.roseBg, border: `1px solid ${theme.roseBorder}`, borderRadius: 24, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 4px 0 rgba(196,86,110,.08)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: theme.fontScript, fontWeight: 600, fontSize: 20, lineHeight: 1, color: theme.mutedSoft }}>{strings.header.available}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
            <div style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 42, lineHeight: 1, color: theme.rose }}>{formatPoints(shownAvail)}</div>
            <div style={{ fontFamily: theme.fontDisplay, fontWeight: 600, fontSize: 16, color: "#C9788C" }}>{strings.header.points}</div>
          </div>
        </div>
        <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", textAlign: "right" }}>
          <div style={{ fontSize: 12, color: theme.mutedSoft, lineHeight: 1.2 }}>{strings.header.reserved}<br /><strong style={{ fontFamily: theme.fontDisplay, fontSize: 15, color: "#8E5A6C" }}>{formatPoints(reserved)}</strong></div>
          <div style={{ fontSize: 12, color: "#A08D80", lineHeight: 1.2 }}>{strings.header.lifetime}<br /><strong style={{ fontFamily: theme.fontDisplay, fontSize: 15, color: theme.sage }}>{formatPoints(lifetime)}</strong></div>
        </div>
        {fly && (
          <div style={{ position: "absolute", right: 24, bottom: 10, fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 26, color: theme.sage, animation: "msFly 1s ease-out forwards", pointerEvents: "none" }}>
            {fly}
          </div>
        )}
      </div>

      {!online && (
        <div style={{ marginTop: 12, background: theme.warnBg, border: `1px solid ${theme.warnBorder}`, borderRadius: 14, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, color: theme.warn, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#C9903A", flex: "0 0 auto" }} />
          {strings.header.offline}
        </div>
      )}
    </div>
  );
}

function BottomNav({ screen, setScreen }) {
  const tabs = [
    { id: "opravila", icon: "🧹", name: strings.nav.opravila },
    { id: "nagrade", icon: "🎁", name: strings.nav.nagrade },
    { id: "dogajanje", icon: "🕰️", name: strings.nav.dogajanje },
  ];
  return (
    <div style={{
      position: "relative", zIndex: 30, flex: "0 0 auto", background: "#FDF7F0", borderTop: `1px solid ${theme.headerBorder}`,
      padding: "9px 12px max(14px, env(safe-area-inset-bottom)) 12px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6,
    }}>
      {tabs.map((t) => {
        const on = screen === t.id;
        return (
          <div key={t.id} role="button" tabIndex={0} onClick={() => setScreen(t.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setScreen(t.id); } }}
            style={{
              height: 56, borderRadius: 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, cursor: "pointer",
              background: on ? theme.roseBgFlat : "transparent", border: on ? `1px solid #EFCBD4` : "1px solid transparent",
            }}>
            <span style={{ fontSize: 19, lineHeight: 1, opacity: on ? 1 : 0.5 }}>{t.icon}</span>
            <span style={{ fontWeight: on ? 800 : 700, fontSize: 11.5, color: on ? theme.rose : "#9C8878" }}>{t.name}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Opravila ────────────────────────────────────────────────────────────
function Opravila({ loading, categories, chores, category, setCategory, onComplete, onError, reducedMotion, hasCompletedOnce }) {
  const [party, setParty] = useState(null);
  const activeChores = useMemo(() => chores.filter((c) => c.active), [chores]);
  const visible = useMemo(
    () => (category === "vse" ? activeChores : activeChores.filter((c) => c.category_id === category)),
    [activeChores, category]
  );
  const catById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);

  if (loading) return <SkeletonList count={3} />;

  if (activeChores.length === 0) {
    return <EmptyState image={MARS_IDLE} title={strings.chores.emptyTitle} body={strings.chores.emptyBody} />;
  }

  return (
    <div>
      <div className="mo-hs" style={{ display: "flex", gap: 8, padding: "16px 20px 4px", overflowX: "auto" }}>
        <Chip active={category === "vse"} onClick={() => setCategory("vse")}><span style={{ fontSize: 15 }}>✨</span>{strings.chores.allChip}</Chip>
        {categories.map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
            <span style={{ fontSize: 15 }}>{c.emoji}</span>{c.name}
          </Chip>
        ))}
      </div>

      <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {visible.map((c) => {
          const cat = catById[c.category_id];
          const isParty = party === c.id;
          return (
            <div key={c.id} style={{
              position: "relative", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 26, padding: 15,
              display: "flex", flexDirection: "column", gap: 13, boxShadow: "0 5px 0 rgba(150,110,80,.07)",
              animation: isParty && !reducedMotion ? "msCelebrate .72s cubic-bezier(.3,1.1,.4,1)" : "none",
            }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ width: 50, height: 50, flex: "0 0 auto", borderRadius: 17, background: "#F8EBDF", border: "1px solid #F0DECD", display: "grid", placeItems: "center", fontSize: 25 }}>{c.emoji}</div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ fontFamily: theme.fontDisplay, fontWeight: 700, fontSize: 18, lineHeight: 1.15, color: theme.ink, textWrap: "pretty" }}>{c.title}</div>
                  {c.description && <div style={{ fontSize: 13, color: theme.muted, lineHeight: 1.35, textWrap: "pretty" }}>{c.description}</div>}
                  {cat && (
                    <div style={{ marginTop: 3, display: "flex", gap: 5, alignItems: "center" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 8px", borderRadius: 8, background: "#F3EDE2", fontSize: 11.5, fontWeight: 700, color: "#7C6A5C" }}>
                        <span>{cat.emoji}</span>{cat.name}
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 48, height: 44, borderRadius: 14, background: theme.sageBg, border: `1px solid ${theme.sageBorder}` }}>
                  <div style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 17, lineHeight: 1, color: "#5C6A44" }}>+{c.points}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: "#8A9470", letterSpacing: ".04em" }}>TOČK</div>
                </div>
              </div>

              <HoldControl
                durationMs={CHORE_HOLD_MS}
                ariaLabel={strings.chores.holdAria(c.title, c.points)}
                onComplete={async () => {
                  await onComplete(c);
                  setParty(c.id);
                  setTimeout(() => setParty(null), 1400);
                }}
                onError={onError(c)}
                label={(phase, pct) => {
                  if (phase === "holding") return strings.chores.holding(pct);
                  if (phase === "saving") return strings.chores.saving;
                  if (phase === "done") return strings.chores.done;
                  return strings.chores.holdLabel(c.points);
                }}
              />
            </div>
          );
        })}

        {visible.length === 0 && (
          <div style={{ padding: "26px 20px", textAlign: "center", border: "1.5px dashed #E6D3C0", borderRadius: 24, background: "#FDF8F2" }}>
            <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 25, lineHeight: 1, color: theme.ink }}>{strings.chores.categoryEmptyTitle}</div>
            <div style={{ fontSize: 13.5, color: theme.muted, marginTop: 5, lineHeight: 1.4 }}>{strings.chores.categoryEmptyBody}</div>
          </div>
        )}

        {!hasCompletedOnce && (
          <div style={{ marginTop: 2, display: "flex", gap: 9, alignItems: "flex-start", padding: "13px 15px", borderRadius: 20, background: theme.sand, border: `1px solid ${theme.sandBorder}` }}>
            <span style={{ fontSize: 15, lineHeight: 1.2 }}>👆</span>
            <div style={{ fontSize: 12.5, color: "#7C6A5C", lineHeight: 1.4 }}>{strings.chores.hint}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Nagrade ────────────────────────────────────────────────────────────
function Nagrade({ loading, rewards, requests, available, reserved, onOpen, onCancel }) {
  const activeRewards = useMemo(() => rewards.filter((r) => r.active), [rewards]);
  const pending = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
  const pendingRewardIds = useMemo(() => new Set(pending.map((r) => r.reward_id)), [pending]);

  if (loading) return <SkeletonList count={2} />;

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 9 }}>
        <div style={{ flex: 1, padding: "12px 14px", borderRadius: 18, background: theme.roseBgFlat, border: `1px solid ${theme.roseBorder}` }}>
          <div style={{ fontFamily: theme.fontScript, fontWeight: 600, fontSize: 19, lineHeight: 1.1, color: theme.mutedSoft }}>{strings.rewards.available}</div>
          <div style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 26, color: theme.rose, lineHeight: 1.1 }}>{formatPoints(available)}</div>
        </div>
        <div style={{ flex: 1, padding: "12px 14px", borderRadius: 18, background: theme.sand, border: `1px solid ${theme.sandBorder}` }}>
          <div style={{ fontFamily: theme.fontScript, fontWeight: 600, fontSize: 19, lineHeight: 1.1, color: "#9A8A76" }}>{strings.rewards.reserved}</div>
          <div style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 26, color: "#7C6A5C", lineHeight: 1.1 }}>{formatPoints(reserved)}</div>
          <div style={{ fontSize: 11.5, color: "#9A8A76", marginTop: 1 }}>{strings.rewards.reservedNote}</div>
        </div>
      </div>

      {pending.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 2 }}>
          <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 23, lineHeight: 1, color: "#7C6A5C" }}>{strings.rewards.yourRequestsTitle}</div>
          {pending.map((q) => (
            <div key={q.id} style={{ background: theme.card, border: "1.5px solid #EDD9BE", borderRadius: 22, padding: "13px 14px", display: "flex", gap: 11, alignItems: "center" }}>
              <div style={{ width: 42, height: 42, flex: "0 0 auto", borderRadius: 14, background: "#F8EFE2", display: "grid", placeItems: "center", fontSize: 21 }}>{q.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: theme.fontDisplay, fontWeight: 700, fontSize: 16, color: theme.ink, lineHeight: 1.15 }}>{q.title}</div>
                <div style={{ fontSize: 12, color: theme.muted, marginTop: 1 }}>{strings.rewards.statusPending} · {formatPoints(q.cost)} {strings.rewards.pointsUnit.toLowerCase()} · {formatTime(q.requested_at)}</div>
              </div>
              <div role="button" tabIndex={0} onClick={() => onCancel(q)}
                style={{ flex: "0 0 auto", height: 38, padding: "0 13px", borderRadius: 13, background: theme.chip, border: `1px solid #E8D3C0`, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, color: "#8A6F5E", cursor: "pointer" }}>
                {strings.rewards.cancel}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeRewards.length === 0 ? (
        <EmptyState image={MARS_IDLE} title={strings.rewards.emptyTitle} body={strings.rewards.emptyBody} size={100} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 23, lineHeight: 1, color: "#7C6A5C", marginTop: 6 }}>{strings.rewards.forExchange}</div>
          {activeRewards.map((r) => {
            const isPending = pendingRewardIds.has(r.id);
            const ok = !isPending && available >= r.cost;
            return (
              <div key={r.id} role={ok ? "button" : undefined} tabIndex={ok ? 0 : undefined}
                onClick={ok ? () => onOpen(r) : undefined}
                onKeyDown={ok ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r); } } : undefined}
                style={{
                  background: ok ? theme.card : "#FCF8F2", border: ok ? `1px solid ${theme.cardBorder}` : "1px dashed #E8D8C7",
                  borderRadius: 24, padding: 14, display: "flex", gap: 12, alignItems: "center",
                  cursor: ok ? "pointer" : "default", boxShadow: ok ? "0 5px 0 rgba(150,110,80,.07)" : "none",
                }}>
                <div style={{ width: 52, height: 52, flex: "0 0 auto", borderRadius: 18, background: ok ? theme.roseBgFlat : "#F5EDE4", border: ok ? "1px solid #F4DBE1" : "none", display: "grid", placeItems: "center", fontSize: 26, opacity: ok ? 1 : 0.62 }}>{r.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: theme.fontDisplay, fontWeight: 700, fontSize: 17.5, color: ok ? theme.ink : "#7E6D60", lineHeight: 1.15, textWrap: "pretty" }}>{r.title}</div>
                  {isPending ? (
                    <div style={{ fontSize: 12.5, color: theme.muted, marginTop: 2 }}>{strings.rewards.statusPending}</div>
                  ) : ok ? (
                    r.description && <div style={{ fontSize: 12.5, color: theme.muted, lineHeight: 1.35, marginTop: 2 }}>{r.description}</div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: "#A08D80", marginTop: 2 }}>{strings.rewards.gapLabel(r.cost - available)}</div>
                  )}
                </div>
                <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 52, height: 46, borderRadius: 15, background: ok ? "#F6DEE4" : "#F3ECE3", border: ok ? "1px solid #EFCBD4" : "1px solid #E7DACC" }}>
                  <div style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 17, lineHeight: 1, color: ok ? theme.rose : "#8A7768" }}>{r.cost}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: ok ? "#C1808F" : "#A69485" }}>{strings.rewards.pointsUnit}</div>
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 4, display: "flex", gap: 9, alignItems: "flex-start", padding: "13px 15px", borderRadius: 20, background: theme.sand, border: `1px solid ${theme.sandBorder}` }}>
            <span style={{ fontSize: 15 }}>🔒</span>
            <div style={{ fontSize: 12.5, color: "#7C6A5C", lineHeight: 1.4 }}>{strings.rewards.lockedNote}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function RewardSheet({ reward, available, onConfirm, onError }) {
  const after = available - reward.cost;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
        <div style={{ position: "relative", width: 62, height: 62, flex: "0 0 auto" }}>
          <div style={{ width: 62, height: 62, borderRadius: 20, background: theme.roseBgFlat, border: "1px solid #F4DBE1", display: "grid", placeItems: "center", fontSize: 31 }}>{reward.emoji}</div>
          <img src={MARS_IDLE} alt="" style={{ position: "absolute", right: -8, bottom: -8, width: 30, height: 30, borderRadius: "50%", objectFit: "cover", border: "2px solid #FDF7F0", boxShadow: "0 2px 6px rgba(120,80,50,.22)" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 30, color: theme.ink, lineHeight: 1.05, textWrap: "pretty" }}>{reward.title}</div>
          {reward.description && <div style={{ fontSize: 13, color: theme.muted, marginTop: 2 }}>{reward.description}</div>}
        </div>
      </div>

      <div style={{ borderRadius: 20, background: "#F8F3EA", border: "1px solid #EDE4D6", overflow: "hidden" }}>
        <Row label={strings.rewards.sheetCost} value={"−" + formatPoints(reward.cost)} valueColor={theme.rose} />
        <div style={{ height: 1, background: "#EDE4D6" }} />
        <Row label={strings.rewards.sheetAvailableNow} value={formatPoints(available)} valueColor={theme.inkSoft} />
        <div style={{ height: 1, background: "#EDE4D6" }} />
        <Row label={strings.rewards.sheetAfter} value={formatPoints(after)} valueColor={theme.sage} bold bg="#F3EEE3" />
      </div>

      <HoldControl
        durationMs={REWARD_HOLD_MS}
        ariaLabel={strings.rewards.sheetAria(reward.title)}
        height={58} radius={19} idleBg="#F1D9DF" idleBorder="#E7C3CC" fillFrom="#E8879E" fillTo="#D2607C" textColor="#6B3A47"
        onComplete={() => onConfirm(reward)}
        onError={onError}
        label={(phase, pct) => {
          if (phase === "holding") return strings.rewards.sheetHolding(pct);
          if (phase === "saving") return strings.rewards.sheetSaving;
          if (phase === "done") return strings.chores.done;
          return strings.rewards.sheetHold;
        }}
      />
      <div style={{ textAlign: "center", fontSize: 12, color: "#A08D80", marginTop: -6 }}>{strings.rewards.sheetCancelNote}</div>
    </div>
  );
}

function Row({ label, value, valueColor, bold, bg }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 15px", fontSize: 13.5, fontWeight: bold ? 800 : 400, color: bold ? theme.inkSoft : "#7C6A5C", background: bg || "transparent" }}>
      <span>{label}</span><strong style={{ fontFamily: theme.fontDisplay, fontSize: 16, color: valueColor }}>{value}</strong>
    </div>
  );
}

// ── Dogajanje ──────────────────────────────────────────────────────────
function Dogajanje({ loading, log, filter, setFilter, available, onUndo, onWhy }) {
  const undoneRefIds = useMemo(() => new Set(log.filter((e) => e.kind === "chore_undone").map((e) => e.ref_id)), [log]);
  const filtered = useMemo(() => {
    if (filter === "vse") return log;
    return log.filter((e) => KIND_TO_GROUP[e.kind] === filter);
  }, [log, filter]);

  const groups = useMemo(() => {
    const out = [];
    let key = null;
    filtered.forEach((e) => {
      const k = dayKey(e.created_at);
      if (k !== key) { key = k; out.push({ isDay: true, label: formatDayLabel(e.created_at), key: "d" + k }); }
      out.push({ isEntry: true, entry: e, key: e.id });
    });
    return out;
  }, [filtered]);

  if (loading) return <SkeletonList count={4} />;

  const chips = [
    { id: "vse", name: strings.log.filterAll },
    { id: "opravila", name: strings.log.filterChores },
    { id: "nagrade", name: strings.log.filterRewards },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, padding: "16px 20px 6px" }}>
        {chips.map((f) => <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>{f.name}</Chip>)}
      </div>

      {log.length === 0 ? (
        <EmptyState emoji="🕰️" title={strings.log.emptyTitle} body={strings.log.emptyBody} />
      ) : (
        <div style={{ padding: "8px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map((row) => row.isDay ? (
            <div key={row.key} style={{ padding: "12px 2px 3px", fontFamily: theme.fontScript, fontWeight: 700, fontSize: 22, lineHeight: 1, color: "#A38F81" }}>{row.label}</div>
          ) : (
            <LogRow key={row.key} entry={row.entry} undoneRefIds={undoneRefIds} available={available} onUndo={onUndo} onWhy={onWhy} />
          ))}
        </div>
      )}
    </div>
  );
}

function LogRow({ entry, undoneRefIds, available, onUndo, onWhy }) {
  const d = describeEntry(entry, undoneRefIds, available);
  const color = d.amountClass === "pos" ? theme.sage : d.amountClass === "neg" ? theme.rose : "#B0A093";
  return (
    <div style={{ background: theme.card, border: `1px solid #F0E2D3`, borderRadius: 20, padding: "12px 13px", display: "flex", gap: 11, alignItems: "center" }}>
      <div style={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 13, background: "#F8EFE5", display: "grid", placeItems: "center", fontSize: 19 }}>{d.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, color: theme.ink, lineHeight: 1.2, textWrap: "pretty" }}>{d.title}</div>
        <div style={{ fontSize: 12, color: "#98857A", marginTop: 1 }}>{d.sub}</div>
        {d.note && <div style={{ fontSize: 12, color: theme.mutedSoft, marginTop: 3, fontStyle: "italic" }}>“{d.note}”</div>}
      </div>
      <div style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 16, color, flex: "0 0 auto", textDecoration: d.amountClass === "dim" && entry.kind === "chore_undone" ? "line-through" : "none" }}>
        {d.amountText}
      </div>
      {d.showUndo && (
        <div role="button" tabIndex={0} onClick={() => onUndo(entry)} aria-label={strings.log.undoAria}
          style={{ flex: "0 0 auto", width: 44, height: 44, borderRadius: 14, background: theme.chip, border: "1px solid #E8D3C0", display: "grid", placeItems: "center", fontSize: 15, color: "#8A6F5E", cursor: "pointer" }}>
          ↺
        </div>
      )}
      {d.showLockUndo && (
        <div role="button" tabIndex={0} onClick={onWhy} aria-label={strings.log.undoLockedAria}
          style={{ flex: "0 0 auto", width: 44, height: 44, borderRadius: 14, background: theme.sand, border: "1px dashed #E0D5C4", display: "grid", placeItems: "center", fontSize: 14, color: "#B5A697", cursor: "pointer" }}>
          ↺
        </div>
      )}
    </div>
  );
}
