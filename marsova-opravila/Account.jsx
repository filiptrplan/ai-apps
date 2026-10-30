// Small, optional apps.trplan.si account button for the header. Signing in
// here doesn't unlock or restrict anything — the app is fully usable logged
// out, same as always. It just saves a detour through the main site when she
// wants an account (e.g. to reach the app from elsewhere on apps.trplan.si).
import { strings } from "./strings.js";
import { theme, Sheet } from "./ui.jsx";
import { useSession, signIn, signOut } from "../shared/auth.js";

const saveBtn = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };

// Split in two so only the icon lives inside the header (which is its own
// `position: relative` box for the "fly" points animation) while the sheet
// itself renders at the app's root level, alongside the other sheets - a
// sheet nested inside the header would anchor to the header's small bounding
// box instead of covering the full screen.
export function AccountIcon({ onClick }) {
  const session = useSession();
  return (
    <div role="button" tabIndex={0} aria-label={strings.account.openAria} onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      style={{ width: 38, height: 38, borderRadius: 13, background: theme.chip, border: `1px solid ${theme.chipBorder}`, display: "grid", placeItems: "center", fontSize: 14, color: "#9A8574", cursor: "pointer" }}>
      {session ? "👤" : "🔐"}
    </div>
  );
}

export function AccountSheet({ open, onClose }) {
  const session = useSession();
  return (
    <Sheet open={open} onClose={onClose}>
      <AccountSheetContent session={session} />
    </Sheet>
  );
}

function AccountSheetContent({ session }) {
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink }}>{strings.account.title}</div>
      <div style={{ fontSize: 12.5, color: theme.muted, lineHeight: 1.4 }}>{strings.account.subtitle}</div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <div role="button" tabIndex={0} onClick={() => signIn()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); signIn(); } }}
          style={saveBtn}>
          {strings.account.signIn}
        </div>
      </div>
    </div>
  );
}
