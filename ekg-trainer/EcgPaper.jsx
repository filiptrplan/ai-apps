// Draws a recording on ECG paper at the standard 25 mm/s and 10 mm/mV, in
// millimetre SVG units so the grid can be read like the real thing. Drag
// across it (with calipers on) to measure an interval.
const { useState, useRef, useMemo } = React;

const SPEED = 25; // mm per second
const GAIN = 10; // mm per mV
const LEFT = 10; // margin for the calibration pulse
const ROW = 40; // baseline-to-baseline spacing
const TOP = 25; // first baseline

const TWELVE_LAYOUT = [
  ["I", "aVR", "V1", "V4"],
  ["II", "aVL", "V2", "V5"],
  ["III", "aVF", "V3", "V6"],
];

function tracePath(samples, fs, from, to, x0, base) {
  const i0 = Math.max(0, Math.round(from * fs));
  const i1 = Math.min(samples.length - 1, Math.round(to * fs));
  let d = "";
  for (let i = i0; i <= i1; i++) {
    const x = x0 + ((i - i0) / fs) * SPEED;
    const y = base - samples[i] * GAIN;
    d += (i === i0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
  }
  return d;
}

// Rows of { label, segments: [{lead, from, to, x}] }.
function layout(twelve, duration) {
  if (!twelve) {
    return ["II", "V1"].map((lead) => ({ segments: [{ lead, from: 0, to: duration, x: LEFT }] }));
  }
  const col = duration / 4;
  const rows = TWELVE_LAYOUT.map((leads) => ({
    segments: leads.map((lead, j) => ({ lead, from: j * col, to: (j + 1) * col, x: LEFT + j * col * SPEED })),
  }));
  rows.push({ segments: [{ lead: "II", from: 0, to: duration, x: LEFT }] });
  return rows;
}

export function EcgPaper({ signal, twelve, zoom = 1, calipers = false }) {
  const { leads, fs, duration } = signal;
  const rows = layout(twelve, duration);
  const width = LEFT + duration * SPEED + 4;
  const height = TOP + (rows.length - 1) * ROW + 18;
  const svgRef = useRef(null);
  const [measure, setMeasure] = useState(null);
  const dragging = useRef(false);

  const traces = useMemo(
    () =>
      rows.map((row, r) => {
        const base = TOP + r * ROW;
        return row.segments.map((s) => ({ ...s, base, d: tracePath(leads[s.lead], fs, s.from, s.to, s.x, base) }));
      }),
    [signal, twelve]
  );

  function toPaper(e) {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }

  const handlers = calipers
    ? {
        onPointerDown: (e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          const p = toPaper(e);
          setMeasure({ a: p, b: p });
        },
        onPointerMove: (e) => {
          if (!dragging.current) return;
          const p = toPaper(e);
          setMeasure((m) => (m ? { ...m, b: p } : m));
        },
        onPointerUp: () => {
          dragging.current = false;
          setMeasure((m) => (m && Math.abs(m.b.x - m.a.x) < 1 ? null : m));
        },
      }
    : {};

  let label = null;
  if (measure && Math.abs(measure.b.x - measure.a.x) >= 0.5) {
    const ms = (Math.abs(measure.b.x - measure.a.x) / SPEED) * 1000;
    const mv = (measure.a.y - measure.b.y) / GAIN;
    label = `${Math.round(ms)} ms · ${Math.round(60000 / ms)} bpm${Math.abs(mv) >= 0.05 ? ` · ${mv > 0 ? "+" : ""}${mv.toFixed(1)} mV` : ""}`;
  }

  return (
    <div className="ek-paper-scroll">
      <svg
        ref={svgRef}
        className={`ek-paper${twelve ? " ek-paper-12" : ""}${calipers ? " ek-calipers" : ""}`}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: `${zoom * 100}%` }}
        role="img"
        aria-label={twelve ? "12-lead ECG" : "Rhythm strip, leads II and V1"}
        {...handlers}
      >
        <defs>
          <pattern id="ek-minor" width="1" height="1" patternUnits="userSpaceOnUse" x={LEFT} y={TOP}>
            <path d="M1 0H0V1" fill="none" stroke="var(--grid-minor)" strokeWidth="0.06" />
          </pattern>
          <pattern id="ek-major" width="5" height="5" patternUnits="userSpaceOnUse" x={LEFT} y={TOP}>
            <rect width="5" height="5" fill="url(#ek-minor)" />
            <path d="M5 0H0V5" fill="none" stroke="var(--grid-major)" strokeWidth="0.16" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="var(--paper)" />
        <rect width={width} height={height} fill="url(#ek-major)" />

        {traces.map((row, r) => (
          <g key={r}>
            <path
              d={`M1.5 ${row[0].base}h2v${-GAIN}h5v${GAIN}h1.5`}
              fill="none"
              stroke="var(--trace)"
              strokeWidth="0.3"
              strokeLinejoin="round"
            />
            {row.map((s, j) => (
              <g key={s.lead + j}>
                <path d={s.d} fill="none" stroke="var(--trace)" strokeWidth="0.32" strokeLinejoin="round" />
                {j > 0 && <path d={`M${s.x} ${s.base - 4}v8`} stroke="var(--trace)" strokeWidth="0.3" />}
                <text x={s.x + 1.5} y={s.base - 10} className="ek-lead">{s.lead}</text>
              </g>
            ))}
          </g>
        ))}

        <text x={width - 2} y={height - 3} textAnchor="end" className="ek-scale">25 mm/s · 10 mm/mV</text>

        {measure && (
          <g className="ek-measure">
            <path d={`M${measure.a.x} ${measure.a.y - 6}v12M${measure.b.x} ${measure.b.y - 6}v12`} />
            <path d={`M${measure.a.x} ${measure.a.y}L${measure.b.x} ${measure.b.y}`} strokeDasharray="1 0.8" />
            {label && (
              <text x={(measure.a.x + measure.b.x) / 2} y={Math.min(measure.a.y, measure.b.y) - 7} textAnchor="middle">
                {label}
              </text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}
