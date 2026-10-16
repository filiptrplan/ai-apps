// Draws a recording on ECG paper at the standard 25 mm/s and 10 mm/mV, in
// millimetre SVG units so the grid can be read like the real thing. Drag
// across it (with calipers on) to measure an interval; pinch with two fingers
// (or ctrl/trackpad-pinch scroll) to zoom around that spot.
const { useState, useRef, useMemo, useEffect, useLayoutEffect } = React;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

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

// Rows of { label, segments: [{lead, from, to, x}] }. A rhythm strip shows
// the recording's `strip` leads (II and V1 when it has all twelve).
function layout(twelve, duration, strip) {
  if (!twelve) {
    return strip.map((lead) => ({ segments: [{ lead, from: 0, to: duration, x: LEFT }] }));
  }
  const col = duration / 4;
  const rows = TWELVE_LAYOUT.map((leads) => ({
    segments: leads.map((lead, j) => ({ lead, from: j * col, to: (j + 1) * col, x: LEFT + j * col * SPEED })),
  }));
  rows.push({ segments: [{ lead: "II", from: 0, to: duration, x: LEFT }] });
  return rows;
}

export function EcgPaper({ signal, twelve, zoom = 1, onZoom, calipers = false }) {
  const { leads, fs, duration, strip } = signal;
  const rows = layout(twelve, duration, strip);
  const width = LEFT + duration * SPEED + 4;
  const height = TOP + (rows.length - 1) * ROW + 18;
  const svgRef = useRef(null);
  const boxRef = useRef(null);
  const [measure, setMeasure] = useState(null);
  const dragPointer = useRef(null); // pointerId of the caliper drag in progress
  const beforeDrag = useRef(null);

  // The paper is sized in pixels so the box keeps its zoom-1 height and the
  // zoomed paper scrolls inside it instead of pushing the page around.
  const [boxW, setBoxW] = useState(0);
  useLayoutEffect(() => {
    const box = boxRef.current;
    setBoxW(box.offsetWidth);
    const ro = new ResizeObserver(() => setBoxW(box.offsetWidth));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  const baseW = Math.max(boxW, twelve ? 760 : 640);
  const baseH = (baseW * height) / width;

  // Zoom changes keep a chosen point under the fingers: the scroll position
  // to restore is parked here and applied once the new size has rendered.
  const zoomRef = useRef(zoom);
  const shownZoom = useRef(zoom);
  const pending = useRef(null);
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  useLayoutEffect(() => {
    const box = boxRef.current;
    const prev = shownZoom.current;
    shownZoom.current = zoom;
    zoomRef.current = zoom;
    let p = pending.current;
    pending.current = null;
    if (!p && prev !== zoom) {
      // Zoomed from the buttons: keep the middle of the view in place.
      const cx = box.clientWidth / 2;
      const cy = box.clientHeight / 2;
      p = { left: ((box.scrollLeft + cx) * zoom) / prev - cx, top: ((box.scrollTop + cy) * zoom) / prev - cy };
    }
    if (p) {
      box.scrollLeft = p.left;
      box.scrollTop = p.top;
    }
  }, [zoom]);

  // Every handler that needs a ref-free closure (the native listeners below)
  // goes through these.
  const view = useRef(null);
  view.current = {
    scroll() {
      const box = boxRef.current;
      return pending.current || { left: box.scrollLeft, top: box.scrollTop };
    },
    set(z, left, top) {
      z = clampZoom(z);
      if (z === zoomRef.current) {
        boxRef.current.scrollLeft = left;
        boxRef.current.scrollTop = top;
        return;
      }
      pending.current = { left, top };
      zoomRef.current = z;
      onZoomRef.current?.(z);
    },
    cancelDrag() {
      if (dragPointer.current == null) return;
      dragPointer.current = null;
      setMeasure(beforeDrag.current);
    },
  };

  useEffect(() => {
    const box = boxRef.current;
    let pinch = null;

    function fingers(touches) {
      const r = box.getBoundingClientRect();
      const [a, b] = touches;
      return {
        x: (a.clientX + b.clientX) / 2 - r.left,
        y: (a.clientY + b.clientY) / 2 - r.top,
        d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
      };
    }
    function start(e) {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      view.current.cancelDrag();
      const f = fingers(e.touches);
      const s = view.current.scroll();
      const z = zoomRef.current;
      // The spot between the fingers, in zoom-1 pixels.
      pinch = { z, d: f.d, ux: (s.left + f.x) / z, uy: (s.top + f.y) / z };
    }
    function move(e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const f = fingers(e.touches);
      const z = clampZoom((pinch.z * f.d) / pinch.d);
      view.current.set(z, pinch.ux * z - f.x, pinch.uy * z - f.y);
    }
    function end(e) {
      if (e.touches.length < 2) pinch = null;
    }
    function wheel(e) {
      // Trackpad pinches arrive as ctrl+wheel.
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = box.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const s = view.current.scroll();
      const z0 = zoomRef.current;
      const z = clampZoom(z0 * Math.exp(-e.deltaY * 0.01));
      view.current.set(z, ((s.left + x) * z) / z0 - x, ((s.top + y) * z) / z0 - y);
    }
    // Safari's own page pinch-zoom.
    const stop = (e) => e.preventDefault();

    box.addEventListener("touchstart", start, { passive: false });
    box.addEventListener("touchmove", move, { passive: false });
    box.addEventListener("touchend", end);
    box.addEventListener("touchcancel", end);
    box.addEventListener("wheel", wheel, { passive: false });
    box.addEventListener("gesturestart", stop);
    box.addEventListener("gesturechange", stop);
    return () => {
      box.removeEventListener("touchstart", start);
      box.removeEventListener("touchmove", move);
      box.removeEventListener("touchend", end);
      box.removeEventListener("touchcancel", end);
      box.removeEventListener("wheel", wheel);
      box.removeEventListener("gesturestart", stop);
      box.removeEventListener("gesturechange", stop);
    };
  }, []);

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
          // A second finger means a pinch, not a measurement.
          if (dragPointer.current != null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragPointer.current = e.pointerId;
          beforeDrag.current = measure;
          const p = toPaper(e);
          setMeasure({ a: p, b: p });
        },
        onPointerMove: (e) => {
          if (e.pointerId !== dragPointer.current) return;
          const p = toPaper(e);
          setMeasure((m) => (m ? { ...m, b: p } : m));
        },
        onPointerUp: (e) => {
          if (e.pointerId !== dragPointer.current) return;
          dragPointer.current = null;
          setMeasure((m) => (m && Math.abs(m.b.x - m.a.x) < 1 ? null : m));
        },
        onPointerCancel: (e) => {
          if (e.pointerId === dragPointer.current) view.current.cancelDrag();
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
    <div className="ek-paper-scroll" ref={boxRef} style={boxW ? { height: `${baseH}px` } : undefined}>
      <svg
        ref={svgRef}
        className={`ek-paper${twelve ? " ek-paper-12" : ""}${calipers ? " ek-calipers" : ""}`}
        viewBox={`0 0 ${width} ${height}`}
        style={boxW ? { width: `${baseW * zoom}px`, height: `${baseH * zoom}px` } : undefined}
        role="img"
        aria-label={twelve ? "12-lead ECG" : `Rhythm strip, leads ${strip.join(" and ")}`}
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
