#!/usr/bin/env python3
"""Sinh 10 tập podcast eval qua AI :15001 và thu thập toàn bộ output.

Chạy TRÊN ccoex bằng venv của AI dev (có httpx):

    ~/devspace/mta-ai-intramind/.venv/bin/python run_generate.py [--only EV01,EV05]

Mỗi case ghi vào out/<id>/:
    submit.json       — payload gửi đi + task_id
    status_final.json — body poll cuối (tập xong: KHÔNG có field `status`)
    transcript.json   — transcript[] tách riêng cho judge
    episode.wav|mp3   — audio tải về
    stt_roundtrip.txt — STT của 120s đầu (đo TTS nghe được)
    timeline.jsonl    — mọi lần poll (soi heartbeat/QC retry về sau)

Gọi THẲNG AI :15001, không qua gateway — eval đo chất lượng sinh, không đo proxy
(hợp đồng proxy đã có nhóm D lo). Nhờ vậy cũng miễn nhiễm bẫy zombie-check.

EV09 cần doc thật: --doc-ids <id1,id2> hoặc bỏ qua (báo SKIP, không fail cả bộ).
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import time

import httpx

AI = "http://localhost:15001/api/v1"
SERVING = "http://localhost:15003/api/v1"
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "out"
POLL_INTERVAL_S = 5
# Trần eval = trần client của FE (45'): quá là FAIL, đúng như người dùng sẽ thấy.
MAX_WAIT_S = 45 * 60
FFMPEG = pathlib.Path.home() / "devspace" / "bin" / "ffmpeg"


def load_cases() -> list[dict]:
    """Đọc cases.jsonl và giải các `text_ref` thành text thật."""
    cases = [
        json.loads(line)
        for line in (HERE / "cases.jsonl").read_text().splitlines()
        if line.strip()
    ]
    by_id = {c["id"]: c for c in cases}
    for c in cases:
        if "text_ref" in c:
            c["text"] = by_id[c["text_ref"]]["text"]
    return cases


def submit(client: httpx.Client, case: dict, doc_ids: list[str]) -> str:
    payload: dict = {
        "language": case["language"],
        "target_minutes": case["target_minutes"],
    }
    if case.get("focus"):
        payload["focus"] = case["focus"]
    if case.get("document_ids") == "RUNTIME":
        payload["document_ids"] = doc_ids
    else:
        payload["text"] = case["text"]

    r = client.post(f"{AI}/tools/audio-overview", json=payload, timeout=60)
    r.raise_for_status()
    task_id = r.json()["task_id"]

    d = OUT / case["id"]
    d.mkdir(parents=True, exist_ok=True)
    (d / "submit.json").write_text(
        json.dumps({"payload": payload, "task_id": task_id}, ensure_ascii=False, indent=2)
    )
    return task_id


def poll(client: httpx.Client, case_id: str, task_id: str) -> dict:
    """Poll đến trạng thái cuối; ghi mọi tick vào timeline.jsonl."""
    d = OUT / case_id
    deadline = time.monotonic() + MAX_WAIT_S
    with (d / "timeline.jsonl").open("w") as timeline:
        while time.monotonic() < deadline:
            r = client.get(
                f"{AI}/tools/audio-overview/status/{task_id}", timeout=30
            )
            body = r.json()
            timeline.write(json.dumps({"t": time.time(), "body": body}, ensure_ascii=False) + "\n")
            timeline.flush()

            status = str(body.get("status", "")).lower()
            if status in ("failure", "failed", "error", "cancelled"):
                return body
            # Tập xong không có field `status` — nhận diện bằng object_key.
            if body.get("object_key"):
                return body
            time.sleep(POLL_INTERVAL_S)
    return {"eval_error": f"timeout sau {MAX_WAIT_S}s"}


def fetch_audio(client: httpx.Client, case_id: str, task_id: str, fmt: str) -> pathlib.Path:
    d = OUT / case_id
    path = d / f"episode.{fmt or 'wav'}"
    with client.stream(
        "GET", f"{AI}/tools/audio-overview/{task_id}/file", timeout=300
    ) as r:
        r.raise_for_status()
        with path.open("wb") as f:
            for chunk in r.iter_bytes(65536):
                f.write(chunk)
    return path


def stt_roundtrip(client: httpx.Client, case_id: str, audio: pathlib.Path, language: str) -> None:
    """Cắt 120s đầu → 16k mono WAV → STT serving. Đo 'TTS có nghe được không'."""
    d = OUT / case_id
    clip = d / "clip120.wav"
    if not FFMPEG.exists():
        (d / "stt_roundtrip.txt").write_text("(SKIP: không có ffmpeg static)")
        return
    subprocess.run(
        [str(FFMPEG), "-y", "-i", str(audio), "-t", "120",
         "-ac", "1", "-ar", "16000", "-loglevel", "error", str(clip)],
        check=True,
    )
    with clip.open("rb") as f:
        r = client.post(
            f"{SERVING}/stt",
            files={"file": ("clip120.wav", f, "audio/wav")},
            data={"language": language},
            timeout=180,
        )
    r.raise_for_status()
    (d / "stt_roundtrip.txt").write_text(r.json().get("text", ""))
    clip.unlink(missing_ok=True)


def run_case(client: httpx.Client, case: dict, doc_ids: list[str]) -> str:
    cid = case["id"]
    if case.get("document_ids") == "RUNTIME" and not doc_ids:
        return "SKIP (chưa có --doc-ids)"

    task_id = submit(client, case, doc_ids)
    final = poll(client, cid, task_id)
    d = OUT / cid
    (d / "status_final.json").write_text(
        json.dumps(final, ensure_ascii=False, indent=2)
    )

    if not final.get("object_key"):
        return f"FAIL ({final.get('status') or final.get('eval_error')})"

    (d / "transcript.json").write_text(
        json.dumps(final.get("transcript", []), ensure_ascii=False, indent=2)
    )
    audio = fetch_audio(client, cid, task_id, final.get("audio_format", "wav"))
    try:
        stt_roundtrip(client, cid, audio, case["language"])
    except Exception as exc:  # STT hỏng không làm mất tập đã sinh
        (d / "stt_roundtrip.txt").write_text(f"(LỖI STT: {exc})")
    return f"OK ({final.get('duration_sec', '?')}s, {len(final.get('transcript', []))} lượt)"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="EV01,EV05 — chỉ chạy các case này")
    ap.add_argument("--doc-ids", help="doc id corpus thật cho EV09, phân cách bằng dấu phẩy")
    args = ap.parse_args()

    wanted = set(args.only.split(",")) if args.only else None
    doc_ids = args.doc_ids.split(",") if args.doc_ids else []

    results: dict[str, str] = {}
    with httpx.Client() as client:
        # Sanity: AI phải sống và bật voice trước khi đốt 45' đầu tiên.
        health = client.get(f"{AI.rsplit('/api', 1)[0]}/health", timeout=10)
        health.raise_for_status()

        for case in load_cases():
            if wanted and case["id"] not in wanted:
                continue
            print(f"── {case['id']} ({case['trap'][:60]}…)", flush=True)
            try:
                results[case["id"]] = run_case(client, case, doc_ids)
            except Exception as exc:
                results[case["id"]] = f"FAIL (exception: {exc})"
            print(f"   → {results[case['id']]}", flush=True)

    (OUT / "generate_summary.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2)
    )
    print("\n=== TÓM TẮT SINH TẬP ===")
    for cid, res in results.items():
        print(f"  {cid}: {res}")
    return 0 if all(r.startswith(("OK", "SKIP")) for r in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
