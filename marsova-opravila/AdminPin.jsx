import * as api from "./api.js";
import { strings, resolveError } from "./strings.js";
import { theme } from "./ui.jsx";

const { useState, useEffect, useCallback } = React;

const MARS_IDLE = "./marsova-opravila/mars-idle.jpg";

// Friendly PIN gate: figures out on its own whether this is the very first
// visit to the admin side (no PIN configured yet - bootstrap flow) or a
// returning one (login flow). The PIN itself is only ever compared inside
// the Supabase functions in api.js; nothing here can validate it.
export function AdminPin({ onSuccess, onCancel }) {
  const [mode, setMode] = useState(null); // 'login' | 'bootstrap'
  const [checking, setChecking] = useState(true);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.adminPinStatus()
      .then((row) => { if (!cancelled) setMode(row.configured ? "login" : "bootstrap"); })
      .catch(() => { if (!cancelled) setMode("login"); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, []);

  const submit = useCallback(async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (mode === "bootstrap") {
      if (pin.length < 4) return setError(strings.adminPin.tooShort);
      if (pin !== confirmPin) return setError(strings.adminPin.mismatch);
      setBusy(true);
      try {
        const row = await api.adminBootstrapPin(pin);
        api.setAdminSession(row.token, row.expires_at);
        onSuccess();
      } catch (err) {
        if (err.code === "already_configured") { setMode("login"); setPin(""); setConfirmPin(""); }
        else setError(resolveError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const row = await api.adminLogin(pin);
      api.setAdminSession(row.token, row.expires_at);
      onSuccess();
    } catch (err) {
      setError(resolveError(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  }, [mode, pin, confirmPin, busy, onSuccess]);

  const inputType = show ? "text" : "password";

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: theme.bgGrad, padding: "24px 20px" }}>
      <div style={{ width: "100%", maxWidth: 360, background: theme.panel, borderRadius: 32, padding: "32px 26px", boxShadow: "0 24px 56px -18px rgba(90,58,40,.28)", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <img src={MARS_IDLE} alt="Mars" style={{ width: 84, height: 84, borderRadius: "50%", objectFit: "cover", border: "3px solid #FFFFFF", boxShadow: "0 6px 16px rgba(120,80,50,.18)" }} />

        {checking ? (
          <div style={{ fontSize: 14, color: theme.muted, padding: "20px 0" }}>{strings.adminPin.checking}</div>
        ) : (
          <form onSubmit={submit} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 28, color: theme.ink, textAlign: "center", lineHeight: 1.1 }}>
              {mode === "bootstrap" ? strings.adminPin.titleBootstrap : strings.adminPin.titleLogin}
            </div>
            <div style={{ fontSize: 13.5, color: theme.muted, textAlign: "center", lineHeight: 1.4 }}>
              {mode === "bootstrap" ? strings.adminPin.subtitleBootstrap : strings.adminPin.subtitleLogin}
            </div>

            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
              <div style={{ position: "relative" }}>
                <input
                  autoFocus type={inputType} inputMode="numeric" pattern="[0-9]*" maxLength={12}
                  value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
                  aria-label={mode === "bootstrap" ? strings.adminPin.titleBootstrap : strings.adminPin.titleLogin}
                  style={inputStyle}
                />
                <div role="button" tabIndex={0} onClick={() => setShow((s) => !s)}
                  style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 12.5, fontWeight: 800, color: theme.mutedSoft, cursor: "pointer" }}>
                  {show ? strings.adminPin.hide : strings.adminPin.show}
                </div>
              </div>

              {mode === "bootstrap" && (
                <input
                  type={inputType} inputMode="numeric" pattern="[0-9]*" maxLength={12}
                  placeholder={strings.adminPin.confirmLabel}
                  value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/[^0-9]/g, ""))}
                  aria-label={strings.adminPin.confirmLabel}
                  style={inputStyle}
                />
              )}
            </div>

            {error && (
              <div style={{ width: "100%", background: theme.badBg, border: `1px solid ${theme.bad}33`, borderRadius: 14, padding: "10px 13px", fontSize: 12.5, color: theme.bad, fontWeight: 700, textAlign: "center" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={busy || pin.length < 4}
              style={{
                width: "100%", height: 52, borderRadius: 17, border: "none", marginTop: 4,
                background: busy || pin.length < 4 ? "#E7C3CC" : theme.ink, color: "#FBF3EA",
                fontWeight: 800, fontSize: 15, cursor: busy || pin.length < 4 ? "default" : "pointer",
                fontFamily: theme.fontBody,
              }}>
              {busy ? strings.adminPin.checking : (mode === "bootstrap" ? strings.adminPin.submitBootstrap : strings.adminPin.submitLogin)}
            </button>

            <div role="button" tabIndex={0} onClick={onCancel}
              style={{ fontSize: 12.5, color: theme.mutedSoft, cursor: "pointer", marginTop: 2 }}>
              {strings.adminPin.backLink}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%", height: 52, borderRadius: 16, border: `1.5px solid ${theme.cardBorder}`,
  background: "#FFFCF7", padding: "0 44px 0 16px", fontSize: 20, letterSpacing: "0.15em",
  color: theme.ink, textAlign: "center", fontFamily: theme.fontDisplay, fontWeight: 700,
};
