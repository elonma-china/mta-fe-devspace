# Phiếu nghe MOS rút gọn — 12 mẫu TTS

> Máy và agent không nghe được ngữ điệu. Phiếu này là vòng cuối: tai người chấm
> 12 mẫu — 6 mẫu bị máy/agent **gắn cờ** + 6 mẫu **ngẫu nhiên** (danh sách cụ thể
> điền sau khi 2 tầng trước chạy xong; cột dưới để sẵn 12 dòng trống).

## Cách nghe (từ máy cá nhân)

```bash
# 1. Kéo audio về máy (một lần):
scp -r ccoex@100.108.33.98:~/devspace/mta-fe-devspace/_uctest/eval/tts/out ./tts-listen
# 2. Nghe từng file:
#    macOS:  afplay ./tts-listen/T07/tts.wav
#    Linux:  aplay  ./tts-listen/T07/tts.wav
#    Windows: mở bằng trình phát bất kỳ
```

## Thang điểm (chấm nhanh theo cảm nhận, 1–5)

- **Tự nhiên**: 5 = như người đọc bản tin · 3 = nghe rõ là máy nhưng dễ chịu · 1 = khó nghe
- **Ngữ điệu & ngắt nghỉ**: 5 = ngắt đúng dấu câu, câu hỏi lên giọng · 3 = đều đều · 1 = ngắt sai làm đổi nghĩa
- **Lỗi nghe được**: 5 = không có · 3 = thi thoảng click/khựng nhẹ · 1 = rè, nuốt âm, vỡ tiếng

| # | Case | File | Lý do chọn (cờ gì / ngẫu nhiên) | Tự nhiên | Ngữ điệu | Lỗi nghe được | Ghi chú |
|---|------|------|--------------------------------|----------|----------|---------------|---------|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |
| 9 | | | | | | | |
| 10 | | | | | | | |
| 11 | | | | | | | |
| 12 | | | | | | | |

**Gate**: trung bình mỗi cột ≥3.5 và không mẫu nào có cột ≤2. Mẫu ≤2 → ghi rõ nghe
thấy gì ở cột ghi chú (đó là đầu vào truy nguyên nhân: chuẩn hoá text / ghép đoạn /
bản thân giọng Piper).
