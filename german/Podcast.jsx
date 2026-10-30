// Podcast: AI episodes about your interests. Pick an interest (or let it
// surprise you) and the german-podcast function makes a 3–4 minute episode
// in the background; play it here, skim its key words or the transcript,
// and tap words to turn them into cards. Playing an episode to the end
// logs its minutes and ticks off the day's podcast task.
import { normEpisodes, nextInterest, episodeMinutes, tokenize, findDuplicate } from "./model.js";
import { startEpisode, wordsFromTranscript } from "./ai.js";
import { episodeAudio, forgetEpisodes } from "./audio.js";
import { useEpisodes } from "./episodes.js";
import { Screen, ScreenHeader, Card, Button, IconButton, LinkButton, Chip, Choice, Label, Spinner, Noun, Empty } from "./ui.jsx";

const { useState, useEffect, useRef, Fragment } = React;

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

function EpisodeView({ app, ep }) {
  const [url, setUrl] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [rate, setRate] = useState(1);
  const [showText, setShowText] = useState(false);
  const [picks, setPicks] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const audio = useRef(null);
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
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate, url]);

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

  return (
    <>
      <Card big label="Episode">
        <div className="g-stack" style={{ gap: 2 }}>
          <span className="g-small">{ep.interest} · {shortDate(ep.started)} · {episodeMinutes(ep)} min{listened ? " · listened today" : ""}</span>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>{ep.title}</span>
        </div>
        {url ? (
          <audio ref={audio} src={url} controls preload="metadata" style={{ width: "100%" }} onEnded={() => app.finishEpisode(ep)} />
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
            <p className="g-small">Tap words to pick them for your deck.</p>
            {ep.lines.map((l, li) => (
              <p key={li}>
                <b className={l.speaker === "Lena" ? "lena" : "jonas"}>{l.speaker}</b>{" "}
                {tokenize(l.text).map((t, ti) => (
                  <Fragment key={ti}>
                    {t.pre}
                    {t.word && (
                      <button type="button" className="g-word" aria-pressed={!!picks[`${li}:${ti}`]} onClick={() => toggle(`${li}:${ti}`, { word: t.word, sentence: l.text })}>{t.word}</button>
                    )}
                    {t.post}{" "}
                  </Fragment>
                ))}
              </p>
            ))}
          </Card>
        )}
      </section>

      {reviewing ? (
        <AddWords app={app} items={picked} onCancel={() => setReviewing(false)} onDone={() => { setPicks({}); setReviewing(false); }} />
      ) : picked.length > 0 && (
        <div className="g-selbar" role="region" aria-label="Picked words">
          <span>{picked.length} {picked.length === 1 ? "word" : "words"} picked</span>
          <LinkButton onClick={() => setPicks({})}>Clear</LinkButton>
          <Button size="sm" variant="mint" disabled={!signedIn} onClick={() => setReviewing(true)}>Add to deck</Button>
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
