# §2. Monster — chỉ số, targeting theo aggro & AI pattern

*(mục 2 của `00-index.md`)*

**Quy ước đặt tên (cập nhật 2026-08-17)**: mọi `id`/`name` monster đều bằng **tiếng Anh**, khớp `data/monsters.json` hiện hành (trước đây tiếng Việt, VD "Chuột Hầm Ngục" → "Dungeon Rat").

### Công thức scaling theo độ sâu tầng (`floorDepth`, tầng 1 = depth 1)

Số liệu hiện hành: `growthBonus(stat, floorDepth)`, tapered theo 5 tier — xem `06-level-system.md` **§6.3/§6.6**. `speed = baseSpeed` (không scale theo tầng).

Đây là công thức archetype → instance, dùng khi spawn quái vào `Room.monsterIds`; các field `attack/defense/hp/maxHp/speed` trên `Monster` luôn là giá trị đã resolve, không lưu công thức.

### Chọn mục tiêu theo `aggro` ("thu hút")

Quy tắc mặc định (dùng cho mọi pattern trừ khi nói khác ở dưới): **random có trọng số** trên toàn bộ nhân vật còn sống trong party, trọng số = `Character.aggro` hiện tại. Nhân vật `aggro` càng cao thì xác suất bị chọn làm mục tiêu càng lớn — đây chính là cách hiện thực hóa "thu hút" như 1 xác suất thay vì ép buộc cứng.

Công thức: `P(target = X) = X.aggro / tổng aggro toàn bộ nhân vật còn sống`.

### 3 AI pattern (`MonsterAiPattern`)
- **`aggressive`** (Hung Hãn): dùng thẳng quy tắc random có trọng số theo `aggro` ở trên.
- **`defensive`** (Phòng Thủ): nếu HP bản thân < 40% và có skill hồi/phòng thủ trong `skillIds` thì dùng skill đó (target: bản thân); ngược lại rơi về quy tắc random có trọng số theo `aggro` như `aggressive`.
- **`erratic`** (Hỗn Loạn): **bỏ qua** trọng số `aggro` — chọn target ngẫu nhiên đều (uniform) trong các nhân vật còn sống. Đây là điểm khác biệt thật sự của pattern này (không phải chỉ random hành động mà còn random cả việc có "nghe" threat hay không) — đúng chất quái "điên loạn", không đoán trước được kể cả khi có Taunt.

### Kiến trúc 2 nhóm archetype — combat thường vs guard-room (elite/boss)

**Cập nhật 2026-08-17**: bổ sung 12 archetype mới (từ 3 lên **15**), tách rõ 2 nhóm bằng field `guardOnly?: boolean` (`MonsterArchetype`, `src/types.ts`):

- **Combat thường** (`guardOnly` không set/`false`, **11 archetype**): xuất hiện random trong phòng combat thông thường (1-3 quái/phòng) — `COMBAT_ROOM_ARCHETYPES` ở `src/data/floor.ts`, lọc bỏ mọi archetype `guardOnly: true`.
- **Guard-room** (**5 archetype**, có cả `eliteSkillIds` lẫn `bossSkillIds` — xem `06-level-system.md` §6.12): trấn giữ phòng boss/tinh anh cuối mỗi tầng — `GUARD_ROOM_ARCHETYPES` ở `floor.ts`, lọc theo archetype có đủ 2 field skill kit đó, random chọn 1 khi build phòng `boss`. **Skeleton Guard** là archetype duy nhất thuộc **cả 2 nhóm** (vẫn xuất hiện ở combat thường lẫn được chọn làm guard-room, kế thừa đúng vai trò cũ) — 4 archetype còn lại (Giant Spider, Dragon, Zombie Knight, Dark Knight) đánh dấu `guardOnly: true`, **chỉ** xuất hiện ở tier elite/boss, không bao giờ là quái trash thường (VD Dragon sẽ không bao giờ lẻ tẻ xuất hiện làm quái lót đường).

Trước đây (`BOSS_ARCHETYPE_ID` cố định = `skeleton-guard`), mọi phòng guard-room trong toàn bộ game đều cùng 1 archetype — giờ random giữa 5 archetype mỗi lần build phòng, tăng đa dạng thị giác/thematic mà không đổi công thức scaling (elite/boss vẫn dùng `eliteMultiplier`/`bossMultiplier` chung, §6.5/§6.11).

### 11 archetype combat thường

**⚠️ Cập nhật cân bằng lần 2 (2026-08-17)**: 2 vòng chỉnh liên tiếp sau playtest thật —
1. **HP quá thấp**: bản đầu (3 archetype gốc) chết trong đúng 1 round kể cả không dùng skill nào — không kịp tạo áp lực, không có cơ hội quái ra đòn trả. Tăng `baseHp` archetype yếu (Dungeon Rat/Black Bat/Slime/Skeleton/Snake/Lizard/Spider/Skeleton Archer) lên mức đủ sống sót 2-3 round trước hỏa lực cả đội.
2. **Attack quá thấp so với defense Vanguard mới hạ** (mục 1, `baseDefense` 12→10): dù đã tăng HP, `baseAttack` cũ (8-15) vẫn khiến phần lớn quái chỉ gây 1 sát thương lên Vanguard (chạm sàn `max(1, atk−def)`). Tăng `baseAttack` toàn bộ archetype (khoảng +7 với quái combat thường, tính riêng cho 5 archetype guard-room theo hệ số elite/boss — xem bảng dưới) để đạt mục tiêu **quái thường gây 5-15 sát thương lên Vanguard, Elite gây 20-40** — chi tiết ở mục "Kiểm chứng damage vào Vanguard" bên dưới.

| id | Tên | baseHp | baseAtk | baseDef | baseSpeed | AI pattern | expReward |
|---|---|---|---|---|---|---|---|
| `dungeon-rat` | Dungeon Rat | 45 | 17 | 1 | 9 | erratic | 6 |
| `black-bat` | Black Bat | 42 | 22 | 1 | 18 | aggressive | 6 |
| `slime` | Slime | 40 | 15 | 2 | 5 | erratic | 6 |
| `skeleton` | Skeleton | 42 | 19 | 6 | 8 | aggressive | 9 |
| `zombie` | Zombie | 45 | 18 | 8 | 4 | defensive | 12 |
| `snake` | Snake | 38 | 20 | 2 | 17 | erratic | 8 |
| `lizard` | Lizard | 46 | 19 | 5 | 11 | aggressive | 9 |
| `spider` | Spider | 40 | 21 | 3 | 15 | aggressive | 9 |
| `skeleton-archer` | Skeleton Archer | 40 | 22 | 3 | 12 | erratic | 10 |
| `skeleton-warrior` | Skeleton Warrior | 40 | 22 | 9 | 7 | defensive | 13 |
| `skeleton-guard`* | Skeleton Guard | 55 | 23 | 10 | 6 | defensive | 15 |

\* `skeleton-guard` cũng là 1 trong 5 archetype guard-room (mục trên) — bảng dưới liệt kê riêng cho rõ, không trùng lặp dữ liệu.

Vai trò từng archetype (AI pattern quyết định cảm giác chơi, không chỉ chỉ số): **Dungeon Rat** (erratic, rẻ mạng, phạt nếu bỏ qua vì random target không đoán trước được), **Black Bat** (aggressive, speed cao nhất bàn — buộc ưu tiên hạ trước khi nó ra đòn), **Slime/Snake** (erratic, HP/def thấp nhưng đủ dai để không chết ngay round 1), **Skeleton/Lizard/Spider/Skeleton Archer** (mid-tier, đa dạng AI pattern để không đoán được targeting), **Zombie/Skeleton Warrior** (defensive, tanky hẳn nhờ defense cao — đòn đánh thường của Mage/Acolyte gần như vô dụng, buộc dùng skill có `amount` hoặc DoT), **Skeleton Guard** (defensive, tanky nhất nhóm combat thường, đồng thời là archetype guard-room "gốc").

### 5 archetype guard-room (elite/boss)

| id | Tên | baseHp | baseAtk | baseDef | baseSpeed | AI pattern | expReward | guardOnly |
|---|---|---|---|---|---|---|---|---|
| `skeleton-guard` | Skeleton Guard | 55 | 23 | 10 | 6 | defensive | 15 | không (dùng chung combat thường) |
| `giant-spider` | Giant Spider | 50 | 26 | 6 | 14 | aggressive | 16 | có |
| `dragon` | Dragon | 65 | 31 | 9 | 10 | aggressive | 20 | có |
| `zombie-knight` | Zombie Knight | 60 | 19 | 12 | 5 | defensive | 17 | có |
| `dark-knight` | Dark Knight | 58 | 27 | 11 | 9 | defensive | 18 | có |

Mỗi archetype có bộ skill kit elite/boss riêng (`eliteSkillIds`/`bossSkillIds`, `data/monster-skills.json`) — chi tiết đầy đủ, cơ chế Finishing Blow, và bảng kiểm chứng damage ở `06-level-system.md` §6.12.

### Kiểm chứng damage vào Vanguard (mục tiêu 5-15 quái thường / 20-40 elite)

Damage 1 hit vào Vanguard (`baseDefense 10`) từ đòn đánh thường (`max(1, baseAttack − 10)`):

| Nhóm | Archetype | atk | dmg → Vanguard |
|---|---|---|---|
| Thấp nhất | Slime | 15 | 5 |
| … | Dungeon Rat | 17 | 7 |
| … | Zombie, Zombie Knight | 18/19 | 8/9 |
| … | Skeleton, Lizard | 19 | 9 |
| … | Snake | 20 | 10 |
| … | Spider | 21 | 11 |
| Cao nhất (combat thường) | Black Bat, Skeleton Archer, Skeleton Warrior | 22 | 12 |
| Guard-room (basic, chưa scale elite) | Skeleton Guard | 23 | 13 |

Elite tier (strike skill, `amount 3` + attack đã nhân `eliteMultiplier.attack ×1.4`, `06-level-system.md` §6.5):

| Archetype | eliteAtk | strike dmg → Vanguard |
|---|---|---|
| Zombie Knight | 27 | 20 |
| Skeleton Guard | 32 | 25 |
| Giant Spider | 36 | 29 |
| Dark Knight | 38 | 31 |
| Dragon | 43 | 36 |

Đạt đúng mục tiêu ban đầu: quái thường **5-13** (không vượt 15), Elite **20-36** (trong khoảng 20-40). Boss tier tự nhiên cao hơn Elite (dùng `bossMultiplier.attack ×1.8` thay vì `×1.4`, cùng công thức skill) — không có trần riêng cho Boss, xem bảng đầy đủ ở `06-level-system.md` §6.12.

**Vì sao giảm luôn `amount` của skill strike (8→3) thay vì chỉ tăng `baseAttack`**: mục tiêu là "nguồn sát thương chủ yếu đến từ base attack (đã scale theo elite/boss multiplier), không phải bonus cố định của skill" — `amount 8` cũ gần như không đổi bất kể archetype/tầng, trong khi phần base attack đã tăng đáng kể qua đợt cân bằng này lẫn qua `growthBonusForDepth` theo tầng sâu. Hạ `amount` xuống 3 (chỉ còn ý nghĩa "đòn skill mạnh hơn đòn thường 1 chút", không còn là nguồn damage chính) để tổng damage phản ánh đúng độ mạnh archetype + tầng qua đúng 1 kênh (attack), không cộng dồn 2 kênh độc lập khó cân bằng cùng lúc.

**Hệ quả cần lưu ý (chưa xử lý)**: vì `amount` cleave (2) và strike (3) giờ chỉ chênh 1 điểm, khoảng cách "Cleave nhẹ hơn hẳn Strike trên từng mục tiêu" mô tả ở mục thiết kế gốc (`06-level-system.md` §6.12) đã thu hẹp đáng kể so với bản `amount 8/2` cũ (chênh 6 điểm) — cleave vẫn nhẹ hơn nhưng không còn rõ rệt ở cấp độ từng-target, chỉ còn rõ khi cộng dồn cả đội (AoE). Ghi nhận để chỉnh lại nếu playtest thấy cleave/strike quá giống nhau.
