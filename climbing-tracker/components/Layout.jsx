import { s, d, C, DESKTOP_QUERY } from "../styles.js";
import { Icon } from "./Icons.jsx";

const { useEffect, useState } = React;

// Inline styles can't carry media queries, so layout switches on this hook.
// Below the breakpoint the app is the phone UI, untouched.
export function useIsDesktop() {
  const [matches, setMatches] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return matches;
}

// Sticky top bar. With `left`/`right` it renders a centred compact title
// (sub-pages); without, a large left-aligned title (main tabs).
export function Header({ title, subtitle, left, right }) {
  const desktop = useIsDesktop();
  const compact = left !== undefined;
  return (
    <div style={{ ...s.header, ...(desktop && d.header) }}>
      {compact && <div style={s.headerSide}>{left}</div>}
      <div style={compact ? s.headerTitleSmall : { ...s.headerTitle, ...(desktop && d.headerTitle) }}>
        {title}
        {subtitle && <div style={s.headerSub}>{subtitle}</div>}
      </div>
      {compact
        ? <div style={{ ...s.headerSide, justifyContent: "flex-end" }}>{right}</div>
        : right}
    </div>
  );
}

export function TabBar({ tabs, active, onChange }) {
  return (
    <nav style={s.tabBar}>
      {tabs.map(t => {
        const TabIcon = Icon[t.icon];
        return (
          <button
            key={t.id}
            style={{ ...s.tab, ...(active === t.id ? s.tabActive : {}) }}
            onClick={() => onChange(t.id)}
            aria-current={active === t.id ? "page" : undefined}
          >
            <TabIcon size={24} />
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

// Desktop replacement for the bottom TabBar: a fixed left rail with the same
// tabs plus an optional footer slot (e.g. a quick stat).
export function Sidebar({ tabs, active, onChange, footer }) {
  return (
    <nav style={d.sidebar}>
      <div style={d.brand}>
        <img src="./climbing-tracker/icon.svg" alt="" width={32} height={32} style={{ borderRadius: 8 }} />
        Climbing
      </div>
      {tabs.map(t => {
        const TabIcon = Icon[t.icon];
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            style={{ ...d.navItem, ...(isActive ? d.navItemActive : {}) }}
            onClick={() => onChange(t.id)}
            aria-current={isActive ? "page" : undefined}
          >
            <TabIcon size={20} />
            {t.label}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      {footer}
    </nav>
  );
}

// Bottom sheet on phones; centred dialog on desktop. Locks page scroll
// behind it while open.
export function Sheet({ title, onClose, children }) {
  const desktop = useIsDesktop();
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={{ ...s.overlay, ...(desktop && d.overlay) }} onClick={onClose}>
      <div style={{ ...s.sheet, ...(desktop && d.sheet) }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        {!desktop && <div style={s.sheetHandle} />}
        <div style={s.sheetHeader}>
          <span style={s.sheetTitle}>{title}</span>
          <button style={s.iconBtn} onClick={onClose} aria-label="Close"><Icon.x /></button>
        </div>
        <div style={{ ...s.sheetBody, ...(desktop && d.sheetBody) }}>{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }) {
  const EmptyIcon = Icon[icon];
  return (
    <div style={s.empty}>
      <div style={s.emptyIcon}><EmptyIcon size={28} /></div>
      <div style={s.emptyTitle}>{title}</div>
      <div style={s.emptyText}>{text}</div>
      {action}
    </div>
  );
}
