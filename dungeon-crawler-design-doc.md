# Dungeon Crawler Terminal (chưa đặt tên chính thức) — Design Doc

**Trạng thái**: Giai đoạn thiết kế, chưa implement
**Loại dự án**: Side project cá nhân / giải trí — không phải sản phẩm nghiêm túc để phát hành
**Cập nhật**: 14/08/2026

## Tóm tắt nhanh

**Đã chốt**: genre & platform, core gameplay loop, combat model, permadeath, 3 survival stat, cấu trúc tầng/phòng, hệ class/skill, 4 mini-game cụ thể + risk profile từng game, cơ chế Magic Tiles (hit/miss + combo + score/time), tech stack (OpenTUI), kiến trúc dual-loop, data model (file riêng).

**Để mở**: tên/nội dung class cụ thể, monster design, quan hệ boss-fight ↔ mini-game, ngưỡng số cho survival stats, ảnh hưởng ngược của fear lên combat, số liệu cụ thể Magic Tiles, thuật toán procedural generation, thuật toán turn queue, resolver logic cho SkillEffect.

---

## 1. SPEC

### 1.1 Tổng quan gameplay
- Thể loại: roguelike dungeon crawler, chạy trên terminal (TUI)
- Party 4 nhân vật, nhiều class khác nhau, di chuyển xuống dần các tầng hầm ngục
- Vòng lặp chính: đánh quái (combat) — khám phá (exploration) — sinh tồn (survival management)

### 1.2 Combat
- Turn-based, **turn riêng từng nhân vật** (tactical, không phải cả team hành động như 1 khối)
- Turn queue xen kẽ giữa 4 nhân vật và quái (initiative-based)
- **Permadeath thật sự** — nhân vật chết là mất hẳn, không hồi sinh

### 1.3 Survival stats
- 3 chỉ số: **sợ hãi (fear)**, **đói (hunger)**, **khát (thirst)** — cộng thêm HP, MP riêng
- Fear tăng theo: độ bóng tối của tầng (darkness tăng dần theo độ sâu) + thua mini-game
- Hunger/thirst giảm dần theo thời gian/hành động
- Hồi phục qua: item, hoặc nghỉ tại rest room

### 1.4 Cấu trúc tầng (Floor/Room)
- Mỗi tầng: 5-10 phòng, có **rẽ nhánh** (đồ thị, không phải chuỗi tuyến tính)
- 1-2 phòng trống dùng để nghỉ ngơi (rest room), hồi survival stats
- Xuống tầng sâu hơn → darkness tăng → fear tăng theo (ambient)

### 1.5 Class & Skill
- Mỗi class: **5 skill total**, bắt đầu với 2, mở dần 3 skill còn lại khi lên cấp
- Tên class cụ thể và danh sách skill: chưa quyết định (xem mục 5)

### 1.6 Item
- Hỗ trợ duy trì sinh tồn (hunger/thirst/fear) và hồi HP/MP

### 1.7 Status Effect (debuff) & Mini-game
- Có "trạng thái bất lợi đặc biệt" (debuff) — trị liệu bằng cách chơi mini-game
- Mini-game cũng dùng để đánh boss
- Thua mini-game → tăng fear
- **4 mini-game cụ thể đã chọn**: Snake, Tetris, Brick Breaker, Magic Tiles

| Mini-game | Rủi ro kỹ thuật | Ghi chú |
|---|---|---|
| Snake | Thấp | Tick-based, rất phổ biến trên terminal/curses |
| Tetris | Thấp | Tương tự Snake, tiền lệ nhiều |
| Brick Breaker | Trung bình | Cần "giữ phím" liên tục cho paddle → giải quyết bằng Kitty keyboard protocol (key release event) |
| Magic Tiles | Ban đầu cao, đã giảm sau khi đơn giản hóa | Xem chi tiết 1.8 |

Gợi ý phân bổ (chưa bắt buộc): game rủi ro thấp (Snake/Tetris) cho trị liệu debuff vì xảy ra thường xuyên; Magic Tiles ban đầu đề xuất riêng cho boss, nhưng sau khi đơn giản hóa (1.8) đã đủ an toàn để dùng rộng hơn nếu muốn.

### 1.8 Magic Tiles — cơ chế đã chốt
- **Không chấm điểm graded** (không có good/great/perfect) — chỉ **hit/miss nhị phân**
- Có **hit combo** — dùng làm hệ số nhân cho hiệu quả (combo cao → trị debuff triệt để hơn / damage lên boss nhiều hơn)
- **Điều kiện thắng/thua**: tính điểm liên tục; đủ điểm mục tiêu trong thời gian quy định = thắng, không đủ = thua
- 3 biến độ khó độc lập để tuning: tốc độ spawn tile, thời lượng ván, điểm mục tiêu

---

## 2. Tech stack

**Đã chốt: OpenTUI (Node.js/TypeScript)**

Lý do:
- Core native viết bằng Zig → hiệu năng redraw cao, cần thiết cho mini-game real-time (đặc biệt Magic Tiles cần redraw mượt)
- Có sẵn Kitty keyboard protocol (`useKittyKeyboard` config, bao gồm key-release events) → giải quyết vấn đề "giữ phím" cho Brick Breaker
- Đã chạy production thật (OpenCode, terminal.shop) — không phải lib thử nghiệm
- Tận dụng nền Node/TS sẵn có từ các dự án khác (Mitom, agentmemory)

**Phương án đã cân nhắc nhưng không chọn**:
- **Silvery** — framework TS khác, tương thích Ink, đầy đủ Kitty protocol; phương án dự phòng đáng chú ý nhưng chưa có track record production
- **Python + tcod** — có sẵn FOV/pathfinding/procedural gen cho roguelike, nhưng tách khỏi hệ Node/TS quen thuộc
- **Rust + ratatui** — hiệu năng tốt, cộng đồng roguelike sôi động, nhưng learning curve dốc nếu chưa quen Rust
- **Node + blessed/neo-blessed** — thấp cấp, kiểm soát trực tiếp, nhưng phải tự code nhiều hơn (không có reconciler)

---

## 3. Kiến trúc — nguyên tắc đã chốt

- **Dual loop**: dungeon loop (turn-based, chỉ redraw khi có action) tách biệt hoàn toàn khỏi mini-game loop (real-time, tick cố định, redraw liên tục)
- **MiniGameSession**: interface chung (`start / tick / handleInput / isComplete / getResult`) — dungeon loop không cần biết chi tiết bên trong từng mini-game; thêm mini-game thứ 5 không đụng vào dungeon loop
- **Data-driven skill & item**: `SkillEffect` dùng chung giữa skill và item, tránh hardcode logic riêng cho từng cái — quan trọng vì có thể lên tới 20-30 skill cần balance (4-6 class × 5 skill)
- **StatusEffect ↔ mini-game**: quan hệ "debuff nào chữa bằng game nào" encode vào data (`curableByMiniGame`), không rải rác trong logic
- **Monotonic clock**: dùng `performance.now()` cho mini-game timing, không dùng `Date.now()`; dùng CHUNG một nguồn thời gian cho cả đếm giờ lẫn tính vị trí tile, tránh desync khi lag

### Rủi ro kỹ thuật đã xác định (chưa cần giải quyết ngay, nhưng cần nhớ khi implement)
- **Rendering**: full redraw gây flicker → cần diff-based redraw; terminal không đồng nhất về truecolor/Unicode wide-char (CJK/emoji)
- **FOV**: thuật toán shadowcasting — lý thuyết không khó nhưng dễ sai ở edge case (góc tường, đường chéo)
- **Pathfinding**: A* cho nhiều quái mỗi turn, cần cache/tối ưu nếu map lớn
- **Procedural generation**: sinh phòng có rẽ nhánh + đảm bảo đúng số rest room là bài toán constraint-satisfaction, không chỉ "khoét phòng nối hành lang"
- **UI real estate**: HP/MP/3 survival stat × 4 nhân vật + map + log + inventory cạnh tranh không gian màn hình → cần information hierarchy (panel chính luôn hiện, chi tiết qua modal/tab)

---

## 4. Data model

Đã sketch trong file riêng: **[`dungeon-crawler-data-model.ts`](./dungeon-crawler-data-model.ts)** (TypeScript, đã compile qua `tsc --noEmit` sạch, cùng thư mục với file này).

Các type chính:
- `Character`, `CharacterClass`, `SkillDefinition`, `SkillEffect` (data-driven)
- `StatusEffectDefinition`
- `ItemDefinition`
- `Room`, `Floor` (cấu trúc hầm ngục)
- `MiniGameSession`, `MiniGameResult`, `KeyEvent` (mini-game)
- `Monster`, `Combatant`, `CombatState` (combat)
- `GameState`, `GameMode` (nối dungeon loop và mini-game loop)

---

## 5. Để mở (chưa quyết định)

Đã tách placeholder cho từng mục ra file riêng trong `docs/` (chỉ có khung, chưa có nội dung — xem section-start guidance ở mỗi file).

### Gameplay / nội dung — xem [`docs/gameplay-todo.md`](./docs/gameplay-todo.md)
- Tên class cụ thể và danh sách 5 skill/class (mới có ví dụ minh họa, chưa phải nội dung thật)
- Monster: chỉ số atk/def, AI pattern
- Ngưỡng số cụ thể cho fear/hunger/thirst (bao nhiêu thì ảnh hưởng gì tới gameplay)
- Fear có ảnh hưởng ngược lại hiệu suất combat không? (đáng cân nhắc vì permadeath là thật — thua mini-game → fear tăng → nếu fear debuff combat thì rủi ro chồng rủi ro)

### Mini-game — xem [`docs/minigame-todo.md`](./docs/minigame-todo.md)
- Quan hệ boss-fight ↔ mini-game: boss fight có hoàn toàn thay bằng mini-game, hay combat turn-based thường + mini-game xen giữa như 1 "phase"?
- Magic Tiles: số liệu cụ thể (tốc độ spawn, thời lượng, điểm mục tiêu) — nguyên tắc đã thống nhất là tính theo kỳ vọng người chơi trung bình (không giữ combo liên tục), số cụ thể chưa chốt
- Magic Tiles: UI hiển thị live progress (điểm hiện tại/mục tiêu hoặc thời gian còn lại) — đã đề xuất, chưa thiết kế chi tiết
- Snake/Tetris/Brick Breaker: mới đánh giá độ rủi ro kỹ thuật, chưa thiết kế cơ chế cụ thể như Magic Tiles

### Kỹ thuật — xem [`docs/technical-todo.md`](./docs/technical-todo.md)
- Thuật toán procedural generation cụ thể cho room/floor (constraint-satisfaction: rẽ nhánh + đảm bảo rest room)
- Thuật toán turn queue/initiative cụ thể (data shape đã có trong `CombatState`, logic tính thứ tự chưa có)
- Resolver function đọc `SkillEffect`/data và áp dụng effect thật sự (bước tiếp theo tự nhiên sau data model)
