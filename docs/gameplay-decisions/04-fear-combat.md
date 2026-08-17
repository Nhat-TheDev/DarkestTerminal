# §4. Fear ảnh hưởng ngược lại combat — có, nhưng có trần và có lối thoát

*(mục 4 của `00-index.md`)*

Quyết định: **fear có ảnh hưởng thật tới hiệu suất combat**, áp dụng theo bậc ở `03-survival-stats.md` mục 3, để giữ đúng tinh thần "rủi ro thật" của permadeath. Để tránh rủi ro chồng rủi ro biến thành tử vòng xoáy không kiểm soát được, ảnh hưởng bị **chặn trần ở bậc 4** và luôn có công cụ hạ fear chủ động (skill Acolyte, item, rest room) đối trọng lại.

| Bậc fear | Ảnh hưởng combat |
|---|---|
| Bình Tĩnh (0-39) | Không ảnh hưởng |
| Bất An (40-69) | Độ chính xác kỹ năng nhắm địch giảm 10% |
| Hoảng Loạn (70-99) | Độ chính xác giảm 20%, sát thương gây ra giảm 15% |
| Suy Sụp (100) | Mỗi lượt có 25% khả năng "mất kiểm soát" — bỏ lượt hoàn toàn (tương đương stun); 75% còn lại hành động bình thường (không giảm thêm accuracy/damage so với bậc Hoảng Loạn) |

Ghi chú: đây là **soft cap có chủ đích** — bậc 4 không tăng nặng thêm theo fear (vì fear đã kịch trần 100), và party luôn có Acolyte/item để kéo fear xuống trước khi vào combat quan trọng. Việc này để dành cho balancing thực tế khi playtest, số % ở trên là điểm khởi đầu, không phải số cuối cùng.

### 4.1 Roll accuracy theo từng mục tiêu (AoE) + ultimate luôn trúng nhưng giảm hiệu quả theo fear

Bảng trên vẫn là quy tắc **mặc định cho skill thường** (đơn mục tiêu hoặc AoE), nhưng cách áp dụng tách làm 2 trường hợp kể từ khi thêm skill AoE/ultimate ở `01-class-skill.md` mục 1:

- **Skill đơn mục tiêu** (`singleEnemy`, nửa "địch" khi người chơi chọn địch cho skill 2 phe kiểu Purify): roll accuracy 1 lần cho cả skill — không đổi so với trước.
- **Skill AoE nhắm địch** (`allEnemies`, nửa "địch" của skill 2 phe kiểu Divine Descent): roll accuracy **riêng cho từng địch** trong danh sách mục tiêu — 1 địch có thể trúng trong khi địch khác né được cùng 1 lần dùng skill. Nửa "đồng đội" của skill 2 phe (heal/buff) không roll accuracy, giữ nguyên quy tắc cũ (fear chỉ ảnh hưởng "kỹ năng nhắm địch").
- **Skill ultimate** (skill ở slot 5, `isUltimate: true`, `cooldownTurns: 5`): **bỏ qua hoàn toàn** roll accuracy lẫn mức giảm 15% sát thương ở bảng trên — ultimate luôn thi triển thành công. Thay vào đó, **hiệu quả** (giá trị `amount` của mọi effect `damage`/`heal` trong skill) bị nhân hệ số theo bậc fear của người dùng, **trước khi** đưa vào công thức sát thương/hồi máu bình thường:

  | Bậc fear | Hệ số hiệu quả ultimate |
  |---|---|
  | Bình Tĩnh (0-39) | 100% |
  | Bất An (40-69) | 90% |
  | Hoảng Loạn (70-99) | 75% |
  | Suy Sụp (100) | 60% |

  *Đề xuất ban đầu, cần playtest để chốt số cuối — nguyên tắc là ultimate "chắc trúng" nhưng phạt bằng độ mạnh thay vì tỉ lệ trúng/trượt, tránh cảm giác "dồn hết vào 1 đòn quyết định rồi trượt trắng tay" ở đúng lúc cần nó nhất (fear cao).*

  Kỹ thuật: cần 1 field đánh dấu "đây là ultimate" tách biệt khỏi `usesPerCombat` (để không vô tình áp luật này lên 1 skill thường nào đó lỡ có `usesPerCombat: 1` vì lý do khác) — xem `docs/technical-decisions.md` §4.
