// Live dictation through Soniox real-time speech-to-text. The mic audio goes
// straight from the browser to Soniox; the soniox-key edge function only
// hands out a short-lived key, so dictation needs a signed-in user.
//
// useDictation({ onText, languages, context }) returns { status, error,
// supported, start, stop, cancel }. onText gets the whole transcript so far
// (settled words plus the ones still being recognised) on every update.
// status is "idle", "starting", "listening" or "finishing"; stop() waits for
// the last words, cancel() drops them.
import { SonioxClient } from "@soniox/speech-to-text-web";
import { callAI } from "./ai.js";

const { useState, useRef, useEffect } = React;

const MODEL = "stt-rt-v5";

const STATUS = {
  RequestingMedia: "starting",
  OpeningWebSocket: "starting",
  Running: "listening",
  FinishingProcessing: "finishing",
};

const ERRORS = {
  get_user_media_failed: "Couldn't use the microphone - check the browser's permission.",
  websocket_error: "Lost the connection to the dictation service.",
  queue_limit_exceeded: "Dictation took too long to connect - try again.",
  media_recorder_error: "The microphone stopped working.",
};

// Soniox marks control points (endpoints, finalize) with tokens like "<end>".
const isControl = (t) => /^<\w+>$/.test(t.text);

export function useDictation({ onText, languages = ["sl", "en"], context }) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const client = useRef(null);
  const keyError = useRef(null);
  const opts = useRef({});
  opts.current = { onText, languages, context };

  useEffect(() => () => client.current?.cancel(), []);

  function start() {
    if (client.current) return;
    setError(null);
    keyError.current = null;
    let final = "";
    const c = new SonioxClient({
      apiKey: async () => {
        try {
          return (await callAI("soniox-key", {})).apiKey;
        } catch (err) {
          keyError.current = err.message;
          throw err;
        }
      },
    });
    client.current = c;
    const done = () => {
      if (client.current === c) client.current = null;
      setStatus("idle");
    };
    c.start({
      model: MODEL,
      languageHints: opts.current.languages,
      enableLanguageIdentification: true,
      context: opts.current.context,
      onStateChange: ({ newState }) => {
        if (STATUS[newState]) setStatus(STATUS[newState]);
      },
      onPartialResult: (res) => {
        let pending = "";
        for (const t of res.tokens) {
          if (isControl(t)) continue;
          if (t.is_final) final += t.text;
          else pending += t.text;
        }
        opts.current.onText((final + pending).trim());
      },
      onFinished: done,
      onError: (kind, message) => {
        setError(keyError.current || ERRORS[kind] || message || "Dictation failed.");
        done();
      },
    });
  }

  return {
    status,
    error,
    supported: SonioxClient.isSupported,
    start,
    stop: () => client.current?.stop(),
    cancel: () => {
      client.current?.cancel();
      client.current = null;
      setStatus("idle");
    },
  };
}
