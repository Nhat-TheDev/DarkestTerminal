# §1. Class & Skill

*(mục 1 của `00-index.md` — xem file đó cho toàn bộ mục lục)*

Mỗi class có **6 skill = 1 đòn đánh thường dùng chung (slot 0) + 5 skill riêng**, cộng 4 cơ chế engine (proc theo %, buff tự thêm hiệu ứng khi đánh trúng, choáng bỏ lượt, skill tác dụng khác nhau tùy phe mục tiêu) và cooldown theo lượt cho 1 số skill mạnh.

**Quy ước đặt tên (cập nhật 2026-08-17)**: mọi `id`/`name` của class, skill, và status effect đều bằng **tiếng Anh** — khớp `data/classes.json`/`data/status-effects.json`/`data/monsters.json` hiện hành. Tu Sĩ đổi tên thành **Acolyte** (id `chaplain` → `acolyte`) cho rõ nghĩa hơn. Phần mô tả/giải thích trong tài liệu vẫn giữ tiếng Việt như toàn bộ `docs/gameplay-decisions/`.

### Bảng chỉ số (level 1)

6 chỉ số class: **tấn công** (`attack`), **phòng thủ** (`defense`), **máu** (`maxHp`), **mana** (`maxMp`), **thu hút** (`aggro` — trọng số bị quái chọn làm mục tiêu, xem `02-monster.md` mục 2), **tốc độ** (`speed` — ưu tiên ra đòn trước, xem `docs/technical-decisions.md` §2).

| Class | attack | defense | maxHp | maxMp | aggro | speed |
|---|---|---|---|---|---|---|
| Vanguard | 14 | **10** | 140 | 20 | 20 | 8 |
| Mage | 6 | 4 | 70 | 60 | 8 | 10 |
| Rogue | 16 | 6 | 90 | 30 | 10 | 16 |
| Acolyte | 6 | 8 | 100 | 50 | 12 | 9 |

Thiết kế có chủ đích: Vanguard cao nhất `aggro` + `defense` + `maxHp`, thấp nhất `speed` (tank hút đòn, ra tay muộn); Mage thấp nhất mọi chỉ số phòng ngự/aggro (né bị nhắm) nhưng `speed` khá; Rogue `speed`/`attack` cao nhất, `defense` thấp; Acolyte cân bằng, `aggro` trung bình để không bị/không tránh được việc làm mục tiêu.

**⚠️ Cập nhật cân bằng (2026-08-17)**: `baseDefense` của Vanguard hạ từ **12 xuống 10** — ở mức 12, đa số quái thường (`baseAttack` 8-15 lúc đó) chỉ gây đúng 1-2 sát thương lên Vanguard (`max(1, atk − def)` chạm sàn), khiến class tank gần như miễn nhiễm damage ngay từ tầng 1 và party sống sót quá dễ dàng dù không dùng skill hỗ trợ nào. Hạ xuống 10 (vẫn cao nhất nhóm — Acolyte 8, Rogue 6, Mage 4) đưa damage nhận vào Vanguard lên mức 1-9 tùy quái (chi tiết bảng đối chiếu ở `02-monster.md` mục 2), giữ vai trò tank nhưng không còn "miễn nhiễm" hoàn toàn.

2 skill riêng đầu mở sẵn ở cấp 1 (cộng đòn đánh thường luôn có), 3 skill riêng còn lại mở dần ở cấp **10/20/35**. `slot`/`unlockLevel`/`cooldownTurns` khớp field cùng tên trong `SkillDefinition` (xem `docs/technical-decisions.md` §4) — **`usesPerCombat` không còn dùng cho skill** (mục 1.5, bullet cuối "Ghi chú thiết kế").

### 1.0 Đòn đánh thường (mọi class, slot 0)

Miễn phí (`mpCost 0`), luôn có sẵn từ cấp 1, không giới hạn số lần dùng, không cooldown, `target: singleEnemy`, `effects: [{ kind: "damage", amount: 0 }]` → sát thương = `max(1, attack − defense)`, đúng nghĩa "sát thương cơ bản" (giống công thức quái vật đánh thường). Tên/vũ khí theo class, không có ý nghĩa cơ chế nào khác ngoài fallback miễn phí khi hết MP:

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

*Shield Guard gánh cả vai trò "thu hút" (aggro) lẫn "phòng thủ" — Vanguard không mất khả năng tank dù Rally giờ là buff cả đội thay vì tự taunt. Cột "Buff?" đánh dấu skill nhận `isBuff: true` — xem quy tắc `durationTurns`/cooldown/speed dành riêng cho buff ở mục 1.5 và `docs/technical-decisions.md` §4.7.*

### 1.2 Mage — sát thương phép tầm xa, giòn; hệ lửa/sét/băng

| Slot | Lvl | Skill id | Tên | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `mage-fireball` | Fireball | 5 | singleEnemy | `damage 10` + 30% `applyStatusEffect "burning"` (2 lượt) | — | — |
| 2 | 1 | `mage-lightning-bolt` | Lightning Bolt | 6 | singleEnemy | `damage 12` + 20% `applyStatusEffect "stunned"` (1 lượt) | — | — |
| 3 | 10 | `mage-fire-pillar` | Fire Pillar | 14 | allEnemies | `damage 12`/địch + 50% `applyStatusEffect "burning"` (2 lượt) **mỗi địch** (roll riêng từng địch, cả accuracy lẫn proc) | — | 2 lượt |
| 4 | 20 | `mage-lightning-storm` | Lightning Storm | 16 | allEnemies | `damage 13`/địch + 30% `applyStatusEffect "stunned"` (1 lượt) **mỗi địch** | — | 3 lượt |
| 5 | 35 | `mage-ice-age` | Ice Age | 20 | allEnemies | `damage 22`/địch — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (`04-fear-combat.md` mục 4) | — | 5 lượt |

*Mage đổi hẳn hệ (bóng tối → lửa/sét/băng), mất "Nguyền Rủa" (debuff attack) — kit mới thuần sát thương + proc bỏng/choáng thay cho khống chế cứng. "Tập Trung" (hồi mp) cũng mất — vai trò "hành động miễn phí khi hết mana" nay do đòn Bludgeon (slot 0) đảm nhiệm.*

### 1.3 Rogue — burst đơn mục tiêu, tốc độ cao nhất nhóm

| Slot | Lvl | Skill id | Tên | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `rogue-poison-coat` | Poison Coat | 3 | self | `applyStatusEffect "poison-coat"` (self-buff, 3 lượt, **không** tự gây damage — mọi đòn `damage` do actor này gây ra trong lúc buff còn hiệu lực tự kèm `applyStatusEffect "poisoned"` lên mục tiêu trúng đòn, xem "on-hit rider" ở `docs/technical-decisions.md` §4) | ✅ | 4 lượt |
| 2 | 1 | `rogue-knife-throw` | Knife Throw | 4 | singleEnemy | `damage 12` | — | — |
| 3 | 10 | `rogue-backstab` | Backstab | 8 | singleEnemy | `damage 20` | — | 1 lượt |
| 4 | 20 | `rogue-poison-bomb` | Poison Bomb | 10 | allEnemies | `applyStatusEffect "poisoned"` mỗi địch — roll độ chính xác riêng từng địch | — | 3 lượt |
| 5 | 35 | `rogue-flurry-assault` | Flurry Assault | 16 | singleEnemy | `damage 12` × 3 (liên tiếp) — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (`04-fear-combat.md` mục 4) | — | 5 lượt |

*Poison Coat chuyển từ "gây độc 1 địch" sang self-buff "tẩm độc lên vũ khí" — rẻ hơn (mp 6→3) vì giá trị giờ đến gián tiếp qua các đòn đánh sau đó. Rogue không còn skill phòng thủ riêng ("Lẩn Tránh" bị bỏ) — kit mới 100% tấn công/debuff, rủi ro cao đúng vai trò glass cannon.*

**⚠️ Về Poison Coat và luật "buff luôn 1 lượt"**: `poison-coat` **không** bị ép về 1 lượt như Shield Guard/Rally, dù cũng là self-buff — lý do: `poison-coat` không mang `modifyCombatStat` (không phải buff chỉ số), nó là buff-rider (bật cơ chế "đòn đánh tự kèm độc"), nếu rút còn 1 lượt thì chỉ ăn được đúng 1 đòn trước khi tắt, gần như vô dụng so với việc dùng thẳng Poison Bomb. Cooldown 4 lượt tính theo công thức chung "lượt tác dụng + 1" (3+1).

### 1.4 Acolyte — hồi phục + hạ fear cả team

| Slot | Lvl | Skill id | Tên | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `acolyte-prayer` | Prayer | 4 | singleAlly | `modifyStat fear -10` | — | — |
| 2 | 1 | `acolyte-heal` | Heal | 6 | singleAlly | `heal 16` | — | — |
| 3 | 10 | `acolyte-purify` | Purify | 9 | **singleAlly HOẶC singleEnemy** (người chơi chọn phe lúc target) | nhắm đồng đội → `removeStatusEffect` (gỡ 1 debuff); nhắm địch → `damage 15` | — | 1 lượt |
| 4 | 20 | `acolyte-mass-heal` | Mass Heal | 10 | allAllies | `heal 10` + `modifyStat fear -6` | — | 2 lượt |
| 5 | 35 | `acolyte-divine-descent` | Divine Descent | 20 | **allAllies VÀ allEnemies cùng lúc** | đồng đội → `heal 25` + `modifyStat fear -15`; địch → `damage 20` — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (`04-fear-combat.md` mục 4) | — | 5 lượt |

*Không skill nào của Acolyte đánh dấu "Buff?" — `modifyStat fear` là chỉnh tức thì (không qua `applyStatusEffect`/`durationTurns`) nên không thuộc phạm vi luật buff ở mục 1.5, dù về bản chất vẫn là hỗ trợ.*

*Acolyte có lựa chọn gây sát thương thật (Purify nhắm địch, Divine Descent, và đòn Punch slot 0) — đảo ngược quyết định cũ "Tu Sĩ không có skill gây damage" (xem ghi chú `06-level-system.md` §6.7/§6.8).*

### 1.5 Status Effects — bảng tổng hợp & hiệu ứng đầy đủ

7 status đang được dùng bởi bộ kit 6 skill/class ở mục 1.1-1.4 (id/name tiếng Anh, khớp `data/status-effects.json`):

| id | Tên | Loại | Hiệu ứng (`perTurnEffects` / field đặc biệt) | Thời lượng | Chữa qua mini-game | Dùng bởi |
|---|---|---|---|---|---|---|
| `guard` | Guard | Buff | `modifyCombatStat defense +6` | 1 lượt | — (buff không cần "chữa") | Shield Guard (Vanguard) |
| `taunt` | Taunt | Buff | `modifyCombatStat aggro +40` | 1 lượt | — | Shield Guard (Vanguard) |
| `rally` | Rally | Buff | `modifyCombatStat attack +4` | 1 lượt | — | Rally (Vanguard) |
| `poison-coat` | Poison Coat | Buff (rider, không phải stat-buff) | không có `perTurnEffects`; field mới `onHitStatusEffectId: "poisoned"` — xem `docs/technical-decisions.md` §4.2 | 3 lượt (ngoại lệ, xem ghi chú ở mục 1.3) | — | Poison Coat (Rogue) |
| `poisoned` | Poisoned | Debuff | `damage 4`/lượt | 3 lượt | Snake, `clearScore 8` | on-hit rider của Poison Coat; Poison Bomb (Rogue) |
| `burning` | Burning | Debuff | `damage 5`/lượt | 2 lượt | Không chữa được qua mini-game (chủ đích — phân biệt với Poisoned) | Fireball 30%, Fire Pillar 50% (Mage) |
| `stunned` | Stunned | Control (debuff) | không có `perTurnEffects` thường; field mới `stuns: true` — xem `docs/technical-decisions.md` §4.3 | 1 lượt | Không chữa được qua mini-game | Lightning Bolt 20%, Lightning Storm 30% (Mage) |

**Đã xoá khỏi hệ thống** (mồ côi từ đợt đổi bộ kit 6 skill — không còn skill nào tham chiếu): `ne-tranh` (từng của "Lẩn Tránh" — Rogue, skill đã bỏ), `nguyen-rua` (từng của "Nguyền Rủa" — Mage, skill đã bỏ).

**Quy ước `durationTurns` mặc định**: `applyStatusEffectToActor` (`resolver.ts`) dùng `def.durationTurns ?? 1`, tức là 1 status không khai báo `durationTurns` sẽ tự hiểu là **1 lượt**.
- **Buff (mang `modifyCombatStat`, tự actor áp lên mình/đồng đội)**: **mặc định 1 lượt**, khớp luật "buff luôn 1 lượt" — không cần set `durationTurns` tường minh trong JSON nếu là 1, nhưng vẫn nên ghi rõ cho dễ đọc.
- **Debuff/control (Poisoned, Burning, Stunned) và buff-rider không phải stat-buff (Poison Coat)**: **luôn phải khai báo `durationTurns` tường minh**, không dựa vào default — để tránh 1 debuff lỡ quên set field rồi vô tình chỉ kéo dài 1 lượt (bug cân bằng, không phải bug kỹ thuật, khó phát hiện qua test).

Ngoài 7 status trên, `weakened` (`modifyCombatStat defense -6`, 2 lượt) dùng riêng cho skill Elite/Boss (`06-level-system.md` §6.12) — không thuộc bộ kit skill nhân vật ở mục này.

### Ghi chú thiết kế
- Mỗi class có đúng 1 skill "ultimate" ở slot 5 — **luôn trúng, không roll accuracy**, nhưng hiệu quả (damage/heal) giảm theo bậc fear qua công thức riêng, thay cho combo roll-trúng-trượt + giảm 15% dùng cho skill thường (`04-fear-combat.md` mục 4). Ultimate dùng `isUltimate: true` + `cooldownTurns: 5` — **không còn `usesPerCombat`** (xem bullet cuối).
- `modifyCombatStat` (buff/debuff attack/defense/aggro/speed) luôn đi qua `applyStatusEffect` — không có effect chỉnh combat-stat tức thời/vĩnh viễn, tất cả đều có `durationTurns` trên `StatusEffectDefinition`.
- `StatusEffectDefinition` dùng chung cho cả buff (VD "guard") lẫn debuff (VD "poisoned"): buff để `curableByMiniGame: []` và hết hạn qua `durationTurns`; debuff thật mới có `curableByMiniGame` khác rỗng. Bảng đầy đủ + quy ước default duration: mục 1.5.
- **Skill có `chance` trên 1 effect** (VD Fireball 30% bỏng) chỉ roll effect đó, tách biệt roll accuracy của toàn skill — effect `damage` chính vẫn luôn áp nếu skill trúng, chỉ effect phụ (proc) là xác suất.
- **Skill AoE** (`allEnemies`, hoặc nửa "địch" của skill 2 phe): roll accuracy **riêng cho từng mục tiêu**, không phải 1 roll chung cho cả skill — 1 địch né được không có nghĩa cả nhóm né được.
- **Skill 2 phe** (Purify, Divine Descent): hiệu ứng áp dụng phụ thuộc mục tiêu là đồng đội hay địch, không dùng chung 1 effect list — xem `effectsByRelation` ở `docs/technical-decisions.md` §4.
- **Cooldown** (`cooldownTurns`): mọi skill riêng slot 3-5 đều có cooldown (slot 1-2 vẫn miễn phí cooldown vì rẻ/mở sớm) — mục đích chặn spam khi lên cấp cao, MP dư dả không còn là rào cản tự nhiên. 2 công thức:
  - **Skill buff** (`isBuff: true` — Shield Guard, Rally, Poison Coat): `cooldownTurns = durationTurns của status chính + 1`.
  - **Skill damage/utility khác + ultimate**: gán tay theo độ mạnh, không theo công thức cố định (ultimate cố định `5 lượt`).
- **`usesPerCombat` không còn dùng cho skill nhân vật** — gỡ khỏi toàn bộ 24 skill (kể cả 4 ultimate, nay dùng `cooldownTurns: 5` thay thế). Field này **vẫn giữ trong hệ thống**, nay dùng cho Item tiêu hao (`07-items-artifacts.md` §7 — đã xác định, không còn "chưa xác định" như bản ghi chú cũ trỏ vào `docs/design-doc.md` mục 1.6).
- **Skill buff luôn +20 speed** cho lượt tính thứ tự trong round nó được dùng ("buff được ưu tiên, tấn công sau" — buff cần landing trước khi các đòn tấn công/khác của round đó resolve). Chỉ áp cho 3 skill đánh dấu "Buff?" ở bảng mỗi class (Shield Guard, Rally, Poison Coat) — **không** áp cho skill hỗ trợ không mang status (Prayer, Heal, Mass Heal của Acolyte chỉnh tức thời, không qua `applyStatusEffect`). Đây là bonus tạm thời chỉ cho việc sắp thứ tự lượt của round hiện tại, không cộng dồn vào `speed` gốc của nhân vật — thiết kế kỹ thuật ở `docs/technical-decisions.md` §4.7.
- Số liệu MP/damage/cooldown ở trên là **đề xuất đầu**, sẽ tinh chỉnh tiếp khi có bản chơi được để playtest — giống tinh thần mọi con số balancing khác trong tài liệu này. Riêng `baseDefense` Vanguard đã qua 1 vòng chỉnh sau playtest thật (xem ghi chú ⚠️ ở bảng đầu mục này).
