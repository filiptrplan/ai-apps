// Minimal inline stroke icons (24x24 grid), so the app needs no icon font.
function Svg({ size = 22, strokeWidth = 2, children }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const Icon = {
  exercises: p => <Svg {...p}><path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" /></Svg>,
  routines: p => <Svg {...p}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" /><circle cx="4.5" cy="12" r="1.2" /><circle cx="4.5" cy="18" r="1.2" /></Svg>,
  history: p => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>,
  settings: p => <Svg {...p}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Svg>,
  play: ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" fill="currentColor" /></svg>,
  pause: ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>,
  skip: p => <Svg {...p}><path d="M6 6l9 6-9 6V6zM18 6v12" /></Svg>,
  plus: p => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  minus: p => <Svg {...p}><path d="M5 12h14" /></Svg>,
  x: p => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>,
  check: p => <Svg strokeWidth={2.6} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>,
  back: p => <Svg strokeWidth={2.4} {...p}><path d="M15 5l-7 7 7 7" /></Svg>,
  chevronDown: p => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>,
  up: p => <Svg {...p}><path d="M12 19V5M6 11l6-6 6 6" /></Svg>,
  down: p => <Svg {...p}><path d="M12 5v14M6 13l6 6 6-6" /></Svg>,
  trash: p => <Svg {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7" /></Svg>,
  restart: p => <Svg {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></Svg>,
  link: p => <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>,
  grip: p => <svg width={p.size || 22} height={p.size || 22} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">{[6, 12, 18].flatMap(y => [9, 15].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}</svg>,
  flag: p => <Svg {...p}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></Svg>,
};
