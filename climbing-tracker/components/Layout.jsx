import { s } from "../styles.js";
import { Icon } from "./Icons.jsx";

const { useEffect } = React;

// Sticky top bar. With `left`/`right` it renders a centred compact title
// (sub-pages); without, a large left-aligned title (main tabs).
export function Header({ title, subtitle, left, right }) {
  const compact = left !== undefined;
  return (
    <div style={s.header}>
      {compact && <div style={s.headerSide}>{left}</div>}
      <div style={compact ? s.headerTitleSmall : s.headerTitle}>
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

// Bottom sheet dialog; locks page scroll behind it while open.
export function Sheet({ title, onClose, children }) {
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
    <div style={s.overlay} onClick={onClose}>
      <div style={s.sheet} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div style={s.sheetHandle} />
        <div style={s.sheetHeader}>
          <span style={s.sheetTitle}>{title}</span>
          <button style={s.iconBtn} onClick={onClose} aria-label="Close"><Icon.x /></button>
        </div>
        <div style={s.sheetBody}>{children}</div>
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
