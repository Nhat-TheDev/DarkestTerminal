# Kỹ thuật — Quyết định

**Liên quan**: `./design-doc.md` mục 3; `../dungeon-crawler-data-model.ts`

---

## 1. Sinh room/floor: generator runtime theo luật cố định

Cấu trúc tầng được sinh trực tiếp bằng thuật toán ở runtime
(`generateFloorLayout(rng)`, `src/data/floorPatterns.ts`) — không đọc từ file
pattern viết tay. Bất biến cốt lõi: **không ngõ cụt, mọi nhánh đều hội tụ về
boss**, đảm bảo bằng đúng 1 quy tắc kết nối (bên dưới), không cần thuật toán
validate riêng.

### Biểu diễn nội bộ
Cấu trúc dùng khái niệm **stage** (cột) — `RoomToken[][]` — mỗi phòng có
`{ stage, roomId, tag }`, `tag` là:
- `""` — phòng combat thường
- `"free"` — phòng nghỉ (rest)
- `"event"` — phòng sự kiện (`gameplay-decisions/08-events.md` §8)
- `"boss"` — phòng boss, bắt buộc là phòng duy nhất của stage cuối

### Quy tắc kết nối
**Mọi phòng ở stage N nối tới TẤT CẢ phòng ở stage N+1**, không có cạnh nào
khác — không nối lùi, không nối tắt qua stage. Hệ quả tự động: không thể có
ngõ cụt, mọi nhánh rẽ tự hội tụ lại khi stage sau chỉ còn 1 phòng, không cho
phép quay lại phòng cũ.

### Luật sinh (`generateFloorLayout`)
Mọi bound dưới đây tính **trên 1 đường đi** (path) từ start tới boss — vì mỗi
stage nối toàn bộ sang stage kế nên độ dài đường đi = số stage, cố định bất
kể chọn nhánh nào:
- Stage 0 (start) đúng 1 phòng, tag `""` (phòng thường).
- Stage cuối đúng 1 phòng, tag `boss`.
- Độ dài path (tổng số phòng, tính cả start + boss): **7–12 phòng** (`MIN_PATH_ROOMS`/`MAX_PATH_ROOMS`), random mỗi lần sinh.
- **Ngã rẽ** (branch = stage >1 phòng) chỉ được đặt từ phòng thứ 3 trở đi (`MIN_BRANCH_START_STAGE = 2`, 0-indexed).
- Tối đa **3 ngã rẽ** (`MAX_BRANCHES`); 2 ngã rẽ liên tiếp phải cách nhau **≥3 phòng** (`MIN_BRANCH_SPACING`) — path ngắn (7 phòng) do đó chỉ khả thi tối đa ~2 ngã rẽ.
- Mỗi ngã rẽ = đúng 2 phòng: **1 phòng thường + 1 phòng event** (người chơi chọn 1 trong 2 khi đi qua stage đó).
- Vì khoảng cách 2 ngã rẽ ≥3 phòng, 2 phòng event không bao giờ liền kề nhau trên cùng 1 path.
- Tối đa **4 phòng event** trên 1 path (`MAX_EVENT_ROOMS_PER_PATH`).
- **1–2 phòng nghỉ** trên mỗi path (`MIN_REST_ROOMS_PER_PATH`/`MAX_REST_ROOMS_PER_PATH`) — chọn ngẫu nhiên trong các stage không phải start/boss/ngã rẽ.
- `roomId` duy nhất trong toàn bộ layout.

`validateGeneratedStages(stages)` re-check lại toàn bộ luật trên — dùng làm
lưới an toàn cho test và cho các thay đổi sau này vào generator (generator
đúng luật do construction, không phụ thuộc vào validate để đúng).

### Lưu trữ & runtime
`createFloor(rng, depth)` (`src/data/floor.ts`) gọi `generateFloorLayout(rng)`
rồi `buildFloorFromStages(stages, rng, depth)`: dựng `Room[]` với
`connectedRoomIds` = toàn bộ phòng stage kế; gán tên phòng ngẫu nhiên (pool
theo loại phòng, tránh trùng tên trong cùng tầng) và random 1-3 quái/phòng
combat (11 archetype combat thường, `gameplay-decisions/02-monster.md` §2),
1 quái elite hoặc boss (5 archetype guard-room, random 1 —
`gameplay-decisions/02-monster.md` §2, `gameplay-decisions/06-level-system.md` §6.11)
cho phòng `boss`. `Game.advanceToNextFloor()` (`src/engine/game.ts`) gọi lại
`createFloor` với `depth + 1` mỗi khi guard-room được dọn sạch
(`gameplay-decisions/06-level-system.md` §6.9).

`test/floorPatterns.test.ts`: property-based test chạy `generateFloorLayout`
trên 200 seed, verify toàn bộ luật ở trên + reachability/no-dead-end (BFS),
cộng test riêng cho `validateGeneratedStages` (input hỏng phải throw).

---

## 2. Vòng lượt: pha ra lệnh + pha thực thi theo tốc độ

Mỗi round chia làm 2 pha rõ rệt, khớp `CombatState.phase` (`"command" | "resolution"`).

### Pha 1 — Ra lệnh (`phase: "command"`)
- Người chơi chọn hành động (skill hoặc item) + mục tiêu cho **cả 4 nhân vật còn sống** trước, không thấy trước quái sẽ làm gì round này. Quái **không** ra lệnh ở pha này.
- Mỗi lựa chọn hợp lệ được ghi thành 1 `QueuedAction` vào `CombatState.queuedActions` (1 entry/nhân vật còn sống).
- Validate ngay tại lúc queue: đủ MP trả `mpCost`, còn lượt `usesPerCombat` nếu skill có giới hạn, không đang `cooldownsRemaining`. Skill không hợp lệ thì không cho chọn.
- **MP bị trừ / vật phẩm bị tiêu hao ngay khi queue**, không đợi tới pha thực thi — quyết định coi như đã chốt, không hoàn tác kể cả khi mục tiêu đổi trạng thái trước lúc thực thi.
- Đủ 4 `QueuedAction` → chuyển `phase` sang `"resolution"`.

### Pha 2 — Thực thi (`phase: "resolution"`)
- Dựng `turnQueue` = mọi combatant còn sống (4 nhân vật + toàn bộ quái), snapshot `speed` hiện tại tại đúng thời điểm này (không tính lại giữa round dù có buff/debuff `speed` xảy ra trong lúc thực thi). Sort giảm dần theo `speed`; hòa → nhân vật trước quái, sau đó theo thứ tự gốc trong `combatants`.
- Duyệt `turnQueue` từ đầu bằng `activeTurnIndex`, mỗi bước:
  1. Nếu combatant đã chết (bị hạ bởi ai đó ra tay trước trong cùng round) → bỏ qua, kể cả nếu là nhân vật có `QueuedAction` đang chờ (action đó bị hủy hoàn toàn).
  2. Nếu là **nhân vật**: lấy `QueuedAction` tương ứng, áp rule mục tiêu chết trước lượt (bên dưới) rồi gọi resolver (§3).
  3. Nếu là **quái**: AI chọn hành động + mục tiêu ngay tại thời điểm này (không pre-commit) dựa trên trạng thái hiện tại — targeting theo `aggro` (`gameplay-decisions/02-monster.md` §2).
- **Mục tiêu chết trước lượt**: nếu target gốc của 1 `QueuedAction` đã chết khi tới lượt actor thực thi:
  - `target: "singleEnemy"` → đổi hướng ngẫu nhiên sang 1 quái còn sống bất kỳ; hết quái sống → action fizzle (MP/item vẫn đã mất từ pha ra lệnh).
  - `target: "singleAlly"` → **không** đổi hướng, action fizzle luôn (đổi sang người khác sẽ đi ngược lựa chọn ban đầu của người chơi).
- Hết `turnQueue` → `roundNumber += 1`, `queuedActions` reset rỗng, `phase` quay lại `"command"` cho round kế.
- Combat kết thúc khi toàn bộ `monster` trong `combatants` chết (thắng) hoặc toàn bộ `character` chết (permadeath toàn đội).

`speed` không có yếu tố ngẫu nhiên (không roll thêm) — quyết định thứ tự lượt
một cách xác định thuần túy; biến thiên giữa các trận tới từ buff/debuff
`speed` qua skill (`modifyCombatStat`), không phải từ RNG nền.

---

## 3. Resolver function cho SkillEffect

Một hàm thuần túy duy nhất, dùng chung cho cả skill lẫn item:

```
resolveSkillEffect(effect: SkillEffect, source: Combatant, targets: Combatant[], ctx: GameState): void
```

`source`/`target` là `Character` hoặc `Monster` — cả 2 type đều có field
phẳng `attack`/`defense`/`hp`/`maxHp` cùng tên nên phần lớn effect dùng chung
code path bất kể source/target là ai; `mp`/`maxMp`/`aggro`/`survival` chỉ
tồn tại trên `Character`.

### Xử lý theo `effect.kind`
- **`damage`**: với mỗi target, `finalDamage = max(1, round((effect.amount + mitigatedOffense(offensiveStat, target.defense)) * damageMultiplier))`, trong đó `offensiveStat = source.attack` mặc định, hoặc `source.magicPower` nếu skill có `isMagic: true` **và** `source` là `Character` (quái luôn dùng `attack`). Cờ `isMagic` được truyền xuống qua `ResolveContext.isMagic` từ `combat.ts`'s `applySkillEffects`.
  `mitigatedOffense(off, def) = off − off·(def/(60+def)) − def/30` (hằng số `DEFENSE_MITIGATION_X=60`/`DEFENSE_MITIGATION_Y=30`, `src/engine/resolver.ts`).
  Nếu `source` là character và đang ở bậc fear "Bất An"/"Hoảng Loạn" (`gameplay-decisions/04-fear-combat.md` mục 4), áp thêm accuracy-roll và damage-multiplier tương ứng trước khi trừ hp; bậc "Suy Sụp" có thêm khả năng bỏ lượt được roll ở bước chọn hành động (pha ra lệnh), trước khi resolver được gọi. **Ngoại lệ khi `source === target`** (tick định kỳ của chính 1 status effect trên actor đang mang nó, VD DoT "Poisoned" — `tickStatusEffects` gọi lại `resolveSkillEffect` với `source`/`target` là cùng 1 actor): đây không phải "một đòn tấn công" nên **không** cộng/trừ attack (hay magicPower)/defense hay áp fear-multiplier — sát thương là `effect.amount` cố định.
- **`heal`**: `target.hp = min(target.maxHp, target.hp + effect.amount + healPower)`, trong đó `healPower = source.magicPower` nếu skill có `isMagic: true` và `source` là `Character`, ngược lại `healPower = 0`.
- **`restoreMp`**: tương tự `heal` nhưng trên `target.mp`/`target.maxMp` (chỉ áp dụng cho `Character`).
- **`applyStatusEffect`** / **`removeStatusEffect`**: thêm/xóa entry `{ statusEffectId, turnsRemaining }` khỏi `target.activeStatusEffects` (danh sách unique theo `statusEffectId` — áp lại 1 status đang có sẵn chỉ refresh `turnsRemaining` về lại `durationTurns`, không stack chồng).
- **`modifyStat`**: `target.survival[effect.stat] += effect.amount` (`fear`/`hunger`/`thirst`, chỉ `Character`), sau đó clamp trong `[0, 100]`.
- **`modifyCombatStat`**: `target[effect.combatStat] += effect.amount` (`attack`/`defense`/`aggro`/`speed`; `aggro` chỉ có trên `Character`). Effect loại này chỉ xuất hiện bên trong `StatusEffectDefinition.perTurnEffects`, nên vòng đời buff/debuff = vòng đời của status effect chứa nó; khi status hết hạn, resolver áp effect ngược dấu 1 lần để gỡ bù (đảm bảo không rò rỉ buff vĩnh viễn).

### Thứ tự & ranh giới trách nhiệm
- Một `SkillDefinition`/`ItemDefinition` có thể có nhiều `effects`; resolver áp dụng **tuần tự theo đúng thứ tự trong mảng**, effect sau thấy được state đã bị effect trước đó thay đổi (VD Flurry Assault của Rogue = 3 effect `damage` liên tiếp, effect 2 tính trên hp đã bị effect 1 trừ).
- Trừ MP (skill) hoặc tiêu hao vật phẩm (item) xảy ra **ở pha ra lệnh, lúc `QueuedAction` được tạo** (§2) — không phải lúc resolver chạy. Resolver chỉ lo phần effect, không đụng vào chi phí kích hoạt.
- `usesPerCombat` cũng được kiểm tra & trừ ngay ở pha ra lệnh, cùng lúc với MP.

---

## 4. Cơ chế skill cho bộ kit 6 skill/class

Áp dụng cho `gameplay-decisions/01-class-skill.md` §1 / `gameplay-decisions/04-fear-combat.md` §4.1. Cả 4 cơ chế dưới đây nằm gọn trong `src/engine/combat.ts` (`applySkillEffects`, `autoResolveTargets`, `resolveExecutionTargets`, `runCharacterTurn`, `queueAction`, `resolveRound`/`finalizeRound`) — `resolveSkillEffect` trong `resolver.ts` không cần biết về roll xác suất/cooldown/quan hệ phe, vì đó vẫn chỉ là hàm áp 1 effect đơn lẻ lên 1 target.

### 4.1 Proc theo tỉ lệ (`SkillEffect.chance`)
- Field optional trên `SkillEffect`: `chance?: number` (0-1). Không có field này = luôn áp dụng.
- Roll tại `applySkillEffects`, trong vòng lặp per-target, ngay trước khi gọi `resolveSkillEffect` cho effect đó: `if (effect.chance !== undefined && ctx.rng.next() >= effect.chance) continue;` — bỏ qua đúng effect này cho đúng target này, các effect khác trong cùng skill không bị ảnh hưởng.
- AoE: mỗi target trong danh sách roll `chance` độc lập.

### 4.2 Buff tự thêm hiệu ứng khi đánh trúng — "on-hit rider" (`StatusEffectDefinition.onHitStatusEffectId`)
Dùng cho Poison Coat (Rogue): self-buff không tự gây sát thương, nhưng khiến các đòn `damage` tiếp theo của actor tự kèm áp poison lên mục tiêu trúng đòn.
- Field optional trên `StatusEffectDefinition`: `onHitStatusEffectId?: Id`.
- Trong `applySkillEffects`, sau khi 1 effect `kind: "damage"` được resolve thành công lên 1 target (target vẫn tồn tại, không nhất thiết phải còn sống): kiểm tra `source.activeStatusEffects` (chỉ khi `isCharacter(source)`) xem có status nào có `onHitStatusEffectId` không → nếu có, gọi thêm `resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: def.onHitStatusEffectId }, source, target, ctx)`.
- Không giới hạn số status mang field này cùng lúc trên 1 actor (loop qua tất cả `activeStatusEffects`).
- Không tương tác với proc `chance` ở 4.1 — rider luôn áp nếu effect `damage` gốc áp thành công (không roll thêm lần 2).

### 4.3 Choáng — bỏ lượt (`StatusEffectDefinition.stuns`)
Dùng cho hiệu ứng "stunned" (Lightning Bolt/Lightning Storm của Mage).
- Field optional trên `StatusEffectDefinition`: `stuns?: boolean`.
- Đầu `runCharacterTurn` và `runMonsterTurn`, trước bước lấy `QueuedAction`/chọn AI: nếu `actor.activeStatusEffects` có bất kỳ status nào `stuns: true` đang active → log bỏ lượt, `return`, không thực thi hành động — áp được cho **cả monster**.
- Không tự động gỡ status khi actor bị bỏ lượt vì nó — `tickStatusEffects` cuối round vẫn xử lý `turnsRemaining` như bình thường.

### 4.4 Skill 2 phe — hiệu ứng khác nhau tùy ally/enemy (`SkillDefinition.effectsByRelation` + 2 `SkillTarget` mới)
Dùng cho Purify (chọn 1 trong 2 phe) và Divine Descent (cả 2 phe cùng lúc) của Acolyte.
- 2 giá trị cho `SkillTarget`: `"singleAllyOrEnemy"` (Purify — người chơi chọn 1 mục tiêu, có thể là đồng đội hoặc địch) và `"allAlliesAndEnemies"` (Divine Descent — tự động nhắm toàn bộ cả 2 phe).
- `SkillDefinition.effects` là optional; `effectsByRelation?: { ally: SkillEffect[]; enemy: SkillEffect[] }` thay thế khi có mặt — skill có `effectsByRelation` thì bỏ qua `effects`.
- `autoResolveTargets`: `"allAlliesAndEnemies"` → trả về hợp của toàn bộ nhân vật + quái còn sống; `"singleAllyOrEnemy"` → trả `null` như `singleEnemy`/`singleAlly` (bắt UI hỏi).
- `resolveExecutionTargets`: `"singleAllyOrEnemy"` — nếu target gốc chết, redirect theo đúng loại của target gốc (gốc là monster → redirect như `singleEnemy`; gốc là character → fizzle như `singleAlly`). `"allAlliesAndEnemies"` — lọc chết khỏi danh sách gộp.
- `applySkillEffects`: nếu `skill.effectsByRelation` tồn tại, effect list cho mỗi target = `isCharacter(target) ? effectsByRelation.ally : effectsByRelation.enemy`.
- Roll accuracy cho AoE (`gameplay-decisions/04-fear-combat.md` mục 4.1) áp dụng cho nửa `enemy` của cả 2 skill; nửa `ally` không roll.

### 4.5 Ultimate: luôn trúng + hệ số hiệu quả theo fear riêng (`SkillDefinition.isUltimate`)
- Field optional trên `SkillDefinition`: `isUltimate?: boolean` — tách biệt hoàn toàn khỏi `usesPerCombat`; ultimate dùng `cooldownTurns` (§4.6) thay vì giới hạn số lần dùng.
- `runCharacterTurn`: nếu `skill.isUltimate`, bỏ qua nhánh `rollHits`/`getFearAccuracyPenalty` hoàn toàn.
- `applySkillEffects`: nếu `skill.isUltimate` và `isCharacter(source)`, nhân `effect.amount` của mọi effect `damage`/`heal` với hệ số theo bảng fear-ultimate (`gameplay-decisions/04-fear-combat.md` §4.1) trước khi truyền vào `resolveSkillEffect` — 2 cơ chế giảm sức mạnh theo fear chạy song song cho 2 nhóm skill khác nhau: ultimate dùng hệ số riêng ở đây, skill thường dùng flat 15%.

### 4.6 Cooldown theo lượt (`SkillDefinition.cooldownTurns` + `Character.cooldownsRemaining`)
`usesPerCombat` không được dùng bởi bất kỳ skill nào trong `data/classes.json` hiện tại — toàn bộ skill (kể cả ultimate) dùng `cooldownTurns` thay thế. `usesPerCombat`/`Character.usesRemainingThisCombat` vẫn tồn tại trong type/code, dành cho item tiêu hao (`gameplay-decisions/07-items-artifacts.md` §7).
- Field optional trên `SkillDefinition`: `cooldownTurns?: number`.
- Field trên `Character` (mirror `usesRemainingThisCombat`): `cooldownsRemaining: Record<Id, number>` — khởi tạo `{}` ở `createCharacter`, reset `{}` ở `startCombat` — không kéo dài qua combat khác.
- `queueAction`: chặn nếu `(actor.cooldownsRemaining[skillId] ?? 0) > 0`. Khi queue thành công và `skill.cooldownTurns` có giá trị, set `actor.cooldownsRemaining[skillId] = skill.cooldownTurns` (cùng lúc trừ MP, ở pha ra lệnh).
- Giảm dần: cuối mỗi round, với mọi entry `> 0` trong `cooldownsRemaining` của mọi actor còn sống → trừ 1 (floor ở 0).
- Quy ước gán `cooldownTurns` (`gameplay-decisions/01-class-skill.md` §1.5): skill `isBuff: true` (Shield Guard, Rally, Poison Coat) → `cooldownTurns = durationTurns của status chính + 1`; skill damage/utility khác gán tay; ultimate cố định `5`.

### 4.7 Buff luôn ưu tiên trong round — `SkillDefinition.isBuff` + bonus speed tạm thời khi tính thứ tự lượt
Dùng cho Shield Guard, Rally (Vanguard), Poison Coat (Rogue) — 3 skill duy nhất `isBuff: true`.

- Field optional trên `SkillDefinition`: `isBuff?: boolean`.
- `buildTurnQueue`: khi tính sort key cho 1 combatant là character, kiểm tra `combat.queuedActions` xem actor đó có `QueuedAction` nào trỏ tới skill `isBuff: true` không → nếu có, dùng `actor.speed + 20` làm khoá sort thay vì `actor.speed`. **Không** ghi đè `actor.speed` thật — chỉ là giá trị tạm thời dùng để sort, mất đi ngay sau khi `turnQueue` dựng xong.
- Không ảnh hưởng gì tới quái (monster không queue trước).
- Nếu 2+ character cùng dùng skill `isBuff: true` trong 1 round, cả 2 đều +20 — tie-break vẫn theo rule cũ (`speed` bằng nhau → nhân vật trước quái, rồi theo thứ tự gốc trong `combatants`).

---

## 5. Elite/Boss skill kit (`gameplay-decisions/06-level-system.md` §6.12)

- **Tái dùng `applySkillEffects`** (viết cho character) thẳng cho quái — hàm này generic theo `Actor` (`isCharacter(source)` tự rẽ nhánh), và `rollHits` luôn trả `true` khi source không phải character, nên quái dùng skill vẫn giữ đúng bất biến "quái luôn trúng" mà không cần sửa gì ở resolver.
- **Skill của quái không qua `queueAction`** — không tốn MP, không track `cooldownsRemaining`, không "chọn trước rồi resolve theo tốc độ" như character. `runMonsterTurn` gọi thẳng `applySkillEffects` tại đúng lượt của quái trong `turnQueue`.
- **Data**: `data/monster-skills.json` (song song `data/classes.json`, nhưng phẳng — không nhóm theo class) + `getMonsterSkill(id)` ở `src/data/monsters.ts`. Tái dùng nguyên `SkillDefinition` type — `mpCost`/`slot`/`unlockLevel` bị bỏ qua khi resolve, giữ giá trị placeholder. 20 entry (4 skill × 5 archetype guard-room — Skeleton Guard, Giant Spider, Dragon, Zombie Knight, Dark Knight).
- **`MonsterArchetype.eliteSkillIds`/`bossSkillIds`** (optional): archetype nào không set thì tier elite/boss của nó rơi về đòn đánh thường (`amount 0`). `MonsterArchetype.guardOnly?: boolean` đánh dấu archetype chỉ được chọn làm quái guard-room, không lẫn vào phòng combat thường (`src/data/floor.ts`, `GUARD_ROOM_ARCHETYPES`/`COMBAT_ROOM_ARCHETYPES`) — phòng guard-room `rng.pick(GUARD_ROOM_ARCHETYPES)` random 1 trong 5 archetype mỗi lần build.
- **`runMonsterTurn`** rẽ nhánh theo `actor.tier` trước khi tới logic targeting cũ (`pickMonsterTarget`, dùng chung cho cả quái thường lẫn skill Strike của elite/boss). Nếu không phải charge/release turn: decrement `executeCooldownTurns`, rồi roll `ctx.rng.chance(0.3)` cho Debuff (theo status khác nhau tùy archetype — `weakened`/`poisoned`/`burning`/`stunned`), rồi tới elite/boss chung roll `ctx.rng.chance(0.3)` cho Cleave, cuối cùng fallback Strike — generic theo `archetype.eliteSkillIds`/`bossSkillIds`, không hardcode tên skill/archetype trong `combat.ts`.
- **Execute — tích lực 2 lượt thay vì trigger theo %HP**: state trên `Monster` — `executeCooldownTurns` (khởi tạo `EXECUTE_COOLDOWN_TURNS = 3` ở `spawnMonster`, chỉ cho tier boss), `isChargingExecute`, `executeTargetId`. Mỗi lượt boss (đầu `runMonsterTurn`, trước cả nhánh Debuff/Cleave):
  1. `isChargingExecute === true` → đọc `executeTargetId` (fallback `pickAggroWeighted` nếu mục tiêu đã chết giữa 2 lượt), gọi `applySkillEffects` với skill execute của đúng archetype (`amount 71`), reset `isChargingExecute = false`, `executeTargetId = undefined`, `executeCooldownTurns = EXECUTE_COOLDOWN_TURNS`, rồi `return`.
  2. Ngược lại, nếu `executeCooldownTurns <= 0` → gọi `pickAggroWeighted` để khoá mục tiêu ngay (ghi vào `executeTargetId`, set `isChargingExecute = true`), log cảnh báo, `return` **không gây sát thương** — cả lượt đó chỉ để tích lực.
  3. Ngược lại → decrement `executeCooldownTurns`, tiếp tục rẽ nhánh Debuff/Cleave/Strike như cũ.
  - Mục tiêu được chọn 1 lần lúc tích lực (bước 2) và đọc lại nguyên vẹn lúc tung đòn (bước 1) — thay đổi `aggro` sau khi đã khoá không ảnh hưởng gì, chỉ có tác dụng nếu dùng trước lượt tích lực trong cùng round (nhờ rule +20 speed cho buff, mục 4.7).
  - `hasStunningStatus` check ở đầu `runMonsterTurn` vẫn chạy trước toàn bộ logic trên — nếu boss bị choáng đúng lượt lẽ ra tung Execute, `isChargingExecute` giữ nguyên `true` (turn bị bỏ qua hoàn toàn), đòn vẫn tung ra ở lượt kế tiếp không bị choáng — stun trì hoãn chứ không hủy đòn đã tích lực.
