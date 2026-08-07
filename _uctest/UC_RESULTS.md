# Kết quả UC — chạy 2026-08-07 trên ccoex (phần tự động)

Bối cảnh: ccoex reboot đêm 06/08 → 3 service live bare-metal (:5001/:5002/:5003)
CHẾT, không autostart. Dev Space chạy fallback embedder→:15003. Các UC cần live
(A5, C8, C14, D9-đầy-đủ, EV09) **treo chờ live**; còn lại chạy đủ.

## Bảng kết quả

| Nhóm | Kết quả | Ghi chú |
|---|---|---|
| A nền tảng & cô lập | ✅ 7/8 (A5 chờ live) | GPU delta +42MB; task dev nằm đúng devspace-redis; minio live chỉ còn `intramind-blobs` |
| B serving :15003 | ✅ toàn bộ | TTS/STT vi+en, 413/422 đúng, round-trip khớp 100% |
| C AI :15001 | ✅ 12/14 (C8/C14 chờ live) | C4 poll-ngay-sau-submit không còn WEDGED; C13 mã lỗi đúng cả bộ |
| D gateway :15050 | ✅ 11/12 (D9 một nửa) | Status đủ field không bị zombie-check phá; file 1.27MB byte-identical qua 2 lớp proxy; guard 403 đúng thông báo; D9 phần "doc thật vẫn còn" chờ live |
| E1-E2 giao diện (máy) | ✅ | env-config có brand+readonly; manifest DEV SPACE; favicon 200 |
| E3-E15 giao diện (mắt người) | ⏳ chờ user | checklist sẵn |
| G-a file dài | ✅ qua eval | EV04 540s/44 lượt; stream 4.2MB byte-exact |
| G-b ngắt phía người dùng | ✅ | cancel <1s sạch (G11), cancel giữa `tts 4/9` (G12), file/DELETE 409 khi chạy (C11/C12), abort tải 5 lần không rò kết nối + tải trọn byte-exact (G14) |
| G-c giết hạ tầng | ✅ 4 chạy / 2 ghi chú | G16 SIGKILL worker: redeliver rồi phán "lost… submit again" đúng terminal, task mới OK · G18 redis restart: API sống, task submit-trước-restart MẤT (chấp nhận — trần client bắt), task mới xong 15s · G19 minio chết → 502, sống lại → 200 · G21 3 task song song 3/3, VRAM đứng im · **G17 chưa test đúng nghĩa** (API restart giữa task — lần chạy bị cắt timeout) · G20 skip (cùng lớp G16) |
| F hồi quy live | ⏳ chạy sau khi live được khôi phục | |

## Bug thật tìm được & đã fix trong phiên

| # | Bug | Fix |
|---|---|---|
| 1 | `.env` seed từ live thiếu khối `AUDIO_OVERVIEW__{PROVIDER,BASE_URL,API_KEY}` → tool init fail | Chép pattern khối SUMMARY (:8003/v1) |
| 2 | serving repo không đọc `.env` (os.environ thuần) → engine không nạp, embedder nhảy GPU | Export env trên dòng lệnh khởi động (đã ghi vào ops/devspace-up.sh từ trước — bootstrap ghi .env là thừa) |
| 3 | runner eval poll body `{"detail":…}` không coi là terminal → poll chay 45' | Vá run_generate.py |
| 4 | difflib autojunk sập ratio trên chuỗi dài (0.255 dù khớp ~0.94) | autojunk=False |
| 5 | Thước WPM 150 lệch service 240 sau fix | Đồng bộ 240 |

## Nợ ghi sổ (không chặn)

- G17 (API restart giữa task) chưa chạy trọn — làm cùng đợt F khi live về.
- Prompt dài hơn → qwen3.5-9b thi thoảng trượt format JSON (1 lần, retry OK) →
  đề xuất tăng parse-retry (kèm trong EVAL_REPORT).
- Speed TTS bị nén biên độ (1.47×/0.76×) — UI không dùng, sổ BE.
- Đề xuất BE lớn nhất từ eval: **bước fact-check số liệu bằng LLM thứ hai trước
  TTS** (xem EVAL_REPORT kết luận 3 vòng).
