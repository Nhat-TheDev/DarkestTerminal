# Dungeon Crawler Terminal (chưa đặt tên chính thức) — Design Doc

**Trạng thái**: Giai đoạn thiết kế, chưa implement
**Loại dự án**: Side project cá nhân / giải trí — không phải sản phẩm nghiêm túc để phát hành
**Cập nhật**: 15/08/2026

## Tóm tắt nhanh

**Đã chốt**: genre & platform, core gameplay loop, combat model (round 2 pha: ra lệnh + thực thi theo tốc độ), permadeath, 6 chỉ số class (tấn công/phòng thủ/máu/mana/thu hút/tốc độ) + targeting theo thu hút + hệ thống level 1-100 tăng trưởng phụ thuộc class, 3 survival stat (cùng giá trị khởi tạo mọi class) + ngưỡng số cụ thể, ảnh hưởng ngược của fear lên combat, cấu trúc tầng/phòng qua thư viện pattern dạng dữ liệu (random chọn 1 pattern/tầng — không phải thuật toán procedural generation), hệ class/skill (4 class × 6 skill: 1 đòn đánh thường dùng chung theo vũ khí + 5 skill riêng, nội dung cụ thể, mốc mở skill 10/20/35, cooldown theo lượt cho 1 số skill mạnh), monster design (scaling + AI pattern), 4 mini-game cụ thể + risk profile từng game, cơ chế Magic Tiles (hit/miss + combo + score/time) + số liệu cụ thể, quan hệ boss-fight ↔ mini-game, tech stack (OpenTUI), kiến trúc dual-loop, resolver logic cho SkillEffect, data model (file riêng).

**Để mở**: không còn mục nào ở tầm thiết kế — toàn bộ đã có quyết định cụ thể, xem `docs/*.md`. Các con số balancing (damage, threshold %, ...) vẫn chỉ là điểm khởi đầu, sẽ điều chỉnh khi có bản chơi được để playtest.

---

## 1. SPEC

### 1.1 Tổng quan gameplay
- Thể loại: roguelike dungeon crawler, chạy trên terminal (TUI)
- Party 4 nhân vật, nhiều class khác nhau, di chuyển xuống dần các tầng hầm ngục
- Vòng lặp chính: đánh quái (combat) — khám phá (exploration) — sinh tồn (survival management)

### 1.2 Combat
- Turn-based theo round, mỗi round 2 pha: **ra lệnh** (người chơi chọn hành động + mục tiêu cho cả 4 nhân vật trước, không thấy trước quái làm gì) rồi **thực thi** (nhân vật + quái lần lượt ra đòn theo **tốc độ**, cao trước thấp sau)
- **Permadeath thật sự** — nhân vật chết là mất hẳn, không hồi sinh
- Thuật toán 2 pha đầy đủ (rule mục tiêu chết trước lượt, thời điểm trừ MP, ...): **[`technical-decisions.md`](./technical-decisions.md)** mục 2
- Hiệu quả HP/MP/attack/defense/aggro/speed + công thức tăng trưởng theo cấp: **[`gameplay-decisions/05-character-stats.md`](./gameplay-decisions/05-character-stats.md)** mục 5

### 1.3 Survival stats
- 3 chỉ số: **sợ hãi (fear)**, **đói (hunger)**, **khát (thirst)** — cộng thêm HP, MP riêng
- Fear tăng theo: độ bóng tối của tầng (darkness tăng dần theo độ sâu) + thua mini-game
- Hunger/thirst giảm dần theo thời gian/hành động
- Hồi phục qua: item, hoặc nghỉ tại rest room
- Ngưỡng số cụ thể: **[`gameplay-decisions/03-survival-stats.md`](./gameplay-decisions/03-survival-stats.md)** mục 3; fear có ảnh hưởng ngược lại combat: **[`gameplay-decisions/04-fear-combat.md`](./gameplay-decisions/04-fear-combat.md)** mục 4

### 1.4 Cấu trúc tầng (Floor/Room)
- Mỗi tầng: 5-10 phòng, có **rẽ nhánh** (đồ thị, không phải chuỗi tuyến tính)
- 1-2 phòng trống dùng để nghỉ ngơi (rest room), hồi survival stats
- Xuống tầng sâu hơn → darkness tăng → fear tăng theo (ambient)
- Thuật toán sinh phòng cụ thể: **[`technical-decisions.md`](./technical-decisions.md)** mục 1

### 1.5 Class & Skill
- Mỗi class: **6 skill total** — 1 **đòn đánh thường** (miễn phí, dùng chung cấu trúc mọi class, gây sát thương thuần theo vũ khí: kiếm=chém, dao=đâm, gậy=đập, tay không=đấm) + **5 skill riêng**, bắt đầu với 2 skill riêng (cộng đòn đánh thường luôn có sẵn), mở dần 3 skill riêng còn lại khi lên cấp
- 6 chỉ số định hình mỗi class: **tấn công, phòng thủ, máu, mana, thu hút** (tỉ lệ bị quái chọn làm mục tiêu), **tốc độ** (ưu tiên ra đòn trước)
- 1 số skill riêng có thêm **cooldown theo lượt** (ngoài `usesPerCombat`) để tránh bị spam liên tục khi lên cấp cao (MP dư dả)
- 4 class, bảng chỉ số + nội dung skill cụ thể: **[`gameplay-decisions/01-class-skill.md`](./gameplay-decisions/01-class-skill.md)** mục 1 (Vanguard, Mage, Rogue, Acolyte)

### 1.6 Item
- Hỗ trợ duy trì sinh tồn (hunger/thirst/fear) và hồi HP/MP
- **Cập nhật 2026-08-17**: spec đầy đủ (10 item tiêu hao, id/name tiếng Anh) + khái niệm mới **Artifact** (relic **trang bị** cho 1 nhân vật cụ thể — tối đa 3/nhân vật, không phải buff cả đội — vĩnh viễn trong 1 run, 30 cái, 11 loại hiệu ứng, 4 bậc hiếm, rơi từ Elite/Boss/Treasure room/Event room) không có trong outline gốc này — xem **[`gameplay-decisions/07-items-artifacts.md`](./gameplay-decisions/07-items-artifacts.md)** §7

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
- Số liệu cụ thể + UI + quan hệ với boss-fight và 3 mini-game còn lại: **[`minigame-decisions.md`](./minigame-decisions.md)**

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
- **Data-driven skill & item**: `SkillEffect` dùng chung giữa skill và item, tránh hardcode logic riêng cho từng cái — quan trọng vì có thể lên tới 25-35 skill cần balance (4-6 class × 6 skill)
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

Đã sketch trong file riêng: **[`dungeon-crawler-data-model.ts`](../dungeon-crawler-data-model.ts)** (TypeScript, đã compile qua `tsc --noEmit --strict` sạch, ở thư mục gốc repo). `SurvivalStats` giờ chỉ còn `fear`/`hunger`/`thirst`; `attack`/`defense`/`hp`/`maxHp`/`mp`/`maxMp`/`aggro`/`speed` là field phẳng trực tiếp trên `Character`/`Monster`. Đã thêm `QueuedAction`/`ActionSource` + `CombatState.phase`/`queuedActions` cho mô hình round 2 pha (mục 1.2), `SkillEffectKind.modifyCombatStat`, `SkillDefinition.usesPerCombat`, `Monster.aiPattern`, `CharacterClass.growthWeights` cho tăng trưởng theo cấp phụ thuộc class (`gameplay-decisions/06-level-system.md` §6.8), và `ActiveStatusEffect` (`{ statusEffectId, turnsRemaining }`) thay cho `statusEffectIds: Id[]` phẳng trên `Character`/`Monster` — cần track riêng số lượt còn lại cho `durationTurns` của từng debuff/buff đang mang.

Các type chính:
- `Character`, `CharacterClass`, `SkillDefinition`, `SkillEffect` (data-driven)
- `StatusEffectDefinition`, `ActiveStatusEffect`
- `ItemDefinition`
- `Room`, `Floor` (cấu trúc hầm ngục)
- `MiniGameSession`, `MiniGameResult`, `KeyEvent` (mini-game)
- `Monster`, `Combatant`, `QueuedAction`, `CombatState` (combat)
- `GameState`, `GameMode` (nối dungeon loop và mini-game loop)

---

## 5. Quyết định chi tiết (tách file)

Toàn bộ mục từng nằm ở "Để mở" nay đã có quyết định cụ thể, tách ra các file riêng cùng thư mục `docs/` với file này để mục 1-4 ở trên không quá dài:

### Gameplay / nội dung — [`gameplay-decisions/`](./gameplay-decisions/00-index.md)
- Tên 4 class + bảng 6 chỉ số (attack/defense/maxHp/maxMp/aggro/speed) + danh sách 6 skill/class đầy đủ (1 đánh thường + 5 riêng; Vanguard, Mage, Rogue, Acolyte)
- Monster: công thức scaling atk/def/hp theo độ sâu tầng + targeting theo `aggro` (random có trọng số) + 3 AI pattern (aggressive/defensive/erratic)
- Giá trị khởi tạo + ngưỡng số cụ thể cho fear/hunger/thirst (giống nhau mọi class) và 4 bậc fear
- Fear ảnh hưởng ngược lại combat — có, theo bậc, nhưng chặn trần ở bậc cao nhất để không tạo tử vòng xoáy
- Hiệu quả HP=0/MP thiếu + hệ thống level 1-100 (5 tier tapered growth, không tuyến tính) cho attack/defense/maxHp/maxMp, đã kiểm chứng TTK xuyên suốt dải level + sửa lỗi hệ số elite boss gây bất tử ở tầng sâu (`aggro`/`speed` không tăng theo cấp)
- **Cập nhật 2026-08-16 (§6.9/6.10)**: level nhân vật tách khỏi level tầng ngục — level nhân vật (chung cả party, cap 100) tăng qua EXP tích lũy từ giết quái; level tầng ngục (`Floor.depth`, không giới hạn — roguelite vô hạn) tăng khi hạ boss của tầng, không còn đồng bộ 1-1 với level nhân vật như thiết kế cũ
- **Cập nhật 2026-08-16 (§6.11/6.12)**: tách Elite (đa số các tầng) khỏi Boss thật (mỗi 5 tầng, mạnh hơn hẳn, loại trừ Elite tầng đó) — cả 2 có bộ skill riêng (strike/cleave AoE; Boss thêm debuff + Finishing Blow tích lực 1 lượt rồi dồn sát thương cố định cực cao)
- **Cập nhật 2026-08-17 (§7, mới)**: Item tiêu hao (10 cái, dùng trong/ngoài combat qua `effects` tái dùng resolver có sẵn) + Artifact (30 cái, 11 loại hiệu ứng — statBoost/reflectDamage/poisonOnHit/lifesteal/dodgeChance/healOnKill/autoDamage/expBoost/fearResist/cooldownReduction/survivalDrainReduction — 4 bậc hiếm common/rare/unique/epic, relic vĩnh viễn trong run — mất khi permadeath) rơi từ giết Elite (35%)/Boss (100%)/Treasure room/Event room (2 loại phòng mới). **Artifact là trang bị** — gắn vào 1 nhân vật cụ thể (tối đa 3/nhân vật), hiệu ứng chỉ tính cho người đang gắn, không còn cộng thẳng cho cả đội. Mọi id/name của Item/Artifact bằng tiếng Anh, khớp hướng đổi tên của monster/class.

### Mini-game — [`minigame-decisions.md`](./minigame-decisions.md)
- Quan hệ boss-fight ↔ mini-game: combat turn-based bình thường, mini-game chỉ chen vào như 1 phase ở các mốc HP nhất định
- Magic Tiles: số liệu cụ thể cho cả debuff-cure lẫn boss phase (thời lượng, tốc độ spawn, điểm mục tiêu, công thức combo)
- Magic Tiles: thiết kế UI live progress (thanh điểm, thanh thời gian, combo counter)
- Snake/Tetris/Brick Breaker: điều kiện thắng/thua và thông số cụ thể từng game

### Kỹ thuật — [`technical-decisions.md`](./technical-decisions.md)
- Sinh room/floor: thư viện pattern dạng dữ liệu (chuỗi `stage.roomId[tag]`), random chọn 1 pattern mỗi tầng — mọi phòng ở stage N nối hết sang stage N+1 nên đảm bảo hết ngõ cụt và mọi nhánh đều về boss bằng kết cấu, không cần validate-and-retry; tối đa 2 stage được phép rẽ nhánh (thay cho random spanning tree ở bản trước)
- Thuật toán round 2 pha: pha ra lệnh (chốt hành động cả 4 nhân vật, trừ MP/lượt ngay lúc đó) rồi pha thực thi (sort theo `speed`, quái quyết định tại chỗ, rule đổi/hủy mục tiêu nếu target đã chết trước lượt)
- Resolver function cho `SkillEffect`: 1 hàm thuần túy switch theo `kind`, dùng chung skill/item, xử lý cả case `triggerMiniGame` (mini-game trả kết quả về dưới dạng effect phái sinh, không có code path riêng)
