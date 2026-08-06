#!/usr/bin/env python3
"""Tầng máy của eval TTS: tổng hợp từng câu đề, phân tích tín hiệu, round-trip STT.

Chạy TRÊN ccoex:

    ~/devspace/mta-ai-intramind/.venv/bin/python run_tts_eval.py [--only T06,T24]

Mỗi câu ghi out/<id>/: tts.wav, roundtrip.txt, timing.json.
Tổng hợp: out/tts_results.json + bảng gate in ra màn hình.

Gate theo TTS_EVAL_PLAN §2. Round-trip similarity CHỈ để báo cáo — phán quyết
độ-đọc-đúng thuộc tầng agent (số về dạng chữ sẽ oan difflib).
"""

from __future__ import annotations

import argparse
import array
import difflib
import json
import math
import pathlib
import re
import sys
import time
import unicodedata
import wave

import httpx

SERVING = "http://localhost:15003/api/v1"
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "out"

# Gate (đồng bộ với TTS_EVAL_PLAN §2)
CPS_LO, CPS_HI = 8.0, 25.0
CLIP_MAX = 0.001
EDGE_SILENCE_MAX_S = 1.5
INTERNAL_SILENCE_MAX_S = 2.5
RMS_DBFS_LO, RMS_DBFS_HI = -35.0, -10.0
RMS_SPREAD_MAX_DB = 6.0
RTF_MAX = 0.30
SPEED_SLOW_LO, SPEED_SLOW_HI = 1.6, 2.4
SPEED_FAST_LO, SPEED_FAST_HI = 0.40, 0.65
STABILITY_MAX_DELTA = 0.10

FRAME_S = 0.02
SILENCE_DBFS = -45.0


def load_cases() -> list[dict]:
    cases = []
    for line in (HERE / "tts_cases.jsonl").read_text().splitlines():
        if not line.strip():
            continue
        c = json.loads(line)
        if c.get("long_repeat_to_chars"):
            n = c["long_repeat_to_chars"]
            c["text"] = (c["text"] * (n // len(c["text"]) + 1))[:n]
        cases.append(c)
    return cases


def synth(client: httpx.Client, case: dict, dest: pathlib.Path) -> dict:
    """Một lần gọi TTS; trả timing + status (không raise để edge-case tự chấm)."""
    payload = {"text": case["text"], "language": case["language"]}
    if case.get("speed"):
        payload["speed"] = case["speed"]
    t0 = time.monotonic()
    r = client.post(f"{SERVING}/tts", json=payload, timeout=600)
    wall = time.monotonic() - t0
    info = {"status": r.status_code, "wall_s": round(wall, 3),
            "reported_ms": r.headers.get("x-audio-duration-ms")}
    if r.status_code == 200:
        dest.write_bytes(r.content)
    return info


def analyze_wav(path: pathlib.Path) -> dict:
    """Duration, clipping, câm lặng đầu/cuối/giữa, RMS dBFS — stdlib thuần."""
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2:
            return {"error": f"sampwidth={w.getsampwidth()} (chỉ hỗ trợ 16-bit)"}
        rate, n = w.getframerate(), w.getnframes()
        samples = array.array("h")
        samples.frombytes(w.readframes(n))
        if w.getnchannels() == 2:
            samples = samples[::2]

    dur = len(samples) / rate
    if not len(samples):
        return {"error": "audio rỗng"}

    clip = sum(1 for s in samples if abs(s) >= 32700) / len(samples)
    rms = math.sqrt(sum(s * s for s in samples) / len(samples))
    dbfs = 20 * math.log10(max(rms, 1e-9) / 32768)

    # RMS theo khung 20ms → khoảng câm lặng
    step = max(int(rate * FRAME_S), 1)
    quiet = []
    for i in range(0, len(samples) - step, step):
        seg = samples[i:i + step]
        frms = math.sqrt(sum(s * s for s in seg) / len(seg))
        quiet.append(20 * math.log10(max(frms, 1e-9) / 32768) < SILENCE_DBFS)

    lead = trail = 0
    for q in quiet:
        if not q:
            break
        lead += 1
    for q in reversed(quiet):
        if not q:
            break
        trail += 1
    inner, run, mx = quiet[lead:len(quiet) - trail or None], 0, 0
    for q in inner:
        run = run + 1 if q else 0
        mx = max(mx, run)

    return {
        "duration_s": round(dur, 2), "clip_frac": round(clip, 5),
        "rms_dbfs": round(dbfs, 1),
        "lead_silence_s": round(lead * FRAME_S, 2),
        "trail_silence_s": round(trail * FRAME_S, 2),
        "max_internal_silence_s": round(mx * FRAME_S, 2),
    }


def stt(client: httpx.Client, path: pathlib.Path, language: str) -> str:
    with path.open("rb") as f:
        r = client.post(f"{SERVING}/stt",
                        files={"file": ("tts.wav", f, "audio/wav")},
                        data={"language": language}, timeout=300)
    r.raise_for_status()
    return r.json().get("text", "")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s.lower())
    return re.sub(r"\s+", " ", re.sub(r"[^\w\sà-ỹ]", " ", s)).strip()


def run_case(client: httpx.Client, case: dict) -> dict:
    cid = case["id"]
    d = OUT / cid
    d.mkdir(parents=True, exist_ok=True)
    res: dict = {"case": cid, "group": case["group"], "checks": {}, "failed": []}

    runs = []
    for i in range(case.get("runs", 1)):
        wav = d / (f"tts_run{i}.wav" if i else "tts.wav")
        info = synth(client, case, wav)
        if info["status"] != 200:
            # Edge được phép 4xx sạch; 5xx là fail ở mọi nhóm.
            res["checks"]["http"] = {"status": info["status"],
                                     "ok": case["group"] == "edge" and info["status"] < 500}
            (d / "timing.json").write_text(json.dumps(info))
            if not res["checks"]["http"]["ok"]:
                res["failed"].append("http")
            return res
        a = analyze_wav(wav)
        if "error" in a:
            res["checks"]["wav_valid"] = {"ok": False, **a}
            res["failed"].append("wav_valid")
            return res
        runs.append({**info, **a})
    (d / "timing.json").write_text(json.dumps(runs, indent=2))
    a = runs[0]

    def chk(name: str, ok: bool, **extra) -> None:
        res["checks"][name] = {"ok": ok, **extra}
        if not ok:
            res["failed"].append(name)

    chk("wav_valid", True, duration_s=a["duration_s"])

    cps = len(case["text"]) / a["duration_s"]
    if case["group"] in ("base", "num", "abbr", "name") and not case.get("speed"):
        chk("cps", CPS_LO <= cps <= CPS_HI, value=round(cps, 1))
    chk("clipping", a["clip_frac"] < CLIP_MAX, value=a["clip_frac"])
    chk("edge_silence",
        a["lead_silence_s"] < EDGE_SILENCE_MAX_S and a["trail_silence_s"] < EDGE_SILENCE_MAX_S,
        lead=a["lead_silence_s"], trail=a["trail_silence_s"])
    chk("internal_silence", a["max_internal_silence_s"] < INTERNAL_SILENCE_MAX_S,
        value=a["max_internal_silence_s"])
    chk("loudness", RMS_DBFS_LO <= a["rms_dbfs"] <= RMS_DBFS_HI, value=a["rms_dbfs"])
    chk("rtf", a["wall_s"] / a["duration_s"] <= RTF_MAX,
        value=round(a["wall_s"] / a["duration_s"], 3))

    if case.get("runs", 1) > 1:
        d0, d1 = runs[0]["duration_s"], runs[1]["duration_s"]
        chk("stability", abs(d0 - d1) / d0 <= STABILITY_MAX_DELTA, run0=d0, run1=d1)

    # Round-trip: báo cáo, không gate (trừ khi rơi tự do <0.3 ở nhóm base)
    try:
        text = stt(client, d / "tts.wav", case["language"])
        (d / "roundtrip.txt").write_text(text)
        sim = difflib.SequenceMatcher(None, norm(case["text"]), norm(text)).ratio()
        res["checks"]["roundtrip"] = {"ok": None, "similarity": round(sim, 3)}
        if case["group"] == "base" and sim < 0.3:
            chk("roundtrip_floor", False, similarity=round(sim, 3))
    except Exception as exc:
        (d / "roundtrip.txt").write_text(f"(LỖI STT: {exc})")
        res["checks"]["roundtrip"] = {"ok": None, "error": str(exc)}

    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    args = ap.parse_args()
    wanted = set(args.only.split(",")) if args.only else None

    results: dict[str, dict] = {}
    with httpx.Client() as client:
        client.get(f"{SERVING}/voices", timeout=10).raise_for_status()
        for case in load_cases():
            if wanted and case["id"] not in wanted:
                continue
            try:
                results[case["id"]] = run_case(client, case)
            except Exception as exc:
                results[case["id"]] = {"case": case["id"], "group": case["group"],
                                       "checks": {}, "failed": [f"exception: {exc}"]}
            r = results[case["id"]]
            print(f"{case['id']:5} {case['group']:10} "
                  f"{'✓' if not r['failed'] else '✗ ' + ','.join(map(str, r['failed']))}",
                  flush=True)

    # Gate chéo nhóm speed (so sánh giữa các case)
    if {"T25", "T26", "T27"} <= results.keys():
        base_d = results["T25"]["checks"].get("wav_valid", {}).get("duration_s")
        for cid, lo, hi, key in (("T26", SPEED_SLOW_LO, SPEED_SLOW_HI, "speed_slow"),
                                 ("T27", SPEED_FAST_LO, SPEED_FAST_HI, "speed_fast")):
            d = results[cid]["checks"].get("wav_valid", {}).get("duration_s")
            if base_d and d:
                ratio = d / base_d
                ok = lo <= ratio <= hi
                results[cid]["checks"][key] = {"ok": ok, "ratio": round(ratio, 2)}
                if not ok:
                    results[cid]["failed"].append(key)

    # Độ lệch âm lượng giữa các câu base
    base_rms = [r["checks"]["loudness"]["value"] for r in results.values()
                if r["group"] == "base" and "loudness" in r["checks"]]
    if len(base_rms) >= 2:
        mean = sum(base_rms) / len(base_rms)
        spread = math.sqrt(sum((x - mean) ** 2 for x in base_rms) / len(base_rms))
        print(f"\nĐộ lệch âm lượng nhóm base: {spread:.1f} dB "
              f"({'✓' if spread < RMS_SPREAD_MAX_DB else '✗ gate ' + str(RMS_SPREAD_MAX_DB)})")

    OUT.mkdir(exist_ok=True)
    (OUT / "tts_results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2))
    n_fail = sum(1 for r in results.values() if r["failed"])
    print(f"\n{len(results) - n_fail}/{len(results)} câu qua tầng máy "
          f"→ tầng agent chấm độ-đọc-đúng trên out/*/roundtrip.txt")
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
