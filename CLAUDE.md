# Project Rules

## Đây là project gì

`mta-fe-devspace` là **bản thử nghiệm Voice RAG**, KHÔNG phải bản thật.

| | |
|---|---|
| Nguồn gốc | `mta-fe-intramind` nhánh `devops` @ `8002093f` (2026-07-31) |
| Commit khởi tạo | `1814dd7` — bản sao nguyên trạng, không sửa gì |
| Mục đích | Dùng thử voice (mic→STT, Audio Overview) trước khi đội FE ghép vào bản thật |
| Nhận dạng | Màu chủ đạo **đỏ**, logo **"DEV SPACE"** (bật bởi `REACT_APP_BRAND=devspace`) |
| Triển khai | ccoex, project compose `devspace-fe`, cổng 18001/15050 — song song bản thật ở 8001/5050 |

### 3 luật riêng của project này

1. **Không đụng `mta-fe-intramind`.** Đây là project độc lập, git riêng, không remote chung.
2. **Đọc corpus thật, không bao giờ ghi.** `AI_INGEST_HOST` trỏ vào BE **live** ở `:5002`.
   Guard `DEV_READONLY_CORPUS=true` chặn cả 5 helper có ghi trong
   `app/routes/document.py` — trong đó `_delete_remote_document` xoá thật tài liệu
   khỏi corpus. **Không bao giờ gỡ guard này.**
3. **Skin đỏ phải nằm sau cổng `REACT_APP_BRAND`.** Không hardcode màu vào
   `index.css` — nhờ vậy patch voice bàn giao cho FE không lẫn thay đổi màu
   (xem mục "Bàn giao" trong `README.md`).

### Điểm lệch giữa code và rule file — code thắng

`.claude/rules/typescript.md` mô tả TypeScript + Vite + CSS Modules + vitest + zod.
Repo thực tế là **Create React App 5.0.1 + JS thuần + global CSS + jest**, store zustand
không middleware. **Viết theo code hiện có**, không theo rule file. Muốn theo rule file
thì đó là một cuộc migration riêng, không nhét vào tính năng voice.

## Quy tắc làm việc (bắt buộc với mọi thay đổi trong repo này)

1. **Trước khi chỉnh sửa bất cứ gì**: kiểm tra đã ở code mới nhất chưa —
   `git fetch origin` rồi so nhánh đang đứng với remote (`git status -sb`,
   `git log HEAD..origin/<nhánh> --oneline`); tụt hậu thì pull/merge xong mới sửa.
2. **Trước khi push lên GitHub**: cập nhật `README.md` cho khớp thay đổi vừa làm.
3. **Quy tắc viết README.md**: trực quan – rõ ràng – ngắn gọn, không giải thích
   dài dòng; ưu tiên diễn giải thành các bước đánh số hoặc gạch đầu dòng;
   dùng bảng/sơ đồ khi nhìn nhanh hơn đọc chữ.

@.claude/rules/python.md
@.claude/rules/typescript.md
@.claude/rules/docker.md