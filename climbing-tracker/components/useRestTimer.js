import { sounds } from "../sounds.js";
import { requestRestAlertPermission, notifyRestOver } from "../restAlert.js";

const { useState, useEffect, useRef } = React;

// Countdown behind a RestBar. Timed against the wall clock rather than by
// counting interval ticks, because a backgrounded page's timers get
// throttled - the rest has to end on time (and raise its notification) even
// while the phone is in another app. The end itself is a one-shot timeout,
// which browsers throttle far less than a repeating interval.
//
// rest is null when idle, else { total, timeLeft, paused, ...meta } where
// meta is whatever the caller passed to start (e.g. a label).
export function useRestTimer() {
  const [rest, setRest] = useState(null);
  const endsAtRef = useRef(0);
  const remainingMsRef = useRef(0); // while paused
  const tickRef = useRef(null);
  const endRef = useRef(null);
  const noticeRef = useRef("");
  const lastSecRef = useRef(0);

  const clearTimers = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (endRef.current) { clearTimeout(endRef.current); endRef.current = null; }
  };

  const finish = () => {
    clearTimers();
    sounds.workStart();
    notifyRestOver(noticeRef.current);
    setRest(null);
  };

  const tick = () => {
    const sec = Math.ceil((endsAtRef.current - Date.now()) / 1000);
    if (sec <= 0) { finish(); return; }
    if (sec === lastSecRef.current) return;
    lastSecRef.current = sec;
    setRest(r => r && { ...r, timeLeft: sec });
    if (sec <= 3) sounds.countdown();
  };

  const run = (ms) => {
    endsAtRef.current = Date.now() + ms;
    lastSecRef.current = Math.ceil(ms / 1000);
    tickRef.current = setInterval(tick, 250);
    endRef.current = setTimeout(finish, ms);
  };

  // notice: body text for the "Rest over" notification.
  const start = (sec, { notice = "", ...meta } = {}) => {
    clearTimers();
    requestRestAlertPermission();
    noticeRef.current = notice;
    setRest({ ...meta, total: sec, timeLeft: sec, paused: false });
    sounds.restStart();
    run(sec * 1000);
  };

  const stop = () => { clearTimers(); setRest(null); };

  const togglePause = () => {
    if (!rest) return;
    if (rest.paused) {
      run(remainingMsRef.current);
      setRest({ ...rest, paused: false });
    } else {
      remainingMsRef.current = Math.max(0, endsAtRef.current - Date.now());
      clearTimers();
      setRest({ ...rest, paused: true });
    }
  };

  useEffect(() => clearTimers, []);

  return { rest, start, stop, togglePause };
}
