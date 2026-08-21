# §2. Monster — chỉ số, targeting theo aggro & AI pattern

*(mục 2 của `00-index.md`)*

**Quy ước đặt tên**: mọi `id`/`name` monster đều bằng **tiếng Anh**, khớp `data/monsters.json`.

### Công thức scaling theo độ sâu tầng (`floorDepth`, tầng 1 = depth 1)

Số liệu hiện hành: `growthBonus(stat, floorDepth)`, tapered theo 5 tier — xem `06-level-system.md` **§6.3/§6.6**. `speed = baseSpeed` (không scale theo tầng).

Đây là công thức archetype → instance, dùng khi spawn quái vào `Room.monsterIds`; các field `attack/defense/hp/maxHp/speed` trên `Monster` luôn là giá trị đã resolve, không lưu công thức.

### Chọn mục tiêu theo `aggro` ("thu hút")

Quy tắc mặc định (dùng cho mọi pattern trừ khi nói khác ở dưới): **random có trọng số** trên toàn bộ nhân vật còn sống trong party, trọng số = `Character.aggro` hiện tại. Nhân vật `aggro` càng cao thì xác suất bị chọn làm mục tiêu càng lớn.

Công thức: `P(target = X) = X.aggro / tổng aggro toàn bộ nhân vật còn sống`.

### 3 AI pattern (`MonsterAiPattern`)
- **`aggressive`** (Hung Hãn): dùng thẳng quy tắc random có trọng số theo `aggro` ở trên.
- **`defensive`** (Phòng Thủ): nếu HP bản thân < 40% và có skill hồi/phòng thủ trong `skillIds` thì dùng skill đó (target: bản thân); ngược lại rơi về quy tắc random có trọng số theo `aggro` như `aggressive`.
- **`erratic`** (Hỗn Loạn): **bỏ qua** trọng số `aggro` — chọn target ngẫu nhiên đều (uniform) trong các nhân vật còn sống.

### Kiến trúc 2 nhóm archetype — combat thường vs guard-room (elite/boss)

15 archetype, tách rõ 2 nhóm bằng field `guardOnly?: boolean` (`MonsterArchetype`, `src/types.ts`):

- **Combat thường** (`guardOnly` không set/`false`, **11 archetype**): xuất hiện random trong phòng combat thông thường (1-3 quái/phòng) — `COMBAT_ROOM_ARCHETYPES` ở `src/data/floor.ts`, lọc bỏ mọi archetype `guardOnly: true`.
- **Guard-room** (**5 archetype**, có cả `eliteSkillIds` lẫn `bossSkillIds` — xem `06-level-system.md` §6.12): trấn giữ phòng boss/tinh anh cuối mỗi tầng — `GUARD_ROOM_ARCHETYPES` ở `floor.ts`, lọc theo archetype có đủ 2 field skill kit đó, random chọn 1 khi build phòng `boss`. **Skeleton Guard** là archetype duy nhất thuộc **cả 2 nhóm** (vẫn xuất hiện ở combat thường lẫn được chọn làm guard-room) — 4 archetype còn lại (Giant Spider, Dragon, Zombie Knight, Dark Knight) đánh dấu `guardOnly: true`, **chỉ** xuất hiện ở tier elite/boss, không bao giờ là quái trash thường (VD Dragon sẽ không bao giờ lẻ tẻ xuất hiện làm quái lót đường).

Mọi phòng guard-room random giữa 5 archetype mỗi lần build phòng, dùng chung công thức scaling (elite/boss vẫn dùng `eliteMultiplier`/`bossMultiplier` chung, §6.5/§6.11).

### 11 archetype combat thường

| id | Tên | baseHp | baseAtk | baseDef | baseSpeed | AI pattern | expReward |
|---|---|---|---|---|---|---|---|
| `dungeon-rat` | Dungeon Rat | 45 | 17 | 1 | 9 | erratic | 6 |
| `black-bat` | Black Bat | 42 | 22 | 1 | 18 | aggressive | 6 |
| `slime` | Slime | 40 | 15 | 1 | 5 | erratic | 6 |
| `skeleton` | Skeleton | 42 | 19 | 4 | 8 | aggressive | 9 |
| `zombie` | Zombie | 45 | 18 | 6 | 4 | defensive | 12 |
| `snake` | Snake | 38 | 20 | 2 | 17 | erratic | 8 |
| `lizard` | Lizard | 46 | 19 | 3 | 11 | aggressive | 9 |
| `spider` | Spider | 40 | 21 | 1 | 15 | aggressive | 9 |
| `skeleton-archer` | Skeleton Archer | 40 | 22 | 3 | 12 | erratic | 10 |
| `skeleton-warrior` | Skeleton Warrior | 40 | 22 | 7 | 7 | defensive | 13 |
| `skeleton-guard`* | Skeleton Guard | 55 | 23 | 7 | 6 | defensive | 15 |

\* `skeleton-guard` cũng là 1 trong 5 archetype guard-room (mục trên) — bảng dưới liệt kê riêng cho rõ, không trùng lặp dữ liệu.

### 5 archetype guard-room (elite/boss)

| id | Tên | baseHp | baseAtk | baseDef | baseSpeed | AI pattern | expReward | guardOnly |
|---|---|---|---|---|---|---|---|---|
| `skeleton-guard` | Skeleton Guard | 55 | 23 | 7 | 6 | defensive | 15 | không (dùng chung combat thường) |
| `giant-spider` | Giant Spider | 50 | 26 | 5 | 14 | aggressive | 16 | có |
| `dragon` | Dragon | 65 | 31 | 7 | 10 | aggressive | 20 | có |
| `zombie-knight` | Zombie Knight | 60 | 19 | 10 | 5 | defensive | 17 | có |
| `dark-knight` | Dark Knight | 58 | 27 | 10 | 9 | defensive | 18 | có |

Mỗi archetype có bộ skill kit elite/boss riêng (`eliteSkillIds`/`bossSkillIds`, `data/monster-skills.json`) — chi tiết đầy đủ, cơ chế Finishing Blow, và bảng kiểm chứng damage ở `06-level-system.md` §6.12.

### Kiểm chứng damage vào Vanguard

Sát thương được tính bằng công thức mitigation theo % (`mitigatedOffense`, `docs/technical-decisions.md`): `off − off × (def / (60 + def)) − def / 30`, trong đó `off` là `attack` (hoặc `magicPower` cho skill `isMagic`) của nguồn gây damage.

Damage 1 hit vào Vanguard (`baseDefense 10`, không buff/debuff) từ đòn đánh thường (`amount 0`, tầng 1 nên không có bonus theo độ sâu):

| Nhóm | Archetype | atk | dmg → Vanguard |
|---|---|---|---|
| Thấp nhất | Slime | 15 | 13 |
| … | Dungeon Rat | 17 | 14 |
| … | Zombie | 18 | 15 |
| … | Skeleton, Lizard | 19 | 16 |
| … | Snake | 20 | 17 |
| … | Spider | 21 | 18 |
| Cao nhất (combat thường) | Black Bat, Skeleton Archer, Skeleton Warrior, Skeleton Guard | 22-23 | 19 |

Elite tier (skill strike, `amount 3`, target `singleEnemy`, attack đã nhân `eliteMultiplier.attack ×1.4` — `06-level-system.md` §6.5):

| Archetype | eliteAtk | strike dmg → Vanguard |
|---|---|---|
| Zombie Knight | 27 | 26 |
| Skeleton Guard | 32 | 30 |
| Giant Spider | 36 | 34 |
| Dark Knight | 38 | 35 |
| Dragon | 43 | 40 |

Boss tier tự nhiên cao hơn Elite (dùng `bossMultiplier.attack ×1.8` thay vì `×1.4`, cùng công thức skill), và Đòn Kết Liễu (boss execute) là 1 cú đánh riêng biệt, nặng hơn hẳn — xem bảng đầy đủ ở `06-level-system.md` §6.12.

Skill strike/cleave dùng `amount` nhỏ (3/2): phần lớn sát thương của elite/boss đến từ `baseAttack` đã nhân multiplier + scale theo độ sâu tầng. Cleave (`amount 2`, `allEnemies`) nhẹ hơn Strike (`amount 3`, `singleEnemy`) trên từng mục tiêu.
