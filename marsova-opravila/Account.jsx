// Small, optional apps.trplan.si account button for the header. Signing in
// here doesn't unlock or restrict anything — the app is fully usable logged
// out, same as always. It just saves a detour through the main site when she
// wants an account (e.g. to reach the app from elsewhere on apps.trplan.si).
import { strings } from "./strings.js";
import { theme, Sheet } from "./ui.jsx";
import { useSession, signIn, signUp, signOut } from "../shared/auth.js";

const { useState } = React;

const fieldStyle = {
  width: "100%", height: 46, borderRadius: 14, border: `1.5px solid ${theme.cardBorder}`, background: "#FFFCF7",
  padding: "0 14px", fontSize: 14.5, color: theme.ink, fontFamily: theme.fontBody, marginTop: 4,
};
const labelStyle = { fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft };
const cancelBtn = { flex: 1, height: 48, borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#7C6A5C", cursor: "pointer" };
const saveBtn = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };

export function AccountButton() {
  const session = useSession();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div role="button" tabIndex={0} aria-label={strings.account.openAria} onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
        style={{ width: 38, height: 38, borderRadius: 13, background: theme.chip, border: `1px solid ${theme.chipBorder}`, display: "grid", placeItems: "center", fontSize: 14, color: "#9A8574", cursor: "pointer" }}>
        {session ? "👤" : "🔐"}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <AccountSheetContent session={session} />
      </Sheet>
    </>
  );
}

function AccountSheetContent({ session }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  if (session === undefined) {
    return <div style={{ padding: "20px 4px", fontSize: 13.5, color: theme.muted }}>{strings.account.loading}</div>;
  }

  if (session) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink }}>{strings.account.title}</div>
        <div style={{ fontSize: 13.5, color: theme.inkSoft }}>{strings.account.loggedInAs(session.user.email)}</div>
        <div role="button" tabIndex={0} onClick={() => signOut()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); signOut(); } }}
          style={{ alignSelf: "flex-start", padding: "12px 20px", borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", fontWeight: 800, fontSize: 14, color: theme.bad, cursor: "pointer" }}>
          {strings.account.signOut}
        </div>
      </div>
    );
  }

  const disabled = busy || !email || !password;
  const submit = async (signingUp) => {
    if (disabled) return;
    setBusy(true); setError(""); setNotice("");
    const { error: err } = signingUp ? await signUp(email, password) : await signIn(email, password);
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (signingUp) setNotice(strings.account.signUpNotice);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink }}>{strings.account.title}</div>
      <div style={{ fontSize: 12.5, color: theme.muted, lineHeight: 1.4 }}>{strings.account.subtitle}</div>
      <label style={labelStyle}>{strings.account.emailLabel}
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={fieldStyle} placeholder={strings.account.emailPlaceholder} />
      </label>
      <label style={labelStyle}>{strings.account.passwordLabel}
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={fieldStyle} />
      </label>
      {error && <div style={{ fontSize: 12.5, color: theme.bad, fontWeight: 700 }}>{error}</div>}
      {notice && <div style={{ fontSize: 12.5, color: theme.sage, fontWeight: 700 }}>{notice}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <div role="button" tabIndex={disabled ? -1 : 0} onClick={() => submit(false)}
          onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); submit(false); } }}
          style={{ ...saveBtn, opacity: disabled ? 0.6 : 1, cursor: disabled ? "default" : "pointer" }}>
          {strings.account.signIn}
        </div>
        <div role="button" tabIndex={disabled ? -1 : 0} onClick={() => submit(true)}
          onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); submit(true); } }}
          style={{ ...cancelBtn, opacity: disabled ? 0.6 : 1, cursor: disabled ? "default" : "pointer" }}>
          {strings.account.signUp}
        </div>
      </div>
    </div>
  );
}
