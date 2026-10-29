// The app's component library. Every screen is built from these, so the
// look stays the same everywhere; the styles live in german.html (g-*
// classes, C2 palette). Components take plain props and hold no app state.
import { ARTICLES } from "./model.js";

const { useEffect } = React;

const cx = (...c) => c.filter(Boolean).join(" ");

// ---------- icons ----------

const PATHS = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4z" />,
  wand: <><path d="M4 20L15 9" /><path d="M15 9l2-2 2 2-2 2z" /><path d="M10 4v2M9 5h2M19 14v2M18 15h2" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cards: <><rect x="4" y="6" width="13" height="14" rx="2" /><path d="M8 3h10a2 2 0 0 1 2 2v12" /></>,
  pen: <><path d="M4 20h16" /><path d="M14.5 4.5l3 3L8 17H5v-3z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>,
  today: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  progress: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
};

export function Icon({ name, size = 20, stroke = 2.2 }) {
  if (name === "play") {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Spinner() {
  return <span className="g-spin" aria-hidden="true" />;
}

// ---------- buttons ----------

// A square icon button. `href` makes it a link. variant: surface (default),
// ghost, mint, accent, wand; `round` for the play button.
export function IconButton({ icon, label, onClick, href, variant, round, small, busy, disabled, iconSize }) {
  const className = cx("g-iconbtn", variant, round && "round", small && "sm");
  const inner = busy ? <Spinner /> : <Icon name={icon} size={iconSize || (small ? 16 : 20)} />;
  if (href) return <a className={className} href={href} aria-label={label} title={label}>{inner}</a>;
  return (
    <button type="button" className={className} onClick={onClick} aria-label={label} title={label} disabled={disabled || busy}>
      {inner}
    </button>
  );
}

// A wide button. variant: mint (cards), amber (writing), outline, or plain
// surface. size: sm, md or the default tall one.
export function Button({ children, onClick, href, variant, size, busy, disabled, type = "button", className }) {
  const cls = cx("g-btn", variant, size, className);
  const inner = <>{busy && <Spinner />}{children}</>;
  if (href) return <a className={cls} href={href}>{inner}</a>;
  return <button type={type} className={cls} onClick={onClick} disabled={disabled || busy}>{inner}</button>;
}

export function LinkButton({ children, onClick, href, mint }) {
  const cls = cx("g-link", mint && "mint");
  if (href) return <a className={cls} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{children}</a>;
  return <button type="button" className={cls} onClick={onClick}>{children}</button>;
}

// ---------- layout ----------

// Header row for screens off the tabs: close (task screens) or back
// (pages behind Progress), a title, and anything on the right.
export function ScreenHeader({ back, close, title, big, meta, children }) {
  return (
    <header className="g-head">
      {close && <IconButton icon="close" label="Pause and go back" href={close} />}
      {back && <IconButton icon="back" label="Back" href={back} />}
      {title && (big ? <h1>{title}</h1> : <span className="g-head-title">{title}</span>)}
      {meta && <span className="g-head-meta">{meta}</span>}
      {children && <div className="g-head-right">{children}</div>}
    </header>
  );
}

export function Screen({ children, wide, center, tab, label }) {
  return (
    <main className={cx("g-screen", wide && "wide", center && "center", tab && "g-tab-screen")} aria-label={label}>
      {children}
    </main>
  );
}

export function Card({ children, big, amber, tight, label, className, as: Tag = "section" }) {
  return <Tag className={cx("g-card", big && "big", amber && "amber", tight && "tight", className)} aria-label={label}>{children}</Tag>;
}

export function Label({ children, htmlFor }) {
  if (htmlFor) return <label className="g-label" htmlFor={htmlFor}>{children}</label>;
  return <span className="g-label">{children}</span>;
}

// ---------- form ----------

export function Field({ id, label, children, right }) {
  return (
    <div className="g-field">
      {right ? (
        <div className="g-between" style={{ margin: "-12px -10px -8px 0" }}>
          <label htmlFor={id}>{label}</label>
          {right}
        </div>
      ) : (
        <label htmlFor={id}>{label}</label>
      )}
      {children}
    </div>
  );
}

export function Input({ id, value, onChange, ...rest }) {
  return <input id={id} className="g-input" value={value} onChange={e => onChange(e.target.value)} {...rest} />;
}

export function TextArea({ id, value, onChange, rows = 2, ...rest }) {
  return <textarea id={id} className="g-input" rows={rows} value={value} onChange={e => onChange(e.target.value)} {...rest} />;
}

// der / die / das picker, each in its own colour.
export function ArticlePicker({ value, onChange }) {
  return (
    <div className="g-radio3" role="radiogroup" aria-label="Article">
      {ARTICLES.map(a => (
        <button key={a} type="button" role="radio" aria-checked={value === a} className={a} onClick={() => onChange(a)}>{a}</button>
      ))}
    </div>
  );
}

// A row of mutually exclusive options; options are [value, label].
export function Choice({ value, onChange, options, label }) {
  return (
    <div className="g-radio3" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className="plain" onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export function Chip({ children, pressed, onClick, onRemove, removeLabel, dashed }) {
  if (onRemove) {
    return (
      <span className="g-chip soft">
        {children}
        <button type="button" className="x" aria-label={removeLabel} onClick={onRemove}>×</button>
      </span>
    );
  }
  return (
    <button type="button" className={cx("g-chip", dashed && "dashed")} aria-pressed={pressed === undefined ? undefined : pressed} onClick={onClick}>
      {children}
    </button>
  );
}

export function Stepper({ value, onChange, min = 0, max = 30 }) {
  return (
    <div className="g-stepper">
      <button type="button" aria-label="Fewer" disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label="More" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

// ---------- display ----------

// "der Antrag" with the article in its colour.
export function Noun({ article, children }) {
  return <><span className={article}>{article}</span> {children}</>;
}

export function ProgressBar({ value, max }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="g-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Tag({ children, tone }) {
  return <span className={cx("g-tag", tone)}>{children}</span>;
}

export function Stat({ label, value, note }) {
  return (
    <section className="g-stat">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {note && <span className="g-small">{note}</span>}
    </section>
  );
}

// Links to pages behind a tab; items are { href, label, note? }.
export function NavList({ items, label }) {
  return (
    <nav className="g-navlist" aria-label={label}>
      {items.map(it => (
        <a key={it.href} href={it.href}>
          <span>{it.label}{it.note && <small>{it.note}</small>}</span>
          <Icon name="chevron" size={18} stroke={2} />
        </a>
      ))}
    </nav>
  );
}

export function Empty({ children }) {
  return <p className="g-empty">{children}</p>;
}

export function Toast({ message }) {
  if (!message) return null;
  return <div className="g-toast" role="status">{message}</div>;
}

// Scrolls back to the top whenever `key` (the route) changes.
export function useScrollTop(key) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [key]);
}
