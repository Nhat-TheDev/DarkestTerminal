# §4. Fear ảnh hưởng ngược lại combat — có, nhưng có trần và có lối thoát

*(mục 4 của `00-index.md`)*

**Fear có ảnh hưởng tới hiệu suất combat**, áp dụng theo bậc ở `03-survival-stats.md` mục 3. Ảnh hưởng bị **chặn trần ở bậc 4**. Có công cụ hạ fear chủ động: skill Acolyte, item, rest room.

| Bậc fear | Ảnh hưởng combat |
|---|---|
| Bình Tĩnh (0-39) | Không ảnh hưởng |
| Bất An (40-69) | Độ chính xác kỹ năng nhắm địch giảm 10% |
| Hoảng Loạn (70-99) | Độ chính xác giảm 20%, sát thương gây ra giảm 15% |
| Suy Sụp (100) | Mỗi lượt có 25% khả năng "mất kiểm soát" — bỏ lượt hoàn toàn (tương đương stun); 75% còn lại hành động bình thường (không giảm thêm accuracy/damage so với bậc Hoảng Loạn) |

Bậc 4 là mức tối đa, không tăng nặng thêm theo fear.

### 4.1 Roll accuracy theo từng mục tiêu (AoE) + ultimate luôn trúng nhưng giảm hiệu quả theo fear

Bảng trên là quy tắc **mặc định cho skill thường** (đơn mục tiêu hoặc AoE), áp dụng theo 2 trường hợp:

- **Skill đơn mục tiêu** (`singleEnemy`, nửa "địch" khi người chơi chọn địch cho skill 2 phe kiểu Purify): roll accuracy 1 lần cho cả skill — không đổi so với trước.
- **Skill AoE nhắm địch** (`allEnemies`, nửa "địch" của skill 2 phe kiểu Divine Descent): roll accuracy **riêng cho từng địch** trong danh sách mục tiêu — 1 địch có thể trúng trong khi địch khác né được cùng 1 lần dùng skill. Nửa "đồng đội" của skill 2 phe (heal/buff) không roll accuracy, giữ nguyên quy tắc cũ (fear chỉ ảnh hưởng "kỹ năng nhắm địch").
- **Skill ultimate** (skill ở slot 5, `isUltimate: true`, `cooldownTurns: 5`): **bỏ qua hoàn toàn** roll accuracy lẫn mức giảm 15% sát thương ở bảng trên — ultimate luôn thi triển thành công. Thay vào đó, **hiệu quả** (giá trị `amount` của mọi effect `damage`/`heal` trong skill) bị nhân hệ số theo bậc fear của người dùng, **trước khi** đưa vào công thức sát thương/hồi máu bình thường:

  | Bậc fear | Hệ số hiệu quả ultimate |
  |---|---|
  | Bình Tĩnh (0-39) | 100% |
  | Bất An (40-69) | 90% |
  | Hoảng Loạn (70-99) | 75% |
  | Suy Sụp (100) | 60% |

  Kỹ thuật: cần 1 field đánh dấu "đây là ultimate" tách biệt khỏi `usesPerCombat` — xem `docs/technical-decisions.md` §4.
