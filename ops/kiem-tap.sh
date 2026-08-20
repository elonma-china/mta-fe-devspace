#!/usr/bin/env bash
#
# kiem-tap.sh <task_id> — nghiệm thu MỘT tập Tổng quan âm thanh đã tạo xong.
#
# Vì sao cần: API báo "xong" chỉ có nghĩa là pipeline chạy hết, KHÔNG có nghĩa
# là tập nghe được. Bốn kiểu hỏng dưới đây đều trả về tệp bình thường:
#   * cả tập đọc bằng giọng dự phòng (giọng HQ 503)      -> nghe kém hẳn
#   * máy chủ thiếu ffmpeg, tập lưu WAV                   -> to gấp ~10, không tua
#   * thời lượng lệch xa mục tiêu (WPM sai hiệu chỉnh)    -> 30 phút ra 18 phút
#   * TTS nuốt/lặp chữ ở mối nối các lô                   -> mất câu giữa tập
# Ba cái đầu backend nay tự báo trong metadata.warnings; script này kiểm ĐỘC LẬP
# bằng chính tệp âm thanh, nên bắt được cả trường hợp backend báo sai.
#
# Cách dùng:
#   DEVSPACE_PASS=... bash ops/kiem-tap.sh <task_id>
#   FULL=1 ...            # thêm phép đo 4 (nghe lại 3 lát) — tốn ~1 phút
#
# Chạy TRÊN ccoex. Chỉ ĐỌC: tải tệp về /tmp, không đụng gì trên máy chủ.
set -u

TASK="${1:-}"
[ -n "$TASK" ] || { echo "dùng: kiem-tap.sh <task_id>"; exit 2; }

GW="${GW:-localhost:15050}"
AI="${AI:-localhost:15001}"
FF="${FF:-$HOME/devspace/bin/ffmpeg}"
FP="${FP:-$HOME/devspace/bin/ffprobe}"
FULL="${FULL:-0}"
D=$(mktemp -d /tmp/kiemtap.XXXX)
P=0; F=0; W=0
ok()   { P=$((P+1)); printf '  ✅ %s\n' "$*"; }
bad()  { F=$((F+1)); printf '  ❌ %s\n' "$*"; }
warn() { W=$((W+1)); printf '  ⚠  %s\n' "$*"; }

TOKEN=$(curl -s -m 15 -X POST "$GW/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"${DEVSPACE_USER:-admin}\",\"password\":\"${DEVSPACE_PASS:?đặt DEVSPACE_PASS}\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("access_token") or d.get("token") or "")')
[ -n "$TOKEN" ] || { echo "không đăng nhập được"; exit 1; }

echo "══ Tập $TASK"
curl -s -m 30 "$GW/tools/audio-overview/status/$TASK" -H "Authorization: Bearer $TOKEN" -o "$D/st.json"

python3 - "$D/st.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
m = d.get("metadata") or {}
print(f"  trạng thái   : {d.get('status') or ('xong (có object_key)' if d.get('object_key') else '?')}")
print(f"  thời lượng   : {d.get('duration_sec')}s | {d.get('size_bytes')} byte | {d.get('audio_format')}")
print(f"  yêu cầu      : {m.get('mode')} · {m.get('voice_gender')} · {m.get('tone_label')} · mục tiêu {m.get('target_minutes')} phút")
print(f"  lượt thoại   : {len(d.get('transcript') or [])} | xử lý {m.get('processing_seconds')}s")
PY

# ── 0. cảnh báo do CHÍNH backend báo ─────────────────────────────────
NW=$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(len(((d.get("metadata") or {}).get("warnings")) or []))' "$D/st.json")
if [ "$NW" = "0" ]; then
  ok "backend không báo cảnh báo nào"
else
  python3 -c 'import json,sys
for w in (json.load(open(sys.argv[1])).get("metadata") or {}).get("warnings") or []:
    print("  ⚠  backend báo:", w.get("message"))' "$D/st.json"
  W=$((W+NW))
fi

OBJ=$(python3 -c 'import json,sys;print((json.load(open(sys.argv[1])).get("object_key") or ""))' "$D/st.json")
[ -n "$OBJ" ] || { echo "  (tập chưa xong — chưa có object_key)"; exit 1; }

# ── 1. tải tệp về ────────────────────────────────────────────────────
CODE=$(curl -s -o "$D/ep.bin" -w '%{http_code}' -m 600 \
  "$GW/tools/audio-overview/$TASK/file" -H "Authorization: Bearer $TOKEN")
SIZE=$(stat -c%s "$D/ep.bin")
DECL=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("size_bytes") or 0)' "$D/st.json")
[ "$CODE" = 200 ] && ok "tải được tệp qua gateway ($SIZE byte)" || bad "tải tệp lỗi HTTP $CODE"
[ "$SIZE" = "$DECL" ] && ok "dung lượng khớp số API khai" || bad "dung lượng lệch: tải $SIZE / API khai $DECL"

FMT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("audio_format") or "")' "$D/st.json")
[ "$FMT" = mp3 ] && ok "định dạng mp3" || warn "định dạng $FMT — máy chủ thiếu ffmpeg, tệp to gấp ~10 và không tua được"

# ── 2. thời lượng thật vs mục tiêu ───────────────────────────────────
REAL=$("$FP" -v error -show_entries format=duration -of csv=p=0 "$D/ep.bin" | cut -d. -f1)
TGT=$(python3 -c 'import json,sys;print(((json.load(open(sys.argv[1])).get("metadata") or {}).get("target_minutes")) or 0)' "$D/st.json")
python3 - "$REAL" "$TGT" <<'PY'
import sys
real, tgt = int(sys.argv[1] or 0), int(sys.argv[2] or 0)
if not tgt:
    print("  ⚠  không có target_minutes để so"); raise SystemExit
drift = abs(real/60 - tgt) / tgt
mark = "✅" if drift <= 0.30 else "❌"
print(f"  {mark} thời lượng thật {real/60:.1f} phút / mục tiêu {tgt} phút (lệch {drift*100:.0f}%)")
PY

# ── 3. có tiếng thật không, có khoảng câm dài không ──────────────────
VOL=$("$FF" -hide_banner -i "$D/ep.bin" -af volumedetect -f null - 2>&1 | grep mean_volume | awk '{print $5}')
python3 -c 'import sys;v=float(sys.argv[1]);print(("  ✅ có tiếng thật (mean_volume %s dB)" % v) if v > -50 else ("  ❌ tệp gần như câm (mean_volume %s dB)" % v))' "${VOL:--99}"
SIL=$("$FF" -hide_banner -i "$D/ep.bin" -af silencedetect=n=-40dB:d=5 -f null - 2>&1 | grep -c silence_start)
[ "${SIL:-0}" -eq 0 ] && ok "không có khoảng câm nào dài quá 5 giây" || warn "$SIL khoảng câm dài hơn 5 giây — kiểm mối nối các lô"

# ── 4. GIỌNG có đúng không ───────────────────────────────────────────
# KHÔNG dùng mẹo phổ tần. Bản đầu của script này báo "tập đã tụt về giọng dự
# phòng" khi năng lượng trên 9 kHz thấp — SAI, đã đo trên ccoex 2026-08-20:
#   vi_male_hq -54,2 dB · vi_female_hq -46,5 dB · vi_male -57,1 dB · vi_female -48,9 dB
# Bốn giọng nằm cùng một khoảng, vì bộ resample lên 48 kHz KHÔNG có lọc chống
# răng cưa nên giọng Piper 16 kHz nâng mẫu cũng sinh năng lượng ở dải đó. Một
# phép đo kêu oan còn tệ hơn không đo.
#
# Đường đáng tin: cảnh báo `voice_downgraded` do chính pipeline ghi (mục 0), và
# dòng log của lượt hạ giọng. Cả hai đều nói CHẮC CHẮN, không suy đoán.
HI=$("$FF" -hide_banner -ss 30 -t 30 -i "$D/ep.bin" -af "highpass=f=9000,volumedetect" -f null - 2>&1 | grep mean_volume | awk '{print $5}')
ALL=$("$FF" -hide_banner -ss 30 -t 30 -i "$D/ep.bin" -af volumedetect -f null - 2>&1 | grep mean_volume | awk '{print $5}')
echo "  ·  phổ tham khảo: toàn dải ${ALL:-?} dB · trên 9 kHz ${HI:-?} dB (chỉ để so giữa các tập, KHÔNG suy ra giọng)"

LOGF="${AO_LOG:-$HOME/devspace/logs/ai-voice-worker.log}"
if [ -f "$LOGF" ] && grep -q "chuyển sang giọng Piper" "$LOGF"; then
  warn "log máy chủ có ghi lượt hạ giọng — đối chiếu mốc thời gian với tập này"
else
  ok "log máy chủ không ghi lượt hạ giọng nào"
fi

# ── 5. nghe lại 3 lát, so với transcript ─────────────────────────────
if [ "$FULL" = 1 ]; then
  python3 -c 'import json,sys;t=json.load(open(sys.argv[1])).get("transcript") or [];print(" ".join(x.get("text","") for x in t).lower())' "$D/st.json" > "$D/tr.txt"
  for POS in 5 $((REAL/2)) $((REAL-70)); do
    [ "$POS" -lt 0 ] && continue
    "$FF" -y -v error -ss "$POS" -t 60 -i "$D/ep.bin" -ar 16000 -ac 1 -sample_fmt s16 "$D/lat.wav"
    HEARD=$(curl -s -m 300 -X POST "$AI/api/v1/stt/transcribe" -F "file=@$D/lat.wav;filename=voice.wav" -F language=vi \
      | python3 -c 'import sys,json;print(json.load(sys.stdin).get("text","").lower())')
    python3 - "$D/tr.txt" "$HEARD" "$POS" <<'PY'
import sys, re
tr = open(sys.argv[1]).read()
heard, pos = sys.argv[2], sys.argv[3]
words = [w for w in re.findall(r"[a-zà-ỹ]{4,}", heard)][:40]
hit = sum(1 for w in words if w in tr)
rate = hit / len(words) if words else 0
mark = "✅" if rate >= 0.6 else "❌"
print(f"  {mark} lát tại {pos}s: {hit}/{len(words)} từ nghe được có trong transcript ({rate*100:.0f}%)")
PY
  done
else
  echo "  ·  bỏ qua phép nghe-lại (đặt FULL=1 để bật, tốn ~1 phút)"
fi

rm -rf "$D"
echo
echo "  ── TỔNG: $P đạt · $F trượt · $W cảnh báo"
[ "$F" -eq 0 ]
