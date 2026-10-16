"""Builds the EKG trainer's case library from real recordings.

Sources (all CC BY 4.0 / ODC-By, credited in the app):
  - PTB-XL 1.0.3 + PTB-XL+ 12SL measurements: cardiologist-labelled 12-lead ECGs
  - Shaoxing/Ningbo "ecg-arrhythmia" 1.0.0: 12-lead ECGs with Mobitz I/II, AVNRT
  - MIT-BIH Malignant Ventricular Ectopy DB (vfdb) and MIT-BIH Arrhythmia DB
    (mitdb): 2-lead monitor strips for VT, VF and junctional rhythm

Each case is chosen strictly (single main diagnosis, no noise flags, numbers
well clear of the cut-offs) and comes with the answers to the step questions,
taken from the measurements. A question whose answer is borderline for that
recording is left out rather than guessed.

Usage (from the repo root):
  uv run --with numpy,pandas,scipy,wfdb python ekg-trainer/tools/build_cases.py DATA_DIR

DATA_DIR must hold:
  ptbxl/ptbxl_database.csv, ptbxl/12sl_features.csv   (PTB-XL, PTB-XL+)
  sx/hea/**.hea                                       (ecg-arrhythmia headers)
Signals are downloaded on demand into DATA_DIR/cache.

Writes ekg-trainer/cases/index.json and one <id>.bin per case: little-endian
int16 microvolts, lead after lead.
"""

import ast
import json
import random
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import wfdb
from scipy import signal as sg
from wfdb import processing

S3 = "https://physionet-open.s3.amazonaws.com"
OUT = Path(__file__).resolve().parent.parent / "cases"
DATA = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data")
CACHE = DATA / "cache"
PER_DX = 15
SEED = 7

# Leads stored for 12-lead cases; III, aVR, aVL and aVF follow from I and II.
STORED_12 = ["I", "II", "V1", "V2", "V3", "V4", "V5", "V6"]

# --- Signal handling ----------------------------------------------------------


def fetch(path):
    """Downloads `path` (relative to the S3 bucket) into the cache once."""
    dest = CACHE / path
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(f"{S3}/{path}", dest)
    return dest


def read_record(base):
    """Reads a WFDB record whose .hea and data file are under `base` in S3."""
    hea = fetch(base + ".hea")
    for line in hea.read_text().splitlines()[1:2]:
        fetch(str(Path(base).parent / line.split()[0]))
    return wfdb.rdrecord(str(CACHE / base))


def clean(x, fs, mains):
    """Removes baseline wander (0.5 Hz high-pass), mains hum and hiss, zero-phase."""
    b, a = sg.butter(2, 0.5 / (fs / 2), "highpass")
    x = sg.filtfilt(b, a, x, axis=0)
    if mains < fs / 2:
        b, a = sg.iirnotch(mains, 30, fs)
        x = sg.filtfilt(b, a, x, axis=0)
    hi = min(100, 0.4 * fs)
    b, a = sg.butter(3, hi / (fs / 2), "lowpass")
    return sg.filtfilt(b, a, x, axis=0)


def r_peaks(x, fs):
    """QRS locations (s) from one lead."""
    try:
        idx = processing.xqrs_detect(x, fs, verbose=False)
    except Exception:
        return np.array([])
    return np.asarray(idx) / fs


def rr_stats(peaks):
    rr = np.diff(peaks)
    if len(rr) < 3:
        return None
    return {
        "rate": 60 / rr.mean(),
        "cv": rr.std() / rr.mean(),
        "premature": bool((rr < 0.85 * np.median(rr)).any()),
        "pause": bool((rr > 1.5 * rr.min()).any()),
    }


def typical_p2p(x, fs):
    """Median peak-to-peak amplitude over 1 s windows (mV)."""
    w = int(fs)
    return float(np.median([np.ptp(x[i: i + w]) for i in range(0, len(x) - w + 1, w)]))


def periodic_rate(x, fs):
    """Rate (bpm) from the strongest autocorrelation peak at 0.2–2 s lag."""
    x = x - x.mean()
    ac = np.correlate(x, x, "full")[len(x) - 1:]
    lo, hi = int(0.2 * fs), int(2 * fs)
    seg = ac[lo:hi]
    if ac[0] <= 0 or seg.max() < 0.3 * ac[0]:
        return None
    # First lag that comes close to the best peak, so a 2-beat period isn't
    # mistaken for the beat period.
    k = int(np.argmax(seg >= 0.85 * seg.max()))
    while k + 1 < len(seg) and seg[k + 1] > seg[k]:
        k += 1
    return 60 * fs / (lo + k)


def save(case_id, leads, data, fs):
    """Writes the samples (mV, shape n × leads) as int16 µV."""
    uv = np.clip(np.round(data * 1000), -32767, 32767).astype("<i2")
    (OUT / f"{case_id}.bin").write_bytes(uv.T.copy().tobytes())
    return {"leads": leads, "fs": int(fs), "n": int(data.shape[0])}


# --- Answers ------------------------------------------------------------------


def band(x, lo, hi, gap):
    """'low'/'mid'/'high' for x against cut-offs lo and hi, or None when x
    is within `gap` of either."""
    if x is None or np.isnan(x):
        return None
    if abs(x - lo) < gap or abs(x - hi) < gap:
        return None
    return "low" if x < lo else "high" if x > hi else "mid"


def rate_answer(hr):
    return {"low": "slow", "mid": "normal", "high": "fast"}.get(band(hr, 60, 100, 4))


def pr_answer(pr):
    if pr is None or np.isnan(pr):
        return None
    if pr < 112:
        return "short"
    if 128 <= pr <= 192:
        return "normal"
    if pr > 212:
        return "long"
    return None


def qrs_answer(qrs):
    if qrs is None or np.isnan(qrs):
        return None
    return "narrow" if qrs <= 108 else "wide" if qrs >= 125 else None


def axis_answer(axis):
    if axis is None or np.isnan(axis):
        return None
    a = ((axis + 180) % 360) - 180
    if any(abs(a - m) < 10 for m in (-90, -30, 90)) or abs(a) > 170:
        return None
    if -30 <= a <= 90:
        return "normal"
    if -90 <= a < -30:
        return "left"
    if 90 < a <= 180:
        return "right"
    return "extreme"


def qt_answer(qtc):
    if qtc is None or np.isnan(qtc):
        return None
    return "normal" if qtc <= 445 else "long" if qtc >= 480 else None


# What each diagnosis implies for the step questions. Measured answers
# (rate, PR, QRS, axis, QTc) override these where the recording has them.
TRUTH = {
    "nsr": dict(rhythm="regular", p="normal", st="normal"),
    "sinus_brady": dict(rhythm="regular", p="normal"),
    "sinus_tachy": dict(rhythm="regular", p="normal"),
    "sinus_arrhythmia": dict(rhythm="regIrreg", p="normal"),
    "pac": dict(rhythm="regIrreg", p="normal"),
    "af": dict(rhythm="irregIrreg", p="fib", pr="na"),
    "aflutter": dict(p="flutter", pr="na"),
    "svt": dict(rhythm="regular", p=["absent", "retro"], pr="na"),
    "junctional": dict(rhythm="regular", p=["absent", "retro"], pr=["na", "short"]),
    "pvc": dict(rhythm="regIrreg", p="normal"),
    "vt": dict(rhythm="regular", p="absent", pr=["na", "variable"], qrs="wide"),
    "vf": dict(),
    "avb1": dict(rhythm="regular", p="normal", pr="long"),
    "mobitz1": dict(rhythm="regIrreg", p="more", pr="progressive"),
    "mobitz2": dict(rhythm="regIrreg", p="more"),
    "avb3": dict(rhythm="regular", p="more", pr="variable"),
    "lbbb": dict(p="normal", qrs="wide", st="secondary"),
    "rbbb": dict(p="normal", qrs="wide", st=["secondary", "depression", "normal"]),
    "lafb": dict(p="normal", axis="left"),
    "wpw": dict(p="normal", pr="short", st=["secondary", "depression", "normal"]),
    "lvh": dict(p="normal"),
    "rvh": dict(p="normal"),
    "stemi_inf": dict(st="regional"),
    "stemi_ant": dict(st="regional"),
    "stemi_lat": dict(st="regional"),
    "stemi_post": dict(st="depression"),
    "long_qt": dict(rhythm="regular", p="normal", qt="long"),
}

# Rhythms where QT isn't asked: irregular, wide or too fast to judge.
NO_QT = {"af", "aflutter", "svt", "vt", "vf", "pvc", "pac", "mobitz1", "mobitz2", "avb3", "sinus_arrhythmia", "lbbb", "rbbb", "wpw"}

# PTB-XL statements that mean "the ST/T isn't normal".
STT_CODES = {"NDT", "NST_", "DIG", "ISC_", "ISCAL", "ISCIN", "ISCIL", "ISCAS", "ISCLA", "ISCAN", "INJAS", "INJAL",
             "INJIN", "INJLA", "INJIL", "STD_", "STE_", "INVT", "LOWT", "NT_", "TAB_", "ANEUR", "EL"}


def build_answers(dx, twelve, m, rhythm_ok=True):
    """Answers for one case. `m` holds whatever was measured: hr, pr, qrs,
    axis, qtc (ms / bpm / degrees) and stt (True if ST/T is abnormal)."""
    t = {k: ([v] if isinstance(v, str) else v) for k, v in TRUTH[dx].items()}
    ans = {}
    if dx == "vf":
        return ans

    r = rate_answer(m.get("hr"))
    if r:
        ans["rate"] = [r]
    if "rhythm" in t and rhythm_ok:
        ans["rhythm"] = t["rhythm"]
    if "p" in t:
        ans["p"] = t["p"]
    measured_pr = pr_answer(m.get("pr"))
    if "pr" in t and set(t["pr"]) & {"na", "progressive", "variable"}:
        ans["pr"] = t["pr"]
    elif measured_pr and ("pr" not in t or measured_pr in t["pr"]):
        ans["pr"] = [measured_pr]
    q = qrs_answer(m.get("qrs"))
    if q and ("qrs" not in t or q in t["qrs"]):
        ans["qrs"] = [q]
    elif "qrs" in t and m.get("qrs") is None:
        ans["qrs"] = t["qrs"]

    if twelve:
        a = axis_answer(m.get("axis"))
        if a and ("axis" not in t or a in t["axis"]):
            ans["axis"] = [a]
        if "st" in t:
            ans["st"] = t["st"]
        elif m.get("stt") is False:
            ans["st"] = ["normal"]
        narrow = ans.get("qrs") == ["narrow"]
        hr = m.get("hr")
        if dx not in NO_QT and narrow and hr is not None and hr <= 100:
            qt = qt_answer(m.get("qtc"))
            if qt and ("qt" not in t or qt in t["qt"]):
                ans["qt"] = [qt]
    return ans


def facts(m):
    f = {}
    for k in ("hr", "pr", "qrs", "axis", "qtc", "qt", "atrial"):
        v = m.get(k)
        if v is not None and not np.isnan(v):
            f[k] = int(round(v))
    return f


# --- PTB-XL -------------------------------------------------------------------

RHYTHMS = {"SR", "SBRAD", "STACH", "SARRH", "AFIB", "AFLT", "SVTAC", "PSVT", "SVARR", "PACE", "BIGU", "TRIGU"}
MAJOR = {"AFIB", "AFLT", "SVTAC", "PSVT", "PVC", "PAC", "BIGU", "TRIGU", "PRC(S)", "SVARR", "1AVB", "2AVB", "3AVB",
         "CLBBB", "CRBBB", "LAFB", "LPFB", "IVCD", "ILBBB", "WPW", "LVH", "VCLVH", "RVH", "SEHYP", "IMI", "AMI", "ASMI",
         "ALMI", "LMI", "ILMI", "PMI", "IPMI", "IPLMI", "INJAS", "INJAL", "INJIN", "INJLA", "INJIL", "LNGQT", "EL",
         "PACE", "ANEUR", "DIG", "LVOLT"}
INF_MI, ANT_MI, LAT_MI, POST_MI = {"IMI", "ILMI", "IPMI", "IPLMI"}, {"AMI", "ASMI", "ALMI"}, {"LMI", "ALMI", "ILMI"}, {"PMI", "IPMI", "IPLMI"}


def only(codes, allowed):
    """No major statement outside `allowed`."""
    return not ((codes & MAJOR) - set(allowed))


def ptbxl_rules():
    """dx → predicate(codes, meas, row). `meas` is the 12SL row."""

    def st(meas, leads, at_least, n=2):
        return sum(meas[f"ST_Amp_{l}"] >= at_least for l in leads) >= n

    def acute(row):
        return ("Stadium I" in (str(row.infarction_stadium1), str(row.infarction_stadium2))
                or "Stadium I-II" in (str(row.infarction_stadium1), str(row.infarction_stadium2))
                or bool(re.search(r"akut|acute|evolving", str(row.report))))

    no_bbb = lambda c: not (c & {"CLBBB", "CRBBB", "WPW", "PACE", "ILBBB", "IVCD"})
    return {
        "nsr": lambda c, m, r: c.get("NORM", 0) >= 100 and "SR" in c and only(set(c), []) and 64 <= m.HR_Ventr_Global <= 96
        and not (set(c) & STT_CODES),
        "sinus_brady": lambda c, m, r: "SBRAD" in c and only(set(c), []) and m.HR_Ventr_Global <= 54 and m.QRS_Dur_Global <= 108,
        "sinus_tachy": lambda c, m, r: "STACH" in c and only(set(c), []) and m.HR_Ventr_Global >= 106 and m.QRS_Dur_Global <= 108,
        "sinus_arrhythmia": lambda c, m, r: "SARRH" in c and only(set(c), []) and 62 <= m.HR_Ventr_Global <= 98,
        "pac": lambda c, m, r: "PAC" in c and set(c) & {"SR", "SBRAD", "STACH"} and only(set(c), ["PAC", "BIGU", "TRIGU", "PRC(S)", "SVARR"])
        and m.QRS_Dur_Global <= 108,
        "af": lambda c, m, r: "AFIB" in c and only(set(c), ["AFIB"]) and m.QRS_Dur_Global <= 108,
        "aflutter": lambda c, m, r: "AFLT" in c and only(set(c), ["AFLT"]) and m.QRS_Dur_Global <= 108,
        "svt": lambda c, m, r: set(c) & {"PSVT", "SVTAC"} and only(set(c), ["PSVT", "SVTAC", "SVARR"]) and m.HR_Ventr_Global >= 130
        and m.QRS_Dur_Global <= 108,
        "pvc": lambda c, m, r: "PVC" in c and set(c) & {"SR", "SBRAD", "STACH"} and only(set(c), ["PVC", "BIGU", "TRIGU", "PRC(S)"])
        and m.QRS_Dur_Global <= 108,
        "avb1": lambda c, m, r: "1AVB" in c and "SR" in c and only(set(c), ["1AVB"]) and m.PR_Int_Global >= 220 and m.QRS_Dur_Global <= 108,
        "avb3": lambda c, m, r: "3AVB" in c and not (set(c) & {"PACE", "AFIB", "AFLT", "WPW"}),
        "lbbb": lambda c, m, r: "CLBBB" in c and "SR" in c and only(set(c), ["CLBBB", "1AVB", "LVH", "VCLVH"]) and m.QRS_Dur_Global >= 130,
        "rbbb": lambda c, m, r: "CRBBB" in c and "SR" in c and only(set(c), ["CRBBB"]) and m.QRS_Dur_Global >= 125,
        "lafb": lambda c, m, r: "LAFB" in c and "SR" in c and only(set(c), ["LAFB"]) and m.QRS_Dur_Global <= 112
        and m.R_AxisFrontal_Global <= -45,
        "wpw": lambda c, m, r: "WPW" in c and "SR" in c and only(set(c), ["WPW"]),
        "lvh": lambda c, m, r: c.get("LVH", 0) >= 100 and "SR" in c and only(set(c), ["LVH", "VCLVH"]) and m.QRS_Dur_Global <= 115,
        "rvh": lambda c, m, r: "RVH" in c and only(set(c), ["RVH"]) and m.QRS_Dur_Global <= 115,
        "stemi_inf": lambda c, m, r: set(c) & INF_MI and acute(r) and no_bbb(set(c)) and st(m, ["II", "III", "aVF"], 0.1)
        and not st(m, ["V1", "V2", "V3", "V4"], 0.15),
        "stemi_ant": lambda c, m, r: set(c) & ANT_MI and acute(r) and no_bbb(set(c)) and st(m, ["V1", "V2", "V3", "V4"], 0.15)
        and not st(m, ["II", "III", "aVF"], 0.1),
        "stemi_lat": lambda c, m, r: set(c) & LAT_MI and acute(r) and no_bbb(set(c)) and st(m, ["I", "aVL", "V5", "V6"], 0.1)
        and not st(m, ["II", "III", "aVF"], 0.1) and not st(m, ["V1", "V2", "V3"], 0.15),
        "stemi_post": lambda c, m, r: set(c) & POST_MI and acute(r) and no_bbb(set(c))
        and sum(m[f"ST_Amp_{l}"] <= -0.1 for l in ["V1", "V2", "V3"]) >= 2,
        "long_qt": lambda c, m, r: "LNGQT" in c and "SR" in c and only(set(c), ["LNGQT"]) and m.QRS_Dur_Global <= 108
        and m.QT_IntCorr_Global >= 480 and 50 <= m.HR_Ventr_Global <= 100,
    }


def ptbxl_cases(rng):
    db = pd.read_csv(DATA / "ptbxl/ptbxl_database.csv", index_col="ecg_id")
    cols = ["ecg_id", "HR_Ventr_Global", "HR_Atrial_Global", "PR_Int_Global", "QRS_Dur_Global", "R_AxisFrontal_Global",
            "QT_Int_Global", "QT_IntCorr_Global"] + [f"ST_Amp_{l}" for l in ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]]
    feats = pd.read_csv(DATA / "ptbxl/12sl_features.csv", usecols=cols, index_col="ecg_id")
    db = db.join(feats, how="inner")
    db["codes"] = db.scp_codes.apply(ast.literal_eval)
    noisy = db[["static_noise", "burst_noise", "electrodes_problems"]].notna().any(axis=1)

    out = []
    for dx, rule in ptbxl_rules().items():
        hits = [i for i, r in db.iterrows() if rule(r.codes, r, r)]
        clean_hits = [i for i in hits if not noisy[i]]
        validated = [i for i in clean_hits if db.at[i, "validated_by_human"]]
        pool = validated if len(validated) >= PER_DX else clean_hits if len(clean_hits) >= 3 else hits
        rng.shuffle(pool)
        # One recording per patient.
        seen, chosen = set(), []
        for i in pool:
            if db.at[i, "patient_id"] in seen:
                continue
            seen.add(db.at[i, "patient_id"])
            chosen.append(i)
        print(f"ptbxl {dx}: {len(hits)} match, {len(clean_hits)} clean, {len(validated)} validated")
        made = 0
        for i in chosen:
            if made >= PER_DX:
                break
            case = ptbxl_case(dx, i, db.loc[i])
            if case:
                out.append(case)
                made += 1
        print(f"  -> {made} cases")
    return out


def ptbxl_case(dx, ecg_id, r):
    rec = read_record(f"ptb-xl/1.0.3/{r.filename_hr}")
    names = rec.sig_name
    x = clean(rec.p_signal, rec.fs, 50)
    stats = rr_stats(r_peaks(x[:, names.index("II")], rec.fs))
    if stats is None:
        return None
    # The 10 s actually shown must show what the label says.
    if dx in ("pac", "pvc") and not stats["premature"]:
        return None
    if dx == "sinus_arrhythmia" and stats["cv"] < 0.08:
        return None
    if dx == "af" and stats["cv"] < 0.08:
        return None
    regular_claim = TRUTH[dx].get("rhythm") == "regular"
    m = {
        "hr": r.HR_Ventr_Global,
        "pr": r.PR_Int_Global if TRUTH[dx].get("pr") not in ("na",) else None,
        "qrs": r.QRS_Dur_Global,
        "axis": r.R_AxisFrontal_Global,
        "qtc": r.QT_IntCorr_Global,
        "qt": r.QT_Int_Global,
        "stt": bool(set(r.codes) & STT_CODES),
    }
    if TRUTH[dx].get("p") in ("more", "flutter"):
        m["atrial"] = r.HR_Atrial_Global
    if dx == "aflutter":
        m["pr"] = None
    ans = build_answers(dx, True, m, rhythm_ok=not regular_claim or stats["cv"] < 0.06)
    # Diagnoses that don't imply a rhythm (BBB, LVH, STEMI…): take it from
    # PTB-XL's own rhythm statement when the strip agrees.
    sinus = set(r.codes) & {"SR", "SBRAD", "STACH"} and not set(r.codes) & {"PAC", "PVC", "BIGU", "TRIGU", "SVARR", "PRC(S)", "1AVB"}
    if sinus and "p" not in TRUTH[dx]:
        ans["p"] = ["normal"]
    if sinus and "rhythm" not in TRUTH[dx] and stats["cv"] < 0.06:
        ans["rhythm"] = ["regular"]
    order = ["rate", "rhythm", "p", "pr", "qrs", "axis", "st", "qt"]
    ans = {k: ans[k] for k in order if k in ans}
    if dx == "aflutter":
        ans["rhythm"] = ["regular"] if stats["cv"] < 0.05 else ["regIrreg", "irregIrreg"] if stats["cv"] > 0.1 else None
        if ans["rhythm"] is None:
            del ans["rhythm"]
    if dx in ("avb3",):
        q = qrs_answer(r.QRS_Dur_Global)
        if q == "wide":
            ans["st"] = ["secondary", "depression"]
    if dx == "avb1" and ans.get("pr") != ["long"]:
        return None
    if dx == "wpw" and ans.get("pr") != ["short"]:
        return None
    case_id = f"ptbxl-{ecg_id}"
    idx = [names.index(l) for l in STORED_12]
    meta = save(case_id, STORED_12, x[:, idx], rec.fs)
    return {
        "id": case_id,
        "dx": dx,
        "src": "ptbxl",
        "ref": int(ecg_id),
        "age": None if pd.isna(r.age) or r.age > 89 else int(r.age),
        "sex": "M" if r.sex == 0 else "F",
        **meta,
        "answers": ans,
        "facts": facts(m),
    }


# --- Shaoxing / Ningbo ----------------------------------------------------------

SX = {
    "mobitz1": "54016002",
    "mobitz2": "28189009",
    "svt": "233896004",  # AVNRT
    "avb3": "27885002",
}
# AF, flutter, AV blocks, WPW, ectopics, bundle branch blocks.
SX_CONFLICT = {"164889003", "164890007", "27885002", "195042002", "54016002", "28189009", "74390002", "17338001",
               "284470004", "164909002", "59118001"}


def sx_cases(rng):
    heads = sorted((DATA / "sx/hea").rglob("*.hea"))
    index = {}
    for h in heads:
        txt = h.read_text()
        dx = re.search(r"#Dx: ?(.*)", txt)
        age = re.search(r"#Age: ?(\d+)", txt)
        sex = re.search(r"#Sex: ?(\w+)", txt)
        index[h] = (set(dx.group(1).strip().split(",")) if dx else set(),
                    int(age.group(1)) if age else None, sex.group(1)[0] if sex else None)
    out = []
    for dx, code in SX.items():
        # The generic "2° AV block" code is fine next to its own subtype.
        conflict = SX_CONFLICT - {code} - ({"195042002"} if dx.startswith("mobitz") else set())
        hits = [h for h, (codes, _, _) in index.items() if code in codes and not (codes & conflict)]
        rng.shuffle(hits)
        print(f"sx {dx}: {len(hits)} match")
        made = 0
        for h in hits:
            if made >= PER_DX:
                break
            case = sx_case(dx, h, *index[h][1:])
            if case:
                out.append(case)
                made += 1
        print(f"  -> {made} cases")
    return out


def sx_case(dx, hea, age, sex):
    rel = hea.relative_to(DATA / "sx/hea").with_suffix("")
    base = f"ecg-arrhythmia/1.0.0/WFDBRecords/{rel}"
    try:
        rec = read_record(base)
    except Exception as e:
        print("  skip", rel, e)
        return None
    names = rec.sig_name
    if rec.p_signal is None or np.isnan(rec.p_signal).any() or np.abs(rec.p_signal).max() > 10:
        return None
    x = clean(rec.p_signal, rec.fs, 50)
    stats = rr_stats(r_peaks(x[:, names.index("II")], rec.fs))
    if stats is None:
        return None
    if dx in ("mobitz1", "mobitz2") and not stats["pause"]:
        return None
    if dx == "svt" and (stats["rate"] < 130 or stats["cv"] > 0.05):
        return None
    ans = build_answers(dx, True, {"hr": stats["rate"]})
    case_id = f"sx-{rel.name}"
    idx = [names.index(l) for l in STORED_12]
    meta = save(case_id, STORED_12, x[:, idx], rec.fs)
    return {
        "id": case_id,
        "dx": dx,
        "src": "sx",
        "ref": rel.name,
        "age": age if age is not None and age <= 89 else None,
        "sex": sex,
        **meta,
        "answers": ans,
        "facts": facts({"hr": stats["rate"]}),
    }


# --- MIT-BIH strips -------------------------------------------------------------

# (database, rhythm annotation) per diagnosis; windows lie wholly inside one
# annotated episode.
STRIPS = {
    "vt": [("vfdb", "(VT"), ("mitdb", "(VT")],
    "vf": [("vfdb", "(VF"), ("vfdb", "(VFIB")],
    "junctional": [("vfdb", "(NOD"), ("mitdb", "(NOD")],
}
WINDOW = 10
PER_RECORD = 3


def mit_path(db, rec):
    return str(CACHE / f"{db}/1.0.0/{rec}")


def episodes(db, rec):
    a = wfdb.rdann(mit_path(db, rec), "atr")
    h = wfdb.rdheader(mit_path(db, rec))
    out, cur, start = [], None, None
    for s, note in zip(a.sample, a.aux_note):
        note = note.strip("\x00").strip()
        if note.startswith("("):
            if cur:
                out.append((cur, start / h.fs, s / h.fs))
            cur, start = note, s
    if cur:
        out.append((cur, start / h.fs, h.sig_len / h.fs))
    return out


def strip_cases(rng):
    out = []
    for dx, sources in STRIPS.items():
        windows = []
        for db, label in sources:
            for rec in wfdb.get_record_list(db):
                fetch(f"{db}/1.0.0/{rec}.hea")
                fetch(f"{db}/1.0.0/{rec}.atr")
                eps = [(s, e) for k, s, e in episodes(db, rec) if k == label and e - s >= WINDOW + 1]
                starts = []
                for s, e in eps:
                    t = s + 0.5
                    while t + WINDOW <= e - 0.5:
                        starts.append(t)
                        t += WINDOW + 5
                rng.shuffle(starts)
                windows += [(db, rec, t) for t in sorted(starts[:PER_RECORD])]
        rng.shuffle(windows)
        print(f"strip {dx}: {len(windows)} windows")
        made = 0
        for db, rec, t in windows:
            if made >= PER_DX:
                break
            case = strip_case(dx, db, rec, t)
            if case:
                out.append(case)
                made += 1
        print(f"  -> {made} cases")
    return out


def strip_case(dx, db, rec, t0):
    h = wfdb.rdheader(mit_path(db, rec))
    fetch(f"{db}/1.0.0/{h.file_name[0]}")
    fs = h.fs
    # A couple of seconds either side so the filters settle, then trim.
    a = int(t0 * fs)
    lo, hi = max(0, a - int(2 * fs)), min(h.sig_len, a + int((WINDOW + 2) * fs))
    sig = wfdb.rdrecord(mit_path(db, rec), sampfrom=lo, sampto=hi).p_signal
    if np.isnan(sig).any():
        return None
    x = clean(sig, fs, 60)[a - lo: a - lo + int(WINDOW * fs)]
    if np.abs(x).max() > 8:
        return None
    # Too small to read on the paper.
    if typical_p2p(x[:, 0], fs) < (0.3 if dx == "vf" else 0.5):
        return None
    names = ["ECG 1", "ECG 2"] if db == "vfdb" else [n.replace("MLII", "II") for n in h.sig_name]
    m = {}
    if dx != "vf":
        stats = rr_stats(r_peaks(x[:, 0], fs))
        if stats is None or stats["cv"] > 0.08:
            return None
        # The QRS detector can count every other complex of a fast, sinusoidal
        # VT; only trust its rate when the strip's own periodicity agrees.
        ac = periodic_rate(x[:, 0], fs)
        if ac is None or abs(stats["rate"] - ac) > 0.12 * ac:
            return None
        m["hr"] = stats["rate"]
    ans = build_answers(dx, False, m)
    case_id = f"{db}-{rec}-{int(t0)}"
    meta = save(case_id, names, x, fs)
    return {"id": case_id, "dx": dx, "src": db, "ref": rec, "age": None, "sex": None, **meta, "answers": ans, "facts": facts(m)}


def main():
    OUT.mkdir(exist_ok=True)
    for f in OUT.glob("*.bin"):
        f.unlink()
    rng = random.Random(SEED)
    cases = ptbxl_cases(rng) + sx_cases(rng) + strip_cases(rng)
    # Too few real examples to practise on: leave the diagnosis out.
    per = {}
    for c in cases:
        per[c["dx"]] = per.get(c["dx"], 0) + 1
    for dx, n in per.items():
        if n < 3:
            print(f"dropping {dx}: only {n}")
    cases = [c for c in cases if per[c["dx"]] >= 3]
    for f in OUT.glob("*.bin"):
        if f.stem not in {c["id"] for c in cases}:
            f.unlink()
    cases.sort(key=lambda c: (c["dx"], c["id"]))
    (OUT / "index.json").write_text(json.dumps(cases, separators=(",", ":")))
    print(f"{len(cases)} cases")


if __name__ == "__main__":
    main()
