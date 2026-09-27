import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { C } from "../styles.js";

const { useEffect, useRef } = React;

const HEIGHT = 220;
const FONT = "12px -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif";

// One series over time, themed to the app. times are ms timestamps. The
// hovered/tapped point is reported through onCursor (index, or null when the
// cursor leaves) so the page can show its own readout instead of uPlot's
// legend.
export function LineChart({ times, values, formatAxis, onCursor }) {
  const ref = useRef(null);
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;

  useEffect(() => {
    const el = ref.current;
    const axis = {
      stroke: C.muted,
      font: FONT,
      grid: { stroke: C.border, width: 1 },
      ticks: { show: false },
    };
    const chart = new uPlot({
      width: el.clientWidth,
      height: HEIGHT,
      padding: [12, 12, 0, 0],
      legend: { show: false },
      cursor: {
        drag: { x: false, y: false },
        points: { size: 10, fill: C.accent, stroke: C.bg, width: 2 },
      },
      scales: { x: { time: true } },
      axes: [
        { ...axis, space: 60 },
        { ...axis, size: 52, values: (u, ticks) => ticks.map(formatAxis) },
      ],
      series: [
        {},
        {
          stroke: C.accent,
          width: 2,
          fill: C.accentSoft,
          points: { show: true, size: 6, fill: C.accent, stroke: C.accent },
        },
      ],
      hooks: {
        setCursor: [u => onCursorRef.current?.(u.cursor.idx ?? null)],
      },
    }, [times.map(t => t / 1000), values], el);

    const resize = new ResizeObserver(() => chart.setSize({ width: el.clientWidth, height: HEIGHT }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      chart.destroy();
    };
  }, [times, values, formatAxis]);

  return <div ref={ref} style={{ width: "100%", minHeight: HEIGHT }} />;
}
