#!/usr/bin/env python3
"""Tầng 1 của eval: số đo khách quan trên output đã sinh — stdlib thuần.

    python3 objective_metrics.py          # đo mọi case có out/<id>/transcript.json
    python3 objective_metrics.py EV06     # đo một case

Ghi out/metrics.json + in bảng. Gate theo EVAL_PLAN §2. Case đỏ tầng này thì
KHÔNG cần tốn hội đồng judge — fix backend trước.
"""

from __future__ import annotations

import difflib
import json
import pathlib
import re
import sys
import unicodedata

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "out"

# PHẢI khớp AUDIO_OVERVIEW_WPM của service (fix 2026-08-07: 150→240 vì Piper
# đọc ~240-250 wpm — script dài theo 240 nên thước đo cũng phải 240).
WPM = {"vi": 240, "en": 240}
# EV10 là bẫy nguồn-quá-ngắn: tập NGẮN hơn yêu cầu là hành vi ĐÚNG, miễn gate dưới.
BUDGET_LO, BUDGET_HI = 0.75, 1.30
DURATION_LO, DURATION_HI = 0.60, 1.40
FOREIGN_MAX = 0.05
ROUNDTRIP_MIN = 0.75

VN_DIACRITIC = re.compile(r"[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s.lower())
    return re.sub(r"\s+", " ", re.sub(r"[^\w\sà-ỹ]", " ", s)).strip()


def words(s: str) -> list[str]:
    return norm(s).split()


def numbers_of(s: str) -> set[str]:
    """Tập con số đã chuẩn hoá ('1.250'→'1250', '98,4'→'98.4') để so bịa số."""
    out = set()
    for m in re.findall(r"\d[\d.,]*", s):
        m = m.rstrip(".,")
        if "," in m and "." in m:
            m = m.replace(".", "").replace(",", ".")
        elif "," in m:
            m = m.replace(",", ".") if len(m.split(",")[-1]) < 3 else m.replace(",", "")
        elif "." in m and len(m.split(".")[-1]) == 3:
            m = m.replace(".", "")
        out.add(m)
        # '4.2 tỷ' đọc thành '4 tỷ 2' vẫn không bị oan: nhận cả phần nguyên.
        if "." in m:
            out.add(m.split(".")[0])
    return out


def load_cases() -> dict[str, dict]:
    cases = {}
    for line in (HERE / "cases.jsonl").read_text().splitlines():
        if line.strip():
            c = json.loads(line)
            cases[c["id"]] = c
    for c in cases.values():
        if "text_ref" in c:
            c["text"] = cases[c["text_ref"]]["text"]
    return cases


def eval_case(cid: str, case: dict) -> dict | None:
    d = OUT / cid
    tpath = d / "transcript.json"
    if not tpath.exists():
        return None
    transcript = json.loads(tpath.read_text())
    status = json.loads((d / "status_final.json").read_text())
    lang = case["language"]
    minutes = case["target_minutes"]
    full_text = " ".join(t.get("text", "") for t in transcript)

    checks: dict[str, dict] = {}

    # ── Ngân sách từ ────────────────────────────────────────────────
    n_words = len(words(full_text))
    ratio = n_words / (WPM[lang] * minutes)
    checks["word_budget"] = {
        "value": round(ratio, 2), "words": n_words,
        "ok": BUDGET_LO <= ratio <= BUDGET_HI or (cid == "EV10" and ratio <= BUDGET_HI),
    }

    # ── Thời lượng audio ────────────────────────────────────────────
    dur = float(status.get("duration_sec") or 0)
    dratio = dur / (minutes * 60)
    checks["duration"] = {
        "value": round(dratio, 2), "sec": dur,
        "ok": DURATION_LO <= dratio <= DURATION_HI or (cid == "EV10" and dratio <= DURATION_HI),
    }

    # ── Cấu trúc thoại ──────────────────────────────────────────────
    speakers = [t.get("speaker") for t in transcript]
    max_run = mx = 1
    for a, b in zip(speakers, speakers[1:]):
        mx = mx + 1 if a == b else 1
        max_run = max(max_run, mx)
    checks["dialogue_structure"] = {
        "turns": len(transcript), "speakers": sorted(set(speakers)),
        "max_monologue_run": max_run,
        "ok": len(set(speakers)) >= 2 and len(transcript) >= 4 and max_run <= 3,
    }

    # ── Thuần ngữ ───────────────────────────────────────────────────
    ws = words(full_text)
    if lang == "vi":
        # vi: từ "ngoại lai" = không dấu VN và không phải số/từ vi không dấu phổ biến
        common_vi = {"la", "va", "cua", "cho", "khong", "trong", "den", "ve", "nay",
                     "theo", "voi", "tren", "sau", "hai", "ba", "nam", "muoi", "mot"}
        foreign = [w for w in ws
                   if w.isalpha() and not VN_DIACRITIC.search(w)
                   and len(w) > 3 and w not in common_vi]
    else:
        foreign = [w for w in ws if VN_DIACRITIC.search(w)]
    frac = len(foreign) / max(len(ws), 1)
    # Report-only (ok=None): tiếng Việt có RẤT nhiều âm tiết không dấu hợp lệ
    # ("nghe", "giai", "chia", "khai"…) nên heuristic dấu-câu đếm oan — lần chạy
    # 2026-08-07 flag toàn từ Việt thật. Thuần ngữ là việc của judge hội thoại.
    checks["language_purity"] = {
        "value": round(frac, 3), "sample": foreign[:8], "ok": None,
    }

    # ── Số liệu không bịa (case nào cũng đo; EV06/EV08 là gate cứng) ─
    if case.get("text"):
        src_nums = numbers_of(case["text"])
        # Phép suy trực tiếp từ 2 số nguồn (hiệu/tổng) là hợp lệ theo luật
        # fidelity — và máy kiểm được: vòng 1 verifier phải ra tay minh oan
        # "70" (=1320−1250); giờ thước tự biết.
        derived = set()
        vals = []
        for s in src_nums:
            try:
                vals.append(float(s))
            except ValueError:
                pass
        for i, a in enumerate(vals):
            for b in vals[i + 1:]:
                for v in (abs(a - b), a + b):
                    derived.add(f"{v:g}")
        tr_nums = numbers_of(full_text)
        invented = sorted(tr_nums - src_nums - derived)
        strict = cid in ("EV06", "EV08")
        checks["numbers"] = {
            "invented": invented, "strict": strict,
            "ok": not invented if strict else len(invented) <= 2,
        }

    # ── EV08: phải nêu CẢ HAI con số lệch nhau ──────────────────────
    if cid == "EV08":
        tr_nums = numbers_of(full_text)
        checks["both_sources_cited"] = {
            "has_1250": "1250" in tr_nums, "has_1320": "1320" in tr_nums,
            "ok": {"1250", "1320"} <= tr_nums,
        }

    # ── TTS round-trip ──────────────────────────────────────────────
    rt = d / "stt_roundtrip.txt"
    if rt.exists() and not rt.read_text().startswith("("):
        stt_text = rt.read_text()
        # So với đúng phần transcript tương ứng 120s đầu (xấp xỉ theo tỉ lệ)
        take = len(norm(full_text)) if dur <= 120 else int(len(norm(full_text)) * 120 / dur)
        sim = difflib.SequenceMatcher(
            None, norm(full_text)[:take], norm(stt_text)
        ).ratio()
        checks["tts_roundtrip"] = {"value": round(sim, 3), "ok": sim >= ROUNDTRIP_MIN}
    else:
        checks["tts_roundtrip"] = {"value": None, "ok": None, "note": "skip"}

    # ── QC nội bộ: ghi nhận, không gate ─────────────────────────────
    meta = status.get("metadata") or {}
    checks["qc_info"] = {
        "attempts": meta.get("attempts"), "notes": meta.get("notes"), "ok": True,
    }

    hard = [k for k, v in checks.items() if v["ok"] is False]
    return {"case": cid, "checks": checks, "failed": hard, "pass": not hard}


def main() -> int:
    cases = load_cases()
    only = set(sys.argv[1:]) or set(cases)
    results = {}
    for cid in sorted(only):
        r = eval_case(cid, cases[cid])
        if r:
            results[cid] = r

    (OUT / "metrics.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2)
    )

    print(f"{'case':6} {'pass':5} lỗi")
    for cid, r in results.items():
        print(f"{cid:6} {'✓' if r['pass'] else '✗':5} {', '.join(r['failed']) or '—'}")
    n_fail = sum(1 for r in results.values() if not r["pass"])
    print(f"\n{len(results) - n_fail}/{len(results)} case qua tầng khách quan")
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
