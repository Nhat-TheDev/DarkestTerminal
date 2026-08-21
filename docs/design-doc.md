# Darkest Terminal — Design Doc

**Phiên bản tài liệu**: 0.1
**Loại dự án**: Side project cá nhân / giải trí — không phải sản phẩm nghiêm túc để phát hành

Tài liệu này mô tả thiết kế hiện tại của game, đúng với những gì đã implement
trong code. Các phần chưa implement (mini-game, FOV/pathfinding, class mới)
được gom riêng ở mục "Định hướng tương lai" cuối tài liệu — không lẫn vào
phần mô tả gameplay hiện có.

---

## 1. SPEC

### 1.1 Tổng quan gameplay
- Thể loại: roguelike dungeon crawler, chạy trên terminal (TUI)
- Party 4 nhân vật (chọn từ 4 class ở đầu game), di chuyển xuống dần các tầng hầm ngục
- Vòng lặp chính: đánh quái (combat) — khám phá (di chuyển giữa các phòng) — sinh tồn (survival management)

### 1.2 Combat
- Turn-based theo round, mỗi round 2 pha: **ra lệnh** (người chơi chọn hành động + mục tiêu cho cả 4 nhân vật trước, không thấy trước quái làm gì) rồi **thực thi** (nhân vật + quái lần lượt ra đòn theo **tốc độ**, cao trước thấp sau)
- **Permadeath thật sự** — nhân vật chết là mất hẳn, không hồi sinh
- Thuật toán 2 pha đầy đủ (rule mục tiêu chết trước lượt, thời điểm trừ MP, ...): **[`technical-decisions.md`](./technical-decisions.md)** mục 2
- Chỉ số HP/MP/attack/defense/aggro/speed + công thức tăng trưởng theo cấp: **[`gameplay-decisions/05-character-stats.md`](./gameplay-decisions/05-character-stats.md)** mục 5

### 1.3 Survival stats
- 3 chỉ số: **sợ hãi (fear)**, **đói (hunger)**, **khát (thirst)** — cộng thêm HP, MP riêng
- Fear tăng theo độ sâu tầng và các sự kiện bất lợi; hunger/thirst giảm dần theo hành động
- Hồi phục qua item hoặc nghỉ tại rest room
- Ngưỡng số cụ thể: **[`gameplay-decisions/03-survival-stats.md`](./gameplay-decisions/03-survival-stats.md)** mục 3; fear có ảnh hưởng ngược lại combat: **[`gameplay-decisions/04-fear-combat.md`](./gameplay-decisions/04-fear-combat.md)** mục 4

### 1.4 Cấu trúc tầng (Floor/Room)
- Mỗi tầng sinh bằng thuật toán runtime, có rẽ nhánh (đồ thị theo stage, không phải chuỗi tuyến tính) nhưng luôn hội tụ về 1 phòng boss cuối, không có ngõ cụt
- Có rest room (hồi survival stats) và event room (sự kiện random) xen giữa các phòng combat
- Thuật toán sinh tầng cụ thể: **[`technical-decisions.md`](./technical-decisions.md)** mục 1

### 1.5 Class & Skill
- Mỗi class: **6 skill total** — 1 **đòn đánh thường** (miễn phí, dùng chung cấu trúc mọi class, gây sát thương thuần theo vũ khí) + **5 skill riêng**, bắt đầu với 2 skill riêng, mở dần 3 skill riêng còn lại khi lên cấp
- 6 chỉ số định hình mỗi class: **tấn công, phòng thủ, máu, mana, thu hút** (tỉ lệ bị quái chọn làm mục tiêu), **tốc độ** (ưu tiên ra đòn trước)
- 1 số skill riêng có thêm **cooldown theo lượt**
- 4 class, bảng chỉ số + nội dung skill cụ thể: **[`gameplay-decisions/01-class-skill.md`](./gameplay-decisions/01-class-skill.md)** mục 1 (Vanguard, Mage, Rogue, Acolyte)

### 1.6 Item & Artifact
- **Item tiêu hao**: hỗ trợ sinh tồn (hunger/thirst/fear) và hồi HP/MP, dùng trong hoặc ngoài combat, rơi ngẫu nhiên từ quái
- **Artifact**: relic **trang bị** cho 1 nhân vật cụ thể (tối đa 3/nhân vật, hiệu ứng chỉ tính cho người đang gắn), vĩnh viễn trong 1 run, nhiều bậc hiếm, rơi từ Elite/Boss/event room
- Spec đầy đủ (danh sách item/artifact, tỉ lệ rơi, bậc hiếm): **[`gameplay-decisions/07-items-artifacts.md`](./gameplay-decisions/07-items-artifacts.md)** mục 7

### 1.7 Event room
- Phòng sự kiện: bước vào roll ngẫu nhiên 1 trong nhiều loại sự kiện, chia theo tier độ hiếm
- Chi tiết từng loại sự kiện: **[`gameplay-decisions/08-events.md`](./gameplay-decisions/08-events.md)** mục 8

### 1.8 Status Effect (buff/debuff)
- Trạng thái tạm thời áp lên nhân vật/quái (VD `poisoned`, `stunned`, `weakened`, `burning`, các buff như `guard`/`rally`), hết hạn theo `durationTurns`, không stack chồng — áp lại chỉ refresh lại thời lượng
- Danh sách status effect và cách chúng tương tác với skill: **[`gameplay-decisions/01-class-skill.md`](./gameplay-decisions/01-class-skill.md)** mục 1

---

## 2. Tech stack

**OpenTUI (Node.js/TypeScript), chạy qua Bun.**

---

## 3. Kiến trúc — nguyên tắc đã chốt

- **Dungeon loop turn-based**: chỉ redraw khi có action, không có real-time tick
- **Data-driven skill & item**: `SkillEffect` dùng chung giữa skill, item, và status effect — resolver (`resolveSkillEffect`) là 1 hàm thuần túy switch theo `effect.kind`
- **Status effect data-driven**: hiệu ứng theo lượt của buff/debuff (`perTurnEffects`) và các cờ đặc biệt (`onHitStatusEffectId`, `stuns`, `vulnerableTo`) đều nằm trong `data/status-effects.json`

---

## 4. Data model

Type chính nằm ở `src/types.ts`, đối chiếu bản sketch gốc **[`dungeon-crawler-data-model.ts`](../dungeon-crawler-data-model.ts)** ở thư mục gốc repo.

Các nhóm type chính:
- `Character`, `CharacterClass`, `SkillDefinition`, `SkillEffect` (data-driven)
- `StatusEffectDefinition`, `ActiveStatusEffect` (`{ statusEffectId, turnsRemaining }`)
- `ItemDefinition`, `ArtifactDefinition`
- `Room`, `Floor` (cấu trúc hầm ngục)
- `EventDefinition` (event room)
- `Monster`, `Combatant`, `QueuedAction`, `CombatState` (`phase: "command" | "resolution"`)
- `GameState`

---

## 5. Quyết định chi tiết (tách file)

### Gameplay / nội dung — [`gameplay-decisions/`](./gameplay-decisions/00-index.md)
- Tên 4 class + bảng 6 chỉ số + danh sách 6 skill/class đầy đủ (Vanguard, Mage, Rogue, Acolyte)
- Monster: công thức scaling theo độ sâu tầng + targeting theo `aggro` + AI pattern
- Ngưỡng số cụ thể cho fear/hunger/thirst và 4 bậc fear, ảnh hưởng ngược lại combat
- Hệ thống level 1-100 (tăng trưởng theo tier, không tuyến tính) cho attack/defense/maxHp/maxMp; level nhân vật (chung party, tăng qua EXP) tách khỏi level tầng ngục (`Floor.depth`, không giới hạn)
- Elite (đa số các tầng) tách khỏi Boss thật (mỗi 5 tầng) — cả 2 có bộ skill riêng
- Item tiêu hao + Artifact trang bị, độ hiếm, nguồn rơi
- Event room: các loại sự kiện, chia theo tier độ hiếm

### Kỹ thuật — [`technical-decisions.md`](./technical-decisions.md)
- Sinh room/floor bằng thuật toán runtime, đảm bảo hết ngõ cụt và mọi nhánh đều hội tụ về boss bằng kết cấu (không cần validate-and-retry)
- Thuật toán round 2 pha: pha ra lệnh (chốt hành động cả 4 nhân vật, trừ MP/lượt ngay lúc đó) rồi pha thực thi (sort theo `speed`, quái quyết định tại chỗ, rule đổi/hủy mục tiêu nếu target đã chết trước lượt)
- Resolver function cho `SkillEffect`: 1 hàm thuần túy switch theo `kind`, dùng chung skill/item/status effect

---

## Định hướng tương lai (chưa implement)

Các phần dưới đây **chưa có trong code hiện tại** — giữ lại làm spec tham
khảo cho khi triển khai, không mô tả trạng thái game hiện có.

- **4 mini-game** (Snake, Tetris, Brick Breaker, Magic Tiles) dùng để chữa debuff và làm boss phase — số liệu cụ thể + cơ chế Magic Tiles (hit/miss, combo, score/time): **[`minigame-decisions.md`](./minigame-decisions.md)**
- **2 class mới** (Viking, Plague Doctor) + công thức cân bằng base stats dùng chung: **[`gameplay-decisions/09-new-classes-viking-plaguedoctor.md`](./gameplay-decisions/09-new-classes-viking-plaguedoctor.md)**
- **FOV** (shadowcasting) và **pathfinding** (A* cho quái)
- **Rendering diff-based**
- **Treasure room** — loại phòng 100% rơi Artifact, có type (`RoomType: "treasure"`) và spec (`gameplay-decisions/07-items-artifacts.md` §7.2) nhưng thuật toán sinh tầng hiện không tạo loại phòng này
