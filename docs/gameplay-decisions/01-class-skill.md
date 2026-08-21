# §1. Class & Skill

*(mục 1 của `00-index.md` — xem file đó cho toàn bộ mục lục)*

Mỗi class có **6 skill = 1 đòn đánh thường dùng chung (slot 0) + 5 skill riêng**, cộng 4 cơ chế engine (proc theo %, buff tự thêm hiệu ứng khi đánh trúng, choáng bỏ lượt, skill tác dụng khác nhau tùy phe mục tiêu) và cooldown theo lượt cho 1 số skill mạnh.

**Quy ước đặt tên**: mọi `id`/`name` của class, skill, và status effect đều bằng **tiếng Anh**, khớp `data/classes.json`/`data/status-effects.json`/`data/monsters.json`. Phần mô tả/giải thích trong tài liệu vẫn giữ tiếng Việt như toàn bộ `docs/gameplay-decisions/`.

### Bảng chỉ số (level 1)

7 chỉ số class: **tấn công** (`attack`), **sức mạnh phép** (`magicPower` — xem mục 1.6 ngay dưới), **phòng thủ** (`defense`), **máu** (`maxHp`), **mana** (`maxMp`), **thu hút** (`aggro` — trọng số bị quái chọn làm mục tiêu, xem `02-monster.md` mục 2), **tốc độ** (`speed` — ưu tiên ra đòn trước, xem `docs/technical-decisions.md` §2).

| Class | attack | magicPower | defense | maxHp | maxMp | aggro | speed |
|---|---|---|---|---|---|---|---|
| Vanguard | 14 | 0 | 10 | 140 | 20 | 20 | 8 |
| Mage | 6 | 14 | 4 | 70 | 60 | 8 | 10 |
| Rogue | 16 | 0 | 6 | 90 | 30 | 10 | 16 |
| Acolyte | 6 | 10 | 8 | 100 | 50 | 12 | 9 |

- Vanguard cao nhất `aggro` + `defense` + `maxHp`, thấp nhất `speed` (tank, ra tay muộn).
- Mage thấp nhất mọi chỉ số phòng ngự/aggro nhưng `speed` khá, và là class duy nhất có `attack` thấp, `magicPower` cao nhất — carry sát thương của Mage đến từ skill phép (mục 1.6), không phải đòn đánh thường.
- Rogue `speed`/`attack` cao nhất, `defense` thấp, `magicPower` bằng 0 (thuần vật lý).
- Acolyte cân bằng, `aggro` trung bình, `magicPower` khá (heal + damage phụ, thấp hơn Mage).

#### Chỉ số `magicPower` và cờ `isMagic`

Skill nào có `damage`/`heal` mang tính "phép" (element lửa/sét/băng của Mage, holy heal/purge của Acolyte) được đánh dấu `isMagic: true` trong `data/classes.json`. Khi resolver tính sát thương/hồi máu cho 1 skill `isMagic`, nó dùng `source.magicPower` của người dùng skill thay cho `source.attack` — chỉ đổi vế offense nào được đưa vào công thức, không đổi cách defense được trừ (chi tiết công thức mitigation đầy đủ: `docs/technical-decisions.md` mục "Xử lý theo `effect.kind`"). Skill không đánh dấu `isMagic` (đòn đánh thường của mọi class, toàn bộ skill Vanguard/Rogue, damage của Purify — chỉ nhánh enemy) dùng `attack` như bình thường.

Danh sách skill mang `isMagic: true`:

| Class | Skill |
|---|---|
| Mage | Fireball, Lightning Bolt, Fire Pillar, Lightning Storm, Ice Age (toàn bộ 5 skill riêng — chỉ trừ đòn đánh thường Bludgeon) |
| Acolyte | Heal, Purify, Mass Heal, Divine Descent (toàn bộ 4 skill riêng có tác dụng heal/damage — trừ đòn đánh thường Punch và Prayer, vốn không có effect `damage`/`heal`) |

`magicPower` tăng theo level qua cùng đường cong tapered 5-tier dùng chung cho `attack`/`defense`/`maxHp`/`maxMp` (`06-level-system.md` §6.3), nhân thêm `growthWeights.magicPower` riêng theo class — xem bảng ngân sách weight đầy đủ ở `06-level-system.md` §6.8.

2 skill riêng đầu mở sẵn ở cấp 1 (cộng đòn đánh thường luôn có), 3 skill riêng còn lại mở dần ở cấp **10/20/35**. `slot`/`unlockLevel`/`cooldownTurns` khớp field cùng tên trong `SkillDefinition` (xem `docs/technical-decisions.md` §4) — `usesPerCombat` không dùng cho skill nhân vật (mục 1.5, bullet cuối "Ghi chú thiết kế").

### 1.0 Đòn đánh thường (mọi class, slot 0)

Miễn phí (`mpCost 0`), luôn có sẵn từ cấp 1, không giới hạn số lần dùng, không cooldown, `target: singleEnemy`, `effects: [{ kind: "damage", amount: 0 }]` → sát thương = `max(1, round(mitigatedOffense(attack, defense)))` (công thức mitigation, `docs/technical-decisions.md`), đúng nghĩa "sát thương cơ bản" (giống công thức quái vật đánh thường). Tên/vũ khí theo class, không có ý nghĩa cơ chế nào khác ngoài fallback miễn phí khi hết MP:

| Class | Vũ khí | Skill id | Tên đòn thường |
|---|---|---|---|
| Vanguard | Kiếm | `vanguard-slash` | Slash |
| Rogue | Dao | `rogue-stab` | Stab |
| Mage | Gậy | `mage-bludgeon` | Bludgeon |
| Acolyte | Tay không | `acolyte-punch` | Punch |

### 1.1 Vanguard — tank, chống chịu, giữ chân quái

| Slot | Lvl | Skill id | Tên | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `vanguard-shield-guard` | Shield Guard | 8 | self | `applyStatusEffect "guard"` (+6 def, 1 lượt) **+** `applyStatusEffect "taunt"` (+40 aggro, 1 lượt) — 2 status độc lập, cùng áp 1 lúc | ✅ | 2 lượt |
| 2 | 1 | `vanguard-shield-throw` | Shield Throw | 5 | singleEnemy | `damage 10` | — | — |
| 3 | 10 | `vanguard-rally` | Rally | 12 | allAllies | `modifyStat fear -8` (tức thì, cả đội) + `applyStatusEffect "rally"` (+4 attack, 1 lượt, cả đội) | ✅ | 2 lượt |
| 4 | 20 | `vanguard-heavy-charge` | Heavy Charge | 14 | allEnemies | `damage 12`/địch — roll độ chính xác **riêng từng địch** (`04-fear-combat.md` mục 4) | — | 3 lượt |
| 5 | 35 | `vanguard-sword-judgment` | Sword Judgment | 14 | singleEnemy | `damage 30` — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (`04-fear-combat.md` mục 4) | — | 5 lượt |

*Shield Guard gánh cả vai trò "thu hút" (aggro) lẫn "phòng thủ", còn Rally là buff cả đội chứ không chỉ tự taunt. Cột "Buff?" đánh dấu skill nhận `isBuff: true` — xem quy tắc `durationTurns`/cooldown/speed dành riêng cho buff ở mục 1.5 và `docs/technical-decisions.md` §4.7.*

### 1.2 Mage — sát thương phép tầm xa, giòn; hệ lửa/sét/băng

| Slot | Lvl | Skill id | Tên | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `mage-fireball` | Fireball | 5 | singleEnemy | `damage 10` + 30% `applyStatusEffect "burning"` (2 lượt) | — | — |
| 2 | 1 | `mage-lightning-bolt` | Lightning Bolt | 6 | singleEnemy | `damage 12` + 20% `applyStatusEffect "stunned"` (1 lượt) | — | — |
| 3 | 10 | `mage-fire-pillar` | Fire Pillar | 14 | allEnemies | `damage 12`/địch + 50% `applyStatusEffect "burning"` (2 lượt) **mỗi địch** (roll riêng từng địch, cả accuracy lẫn proc) | — | 2 lượt |
| 4 | 20 | `mage-lightning-storm` | Lightning Storm | 16 | allEnemies | `damage 13`/địch + 30% `applyStatusEffect "stunned"` (1 lượt) **mỗi địch** | — | 3 lượt |
| 5 | 35 | `mage-ice-age` | Ice Age | 20 | allEnemies | `damage 22`/địch — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (`04-fear-combat.md` mục 4) | — | 5 lượt |

*Mage là class thuần hệ lửa/sét/băng, kit tập trung sát thương + proc bỏng/choáng. Đòn Bludgeon (slot 0) đảm nhiệm vai trò "hành động miễn phí khi hết mana".*

### 1.3 Rogue — burst đơn mục tiêu, tốc độ cao nhất nhóm

| Slot | Lvl | Skill id | Tên | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `rogue-poison-coat` | Poison Coat | 3 | self | `applyStatusEffect "poison-coat"` (self-buff, 3 lượt, **không** tự gây damage — mọi đòn `damage` do actor này gây ra trong lúc buff còn hiệu lực tự kèm `applyStatusEffect "poisoned"` lên mục tiêu trúng đòn, xem "on-hit rider" ở `docs/technical-decisions.md` §4) | ✅ | 4 lượt |
| 2 | 1 | `rogue-knife-throw` | Knife Throw | 4 | singleEnemy | `damage 12` | — | — |
| 3 | 10 | `rogue-backstab` | Backstab | 8 | singleEnemy | `damage 20` | — | 1 lượt |
| 4 | 20 | `rogue-poison-bomb` | Poison Bomb | 10 | allEnemies | `applyStatusEffect "poisoned"` mỗi địch — roll độ chính xác riêng từng địch | — | 3 lượt |
| 5 | 35 | `rogue-flurry-assault` | Flurry Assault | 16 | singleEnemy | `damage 12` × 3 (liên tiếp) — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (`04-fear-combat.md` mục 4) | — | 5 lượt |

*Poison Coat là self-buff "tẩm độc lên vũ khí" — giá trị đến gián tiếp qua các đòn đánh sau đó, mp 3. Rogue không có skill phòng thủ riêng — kit 100% tấn công/debuff.*

**Về Poison Coat và luật "buff luôn 1 lượt"**: `poison-coat` **không** bị ép về 1 lượt như Shield Guard/Rally, dù cũng là self-buff. `poison-coat` không mang `modifyCombatStat`, nó là buff-rider (bật cơ chế "đòn đánh tự kèm độc"). Cooldown 4 lượt tính theo công thức chung "lượt tác dụng + 1" (3+1).

### 1.4 Acolyte — hồi phục + hạ fear cả team

| Slot | Lvl | Skill id | Tên | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `acolyte-prayer` | Prayer | 4 | singleAlly | `modifyStat fear -10` | — | — |
| 2 | 1 | `acolyte-heal` | Heal | 6 | singleAlly | `heal 16` | — | — |
| 3 | 10 | `acolyte-purify` | Purify | 9 | **singleAlly HOẶC singleEnemy** (người chơi chọn phe lúc target) | nhắm đồng đội → `removeStatusEffect` (gỡ 1 debuff); nhắm địch → `damage 15` | — | 1 lượt |
| 4 | 20 | `acolyte-mass-heal` | Mass Heal | 10 | allAllies | `heal 10` + `modifyStat fear -6` | — | 2 lượt |
| 5 | 35 | `acolyte-divine-descent` | Divine Descent | 20 | **allAllies VÀ allEnemies cùng lúc** | đồng đội → `heal 25` + `modifyStat fear -15`; địch → `damage 20` — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (`04-fear-combat.md` mục 4) | — | 5 lượt |

*Không skill nào của Acolyte đánh dấu "Buff?" — `modifyStat fear` là chỉnh tức thì, không qua `applyStatusEffect`/`durationTurns`.*

*Acolyte có lựa chọn gây sát thương thật (Purify nhắm địch, Divine Descent, và đòn Punch slot 0) bên cạnh vai trò healer chính.*

### 1.5 Status Effects — bảng tổng hợp & hiệu ứng đầy đủ

7 status đang được dùng bởi bộ kit 6 skill/class ở mục 1.1-1.4 (id/name tiếng Anh, khớp `data/status-effects.json`):

| id | Tên | Loại | Hiệu ứng (`perTurnEffects` / field đặc biệt) | Thời lượng | Chữa qua mini-game | Dùng bởi |
|---|---|---|---|---|---|---|
| `guard` | Guard | Buff | `modifyCombatStat defense +6` | 1 lượt | — (buff không cần "chữa") | Shield Guard (Vanguard) |
| `taunt` | Taunt | Buff | `modifyCombatStat aggro +40` | 1 lượt | — | Shield Guard (Vanguard) |
| `rally` | Rally | Buff | `modifyCombatStat attack +4` | 1 lượt | — | Rally (Vanguard) |
| `poison-coat` | Poison Coat | Buff (rider, không phải stat-buff) | không có `perTurnEffects`; field `onHitStatusEffectId: "poisoned"` — xem `docs/technical-decisions.md` §4.2 | 3 lượt (ngoại lệ, xem ghi chú ở mục 1.3) | — | Poison Coat (Rogue) |
| `poisoned` | Poisoned | Debuff | `damage 4`/lượt | 3 lượt | Snake, `clearScore 8` | on-hit rider của Poison Coat; Poison Bomb (Rogue) |
| `burning` | Burning | Debuff | `damage 5`/lượt | 2 lượt | Không chữa được qua mini-game (chủ đích — phân biệt với Poisoned) | Fireball 30%, Fire Pillar 50% (Mage) |
| `stunned` | Stunned | Control (debuff) | không có `perTurnEffects` thường; field `stuns: true` — xem `docs/technical-decisions.md` §4.3 | 1 lượt | Không chữa được qua mini-game | Lightning Bolt 20%, Lightning Storm 30% (Mage) |

**Quy ước `durationTurns` mặc định**: `applyStatusEffectToActor` (`resolver.ts`) dùng `def.durationTurns ?? 1`, tức là 1 status không khai báo `durationTurns` sẽ tự hiểu là **1 lượt**.
- **Buff (mang `modifyCombatStat`, tự actor áp lên mình/đồng đội)**: **mặc định 1 lượt**, khớp luật "buff luôn 1 lượt" — không cần set `durationTurns` tường minh trong JSON nếu là 1, nhưng vẫn nên ghi rõ cho dễ đọc.
- **Debuff/control (Poisoned, Burning, Stunned) và buff-rider không phải stat-buff (Poison Coat)**: **luôn phải khai báo `durationTurns` tường minh**, không dựa vào default.

Ngoài 7 status trên, `weakened` (`modifyCombatStat defense -6`, 2 lượt) dùng riêng cho skill Elite/Boss (`06-level-system.md` §6.12) — không thuộc bộ kit skill nhân vật ở mục này.

### Ghi chú thiết kế
- Mỗi class có đúng 1 skill "ultimate" ở slot 5 — **luôn trúng, không roll accuracy**, nhưng hiệu quả (damage/heal) giảm theo bậc fear qua công thức riêng, thay cho combo roll-trúng-trượt + giảm 15% dùng cho skill thường (`04-fear-combat.md` mục 4). Ultimate dùng `isUltimate: true` + `cooldownTurns: 5` — không dùng `usesPerCombat` (xem bullet cuối).
- `modifyCombatStat` (buff/debuff attack/defense/aggro/speed) luôn đi qua `applyStatusEffect` — không có effect chỉnh combat-stat tức thời/vĩnh viễn, tất cả đều có `durationTurns` trên `StatusEffectDefinition`.
- `StatusEffectDefinition` dùng chung cho cả buff (VD "guard") lẫn debuff (VD "poisoned"): buff để `curableByMiniGame: []` và hết hạn qua `durationTurns`; debuff thật mới có `curableByMiniGame` khác rỗng. Bảng đầy đủ + quy ước default duration: mục 1.5.
- **Skill có `chance` trên 1 effect** (VD Fireball 30% bỏng) chỉ roll effect đó, tách biệt roll accuracy của toàn skill — effect `damage` chính vẫn luôn áp nếu skill trúng, chỉ effect phụ (proc) là xác suất.
- **Skill AoE** (`allEnemies`, hoặc nửa "địch" của skill 2 phe): roll accuracy **riêng cho từng mục tiêu**, không phải 1 roll chung cho cả skill — 1 địch né được không có nghĩa cả nhóm né được.
- **Skill 2 phe** (Purify, Divine Descent): hiệu ứng áp dụng phụ thuộc mục tiêu là đồng đội hay địch, không dùng chung 1 effect list — xem `effectsByRelation` ở `docs/technical-decisions.md` §4.
- **Cooldown** (`cooldownTurns`): mọi skill riêng slot 3-5 đều có cooldown (slot 1-2 không có cooldown). 2 công thức:
  - **Skill buff** (`isBuff: true` — Shield Guard, Rally, Poison Coat): `cooldownTurns = durationTurns của status chính + 1`.
  - **Skill damage/utility khác + ultimate**: gán tay theo độ mạnh, không theo công thức cố định (ultimate cố định `5 lượt`).
- `usesPerCombat` không dùng cho bất kỳ skill nhân vật nào (toàn bộ 24 skill dùng `cooldownTurns`, kể cả 4 ultimate cố định `5 lượt`). Field này vẫn tồn tại trên `SkillDefinition`/`ItemDefinition` cho Item (`07-items-artifacts.md` §7).
- **Skill buff luôn +20 speed** cho lượt tính thứ tự trong round nó được dùng. Chỉ áp cho 3 skill đánh dấu "Buff?" ở bảng mỗi class (Shield Guard, Rally, Poison Coat) — không áp cho skill hỗ trợ không mang status (Prayer, Heal, Mass Heal của Acolyte chỉnh tức thời, không qua `applyStatusEffect`). Đây là bonus tạm thời chỉ cho việc sắp thứ tự lượt của round hiện tại, không cộng dồn vào `speed` gốc của nhân vật — thiết kế kỹ thuật ở `docs/technical-decisions.md` §4.7.
