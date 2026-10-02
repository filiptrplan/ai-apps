const { useState, useEffect, useRef } = React;

// Fill level for a ticking countdown display (ring or bar). Rather than
// animating to the value it shows now - which leaves the last second
// undrawn when the phase ends on the next tick - it animates to where the
// countdown will be at that next tick, so it drains continuously and hits
// empty exactly as the time runs out.
//
// from: the fill right now; to: the fill at the next tick, ms away.
// While not running it just shows from, with no animation. Returns
// { value, ms }, ms being the transition length to apply.
export function useDrain(from, to, ms, running) {
  const [shown, setShown] = useState({ value: from, ms: 0 });
  const primedRef = useRef(false);

  useEffect(() => {
    if (!running) {
      primedRef.current = false;
      setShown({ value: from, ms: 0 });
      return;
    }
    if (primedRef.current) {
      setShown({ value: to, ms });
      return;
    }
    // Starting (or resuming): paint the current level first, then animate
    // from it - otherwise there's nothing for the transition to start from.
    setShown({ value: from, ms: 0 });
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        primedRef.current = true;
        setShown({ value: to, ms });
      });
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [from, to, ms, running]);

  return shown;
}
