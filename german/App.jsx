// App shell: synced data, hash routing, the Today / Progress tabs and the
// pieces every screen shares (toast, sync-conflict banner, the background
// refill of AI-suggested words). Screens get one `app` object with the
// data and the actions on it.
import { useSyncedStorage } from "../shared/syncStorage.js";
import { useSession } from "../shared/auth.js";
import { supabase } from "../shared/supabaseClient.js";
import { runDailyBackupIfNeeded } from "../shared/backup.js";
import {
  APP_ID, KEYS, DEFAULT_SETTINGS, DEFAULT_LISTENING, SUGGEST_BUFFER,
  dayKey, normSettings, normListening, makeCard, findDuplicate,
} from "./model.js";
import { suggestWords } from "./ai.js";
import { Icon, Toast, useScrollTop } from "./ui.jsx";
import { useRoute } from "./route.js";
import { Today } from "./Today.jsx";
import { Review } from "./Review.jsx";
import { CardEditor } from "./CardEditor.jsx";
import { Deck } from "./Deck.jsx";
import { Write } from "./Write.jsx";
import { History } from "./History.jsx";
import { Listening } from "./Listening.jsx";
import { Progress } from "./Progress.jsx";
import { Settings } from "./Settings.jsx";

const { useState, useEffect, useRef, useMemo } = React;

const NONE = [];
const NO_LOG = {};

// The current study day, re-read every minute so an app left open
// overnight moves on to the new day.
function useToday() {
  const [key, setKey] = useState(() => dayKey());
  useEffect(() => {
    const t = setInterval(() => setKey(dayKey()), 60 * 1000);
    return () => clearInterval(t);
  }, []);
  return key;
}

const TABS = [["", "Today", "today"], ["progress", "Progress", "progress"]];

function TopBar({ route }) {
  return (
    <header className="g-topbar">
      <a className="g-brand" href="#/"><span className="g-brand-mark">D</span>Deutsch</a>
      <div className="g-topbar-right">
        <nav className="g-seg" aria-label="Main">
          {TABS.map(([name, label]) => (
            <a key={label} href={`#/${name}`} aria-current={route.name === name ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <a className="g-pill-link" href="#/add"><Icon name="plus" size={16} stroke={2.4} />Word</a>
      </div>
    </header>
  );
}

function TabBar({ route }) {
  return (
    <nav className="g-tabbar" aria-label="Main">
      {TABS.map(([name, label, icon]) => (
        <a key={label} href={`#/${name}`} aria-current={route.name === name ? "page" : undefined}>
          <Icon name={icon} size={24} stroke={2} />{label}
        </a>
      ))}
    </nav>
  );
}

export function GermanApp() {
  const session = useSession();
  const route = useRoute();
  const today = useToday();
  useScrollTop(`${route.name}/${route.param}`);

  const [cards, setCards, cardsConflict] = useSyncedStorage(APP_ID, KEYS.cards, NONE);
  const [suggest, setSuggest] = useSyncedStorage(APP_ID, KEYS.suggest, NONE);
  const [writing, setWriting, writingConflict] = useSyncedStorage(APP_ID, KEYS.writing, NONE);
  const [draft, setDraft] = useSyncedStorage(APP_ID, KEYS.draft, null);
  const [log, setLog] = useSyncedStorage(APP_ID, KEYS.log, NO_LOG);
  const [storedListening, setListening] = useSyncedStorage(APP_ID, KEYS.listening, DEFAULT_LISTENING);
  const [storedSettings, setSettings] = useSyncedStorage(APP_ID, KEYS.settings, DEFAULT_SETTINGS);
  const settings = useMemo(() => normSettings(storedSettings), [storedSettings]);
  const listening = useMemo(() => normListening(storedListening), [storedListening]);

  const [toast, setToast] = useState(null);
  const toastT = useRef(null);
  function showToast(msg) {
    clearTimeout(toastT.current);
    setToast(msg);
    toastT.current = setTimeout(() => setToast(null), 2400);
  }

  useEffect(() => {
    if (session) runDailyBackupIfNeeded(supabase, session);
  }, [session]);

  // Keeps SUGGEST_BUFFER AI-suggested words ready while online, so new
  // cards keep coming on offline days. Each word remembers the level and
  // topics it was picked for; after a settings change the old ones are
  // dropped and replaced. One refill at a time; a failed one is retried
  // after a minute.
  const fitKey = `${settings.level}|${settings.topics.join(",")}`;
  const usable = useMemo(() => suggest.filter(s => s.for === fitKey), [suggest, fitKey]);
  const [refilling, setRefilling] = useState(false);
  const [retry, setRetry] = useState(0);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  useEffect(() => {
    const missing = SUGGEST_BUFFER - usable.length;
    if (!session || missing <= 0 || refilling || !navigator.onLine) return;
    setRefilling(true);
    const known = [...cardsRef.current.map(c => c.de), ...usable.map(s => s.de)].filter(Boolean);
    let retryT;
    suggestWords(missing, known, settings)
      .then(words => {
        const fresh = words.filter(w => !findDuplicate(cardsRef.current, w)).map(({ sense, ...w }) => ({ ...w, for: fitKey }));
        setSuggest(s => {
          const keep = s.filter(x => x.for === fitKey);
          return [...keep, ...fresh.filter(w => !keep.some(x => x.de === w.de))].slice(0, SUGGEST_BUFFER * 2);
        });
      })
      .catch(() => {
        retryT = setTimeout(() => setRetry(n => n + 1), 60 * 1000);
      })
      .finally(() => setRefilling(false));
    return () => clearTimeout(retryT);
  }, [session, usable.length, fitKey, retry]);

  const app = {
    session, today, route, settings, cards, writing, draft, log, listening, showToast,
    // Suggested words that fit the current level and topics, and whether
    // more are on their way.
    suggest: usable, refilling,
    setCards, setSuggest, setWriting, setDraft, setListening,
    setSettings: fn => setSettings(s => (typeof fn === "function" ? fn(normSettings(s)) : fn)),
    // Marks one of today's tasks as done.
    markDone: task => setLog(l => ({ ...l, [today]: { ...(l[today] || {}), [task]: true } })),
    // Adds a card unless the same German word is already in the deck.
    addCard(fields, source) {
      const dup = findDuplicate(cards, fields);
      if (dup) return { card: dup, duplicate: true };
      const card = makeCard(fields, source);
      setCards(cs => [card, ...cs]);
      return { card, duplicate: false };
    },
    updateCard: (id, fn) => setCards(cs => cs.map(c => (c.id === id ? fn(c) : c))),
    deleteCard: id => setCards(cs => cs.filter(c => c.id !== id)),
  };

  const conflict = cardsConflict || writingConflict;

  let screen;
  let tabs = false;
  switch (route.name) {
    case "cards": screen = <Review app={app} />; break;
    case "write": screen = <Write app={app} />; break;
    case "add": screen = <CardEditor key="new" app={app} />; break;
    case "card": screen = <CardEditor key={route.param} app={app} cardId={route.param} />; break;
    case "deck": screen = <Deck app={app} />; break;
    case "history": screen = <History app={app} sessionId={route.param} />; break;
    case "listening": screen = <Listening app={app} />; break;
    case "settings": screen = <Settings app={app} />; break;
    case "progress": screen = <Progress app={app} />; tabs = true; break;
    default: screen = <Today app={app} />; tabs = true;
  }

  return (
    <div className="g-shell">
      {conflict && (
        <div className="g-banner" role="alert">
          <span>Your {cardsConflict ? "cards" : "writing"} changed on another device.</span>
          <button onClick={conflict.keepRemote}>Use theirs</button>
          <button onClick={conflict.keepLocal}>Keep mine</button>
        </div>
      )}
      {tabs && <TopBar route={route} />}
      {screen}
      {tabs && <TabBar route={route} />}
      <Toast message={toast} />
    </div>
  );
}
