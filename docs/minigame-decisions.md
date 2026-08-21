# Mini-game — Định hướng tương lai (chưa implement)

**Chưa có trong code hiện tại.** Tài liệu này là spec tham khảo cho khi
triển khai mini-game, không mô tả trạng thái game hiện có — xem
`../design-doc.md` mục "Định hướng tương lai".
**Liên quan**: `./design-doc.md` mục 1.7, 1.8

---

## 1. Quan hệ boss-fight ↔ mini-game

Quyết định: **boss fight KHÔNG bị thay hoàn toàn bằng mini-game** — vẫn là combat turn-based bình thường (turn queue, skill, item như combat thường), mini-game chỉ chen vào như **1 "phase" ngắt quãng**, đúng tinh thần `GameMode.miniGame.reason: "bossPhase"` đã có sẵn trong data model.

Cơ chế:
- Mỗi boss có 1 hoặc nhiều **ngưỡng HP kích hoạt phase** (VD: 50% HP). Khi HP boss chạm ngưỡng, combat tạm dừng (không mất turn queue hiện có — `CombatState` giữ nguyên), `GameMode` chuyển sang `{ kind: "miniGame", reason: "bossPhase" }`.
- Mini-game dùng cho phase: mặc định **Magic Tiles** (đã đơn giản hóa đủ an toàn để dùng rộng — xem mục 1.8 trong design doc chính), nhưng field `miniGameId` trên `SkillEffect`/cấu hình boss vẫn cho phép gán game khác nếu muốn đa dạng hóa.
- Thắng phase: `MiniGameResult.maxCombo` quy đổi thành sát thương thẳng vào boss (xem công thức combo ở mục 2) — tính là 1 "đòn" ngoài turn queue, không tốn lượt của ai.
- Thua phase: không insta-kill, không mất turn — chỉ `fear += 15` cho cả party (như thua mini-game thường, `gameplay-decisions/03-survival-stats.md` mục 3) rồi combat turn-based tiếp tục bình thường từ đúng chỗ đang dừng.
- Mỗi ngưỡng HP chỉ kích hoạt phase **đúng 1 lần** (tránh spam mini-game liên tục nếu boss dao động quanh ngưỡng do heal/lifesteal).

---

## 2. Magic Tiles — số liệu cụ thể

Nguyên tắc (đã chốt ở design doc 1.8): tune theo kỳ vọng người chơi trung bình, không cần giữ combo liên tục mới thắng.

| Biến | Dùng để trị debuff | Dùng ở boss phase |
|---|---|---|
| Thời lượng ván | 20 giây | 30 giây |
| Tốc độ spawn tile (khoảng cách giữa 2 tile) | bắt đầu 700ms, giảm dần theo độ sâu tầng tới sàn 400ms (`spawnIntervalMs = max(400, 700 - floorDepth * 15)`) | cố định 500ms (khó hơn debuff-cure mặc định, không phụ thuộc tầng) |
| Điểm mục tiêu | `targetScore = round(duration_seconds * 1.2)` → 24 điểm | `round(30 * 1.2)` → 36 điểm |

- Mỗi tile hit = **+1 điểm** (nhị phân, không graded — đã chốt ở 1.8).
- **Combo**: mỗi 5 hit liên tiếp không trượt tăng hệ số nhân thêm **+0.1x**, trần **2.0x** (tức tối đa combo 50 hit liên tục). Trượt 1 tile → combo về 0, nhưng **điểm đã ghi không bị trừ** (điều kiện thắng chỉ nhìn tổng điểm, không nhìn combo).
- Hệ số combo cuối ván (`maxCombo` quy đổi ra hệ số, VD combo 20 → 1.4x) nhân vào:
  - Hiệu quả trị debuff (VD: giảm `durationTurns` còn lại của status effect theo tỉ lệ hệ số) khi dùng cho debuff-cure.
  - Sát thương lên boss khi dùng cho boss phase: `bossDamage = baseBossPhaseDamage * comboMultiplier`, với `baseBossPhaseDamage` là hằng số balancing riêng theo từng boss (không cố định ở đây).
- Thắng/thua: đủ `targetScore` trong `duration` = thắng (map vào `MiniGameResult.won = true`), hết giờ mà chưa đủ = thua (`won = false`, `fearDelta = +15`).

---

## 3. Magic Tiles — UI hiển thị live progress

- **Thanh điểm**: progress bar ngang trên cùng màn hình mini-game, hiển thị `score / targetScore` (VD "14 / 24"), cập nhật ngay mỗi lần hit — không đợi tick định kỳ.
- **Thanh thời gian**: progress bar mỏng ngay dưới thanh điểm, đếm ngược từ `duration` về 0, dùng chung `performance.now()` với logic spawn tile (đã chốt ở kiến trúc — tránh desync).
- **Combo counter**: số hiển thị góc, chỉ **nhấp nháy** (highlight 1 frame) mỗi khi combo chạm mốc chia hết cho 5 (tức mỗi lần hệ số nhân tăng thêm 0.1x).
- Redraw của 3 thành phần trên nằm trong cùng tick loop của mini-game (real-time, tick cố định — theo kiến trúc dual-loop đã chốt), không redraw riêng lẻ ngoài luồng.

---

## 4. Snake / Tetris / Brick Breaker — cơ chế cụ thể

Cả 3 đều theo khung thắng/thua chung: đủ điều kiện trong thời gian quy định = thắng; hết giờ hoặc chết giữa chừng = thua (`fearDelta = +15`, giống Magic Tiles). Không có hit-combo kiểu Magic Tiles — đây là 3 game "eval nhị phân" đơn giản hơn.

### Snake
- Grid-based, tick cố định (300ms/tick ở độ khó chuẩn, giảm dần theo tầng tới sàn 180ms, tương tự cách scale của Magic Tiles).
- Điều kiện thắng: ăn đủ **N = 8 food** trong **25 giây**.
- Điều kiện thua: đâm tường hoặc tự đâm thân — thua ngay lập tức (không chờ hết giờ), không có "mạng" phụ.

### Tetris
- Chuẩn 10x20 grid, tốc độ rơi tăng dần theo thời gian trong ván (không phụ thuộc tầng — độ khó tự thân của game đã đủ biến thiên).
- Điều kiện thắng: xóa đủ **4 hàng** trong **40 giây**.
- Điều kiện thua: khối chồng tới đỉnh grid (game-over chuẩn của Tetris) hoặc hết giờ chưa đủ 4 hàng.

### Brick Breaker
- Paddle di chuyển liên tục khi giữ phím trái/phải, dùng Kitty keyboard key-release event để dừng paddle ngay khi nhả phím (giải quyết đúng vấn đề kỹ thuật đã nêu ở design doc 1.7).
- Điều kiện thắng: phá đủ **60% tổng số gạch** trong **35 giây**.
- Số mạng (bóng rơi khỏi paddle): **3 mạng**; hết mạng trước khi đạt 60% hoặc hết giờ = thua.
