(() => {
  // interval-timer-app.jsx
  var { useState, useEffect, useRef, useCallback } = React;
  var STORAGE_KEYS = { presets: "interval-timer-presets", history: "interval-timer-history" };
  function formatTime(s2) {
    const m = Math.floor(s2 / 60);
    const sec = s2 % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  function useStorage(key, fallback) {
    const [data, setData] = useState(() => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    });
    const save = useCallback((val) => {
      setData(val);
      try {
        localStorage.setItem(key, JSON.stringify(val));
      } catch {
      }
    }, [key]);
    return [data, save];
  }
  var TABS = ["Timer", "Presets", "History"];
  var audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function beep(freq, duration, volume = 0.2, type = "sine", delay = 0) {
    try {
      const ctx = getAudioCtx();
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(1e-3, t0 + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch {
    }
  }
  var sounds = {
    countdown: () => beep(880, 0.1, 0.18, "sine"),
    workStart: () => beep(660, 0.18, 0.22, "square"),
    restStart: () => beep(440, 0.18, 0.22, "sine"),
    finish: () => {
      beep(523, 0.15, 0.22, "sine", 0);
      beep(659, 0.15, 0.22, "sine", 0.15);
      beep(784, 0.3, 0.24, "sine", 0.3);
    }
  };
  function EditableNum({ value, onChange, min = 1, max = 999, suffix = "", step }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const inputRef = useRef(null);
    const getStep = (v, dir) => {
      if (step) return step;
      if (dir > 0) return v >= 60 ? 10 : v >= 10 ? 5 : 1;
      return v > 60 ? 10 : v > 10 ? 5 : 1;
    };
    const commit = () => {
      const n = parseInt(draft, 10);
      if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
      setEditing(false);
    };
    useEffect(() => {
      if (editing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [editing]);
    return /* @__PURE__ */ React.createElement("div", { style: s.numRow }, /* @__PURE__ */ React.createElement("button", { style: s.numBtn, onClick: () => onChange(Math.max(min, value - getStep(value, -1))) }, "\u2212"), editing ? /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: inputRef,
        style: s.numInput,
        type: "number",
        value: draft,
        onChange: (e) => setDraft(e.target.value),
        onBlur: commit,
        onKeyDown: (e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }
      }
    ) : /* @__PURE__ */ React.createElement("span", { style: s.numVal, onClick: () => {
      setDraft(String(value));
      setEditing(true);
    } }, value, suffix), /* @__PURE__ */ React.createElement("button", { style: s.numBtn, onClick: () => onChange(Math.min(max, value + getStep(value, 1))) }, "+"));
  }
  function IntervalTimerApp() {
    const [tab, setTab] = useState("Timer");
    const [presets, setPresets] = useStorage(STORAGE_KEYS.presets, []);
    const [history, setHistory] = useStorage(STORAGE_KEYS.history, []);
    const [workSec, setWorkSec] = useState(30);
    const [restSec, setRestSec] = useState(15);
    const [totalSets, setTotalSets] = useState(5);
    const [phase, setPhase] = useState("idle");
    const [currentSet, setCurrentSet] = useState(1);
    const [timeLeft, setTimeLeft] = useState(0);
    const [paused, setPaused] = useState(false);
    const intervalRef = useRef(null);
    const configRef = useRef({ workSec, restSec, totalSets });
    const [presetName, setPresetName] = useState("");
    useEffect(() => {
      configRef.current = { workSec, restSec, totalSets };
    }, [workSec, restSec, totalSets]);
    const clearInterval_ = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    const phaseRef = useRef("idle");
    const currentSetRef = useRef(1);
    const timeLeftRef = useRef(0);
    const runTick = () => {
      timeLeftRef.current -= 1;
      if (timeLeftRef.current <= 0) {
        if (phaseRef.current === "work") {
          if (currentSetRef.current >= configRef.current.totalSets) {
            phaseRef.current = "done";
            setPhase("done");
            setTimeLeft(0);
            clearInterval_();
            sounds.finish();
            return;
          }
          phaseRef.current = "rest";
          timeLeftRef.current = configRef.current.restSec;
          setPhase("rest");
          setTimeLeft(configRef.current.restSec);
          sounds.restStart();
        } else if (phaseRef.current === "rest") {
          currentSetRef.current += 1;
          phaseRef.current = "work";
          timeLeftRef.current = configRef.current.workSec;
          setPhase("work");
          setCurrentSet(currentSetRef.current);
          setTimeLeft(configRef.current.workSec);
          sounds.workStart();
        }
      } else {
        setTimeLeft(timeLeftRef.current);
        if (timeLeftRef.current <= 3 && timeLeftRef.current >= 1) {
          sounds.countdown();
        }
      }
    };
    const startTimer = () => {
      clearInterval_();
      getAudioCtx();
      phaseRef.current = "work";
      currentSetRef.current = 1;
      timeLeftRef.current = workSec;
      setPhase("work");
      setCurrentSet(1);
      setTimeLeft(workSec);
      setPaused(false);
      sounds.workStart();
      intervalRef.current = setInterval(runTick, 1e3);
    };
    const togglePause = () => {
      if (paused) {
        intervalRef.current = setInterval(runTick, 1e3);
        setPaused(false);
      } else {
        clearInterval_();
        setPaused(true);
      }
    };
    const stopTimer = () => {
      clearInterval_();
      setPhase("idle");
      setCurrentSet(1);
      setTimeLeft(0);
      setPaused(false);
      phaseRef.current = "idle";
      currentSetRef.current = 1;
      timeLeftRef.current = 0;
    };
    const skipPhase = () => {
      if (phaseRef.current === "rest") {
        currentSetRef.current += 1;
        phaseRef.current = "work";
        timeLeftRef.current = configRef.current.workSec;
        setPhase("work");
        setCurrentSet(currentSetRef.current);
        setTimeLeft(configRef.current.workSec);
      } else if (phaseRef.current === "work") {
        if (currentSetRef.current >= configRef.current.totalSets) {
          clearInterval_();
          phaseRef.current = "done";
          setPhase("done");
          setTimeLeft(0);
        } else {
          phaseRef.current = "rest";
          timeLeftRef.current = configRef.current.restSec;
          setPhase("rest");
          setTimeLeft(configRef.current.restSec);
        }
      }
    };
    useEffect(() => {
      if (phase === "done") {
        const entry = {
          id: Date.now(),
          date: (/* @__PURE__ */ new Date()).toISOString(),
          workSec: configRef.current.workSec,
          restSec: configRef.current.restSec,
          sets: configRef.current.totalSets
        };
        setHistory([entry, ...history]);
      }
    }, [phase]);
    useEffect(() => () => clearInterval_(), []);
    const running = phase === "work" || phase === "rest";
    const isIdle = phase === "idle";
    const isDone = phase === "done";
    const phaseColor = phase === "work" ? "#E8553A" : phase === "rest" ? "#3A9E6E" : "#888";
    const phaseBg = phase === "work" ? "rgba(232,85,58,0.08)" : phase === "rest" ? "rgba(58,158,110,0.08)" : "transparent";
    const savePreset = () => {
      if (!presetName.trim()) return;
      const p = { id: Date.now(), name: presetName.trim(), workSec, restSec, sets: totalSets };
      setPresets([...presets, p]);
      setPresetName("");
    };
    const loadPreset = (p) => {
      setWorkSec(p.workSec);
      setRestSec(p.restSec);
      setTotalSets(p.sets);
      setTab("Timer");
    };
    const deletePreset = (id) => setPresets(presets.filter((p) => p.id !== id));
    const clearHistory = () => setHistory([]);
    const deleteHistoryEntry = (id) => setHistory(history.filter((h) => h.id !== id));
    const fileInputRef = useRef(null);
    const [transferMode, setTransferMode] = useState(null);
    const [transferText, setTransferText] = useState("");
    const [copied, setCopied] = useState(false);
    const [importError, setImportError] = useState("");
    const openExport = () => {
      setTransferText(JSON.stringify({ presets, history }, null, 2));
      setCopied(false);
      setTransferMode("export");
    };
    const openImport = () => {
      setTransferText("");
      setImportError("");
      setTransferMode("import");
    };
    const copyExport = async () => {
      try {
        await navigator.clipboard.writeText(transferText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2e3);
      } catch {
        const ta = document.querySelector("[data-transfer-text]");
        if (ta) {
          ta.select();
          document.execCommand("copy");
          setCopied(true);
          setTimeout(() => setCopied(false), 2e3);
        }
      }
    };
    const downloadExport = () => {
      const blob = new Blob([transferText], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `interval-timer-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
    const applyImport = (text) => {
      try {
        const data = JSON.parse(text || transferText);
        if (data.presets && Array.isArray(data.presets)) setPresets(data.presets);
        if (data.history && Array.isArray(data.history)) setHistory(data.history);
        setTransferMode(null);
        setImportError("");
      } catch {
        setImportError("Invalid JSON");
      }
    };
    const importFromFile = (e) => {
      var _a;
      const file = (_a = e.target.files) == null ? void 0 : _a[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result;
        setTransferText(text);
        applyImport(text);
      };
      reader.readAsText(file);
      e.target.value = "";
    };
    return /* @__PURE__ */ React.createElement("div", { style: s.root }, /* @__PURE__ */ React.createElement("div", { style: s.tabs }, TABS.map((t) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: t,
        onClick: () => setTab(t),
        style: { ...s.tab, ...tab === t ? s.tabActive : {} }
      },
      t,
      t === "History" && history.length > 0 ? ` (${history.length})` : ""
    ))), tab === "Timer" && /* @__PURE__ */ React.createElement("div", { style: s.page }, isIdle && /* @__PURE__ */ React.createElement("div", { style: s.config }, /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement("label", { style: s.label }, "Work"), /* @__PURE__ */ React.createElement(EditableNum, { value: workSec, onChange: setWorkSec, suffix: "s" })), /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement("label", { style: s.label }, "Rest"), /* @__PURE__ */ React.createElement(EditableNum, { value: restSec, onChange: setRestSec, suffix: "s" })), /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement("label", { style: s.label }, "Sets"), /* @__PURE__ */ React.createElement(EditableNum, { value: totalSets, onChange: setTotalSets, min: 1, max: 99, step: 1 }))), /* @__PURE__ */ React.createElement("div", { style: { ...s.timerBox, background: phaseBg } }, isIdle && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: s.timerDigits }, formatTime(workSec)), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, totalSets, " sets \xB7 ", formatTime(workSec), " work \xB7 ", formatTime(restSec), " rest"), /* @__PURE__ */ React.createElement("div", { style: s.timerSub2 }, "Total: ", formatTime(totalSets * workSec + (totalSets - 1) * restSec))), running && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: phaseColor } }, phase.toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { ...s.timerDigits, color: phaseColor } }, formatTime(timeLeft)), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, "Set ", currentSet, " / ", configRef.current.totalSets), paused && /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: "#F0AD4E", marginTop: 8, fontSize: 13 } }, "PAUSED")), isDone && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: "#3A9E6E" } }, "DONE"), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, configRef.current.totalSets, " sets completed"))), /* @__PURE__ */ React.createElement("div", { style: s.controls }, isIdle && /* @__PURE__ */ React.createElement("button", { style: s.startBtn, onClick: startTimer }, "Start"), running && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { style: s.pauseBtn, onClick: togglePause }, paused ? "Resume" : "Pause"), /* @__PURE__ */ React.createElement("button", { style: s.skipBtn, onClick: skipPhase }, "Skip"), /* @__PURE__ */ React.createElement("button", { style: s.stopBtn, onClick: stopTimer }, "Stop")), isDone && /* @__PURE__ */ React.createElement("button", { style: s.startBtn, onClick: stopTimer }, "Reset")), isIdle && presets.length > 0 && /* @__PURE__ */ React.createElement("div", { style: s.quickPresets }, /* @__PURE__ */ React.createElement("div", { style: { ...s.label, marginBottom: 8 } }, "Quick load"), /* @__PURE__ */ React.createElement("div", { style: s.presetChips }, presets.map((p) => /* @__PURE__ */ React.createElement("button", { key: p.id, style: s.chip, onClick: () => loadPreset(p) }, p.name))))), tab === "Presets" && /* @__PURE__ */ React.createElement("div", { style: s.page }, /* @__PURE__ */ React.createElement("div", { style: s.presetForm }, /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.input,
        placeholder: "Preset name",
        value: presetName,
        onChange: (e) => setPresetName(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && savePreset()
      }
    ), /* @__PURE__ */ React.createElement("button", { style: s.saveBtn, onClick: savePreset, disabled: !presetName.trim() }, "Save current")), /* @__PURE__ */ React.createElement("div", { style: s.configSummary }, "Saving: ", formatTime(workSec), " work / ", formatTime(restSec), " rest / ", totalSets, " sets"), presets.length === 0 && /* @__PURE__ */ React.createElement("p", { style: s.empty }, "No presets yet. Configure your timer and save one."), presets.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, style: s.listItem }, /* @__PURE__ */ React.createElement("div", { style: s.listMain, onClick: () => loadPreset(p) }, /* @__PURE__ */ React.createElement("div", { style: s.listTitle }, p.name), /* @__PURE__ */ React.createElement("div", { style: s.listMeta }, formatTime(p.workSec), " / ", formatTime(p.restSec), " \xB7 ", p.sets, " sets")), /* @__PURE__ */ React.createElement("button", { style: s.deleteBtn, onClick: () => deletePreset(p.id) }, "\xD7"))), /* @__PURE__ */ React.createElement("div", { style: s.exportSection }, /* @__PURE__ */ React.createElement("div", { style: { ...s.label, marginBottom: 10 } }, "Transfer data"), /* @__PURE__ */ React.createElement("div", { style: s.exportRow }, /* @__PURE__ */ React.createElement("button", { style: s.exportBtn, onClick: openExport }, "Export"), /* @__PURE__ */ React.createElement("button", { style: s.exportBtn, onClick: openImport }, "Import")), /* @__PURE__ */ React.createElement("div", { style: s.exportHint }, "Move presets and history between devices."))), tab === "History" && /* @__PURE__ */ React.createElement("div", { style: s.page }, history.length > 0 && /* @__PURE__ */ React.createElement("button", { style: s.clearBtn, onClick: clearHistory }, "Clear all"), history.length === 0 && /* @__PURE__ */ React.createElement("p", { style: s.empty }, "No completed workouts yet."), history.map((h) => /* @__PURE__ */ React.createElement("div", { key: h.id, style: s.listItem }, /* @__PURE__ */ React.createElement("div", { style: s.listMain }, /* @__PURE__ */ React.createElement("div", { style: s.listTitle }, formatDate(h.date)), /* @__PURE__ */ React.createElement("div", { style: s.listMeta }, formatTime(h.workSec), " / ", formatTime(h.restSec), " \xB7 ", h.sets, " sets \xB7 ", formatTime(h.sets * h.workSec + (h.sets - 1) * h.restSec), " total")), /* @__PURE__ */ React.createElement("button", { style: s.deleteBtn, onClick: () => deleteHistoryEntry(h.id) }, "\xD7")))), transferMode && /* @__PURE__ */ React.createElement("div", { style: s.overlay, onClick: () => setTransferMode(null) }, /* @__PURE__ */ React.createElement("div", { style: s.modal, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { style: s.modalHeader }, /* @__PURE__ */ React.createElement("span", { style: s.modalTitle }, transferMode === "export" ? "Export" : "Import"), /* @__PURE__ */ React.createElement("button", { style: s.modalClose, onClick: () => setTransferMode(null) }, "\xD7")), transferMode === "export" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      "textarea",
      {
        "data-transfer-text": true,
        style: s.transferArea,
        value: transferText,
        readOnly: true,
        onFocus: (e) => e.target.select()
      }
    ), /* @__PURE__ */ React.createElement("div", { style: s.modalActions }, /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: copyExport }, copied ? "Copied!" : "Copy"), /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: downloadExport }, "Download"))), transferMode === "import" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      "textarea",
      {
        style: s.transferArea,
        value: transferText,
        onChange: (e) => {
          setTransferText(e.target.value);
          setImportError("");
        },
        placeholder: "Paste exported JSON here..."
      }
    ), importError && /* @__PURE__ */ React.createElement("div", { style: s.importError }, importError), /* @__PURE__ */ React.createElement("div", { style: s.modalActions }, /* @__PURE__ */ React.createElement(
      "button",
      {
        style: { ...s.exportBtn, flex: 1 },
        onClick: () => applyImport(),
        disabled: !transferText.trim()
      },
      "Apply"
    ), /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: () => {
      var _a;
      return (_a = fileInputRef.current) == null ? void 0 : _a.click();
    } }, "From file"), /* @__PURE__ */ React.createElement("input", { ref: fileInputRef, type: "file", accept: ".json", onChange: importFromFile, style: { display: "none" } }))))));
  }
  var s = {
    root: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      maxWidth: 440,
      margin: "0 auto",
      minHeight: "100vh",
      background: "#111",
      color: "#E8E8E8"
    },
    tabs: {
      display: "flex",
      borderBottom: "1px solid #282828",
      position: "sticky",
      top: 0,
      background: "#111",
      zIndex: 10
    },
    tab: {
      flex: 1,
      padding: "14px 0",
      background: "none",
      border: "none",
      color: "#666",
      fontSize: 14,
      fontWeight: 500,
      cursor: "pointer",
      borderBottom: "2px solid transparent",
      transition: "color 0.15s"
    },
    tabActive: {
      color: "#E8E8E8",
      borderBottomColor: "#E8E8E8"
    },
    page: { padding: "20px 16px" },
    config: {
      display: "flex",
      gap: 8,
      marginBottom: 24,
      minWidth: 0
    },
    field: { flex: 1, textAlign: "center", minWidth: 0 },
    label: { fontSize: 12, color: "#777", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
    numRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 8 },
    numBtn: {
      width: 32,
      height: 32,
      borderRadius: 8,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#CCC",
      fontSize: 18,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0
    },
    numVal: {
      fontSize: 17,
      fontWeight: 600,
      fontVariantNumeric: "tabular-nums",
      minWidth: 40,
      textAlign: "center",
      cursor: "pointer",
      padding: "4px 2px",
      borderRadius: 6,
      borderBottom: "1px dashed #444"
    },
    numInput: {
      width: 52,
      textAlign: "center",
      fontSize: 17,
      fontWeight: 600,
      background: "#1A1A1A",
      color: "#E8E8E8",
      border: "1px solid #555",
      borderRadius: 6,
      padding: "4px 2px",
      outline: "none",
      fontVariantNumeric: "tabular-nums"
    },
    timerBox: {
      borderRadius: 16,
      padding: "36px 20px",
      textAlign: "center",
      border: "1px solid #222",
      marginBottom: 20,
      transition: "background 0.3s"
    },
    phaseLabel: {
      fontSize: 14,
      fontWeight: 700,
      letterSpacing: "0.12em",
      marginBottom: 8
    },
    timerDigits: {
      fontSize: 72,
      fontWeight: 200,
      fontVariantNumeric: "tabular-nums",
      letterSpacing: "-0.02em",
      lineHeight: 1
    },
    timerSub: { marginTop: 12, fontSize: 14, color: "#888" },
    timerSub2: { marginTop: 4, fontSize: 13, color: "#555" },
    controls: { display: "flex", gap: 12, justifyContent: "center" },
    startBtn: {
      flex: 1,
      maxWidth: 200,
      padding: "14px 0",
      borderRadius: 10,
      border: "none",
      background: "#E8553A",
      color: "#fff",
      fontSize: 16,
      fontWeight: 600,
      cursor: "pointer"
    },
    pauseBtn: {
      flex: 1,
      padding: "14px 0",
      borderRadius: 10,
      border: "1px solid #444",
      background: "#1A1A1A",
      color: "#E8E8E8",
      fontSize: 15,
      fontWeight: 500,
      cursor: "pointer"
    },
    stopBtn: {
      flex: 1,
      padding: "14px 0",
      borderRadius: 10,
      border: "1px solid #333",
      background: "transparent",
      color: "#999",
      fontSize: 15,
      fontWeight: 500,
      cursor: "pointer"
    },
    skipBtn: {
      flex: 1,
      padding: "14px 0",
      borderRadius: 10,
      border: "1px solid #444",
      background: "transparent",
      color: "#CCC",
      fontSize: 15,
      fontWeight: 500,
      cursor: "pointer"
    },
    quickPresets: { marginTop: 28 },
    presetChips: { display: "flex", flexWrap: "wrap", gap: 8 },
    chip: {
      padding: "8px 16px",
      borderRadius: 8,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#CCC",
      fontSize: 13,
      cursor: "pointer"
    },
    presetForm: { display: "flex", gap: 8, marginBottom: 8 },
    input: {
      flex: 1,
      padding: "10px 12px",
      borderRadius: 8,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#E8E8E8",
      fontSize: 14,
      outline: "none"
    },
    saveBtn: {
      padding: "10px 16px",
      borderRadius: 8,
      border: "none",
      background: "#333",
      color: "#E8E8E8",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      whiteSpace: "nowrap"
    },
    configSummary: { fontSize: 12, color: "#555", marginBottom: 20 },
    empty: { color: "#555", fontSize: 14, textAlign: "center", marginTop: 40 },
    listItem: {
      display: "flex",
      alignItems: "center",
      padding: "14px 0",
      borderBottom: "1px solid #1E1E1E",
      cursor: "pointer"
    },
    listMain: { flex: 1 },
    listTitle: { fontSize: 15, fontWeight: 500 },
    listMeta: { fontSize: 13, color: "#666", marginTop: 2 },
    deleteBtn: {
      width: 32,
      height: 32,
      borderRadius: 8,
      border: "none",
      background: "transparent",
      color: "#555",
      fontSize: 20,
      cursor: "pointer"
    },
    clearBtn: {
      padding: "8px 14px",
      borderRadius: 8,
      border: "1px solid #333",
      background: "transparent",
      color: "#888",
      fontSize: 13,
      cursor: "pointer",
      marginBottom: 16,
      display: "block"
    },
    exportSection: {
      marginTop: 32,
      paddingTop: 20,
      borderTop: "1px solid #222"
    },
    exportRow: { display: "flex", gap: 8 },
    exportBtn: {
      flex: 1,
      padding: "10px 0",
      borderRadius: 8,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#CCC",
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer"
    },
    exportHint: { fontSize: 12, color: "#555", marginTop: 8 },
    overlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.7)",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
      zIndex: 100
    },
    modal: {
      background: "#1A1A1A",
      borderRadius: "16px 16px 0 0",
      width: "100%",
      maxWidth: 440,
      padding: "20px 16px 24px",
      maxHeight: "80vh",
      display: "flex",
      flexDirection: "column"
    },
    modalHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14
    },
    modalTitle: { fontSize: 16, fontWeight: 600 },
    modalClose: {
      background: "none",
      border: "none",
      color: "#888",
      fontSize: 24,
      cursor: "pointer",
      padding: "0 4px"
    },
    transferArea: {
      width: "100%",
      minHeight: 140,
      maxHeight: 260,
      resize: "vertical",
      background: "#111",
      color: "#CCC",
      border: "1px solid #333",
      borderRadius: 8,
      padding: 12,
      fontSize: 13,
      fontFamily: "monospace",
      outline: "none",
      boxSizing: "border-box"
    },
    modalActions: { display: "flex", gap: 8, marginTop: 12 },
    importError: { color: "#E8553A", fontSize: 13, marginTop: 6 }
  };
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(IntervalTimerApp, null));
})();
