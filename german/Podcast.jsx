// Podcast: AI episodes about your interests. Pick an interest (or let it
// surprise you) and the german-podcast function makes a 3–4 minute episode
// in the background; play it here (with 10-second skips), skim its key
// words or the transcript, tap words to turn them into cards, and select
// any stretch of the transcript to have it translated and explained.
// Playing an episode to the end logs its minutes and ticks off the day's
// podcast task.
import { normEpisodes, nextInterest, episodeMinutes, tokenize, findDuplicate } from "./model.js";
import { startEpisode, wordsFromTranscript, explainSelection } from "./ai.js";
import { episodeAudio, forgetEpisodes } from "./audio.js";
import { useEpisodes } from "./episodes.js";
import { Screen, ScreenHeader, Card, Button, IconButton, LinkButton, Chip, Choice, Label, Spinner, Noun, Empty, Icon } from "./ui.jsx";

const { useState, useEffect, useRef, useCallback, Fragment } = React;

const shortDate = ms => new Date(ms).toLocaleDateString("de-DE", { day: "numeric", month: "short" });
const cardLabel = c => (c.kind === "noun" ? `${c.article} ${c.de}` : c.de);

function NewEpisode({ app, history, pending, failed, onStarted }) {
  const { interests } = app.podcast;
  const [picked, setPicked] = useState(null);
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const topic = interests.includes(picked) ? picked : null;
  const surprise = nextInterest(interests, history);

  async function start(interest) {
    setBusy(true);
    setError(null);
    try {
      await startEpisode(interest, app.cards, app.writing, app.settings);
      await onStarted();
      setPicked(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const add = () => {
    const t = (adding || "").trim();
    if (t && !interests.includes(t)) app.setPodcast(p => ({ ...p, interests: [...p.interests, t] }));
    if (t) setPicked(t);
    setAdding(null);
  };
  const remove = t => {
    app.setPodcast(p => ({ ...p, interests: p.interests.filter(x => x !== t) }));
    setPicked(null);
  };

  if (pending) {
    return (
      <Card big label="New episode">
        <div className="g-row"><Spinner /><b>Making an episode about {pending.interest}…</b></div>
        <p className="g-muted">This takes a minute or two. You can close the app; the episode will be here when you're back.</p>
      </Card>
    );
  }
  return (
    <Card big label="New episode">
      <div className="g-between" style={{ alignItems: "baseline" }}>
        <b style={{ fontSize: 17 }}>New episode</b>
        <span className="g-small">Lena &amp; Jonas · 3–4 min</span>
      </div>
      {failed && <p className="g-error">The episode about {failed.interest} didn't work out: {failed.error}</p>}
      <div className="g-chips">
        {interests.map(t => (
          <Chip key={t} pressed={t === topic} onClick={() => setPicked(t === topic ? null : t)}>{t}</Chip>
        ))}
        {adding === null ? (
          <Chip dashed onClick={() => setAdding("")}>+ Interest</Chip>
        ) : (
          <form onSubmit={e => { e.preventDefault(); add(); }} style={{ display: "flex" }}>
            <label htmlFor="interest" className="sr">New interest</label>
            <input id="interest" className="g-input" style={{ minHeight: 36, padding: "0 12px", borderRadius: 999, width: 180 }} autoFocus value={adding} placeholder="e.g. AI safety" onChange={e => setAdding(e.target.value)} onBlur={add} />
          </form>
        )}
      </div>
      <Button variant="mint" size="md" busy={busy} disabled={!app.session || (!topic && !surprise)} onClick={() => start(topic || surprise)}>
        {topic ? `Make an episode about ${topic}` : surprise ? "Surprise me" : "Add an interest first"}
      </Button>
      {topic && <div><LinkButton onClick={() => remove(topic)}>Remove “{topic}” from your interests</LinkButton></div>}
      {!app.session && <p className="g-small">Sign in on the home page to make episodes.</p>}
      {error && <p className="g-error">{error}</p>}
    </Card>
  );
}

// The picked words, turned into cards by the AI, to check before adding:
// switch between the whole verb/phrase and the single word, skip any, and
// words already in the deck are left out.
function AddWords({ app, items, onDone, onCancel }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    wordsFromTranscript(items, app.settings)
      .then(out => alive && setRows(out.map(o => ({ ...o, useAlt: false, skip: false }))))
      .catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  const chosen = r => (r.useAlt && r.alt ? r.alt : r.main);
  const set = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Skipped rows, words already in the deck and repeats within the list
  // aren't added.
  const seen = new Set();
  const adds = (rows || []).map(r => {
    const c = chosen(r);
    const dup = !!findDuplicate(app.cards, c);
    const key = c.de.toLowerCase();
    const add = !r.skip && !dup && !seen.has(key);
    if (add) seen.add(key);
    return { dup, add };
  });
  const count = adds.filter(a => a.add).length;

  const add = () => {
    rows.forEach((r, i) => {
      if (!adds[i].add) return;
      const { sense, ...fields } = chosen(r);
      app.addCard(fields, "podcast");
    });
    app.showToast(`Added ${count} ${count === 1 ? "card" : "cards"}`);
    onDone();
  };

  return (
    <Card label="Add to your deck">
      <b style={{ fontSize: 17 }}>Add to your deck</b>
      {!rows && !error && <div className="g-row"><Spinner /><span className="g-muted">Making cards…</span></div>}
      {error && <p className="g-error">{error}</p>}
      {rows && (
        <ul className="g-picks">
          {rows.map((r, i) => {
            const c = chosen(r);
            return (
              <li key={i} className={adds[i].add ? undefined : "off"}>
                <div className="g-stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
                  <b>{c.kind === "noun" ? <Noun article={c.article}>{c.de}</Noun> : c.de}</b>
                  <span className="g-small">{c.en}{adds[i].dup ? " · already in your deck" : ""}</span>
                  {r.alt && (
                    <div className="g-chips">
                      <Chip pressed={!r.useAlt} onClick={() => set(i, { useAlt: false })}>{cardLabel(r.main)}</Chip>
                      <Chip pressed={r.useAlt} onClick={() => set(i, { useAlt: true })}>{cardLabel(r.alt)}</Chip>
                    </div>
                  )}
                </div>
                {!adds[i].dup && (
                  <IconButton icon={r.skip ? "plus" : "close"} label={r.skip ? `Add ${cardLabel(c)}` : `Skip ${cardLabel(c)}`} variant="ghost" small onClick={() => set(i, { skip: !r.skip })} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="g-row">
        <Button size="sm" variant="mint" disabled={!count} onClick={add}>Add {count} {count === 1 ? "card" : "cards"}</Button>
        <LinkButton onClick={onCancel}>Cancel</LinkButton>
      </div>
    </Card>
  );
}

const SKIP = 10;
const clock = sec => {
  const t = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

// The episode player: play/pause, 10 seconds back and forward, a seek bar
// and the time. The same skips work from the lock screen and headphones
// (Media Session), where the browser supports it.
function Player({ url, rate, title, fallbackSeconds, onEnded }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(fallbackSeconds || 0);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate, url]);

  const skip = useCallback(by => {
    const a = audio.current;
    if (!a) return;
    const end = Number.isFinite(a.duration) ? a.duration : Infinity;
    a.currentTime = Math.min(end, Math.max(0, a.currentTime + by));
    setTime(a.currentTime);
  }, []);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch {} };
    if (window.MediaMetadata) ms.metadata = new MediaMetadata({ title, artist: "Lena & Jonas" });
    set("seekbackward", () => skip(-SKIP));
    set("seekforward", () => skip(SKIP));
    return () => { set("seekbackward", null); set("seekforward", null); };
  }, [title, skip]);

  const seek = to => {
    if (audio.current) audio.current.currentTime = to;
    setTime(to);
  };
  const shown = Math.min(time, duration || time);
  return (
    <div className="g-player">
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={e => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); onEnded(); }}
      />
      <input
        type="range"
        className="g-seek"
        aria-label="Position"
        min={0}
        max={duration || 1}
        step={0.1}
        value={shown}
        style={{ "--p": `${duration ? (shown / duration) * 100 : 0}%` }}
        onChange={e => seek(Number(e.target.value))}
      />
      <div className="g-between g-small">
        <span>{clock(shown)}</span>
        <span>−{clock((duration || 0) - shown)}</span>
      </div>
      <div className="g-player-buttons">
        <button type="button" aria-label={`Back ${SKIP} seconds`} title={`Back ${SKIP} seconds`} onClick={() => skip(-SKIP)}><Icon name="back10" size={28} stroke={2} /></button>
        <button type="button" className="play" aria-label={playing ? "Pause" : "Play"} onClick={toggle}><Icon name={playing ? "pause" : "play"} size={30} /></button>
        <button type="button" aria-label={`Forward ${SKIP} seconds`} title={`Forward ${SKIP} seconds`} onClick={() => skip(SKIP)}><Icon name="fwd10" size={28} stroke={2} /></button>
      </div>
    </div>
  );

}

// The translation of text selected in the transcript, with an optional note
// on how it's built. Short selections can also be picked for the deck.
function Explanation({ app, sel, onClose, onPick }) {
  const [out, setOut] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setOut(null);
    setError(null);
    explainSelection(sel.text, sel.context, app.settings)
      .then(r => alive && setOut(r))
      .catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [sel.text, sel.context]);
  const short = sel.text.split(/\s+/).length <= 5 && !sel.multiLine;

  return (
    <div className="g-explain" role="region" aria-label="Translation" aria-live="polite">
      <div className="g-between" style={{ alignItems: "flex-start", gap: 8 }}>
        <b className="q">{sel.text}</b>
        <IconButton icon="close" label="Close" variant="ghost" small onClick={onClose} />
      </div>
      {!out && !error && <div className="g-row"><Spinner /><span className="g-muted">Translating…</span></div>}
      {error && <p className="g-error">{error}</p>}
      {out && (
        <>
          <p className="t">{out.translation}</p>
          {out.notes && <p className="g-muted">{out.notes}</p>}
        </>
      )}
      {short && <div><LinkButton mint onClick={onPick}>Pick for your deck</LinkButton></div>}
    </div>
  );
}

// The transcript's current text selection: { text, context, multiLine }
// (context is the line(s) it's in), or null.
function readSelection(root) {
  const s = window.getSelection();
  if (!root || !s || s.isCollapsed || !s.rangeCount) return null;
  const range = s.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = s.toString().replace(/\s+/g, " ").trim();
  if (!text || !/[\p{L}]/u.test(text)) return null;
  const lineOf = node => (node.nodeType === 1 ? node : node.parentElement)?.closest("[data-line]");
  const a = lineOf(range.startContainer), b = lineOf(range.endContainer);
  const from = a ? Number(a.dataset.line) : 0;
  const to = b ? Number(b.dataset.line) : from;
  return { text: text.slice(0, 500), from, to: Math.min(to, from + 3), multiLine: from !== to };
}

function EpisodeView({ app, ep }) {
  const [url, setUrl] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [rate, setRate] = useState(1);
  const [showText, setShowText] = useState(false);
  const [picks, setPicks] = useState({});
  const [reviewing, setReviewing] = useState(false);
  // The live selection in the transcript, and the one being translated.
  const [selection, setSelection] = useState(null);
  const [explaining, setExplaining] = useState(null);
  const transcript = useRef(null);
  const signedIn = !!app.session;

  useEffect(() => {
    let alive = true;
    let objectUrl;
    setLoadError(null);
    episodeAudio(ep.path, app.session)
      .then(blob => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(e => alive && setLoadError(e.message));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ep.path, signedIn]);
  // Follows the text selection in the transcript. Tapping the Translate
  // button can clear the selection just before the tap lands (on phones), so
  // a cleared selection only hides the bar a moment later.
  useEffect(() => {
    if (!showText) return;
    let timer;
    const onChange = () => {
      clearTimeout(timer);
      const sel = readSelection(transcript.current);
      if (sel) setSelection(sel);
      else timer = setTimeout(() => setSelection(readSelection(transcript.current)), 600);
    };
    document.addEventListener("selectionchange", onChange);
    return () => { clearTimeout(timer); document.removeEventListener("selectionchange", onChange); };
  }, [showText]);

  const listened = app.listening.log.some(e => e.episode === ep.id && e.day === app.today);
  const toggle = (key, pick) => setPicks(p => {
    const next = { ...p };
    if (next[key]) delete next[key];
    else next[key] = pick;
    return next;
  });
  // The line a key word first comes up in, as its example.
  const lineWith = word => {
    const stem = word.replace(/^(der|die|das)\s+/i, "").toLowerCase();
    return ep.lines.find(l => l.text.toLowerCase().includes(stem))?.text || "";
  };
  const picked = Object.values(picks);
  const contextOf = sel => ep.lines.slice(sel.from, sel.to + 1).map(l => `${l.speaker}: ${l.text}`).join("\n");
  const translate = () => {
    if (!selection) return;
    setExplaining({ ...selection, context: contextOf(selection) });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };
  const pickSelection = () => {
    const key = `s:${explaining.from}:${explaining.text}`;
    setPicks(p => ({ ...p, [key]: { word: explaining.text, sentence: ep.lines[explaining.from]?.text || "" } }));
    setExplaining(null);
  };
  // A tap on a word picks it, unless it ended a text selection.
  const tapWord = (key, pick) => {
    if (window.getSelection()?.isCollapsed === false) return;
    toggle(key, pick);
  };

  return (
    <>
      <Card big label="Episode">
        <div className="g-stack" style={{ gap: 2 }}>
          <span className="g-small">{ep.interest} · {shortDate(ep.started)} · {episodeMinutes(ep)} min{listened ? " · listened today" : ""}</span>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>{ep.title}</span>
        </div>
        {url ? (
          <Player url={url} rate={rate} title={ep.title} fallbackSeconds={ep.seconds} onEnded={() => app.finishEpisode(ep)} />
        ) : loadError ? (
          <p className="g-error">{loadError}</p>
        ) : (
          <div className="g-row"><Spinner /><span className="g-muted">Loading the episode…</span></div>
        )}
        <div className="g-between">
          <div style={{ width: 210 }}>
            <Choice label="Speed" value={rate} onChange={setRate} options={[[0.75, "0.75×"], [0.9, "0.9×"], [1, "1×"]]} />
          </div>
          {!listened && <LinkButton mint onClick={() => app.finishEpisode(ep)}>Mark as listened</LinkButton>}
        </div>
      </Card>

      {ep.keyWords?.length > 0 && (
        <section aria-label="Key words" className="g-stack">
          <Label>Key words · tap to pick</Label>
          <ul className="g-list">
            {ep.keyWords.map((k, i) => (
              <li key={i}>
                <button type="button" className="g-kw" aria-pressed={!!picks[`k${i}`]} onClick={() => toggle(`k${i}`, { word: k.de, sentence: lineWith(k.de) })}>
                  <span className="t"><b>{k.de}</b><span>{k.en}</span></span>
                  <span className="r">{picks[`k${i}`] ? "Picked" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Transcript" className="g-stack">
        <div className="g-between">
          <Label>Transcript</Label>
          <LinkButton mint onClick={() => setShowText(v => !v)}>{showText ? "Hide" : "Show"}</LinkButton>
        </div>
        {showText && (
          <Card className="g-transcript">
            <p className="g-small">Tap words to pick them for your deck. Select any words or sentences (press and hold, then drag) to see what they mean.</p>
            <div ref={transcript}>
              {ep.lines.map((l, li) => (
                <p key={li} data-line={li}>
                  <b className={l.speaker === "Lena" ? "lena" : "jonas"}>{l.speaker}</b>{" "}
                  {tokenize(l.text).map((t, ti) => {
                    const key = `${li}:${ti}`;
                    const pick = () => tapWord(key, { word: t.word, sentence: l.text });
                    return (
                      <Fragment key={ti}>
                        {t.pre}
                        {t.word && (
                          // A span, not a button, so the text stays selectable.
                          <span role="button" tabIndex={0} className="g-word" aria-pressed={!!picks[key]} onClick={pick}
                            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(key, { word: t.word, sentence: l.text }); } }}>{t.word}</span>
                        )}
                        {t.post}{" "}
                      </Fragment>
                    );
                  })}
                </p>
              ))}
            </div>
          </Card>
        )}
      </section>

      {reviewing && (
        <AddWords app={app} items={picked} onCancel={() => setReviewing(false)} onDone={() => { setPicks({}); setReviewing(false); }} />
      )}

      {(explaining || (selection && showText) || (picked.length > 0 && !reviewing)) && (
        <div className="g-dock">
          {explaining && (
            <Explanation key={`${explaining.from}:${explaining.text}`} app={app} sel={explaining} onClose={() => setExplaining(null)} onPick={pickSelection} />
          )}
          {selection && showText ? (
            <div className="g-selbar" role="region" aria-label="Selected text">
              <span className="q">“{selection.text}”</span>
              <Button size="sm" variant="mint" disabled={!signedIn} onClick={translate}>Translate</Button>
            </div>
          ) : picked.length > 0 && !reviewing && (
            <div className="g-selbar" role="region" aria-label="Picked words">
              <span>{picked.length} {picked.length === 1 ? "word" : "words"} picked</span>
              <LinkButton onClick={() => setPicks({})}>Clear</LinkButton>
              <Button size="sm" variant="mint" disabled={!signedIn} onClick={() => setReviewing(true)}>Add to deck</Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function Podcast({ app, episodeId }) {
  const [data, refresh] = useEpisodes(app.session);
  const { episodes, history } = normEpisodes(data);
  const pending = episodes.find(e => e.status === "generating");
  const failed = episodes[0]?.status === "failed" ? episodes[0] : null;
  const ready = episodes.filter(e => e.status === "ready");
  const shown = episodeId ? ready.find(e => e.id === episodeId) : ready[0];
  const readyIds = ready.map(e => e.id).join();

  // Realtime normally brings the finished episode; this is the fallback.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(refresh, 15 * 1000);
    return () => clearInterval(t);
  }, [pending?.id, refresh]);
  useEffect(() => {
    if (ready.length) forgetEpisodes(ready.map(e => e.path));
  }, [readyIds]);

  const others = ready.filter(e => e !== shown);
  return (
    <Screen label="Podcast">
      <ScreenHeader back="#/" title="Podcast" big />
      <NewEpisode app={app} history={history} pending={pending} failed={failed} onStarted={refresh} />
      {shown ? (
        <EpisodeView key={shown.id} app={app} ep={shown} />
      ) : episodeId ? (
        <Empty>That episode is gone; only the last 10 are kept.</Empty>
      ) : !pending && (
        <Empty>No episodes yet. Pick an interest and make your first one.</Empty>
      )}
      {others.length > 0 && (
        <section aria-label="Earlier episodes" className="g-stack">
          <Label>Earlier episodes</Label>
          <ul className="g-list">
            {others.map(e => (
              <li key={e.id}>
                <a href={`#/podcast/${e.id}`}>
                  <span className="t"><b>{e.title}</b><span>{e.interest} · {shortDate(e.started)}</span></span>
                  <span className="r">{episodeMinutes(e)} min</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  );
}
