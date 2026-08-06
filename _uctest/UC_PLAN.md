# Bộ UC test toàn diện — Dev Space Voice RAG trên ccoex

> **Quy trình khi UC đỏ**: lỗi hiện trên giao diện → truy ngược từng tầng
> `UI → node proxy (:18001) → gateway (:15050) → AI (:15001) → serving (:15003) / BE live (:5002)`
> bằng cách gọi **cùng một request** trực tiếp vào từng tầng cho đến khi tìm ra tầng đầu tiên
> trả sai. **Fix ở backend là chính** (gateway/AI/serving); chỉ sửa FE khi backend đã được
> chứng minh trả đúng. Sau mỗi fix: chạy lại UC đỏ + toàn bộ nhóm của nó + UC hồi quy F.

**Ký hiệu cách chạy**: `[A]` = tự động (curl/script, tôi chạy được) · `[M]` = cần người
thật trên trình duyệt (mic, nghe audio, nhìn màu) — tôi chuẩn bị sẵn lệnh/bước, user bấm.

**Điều kiện tiên quyết** (thứ tự bắt buộc):
1. `V0` chụp ảnh nền → 2. `ops/devspace-bootstrap.sh` → 3. `ops/devspace-up.sh`
→ 4. đẩy `mta-fe-devspace` lên ccoex + `PORT_OFFSET=10000 COMPOSE_PROJECT=devspace-fe ./deploy/02-up.sh`
→ 5. nạp metadata DB (pg_dump/mongodump từ live — chỉ đọc) → 6. chạy UC theo nhóm A→F.

---

## Nhóm A — Nền tảng & cô lập (chạy TRƯỚC mọi nhóm khác)

| UC | Mô tả | Kỳ vọng | Cách |
|---|---|---|---|
| A1 | Ảnh nền V0: redis keyspace, minio /data, ss -tlnp, health :5001/:5002/:5003, nvidia-smi → lưu `~/devspace/baseline/` | Có đủ 6 file baseline | [A] |
| A2 | Serving voice `:15003/api/v1/voices` | 200, có cả `vi` lẫn `en` | [A] |
| A3 | Delta VRAM sau khi serving-voice lên | ≤ ~200 MB so với A1. Nhảy ~2 GB = `ENABLE_RERANKER=false` không ăn → **dừng ngay, fix trước khi đi tiếp** | [A] |
| A4 | AI voice `:15001/health` | 200, components ok | [A] |
| A5 | Đối chứng live KHÔNG có voice: `:5003/api/v1/voices` và `:5001/api/v1/stt/transcribe` | Cả hai **404** | [A] |
| A6 | Cô lập Redis: task dev nằm ở `devspace-redis`, db0 của redis live không đổi so với A1 | DBSIZE live không tăng bởi task dev | [A] |
| A7 | Cô lập MinIO: minio live vẫn chỉ có `intramind-blobs` | Không xuất hiện bucket dev trong minio live | [A] |
| A8 | Worker dev chỉ tiêu thụ queue `audio_overview`: `celery inspect active_queues` qua redis :16379 | Đúng 1 queue | [A] |

## Nhóm B — Serving voice :15003 (hợp đồng thấp nhất)

| UC | Mô tả | Kỳ vọng | Cách |
|---|---|---|---|
| B1 | TTS vi: `POST /api/v1/tts {"text":"xin chào","language":"vi"}` | 200, `file` = RIFF WAV, header `X-Audio-Duration-Ms` | [A] |
| B2 | TTS en tương tự | 200 WAV | [A] |
| B3 | TTS text quá `TTS_MAX_TEXT_CHARS` (2001 ký tự) | **413**, không cắt ngầm | [A] |
| B4 | STT round-trip: đem WAV của B1 `POST /api/v1/stt` | 200, `text` khớp "xin chào" (chuẩn hoá dấu/hoa thường), có `segments[]` | [A] |
| B5 | STT en round-trip từ B2 | 200, khớp từ | [A] |
| B6 | STT file rỗng / không decode được | **422** | [A] |
| B7 | STT quá `STT_MAX_AUDIO_BYTES` | **413** | [A] |
| B8 | STT webm/opus (giả lập file đuôi .webm) khi CÓ ffmpeg static trong PATH | 200 (đường ffmpeg hoạt động — dự phòng cho trình duyệt lạ) | [A] |

## Nhóm C — AI voice :15001 (luồng nghiệp vụ)

| UC | Mô tả | Kỳ vọng | Cách |
|---|---|---|---|
| C1 | `POST /api/v1/stt/transcribe` WAV vi | 200 `{text, language, duration_ms, segments}` | [A] |
| C2 | STT gửi `.pdf` | **415** | [A] |
| C3 | Audio overview submit chỉ `text`, vi, 1 phút | 200 `{task_id, status:"submitted"}` | [A] |
| C4 | Poll status C3 **ngay sau submit** (hành vi FE thật — đây chính là chỗ bug WEDGED `9425492` từng nằm) | KHÔNG 500 "presumed dead"; `processing` → xong | [A] |
| C5 | Progress heartbeat: note tiến `script` → `tts n/m` | Có note, không đứng im >120s | [A] |
| C6 | Hoàn tất: status trả `object_key, audio_format, duration_sec, size_bytes, transcript[]` (KHÔNG có field `status`) | Đủ field; transcript ≥2 lượt host/guest | [A] |
| C7 | `GET .../file` | 200, audio phát được (`file` = RIFF/ID3), Content-Length khớp `size_bytes` | [A] |
| C8 | Audio overview từ `document_ids` corpus THẬT (lấy 1-2 doc COMPLETED qua BE :5002) | Xong, transcript nhắc nội dung tài liệu | [A] |
| C9 | Submit en | Xong, transcript tiếng Anh | [A] |
| C10 | Huỷ giữa chừng: submit → đợi vào `tts` → cancel | status → `cancelled`, `GET file` → **404**; worker không treo | [A] |
| C11 | `GET file` khi đang chạy | **409** | [A] |
| C12 | DELETE khi đang chạy → 409; DELETE sau khi xong → 200 và file → 404 | Đúng cả hai chiều | [A] |
| C13 | Input hỏng: body rỗng → 400 · `language:"fr"` → 422 · task không tồn tại → 404/409 đúng semantics | Đúng mã | [A] |
| C14 | Hỏi đáp RAG thường (không voice) `POST /api/v1/query/stream` với doc corpus thật | SSE stream câu trả lời + citations — chứng minh AI voice vẫn là AI đầy đủ | [A] |

## Nhóm D — Gateway :15050 (hợp đồng FE tiêu thụ)

| UC | Mô tả | Kỳ vọng | Cách |
|---|---|---|---|
| D1 | Login lấy JWT (user seed/restore) | 200, token | [A] |
| D2 | Không token → mọi route voice | **401** | [A] |
| D3 | `POST /tools/audio-overview` qua gateway | 200 task_id (đường catch-all) | [A] |
| D4 | `GET /tools/audio-overview/status/{id}` khi XONG | Body **có đủ** `object_key/transcript/duration_sec/audio_format/size_bytes` và **KHÔNG bị** ghi đè thành `{status:"FAILURE"}` (bẫy zombie-check) | [A] |
| D5 | `GET /tools/audio-overview/{id}/file` | 200, stream đủ byte (đếm = `size_bytes`), có Content-Type/Disposition | [A] |
| D6 | Cancel + DELETE qua gateway | Truyền nguyên 200/409 | [A] |
| D7 | `POST /stt/transcribe` qua gateway (multipart) | 200 text; upstream 415/422/413 truyền nguyên mã | [A] |
| D8 | **Guard chỉ-đọc**: upload qua gateway | **403** + message "Dev Space chỉ đọc…" | [A] |
| D9 | **Guard chỉ-đọc — ca nguy hiểm nhất**: DELETE document qua gateway → 403, **rồi xác minh tài liệu VẪN CÒN** trên BE live `:5002/api/v1/documents/{id}/status` | 403 và doc còn nguyên | [A] |
| D10 | process/preview/replace qua gateway | Đều **403** | [A] |
| D11 | `link-repository` (Chọn từ kho) | **200** — đường đọc duy nhất được phép phải sống | [A] |
| D12 | Stream file qua node proxy `:18001/tools/...` (qua lớp strip content-length) | Đủ byte, không cắt cụt | [A] |

## Nhóm E — Giao diện :18001

| UC | Mô tả | Kỳ vọng | Cách |
|---|---|---|---|
| E1 | Trang chủ serve được; `env-config.js` chứa `REACT_APP_BRAND:"devspace"` + `READONLY_CORPUS:"true"` | Đúng cả hai | [A] |
| E2 | HTML/manifest: title động thành "DEV SPACE", manifest short_name "DEV SPACE", favicon devspace.svg tồn tại | Đúng | [A] |
| E3 | Skin đỏ: mở UI — header wordmark "DEV SPACE" đỏ, không còn vệt teal ở DataTable / SourceCard / TemplatePicker / RepoPicker / DocumentViewer | Nhìn bằng mắt | [M] |
| E4 | Dark mode toggle → palette đỏ tối (`#F08C8C`) | Nhìn bằng mắt | [M] |
| E5 | Login page: tagline "DEV SPACE — bản thử nghiệm giọng nói" | Đúng chữ | [M] |
| E6 | Đăng nhập, tạo hội thoại, **"Chọn từ kho"** kéo 2-3 tài liệu thật vào | Danh sách hiện tài liệu, không lỗi | [M] |
| E7 | Khu upload hiển thị thông báo chỉ-đọc (không phải dropzone) | Đúng | [M] |
| E8 | Hỏi đáp RAG thường trên corpus thật | Trả lời stream + citation bấm được | [M] |
| E9 | **Mic hạnh phúc** (qua `ssh -L 18001:localhost:18001`): bấm mic → cho quyền → nói tiếng Việt → chữ vào ô nhập → sửa → Enter → có câu trả lời | Toàn luồng chạy | [M] |
| E10 | Mic lỗi: từ chối quyền → thông báo đúng; mở bằng IP trần → nút mờ + báo insecure context; ghi >120s → tự dừng | 3 ca đều có thông báo riêng | [M] |
| E11 | **Audio overview hạnh phúc**: chọn tài liệu → "Tổng quan âm thanh" → modal (vi, 3') → note tiến (`script` → `tts n/m`, KHÔNG có thanh 0/0) → player phát được → transcript 2 cột host/guest | Toàn luồng chạy | [M] |
| E12 | **Reload giữa chừng**: F5 khi đang tạo → poll nối lại từ localStorage, không mất task | Row vẫn hiện "Đang tạo…" và về đích | [M] |
| E13 | Huỷ giữa chừng trên UI → row "Đã huỷ"; Xoá tập đã xong → biến mất; xoá khi đang chạy → báo "Huỷ trước rồi xoá" | Đúng cả 3 | [M] |
| E14 | Podcast tiếng Anh từ UI | Phát được | [M] |
| E15 | 2 phiên/2 hội thoại song song: mỗi hội thoại một episode riêng, không lẫn | Đúng | [M] |

## Nhóm G — Chịu tải & ngắt quãng (file dài, đứt gãy giữa chừng)

> Đây là nhóm "đời thật": tập dài nhiều lượt, người dùng đóng tab, mạng rớt, service
> chết giữa chừng. Nguyên tắc kỳ vọng chung: **không bao giờ treo vô hạn, không bao giờ
> mất dấu task, không bao giờ nhận nhầm tập hỏng là tập xong.**

### G-a. File dài / nguồn lớn

| UC | Mô tả | Kỳ vọng | Cách |
|---|---|---|---|
| G1 | **Tập dài**: nguồn ~3-5k từ (ghép nhiều doc hoặc text dài), `target_minutes=8-10` | Xong; ~15-25 lượt thoại; nếu kịch bản lệch ngân sách thì QC tự sinh lại (metadata `attempts=2`, note `script-budget-retry`) chứ không fail | [A] |
| G2 | Max tài liệu: submit với **10 document_ids** | Chạy được; 11 docs → 422 | [A] |
| G3 | `target_minutes=30` (max) từ nguồn lớn | Xong trong trần 45' client; file wav lớn (~60-80MB) vẫn stream đủ byte qua 2 lớp proxy | [A] |
| G4 | `target_minutes=1` từ nguồn rất lớn (nén cực mạnh) | Xong, không vòng lặp QC vô hạn | [A] |
| G5 | Nguồn "khó đọc": số liệu, viết tắt, ký tự đặc biệt, bảng | Script không rỗng, TTS không crash trên ký tự lạ | [A] |
| G6 | STT ghi âm dài: WAV ~115s (sát trần 120s client) | 200, transcript đủ; 26MB+ → 413 | [A] |
| G7 | Doc chưa COMPLETED / doc_id bịa | 400/422 rõ ràng, không nhận task rồi chết ngầm | [A] |

### G-b. Ngắt giữa chừng — phía người dùng

| UC | Mô tả | Kỳ vọng | Cách |
|---|---|---|---|
| G8 | **Đóng hẳn tab** khi đang tạo (không phải F5), mở lại sau khi task đã XONG phía server | localStorage hydrate → row chuyển "Sẵn sàng phát", player mở được | [M] |
| G9 | Đóng tab khi đang tạo, mở lại khi VẪN đang tạo | Poll nối lại, note tiến tiếp | [M] |
| G10 | **Mất mạng client** giữa lúc poll (tắt wifi/rút ssh -L ~30s rồi nối lại) | Poll lỗi không giết state; nối mạng lại là tiếp tục — không văng về FAILURE chỉ vì vài lần poll hỏng | [M] |
| G11 | Cancel **ngay lập tức** sau submit (<1s — cửa sổ race trước heartbeat đầu) | `cancelled` sạch, không 500, không task ma chạy tiếp đến cùng | [A] |
| G12 | Cancel trong pha `script` (trước khi vào `tts`) vs trong pha `tts` | Cả hai đường đều `cancelled`, file → 404 | [A] |
| G13 | Bấm tạo khi hội thoại ĐÃ có tập đang chạy | UI chặn bằng thông báo "Đã có tập podcast", không double-submit | [M] |
| G14 | **Ngắt tải file giữa chừng**: client abort khi mới nhận một phần stream (curl --max-time cắt ngang) rồi tải lại | Lần 2 đủ byte; gateway không leak kết nối (số fd/connection không tăng dần sau 5 lần lặp) | [A] |
| G15 | Nghe audio + đồng thời hỏi RAG trong cùng hội thoại | Cả hai chạy song song không chặn nhau | [M] |

### G-c. Ngắt giữa chừng — phía hạ tầng (chỉ giết devspace-*, KHÔNG BAO GIỜ đụng live)

| UC | Mô tả | Kỳ vọng | Cách |
|---|---|---|---|
| G16 | **SIGKILL worker dev** giữa pha tts → khởi động lại worker | Task cũ: poll không treo vô hạn — hoặc liveness phán chết (FAILURE có message), hoặc trần 45' client bắt; task MỚI submit sau restart chạy bình thường | [A] |
| G17 | **Restart AI api** (:15001) khi task đang chạy trong worker | Worker chạy tiếp (độc lập process); api lên lại → poll cùng task_id trả đúng trạng thái (result backend Redis còn) | [A] |
| G18 | **Restart devspace-redis** giữa chừng | Task đang chạy có thể mất — chấp nhận, nhưng: api không sập, poll trả lỗi/failure rõ ràng chứ không treo, submit mới sau đó chạy được | [A] |
| G19 | **Stop devspace-minio** rồi GET file của tập đã xong | Gateway trả **502** (đúng semantics), UI báo "Không tải được tệp"; bật minio lại → tải được | [A] |
| G20 | Serving-voice (:15003) chết giữa pha tts | Task fail có message (không treo); restart serving → submit mới OK | [A] |
| G21 | 3 submit song song từ 3 hội thoại | Queue xử lý tuần tự/tương tranh theo concurrency; cả 3 về đích; heartbeat không lẫn task; VRAM không leo thang | [A] |
| G22 | Sau TOÀN BỘ nhóm G: lặp lại A6/A7 + F1/F2 | Live vẫn nguyên vẹn sau mọi màn tra tấn | [A] |

## Nhóm F — Hồi quy & live nguyên vẹn (chạy CUỐI, và sau MỖI lần fix)

| UC | Mô tả | Kỳ vọng | Cách |
|---|---|---|---|
| F1 | Diff toàn bộ V0: redis keyspace live, minio live, container list, nvidia-smi | Không lệch ngoài dao động nền | [A] |
| F2 | Health live :5001/:5002/:5003/:5050/:8001 | Đều 200 | [A] |
| F3 | FE THẬT `:8001`: đăng nhập, hỏi 1 câu | Trả lời bình thường | [M] |
| F4 | `docker logs --since 2h intramind-client-api` | Không error mới liên quan | [A] |
| F5 | Không tiến trình/port/volume devspace nào ngoài danh mục (15001/15003/15050/18001/15432/37018/16379/19000) | Sạch | [A] |

---

## Ma trận bao phủ (đối chiếu để không sót)

| Năng lực | UC |
|---|---|
| TTS vi/en + giới hạn | B1 B2 B3 |
| STT vi/en + mọi mã lỗi (413/415/422/503) | B4-B8, C1 C2, D7 |
| Audio overview: submit/progress/complete/file/cancel/delete/409/404 | C3-C13, D3-D6 |
| Bug WEDGED từng fix (poll ngay sau submit) | C4 |
| Bẫy zombie-check (status-less body) | D4 |
| Bẫy poll vô hạn (`cancelled`) | C10 + E13 |
| Stream không cắt cụt qua 2 lớp proxy | D5 D12 |
| Chỉ-đọc corpus: cả 5 đường ghi + đường đọc được phép | D8-D11, E7 |
| Skin đỏ light/dark + brand chữ | E2-E5 |
| Mic: hạnh phúc + 3 ca lỗi | E9 E10 |
| localStorage resume + đa hội thoại | E12 E15 |
| RAG thường không hỏng vì voice | C14, E8, G15 |
| Tập dài / nguồn lớn / QC budget retry | G1-G5 |
| Ngắt phía người dùng (tab, mạng, cancel-race, abort stream) | G8-G14, E12 |
| Chết giữa chừng phía hạ tầng (worker/api/redis/minio/serving) | G16-G20 |
| Tương tranh nhiều task | G21, E15 |
| Cô lập tuyệt đối với live | A3 A5-A8, D9, F1-F5, G22 |

## Thứ tự thực thi & luật dừng

1. **A đỏ → dừng toàn bộ** (nền tảng sai thì mọi kết quả sau vô nghĩa; A3 đỏ = nguy cơ OOM live).
2. B → C → D chạy tuần tự [A]; mỗi UC đỏ: truy tầng, fix (BE trước), chạy lại UC + cả nhóm.
3. E: tôi chạy trước E1-E2 [A]; các UC [M] tôi soạn checklist từng bước gửi user bấm, user báo kết quả, lỗi thì tôi truy ngược bằng log 4 tầng (`~/devspace/logs/*.log`, `docker logs devspace-*`).
4. G chạy SAU khi C+D xanh (nghịch cảnh chỉ có nghĩa khi đường hạnh phúc đã đúng);
   G-c giết **duy nhất** tiến trình/container `devspace-*` — theo cổng/tên, không bao giờ pattern.
5. F sau cùng, và **lặp lại F1-F2 sau mỗi lần fix** động đến backend.
