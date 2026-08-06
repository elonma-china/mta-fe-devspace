# ARBITER — phân xử khi hai giám khảo lệch điểm

Bạn là trọng tài MỚI, độc lập. Hai giám khảo chấm cùng dimension "{DIMENSION}" cho
cùng một tập nhưng lệch nhau >1 điểm. Phân xử bằng chứng cứ, không thoả hiệp lấy
trung bình.

## Nguồn
{SOURCE}

## Transcript
{TRANSCRIPT}

## Hai bản chấm (đầy đủ giải trình của mỗi bên)
{JUDGMENT_A}

{JUDGMENT_B}

## Việc phải làm

1. Kiểm tra TỪNG luận cứ của mỗi bên trực tiếp trên transcript/nguồn — luận cứ nào
   đúng sự thật, luận cứ nào giám khảo nhìn nhầm/bỏ sót.
2. Ra điểm cuối 1-5 theo đúng neo điểm của dimension đó (neo nằm trong prompt judge
   gốc, được dán kèm dưới đây nếu có): điểm của bạn KHÔNG bắt buộc nằm giữa hai điểm
   kia — nếu một bên đúng hoàn toàn thì theo hẳn bên đó.
3. Ghi rõ vì sao bên kia sai.

## Output — CHỈ JSON

```json
{
  "case": "{CASE_ID}", "judge": "arbiter", "dimension": "{DIMENSION}",
  "final_score": <1-5>,
  "sided_with": "A|B|neither",
  "reasoning": "luận cứ nào thắng, luận cứ nào bị bác và vì sao",
  "confidence": "high|medium|low"
}
```
