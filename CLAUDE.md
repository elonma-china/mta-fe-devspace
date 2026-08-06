# Project Rules

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