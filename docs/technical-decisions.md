# Kỹ thuật — Quyết định

**Trạng thái**: Đã chốt và **đã implement đầy đủ** (mục 1-5) — **⚠️ cập nhật 2026-08-17**: mục 4 từng ghi "spec chưa implement" (2026-08-16), nay đã lỗi thời — mọi field/cơ chế mô tả ở mục 4 (`isBuff`, `isUltimate`, `effectsByRelation`, `onHitStatusEffectId`, `stuns`, `cooldownTurns`) đã có mặt trong `src/types.ts`/`src/engine/combat.ts` và đang chạy thật trong game, không còn là spec chờ code.
**Liên quan**: `./design-doc.md` mục 3; `../dungeon-crawler-data-model.ts`

---

## 1. Sinh room/floor: thư viện pattern (thay cho spanning tree)

**Quyết định đã đổi** (bản trước dùng random spanning tree generate-then-validate — xem lịch sử git nếu cần tham khảo). Lý do đổi: spanning tree ngẫu nhiên vẫn có thể sinh ra **ngõ cụt** (leaf node không dẫn tới đâu, ví dụ 1 nhánh phụ chỉ để rồi phải quay lại) — trải nghiệm không tốt cho 1 dungeon crawler muốn mọi lựa chọn của người chơi đều có ý nghĩa tiến triển. Quyết định mới: **tác giả thủ công 1 thư viện "pattern" tầng, lưu dạng dữ liệu, random chọn 1 pattern mỗi khi tạo tầng** — cấu trúc được đảm bảo đúng luật ngay từ lúc thiết kế pattern, không cần validate-and-retry.

### Notation
Một pattern là chuỗi các **stage** (cột) nối nhau bằng `-`; mỗi stage gồm 1+ phòng nối nhau bằng `,`; mỗi phòng là `stage.roomId[tag]`:
- `stage` = số thứ tự cột (0-indexed, phải khớp vị trí thực của nó trong chuỗi — bắt lỗi copy-paste).
- `roomId` = số hiệu phòng, duy nhất trong toàn pattern.
- `tag` = `""` (phòng combat thường), `"free"` (phòng nghỉ/rest), `"boss"` (phòng boss — bắt buộc là phòng duy nhất của stage cuối).

Ví dụ (pattern `pattern-fork-mid`, 9 phòng — mọi đường đi đều khớp đúng "5 thường + 1 nghỉ + 1 boss" đã chốt):
```
0.1[]-1.2[],1.3[],1.4[]-2.5[]-3.6[]-4.7[free]-5.8[]-6.9[boss]
```

### Quy tắc kết nối — đảm bảo hết ngõ cụt bằng kết cấu, không cần kiểm tra riêng
**Mọi phòng ở stage N nối tới TẤT CẢ phòng ở stage N+1** (đồ thị 2 phía đầy đủ giữa 2 stage liền kề), **không có cạnh nào khác** — không nối lùi, không nối tắt qua stage. Hệ quả tự động, không cần thuật toán validate riêng:
- Không thể có ngõ cụt: mọi phòng luôn có ít nhất 1 cạnh đi tới stage kế, tới tận stage cuối (boss).
- Mọi nhánh rẽ đều tự hội tụ lại: khi 1 stage sau đó chỉ có 1 phòng, mọi phòng ở stage rẽ nhánh trước đó đều dẫn vào đúng phòng ấy.
- Không cho phép quay lại phòng cũ (di chuyển chỉ tiến, khớp tinh thần "mỗi nhánh đều về đích").

### Ràng buộc khi tác giả 1 pattern (`validatePattern` chặn ở code, không chỉ ở tài liệu)
- Stage 0 đúng 1 phòng (lối vào duy nhất).
- Stage cuối đúng 1 phòng, tag `boss`; không stage nào khác được gắn `boss`.
- **Tối đa 2 stage có > 1 phòng** ("2 lần rẽ nhánh" — đúng yêu cầu đã chốt).
- `roomId` duy nhất trong cả pattern.
- **Mọi đường đi từ entry tới boss phải có ≥5 phòng combat và 1-2 phòng nghỉ** (`pathRoomBounds` trong `floorPatterns.ts` — vì mỗi stage nối toàn bộ sang stage kế nên độ dài đường đi = số stage bất kể chọn nhánh nào; bổ sung 2026-08-17 sau khi phát hiện `pattern-short-fork` cho phép chỉ 2 phòng combat trước boss).

### Lưu trữ & runtime
- Thư viện pattern: `darkest-terminal/data/floor-patterns.json` — mảng `{ id, description, layout }`; hiện có 4 pattern mẫu (0, 1, 1, 2 branch stage; 8–12 phòng, mọi đường đi ≥5 combat + 1-2 nghỉ) minh họa đủ dải quy tắc cho phép.
- `createFloor(rng, depth)` (`src/data/floor.ts`): random chọn 1 pattern qua `rng.pick`, parse layout, dựng `Room[]` với `connectedRoomIds` = toàn bộ phòng stage kế; gán tên phòng ngẫu nhiên (pool theo loại phòng, tránh trùng tên trong cùng tầng) và random 1-3 quái/phòng combat (từ 11 archetype combat thường, xem `gameplay-decisions/02-monster.md` §2), 1 quái elite hoặc boss (5 archetype guard-room, random 1 — `gameplay-decisions/02-monster.md` §2, `gameplay-decisions/06-level-system.md` §6.11) cho phòng `boss`. `depth` không còn cố định — `Game.advanceToNextFloor()` (`src/engine/game.ts`) gọi lại `createFloor` với `depth + 1` mỗi khi phòng guard-room được dọn sạch (`gameplay-decisions/06-level-system.md` §6.9).
- `test/floorPatterns.test.ts`: verify từng pattern trong thư viện — số stage rẽ nhánh ≤ 2, mọi phòng reachable từ entry, mọi phòng đều có đường tới boss (BFS), cộng test riêng cho parser/validator (input hỏng phải throw).

`darknessLevel` của `Floor` = hàm đơn điệu tăng theo `depth` (công thức cụ thể để dành cho balancing sau, chỉ cần đảm bảo tăng dần) — không đổi so với quyết định trước.

---

## 2. Vòng lượt: pha ra lệnh + pha thực thi theo tốc độ

Mô hình đã chốt: **không phải turn-by-turn phản ứng liên tục** — mỗi round chia làm 2 pha rõ rệt, khớp `CombatState.phase` (`"command" | "resolution"`).

### Pha 1 — Ra lệnh (`phase: "command"`)
- Người chơi chọn hành động (skill hoặc item) + mục tiêu cho **cả 4 nhân vật còn sống** trước, không thấy trước quái sẽ làm gì round này ("chọn mù"). Quái **không** ra lệnh ở pha này.
- Mỗi lựa chọn hợp lệ được ghi thành 1 `QueuedAction` vào `CombatState.queuedActions` (1 entry/nhân vật còn sống).
- Validate ngay tại lúc queue (không đợi tới lúc thực thi): đủ MP trả `mpCost`, còn lượt `usesPerCombat` nếu skill có giới hạn. Skill không hợp lệ thì không cho chọn.
- **MP bị trừ / vật phẩm bị tiêu hao ngay khi queue**, không đợi tới pha thực thi — quyết định ở pha ra lệnh coi như đã chốt, không hoàn tác kể cả khi mục tiêu đổi trạng thái trước lúc thực thi (xem rule bên dưới).
- Đủ 4 `QueuedAction` → chuyển `phase` sang `"resolution"`.

### Pha 2 — Thực thi (`phase: "resolution"`)
- Dựng `turnQueue` = mọi combatant còn sống (4 nhân vật + toàn bộ quái), **snapshot `speed` hiện tại tại đúng thời điểm này** (không tính lại giữa round dù có buff/debuff `speed` xảy ra trong lúc thực thi). Sort giảm dần theo `speed`; hòa → nhân vật trước quái, sau đó theo thứ tự gốc trong `combatants`.
- Duyệt `turnQueue` từ đầu bằng `activeTurnIndex`, mỗi bước:
  1. Nếu combatant đã chết (bị hạ bởi ai đó ra tay trước trong cùng round) → bỏ qua, không hành động, kể cả nếu là nhân vật có `QueuedAction` đang chờ (action đó bị hủy hoàn toàn, không thực thi).
  2. Nếu là **nhân vật**: lấy `QueuedAction` tương ứng, áp **rule mục tiêu chết trước lượt** (bên dưới) rồi gọi resolver (`§3`).
  3. Nếu là **quái**: AI chọn hành động + mục tiêu **ngay tại thời điểm này** (không pre-commit như nhân vật) dựa trên trạng thái hiện tại — targeting theo `aggro` (`gameplay-decisions/02-monster.md` §2).
- **Mục tiêu chết trước lượt**: nếu target gốc của 1 `QueuedAction` đã chết khi tới lượt actor thực thi:
  - `target: "singleEnemy"` → đổi hướng ngẫu nhiên sang 1 quái còn sống bất kỳ; hết quái sống → action fizzle (MP/item vẫn đã mất từ pha ra lệnh).
  - `target: "singleAlly"` → **không** đổi hướng, action fizzle luôn — đổi sang người khác sẽ đi ngược lựa chọn ban đầu của người chơi (VD 1 lệnh hồi máu nhắm đúng người sắp chết không nên tự "trôi" sang người khác).
- Hết `turnQueue` → `roundNumber += 1`, `queuedActions` reset rỗng, `phase` quay lại `"command"` cho round kế (nếu combat chưa kết thúc).
- Combat kết thúc khi toàn bộ `monster` trong `combatants` chết (thắng) hoặc toàn bộ `character` chết (permadeath toàn đội — game over, không phải "thua trận" thông thường).

Có chủ đích **không** thêm yếu tố ngẫu nhiên vào `speed` (không roll thêm) — tốc độ quyết định thứ tự lượt một cách thuần túy xác định, đúng như "tốc độ (ưu tiên ra đòn trước)" đã chốt; biến thiên giữa các trận tới từ buff/debuff `speed` qua skill (`modifyCombatStat`), không phải từ RNG nền.

---

## 3. Resolver function cho SkillEffect

Một hàm thuần túy duy nhất, dùng chung cho cả skill lẫn item (đúng nguyên tắc data-driven đã chốt):

```
resolveSkillEffect(effect: SkillEffect, source: Combatant, targets: Combatant[], ctx: GameState): void
```

`source`/`target` ở đây là `Character` hoặc `Monster` — cả 2 type đều có field phẳng `attack`/`defense`/`hp`/`maxHp` cùng tên nên phần lớn effect dùng chung code path bất kể source/target là ai; `mp`/`maxMp`/`aggro`/`survival` chỉ tồn tại trên `Character`.

### Xử lý theo `effect.kind`
- **`damage`**: với mỗi target, `finalDamage = max(1, effect.amount + source.attack - target.defense)`. Nếu `source` là character và đang ở bậc fear "Bất An"/"Hoảng Loạn" (`gameplay-decisions/04-fear-combat.md` mục 4), áp thêm accuracy-roll và damage-multiplier tương ứng trước khi trừ hp; bậc "Suy Sụp" có thêm khả năng bỏ lượt được roll ở bước chọn hành động (pha ra lệnh), trước khi resolver được gọi (nên resolver không cần biết về case "mất lượt"). **Ngoại lệ khi `source === target`** (tick định kỳ của chính 1 status effect trên actor đang mang nó, VD DoT "Poisoned" — `tickStatusEffects` trong `resolver.ts` gọi lại `resolveSkillEffect` với `source`/`target` là cùng 1 actor): đây không phải "một đòn tấn công" nên **không** cộng/trừ attack/defense hay áp fear-multiplier — sát thương là `effect.amount` cố định, khớp mô tả "mỗi lượt damage 4" ở `gameplay-decisions/01-class-skill.md` mục 1.5 (bảng status effects). Có regression test (`test/engine.test.ts`) chặn trường hợp DoT vô tình cộng thêm attack/defense của chính actor đang chịu DoT.
- **`heal`**: `target.hp = min(target.maxHp, target.hp + effect.amount)`.
- **`restoreMp`**: tương tự `heal` nhưng trên `target.mp`/`target.maxMp` (chỉ áp dụng cho `Character`).
- **`applyStatusEffect`** / **`removeStatusEffect`**: thêm/xóa entry `{ statusEffectId, turnsRemaining }` khỏi `target.activeStatusEffects` (danh sách unique theo `statusEffectId` — áp lại 1 status đang có sẵn chỉ refresh `turnsRemaining` về lại `durationTurns`, không stack chồng). `activeStatusEffects: ActiveStatusEffect[]` (không phải `statusEffectIds: Id[]` phẳng) vì cần track riêng số lượt còn lại cho từng instance — xem `ActiveStatusEffect` trong `dungeon-crawler-data-model.ts`/`src/types.ts`.
- **`modifyStat`**: `target.survival[effect.stat] += effect.amount` (`fear`/`hunger`/`thirst`, chỉ `Character`), sau đó clamp trong `[0, 100]`.
- **`modifyCombatStat`**: `target[effect.combatStat] += effect.amount` (`attack`/`defense`/`aggro`/`speed`; `aggro` chỉ có trên `Character`). Effect loại này chỉ xuất hiện bên trong `StatusEffectDefinition.perTurnEffects` (không đứng độc lập trong 1 skill), nên vòng đời buff/debuff = vòng đời của status effect chứa nó; khi status hết hạn (`durationTurns` về 0), resolver áp effect ngược dấu 1 lần để gỡ bù (đảm bảo không rò rỉ buff vĩnh viễn).
- **`triggerMiniGame`**: resolver KHÔNG tự resolve hp/mp ở đây — trả về tín hiệu "pending", caller (combat loop) chuyển `GameState.mode` sang `{ kind: "miniGame", session, reason }`. Khi mini-game hoàn tất, `MiniGameResult` được dịch ngược thành 1 danh sách `SkillEffect` phái sinh (VD `damage` tỉ lệ combo cho boss phase, hoặc rút ngắn `durationTurns` của debuff đang chữa) và đưa lại qua chính `resolveSkillEffect` — không có code path resolve riêng cho kết quả mini-game.

### Thứ tự & ranh giới trách nhiệm
- Một `SkillDefinition`/`ItemDefinition` có thể có nhiều `effects`; resolver áp dụng **tuần tự theo đúng thứ tự trong mảng**, effect sau thấy được state đã bị effect trước đó thay đổi (VD Flurry Assault của Rogue = 3 effect `damage` liên tiếp, effect 2 tính trên hp đã bị effect 1 trừ).
- Trừ MP (skill) hoặc tiêu hao vật phẩm (item, nếu `!stackable` hoặc hết số lượng) xảy ra **ở pha ra lệnh, lúc `QueuedAction` được tạo** (§2) — không phải lúc resolver chạy. Resolver chỉ lo phần effect, không đụng vào chi phí kích hoạt; tới lúc resolver được gọi thì chi phí đã trừ xong từ trước, kể cả khi action sau đó fizzle vì mục tiêu chết.
- `usesPerCombat` cũng được kiểm tra & trừ ngay ở pha ra lệnh, cùng lúc với MP (resolver không biết và không cần biết về giới hạn số lần dùng).

---

## 4. Cơ chế skill cho bộ kit 6 skill/class

**Trạng thái**: **đã implement đầy đủ** — cơ chế mới cho `gameplay-decisions/01-class-skill.md` §1 / `gameplay-decisions/04-fear-combat.md` §4.1, ban đầu viết ra như spec-trước-code (⚠️ dòng trạng thái gốc "chỉ là tài liệu, chưa sửa" đã lỗi thời, xem ghi chú đầu file) để lúc implement code khớp đúng thiết kế thay vì đoán lại — nay `data/classes.json`/`src/types.ts`/`src/engine/combat.ts`/`src/engine/resolver.ts`/`src/ui/app.ts`/`src/engine/party.ts` đều đã sửa theo đúng mục này.

Cả 4 cơ chế dưới đây đều thiết kế để nằm gọn trong `src/engine/combat.ts` (cụ thể là hàm `applySkillEffects`, `autoResolveTargets`, `resolveExecutionTargets`, `runCharacterTurn`, `queueAction`, `resolveRound`/`finalizeRound`) — **không cần sửa** `resolveSkillEffect` trong `resolver.ts`, vì đó vẫn chỉ là hàm áp 1 effect đơn lẻ lên 1 target, không cần biết về roll xác suất/cooldown/quan hệ phe.

### 4.1 Proc theo tỉ lệ (`SkillEffect.chance`)

- Field mới, optional, trên `SkillEffect`: `chance?: number` (0-1). Không có field này = luôn áp dụng (hành vi hiện tại, không đổi cho 22 effect đã có).
- Roll tại `applySkillEffects`, **trong vòng lặp per-target**, ngay trước khi gọi `resolveSkillEffect` cho effect đó: `if (effect.chance !== undefined && ctx.rng.next() >= effect.chance) continue;` — bỏ qua đúng effect này cho đúng target này, các effect khác trong cùng skill (VD effect `damage` chính) không bị ảnh hưởng.
- AoE: mỗi target trong danh sách roll `chance` độc lập (Fire Pillar 50% bỏng trên 3 địch có thể ra 0, 1, 2, hoặc cả 3 địch bị bỏng).

### 4.2 Buff tự thêm hiệu ứng khi đánh trúng — "on-hit rider" (`StatusEffectDefinition.onHitStatusEffectId`)

Dùng cho Poison Coat (Rogue): self-buff không tự gây sát thương, nhưng khiến các đòn `damage` tiếp theo của actor tự kèm áp poison lên mục tiêu trúng đòn.

- Field mới, optional, trên `StatusEffectDefinition`: `onHitStatusEffectId?: Id`.
- Trong `applySkillEffects`, sau khi 1 effect `kind: "damage"` được resolve thành công lên 1 target (target vẫn tồn tại, không nhất thiết phải còn sống — theo đúng rule "sát thương trước, kiểm tra chết sau" đã có): kiểm tra `source.activeStatusEffects` (chỉ khi `isCharacter(source)`) xem có status nào có `onHitStatusEffectId` không → nếu có, gọi thêm `resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: def.onHitStatusEffectId }, source, target, ctx)`.
- Không giới hạn số status mang field này cùng lúc trên 1 actor (loop qua tất cả `activeStatusEffects`, không dừng ở cái đầu tiên) — dù ở bản kit hiện tại chỉ có `poison-coat` (Poison Coat) dùng cơ chế này.
- Không tương tác với proc `chance` ở 4.1 — rider luôn áp nếu effect `damage` gốc áp thành công (không roll thêm lần 2), trừ khi sau này có skill cụ thể cần rider theo %, lúc đó thêm field `onHitChance?: number` riêng chứ không tái dùng `chance` của 4.1 (2 khái niệm khác nhau: chance của 1 effect trong skill vs. chance của rider từ buff).

### 4.3 Choáng — bỏ lượt (`StatusEffectDefinition.stuns`)

Dùng cho hiệu ứng "stunned" (Lightning Bolt/Lightning Storm của Mage).

- Field mới, optional, trên `StatusEffectDefinition`: `stuns?: boolean`.
- Đầu `runCharacterTurn` và `runMonsterTurn` (combat.ts), **trước** bước lấy `QueuedAction`/chọn AI: nếu `actor.activeStatusEffects` có bất kỳ status nào `stuns: true` đang active → log bỏ lượt, `return`, không thực thi hành động — giống hệt pattern `rollLosesControl` (fear bậc 4) đã có, chỉ khác là do status thay vì roll theo fear, và áp được cho **cả monster** (fear chỉ tồn tại trên Character, nhưng "choáng" do skill người chơi gây cần tác dụng lên quái).
- Không tự động gỡ status khi actor bị bỏ lượt vì nó — `tickStatusEffects` cuối round vẫn xử lý `turnsRemaining` như bình thường, không có logic đặc biệt.

### 4.4 Skill 2 phe — hiệu ứng khác nhau tùy ally/enemy (`SkillDefinition.effectsByRelation` + 2 `SkillTarget` mới)

Dùng cho Purify (chọn 1 trong 2 phe) và Divine Descent (cả 2 phe cùng lúc) của Acolyte.

- 2 giá trị mới cho `SkillTarget`: `"singleAllyOrEnemy"` (Purify — người chơi chọn 1 mục tiêu, có thể là đồng đội hoặc địch) và `"allAlliesAndEnemies"` (Divine Descent — tự động nhắm toàn bộ cả 2 phe, không cần chọn).
- `SkillDefinition.effects` đổi thành **optional**; thêm field mới optional `effectsByRelation?: { ally: SkillEffect[]; enemy: SkillEffect[] }`. Quy ước: skill có `effectsByRelation` thì bỏ qua `effects`; 24 skill còn lại (không phải Purify/Divine Descent) vẫn dùng `effects` như cũ, không set `effectsByRelation`.
- `autoResolveTargets`: thêm case `"allAlliesAndEnemies"` → trả về `livingCharacterRefs(...) ∪ livingMonsterRefs(...)` (gộp, không cần người chơi chọn); case `"singleAllyOrEnemy"` → trả `null` như `singleEnemy`/`singleAlly` hiện tại (bắt UI hỏi).
- `src/ui/app.ts` (`trySelectSkill`): thêm nhánh cho `"singleAllyOrEnemy"` — candidates = `livingEnemyRefs() ∪ livingAllyRefs()`, hiển thị chung 1 danh sách để người chơi chọn (cần phân biệt rõ ally/enemy trong label, VD prefix "[Đồng đội]"/"[Địch]").
- `resolveExecutionTargets`: `"singleAllyOrEnemy"` — nếu target gốc chết, redirect theo đúng loại của target gốc (gốc là monster → redirect như `singleEnemy`; gốc là character → fizzle như `singleAlly`, không đổi phe). `"allAlliesAndEnemies"` — lọc chết khỏi danh sách gộp, giữ nguyên pattern generic đã dùng cho `self`/`allAllies`/`allEnemies`.
- `applySkillEffects`: nếu `skill.effectsByRelation` tồn tại, effect list cho mỗi target = `isCharacter(target) ? effectsByRelation.ally : effectsByRelation.enemy` (thay vì `skill.effects` cố định).
- `runCharacterTurn` (`isEnemyTargeting`, quyết định có roll accuracy hay không): mở rộng điều kiện — `"allAlliesAndEnemies"` luôn coi là có nhắm địch (vì luôn có nửa `enemy`); `"singleAllyOrEnemy"` tùy thuộc **target đã resolve** (`queued.targets[0].kind === "monster"`) chứ không phải field `target` tĩnh của skill.
- Roll accuracy cho AoE (`gameplay-decisions/04-fear-combat.md` mục 4.1, tách theo từng target) áp dụng cho nửa `enemy` của cả 2 skill; nửa `ally` không roll, giữ nguyên rule cũ ("fear chỉ ảnh hưởng kỹ năng nhắm địch").

### 4.5 Ultimate: luôn trúng + hệ số hiệu quả theo fear riêng (`SkillDefinition.isUltimate`)

**Cập nhật (2026-08-16, cùng ngày)**: ultimate không còn dùng `usesPerCombat` — xem lý do ở §4.6.

- Field mới, optional, trên `SkillDefinition`: `isUltimate?: boolean` — cờ tường minh, tách biệt hoàn toàn khỏi mọi giới hạn số lần dùng (không tái dùng `usesPerCombat` hay bất kỳ field nào khác làm cờ ngầm định). Cả 4 ultimate hiện có (Sword Judgment, Flurry Assault, Ice Age, Divine Descent) set `isUltimate: true` **+** `cooldownTurns: 5` (không set `usesPerCombat`).
- `runCharacterTurn`: nếu `skill.isUltimate`, bỏ qua nhánh `rollHits`/`getFearAccuracyPenalty` hoàn toàn (không log "trượt vì quá sợ hãi").
- `applySkillEffects` (hoặc 1 bước tiền xử lý trước khi gọi resolver): nếu `skill.isUltimate` và `isCharacter(source)`, nhân `effect.amount` của mọi effect `damage`/`heal` với hệ số theo bảng fear-ultimate (`gameplay-decisions/04-fear-combat.md` §4.1) **trước khi** truyền vào `resolveSkillEffect` — không đụng `damageMultiplierFor`/`getFearDamagePenalty` hiện có (2 cơ chế giảm sức mạnh theo fear chạy song song nhưng áp cho 2 nhóm skill khác nhau: ultimate dùng hệ số riêng ở đây, skill thường vẫn dùng flat 15% cũ).

### 4.6 Cooldown theo lượt thay cho `usesPerCombat` (`SkillDefinition.cooldownTurns` + `Character.cooldownsRemaining`)

**Cập nhật (2026-08-16, cùng ngày)**: bản spec trước có `usesPerCombat: 1` cho 4 ultimate + cooldown chỉ áp cho skill slot 3-4. Quyết định mới: **`usesPerCombat` không còn dùng cho bất kỳ skill nào** (kể cả ultimate) — toàn bộ 24 skill (kể cả 4 ultimate, dùng `cooldownTurns: 5`) chuyển hẳn sang `cooldownTurns`. `usesPerCombat`/`Character.usesRemainingThisCombat` **vẫn giữ nguyên trong type/code hiện có**, chỉ đơn giản là không skill nào set field này nữa — dành chỗ cho Item tiêu hao (nay đã có spec, xem `gameplay-decisions/01-class-skill.md` §1.5 bullet cuối và `gameplay-decisions/07-items-artifacts.md` §7). Vì không skill nào dùng `usesPerCombat` nữa, nhánh check `usesPerCombat`/`usesRemainingThisCombat` hiện có trong `queueAction` trở thành **dead code cho tới khi** chức năng kia được thiết kế — không xoá (vẫn cần cho chức năng tương lai đó), nhưng không còn nhánh nào trong `data/classes.json` kích hoạt nó nữa.

- Field mới, optional, trên `SkillDefinition`: `cooldownTurns?: number`.
- Field mới trên `Character` (mirror `usesRemainingThisCombat`): `cooldownsRemaining: Record<Id, number>` — khởi tạo `{}` ở `createCharacter` (`party.ts`), reset `{}` ở `startCombat` (`combat.ts`, cùng chỗ reset `usesRemainingThisCombat`) — **cooldown không kéo dài qua combat khác**, chỉ có ý nghĩa trong 1 trận đang đánh.
- `queueAction`: thêm điều kiện chặn — `if ((actor.cooldownsRemaining[skillId] ?? 0) > 0) return { reason: "Kỹ năng đang hồi chiêu." }`. Khi queue thành công và `skill.cooldownTurns` có giá trị, set `actor.cooldownsRemaining[skillId] = skill.cooldownTurns` (cùng lúc trừ MP, tại pha ra lệnh, đúng nguyên tắc "chi phí chốt lúc queue" ở mục 2).
- Giảm dần: cuối mỗi round (`resolveRound`/`finalizeRound`, cùng chỗ `tickStatusEffects` chạy), với mọi entry `> 0` trong `cooldownsRemaining` của mọi actor còn sống → trừ 1 (floor ở 0, không cần xóa key).
- 2 quy ước gán `cooldownTurns` (`gameplay-decisions/01-class-skill.md` §1.5): skill đánh dấu `isBuff: true` (Shield Guard, Rally, Poison Coat) → `cooldownTurns = durationTurns của status chính + 1`; skill damage/utility khác và ultimate → gán tay (ultimate cố định `5`).

### 4.7 Buff luôn ưu tiên trong round — `SkillDefinition.isBuff` + bonus speed tạm thời khi tính thứ tự lượt

Dùng cho Shield Guard, Rally (Vanguard), Poison Coat (Rogue) — 3 skill duy nhất đánh dấu `isBuff: true` (bảng ở `gameplay-decisions/01-class-skill.md` §1.1-1.4, cột "Buff?").

**Vì sao không làm bằng data thuần (`applyStatusEffect` một status "+20 speed, 1 lượt")**: `buildTurnQueue` (combat.ts, §2) snapshot `speed` của mọi combatant **ngay khi bắt đầu pha thực thi**, tức là **trước** khi bất kỳ effect nào của bất kỳ `QueuedAction` nào được resolve. Nếu để "+20 speed" là 1 effect nằm trong chính skill buff đó, nó chỉ áp dụng **sau** khi tới lượt actor trong `turnQueue` — nghĩa là chỉ có tác dụng cho round **kế tiếp**, không phải round đang thực thi. Vì mục tiêu là "buff xong rồi mới tới đòn tấn công **trong cùng round**", cần can thiệp thẳng vào bước build `turnQueue`, không thể chỉ dùng data.

- Field mới, optional, trên `SkillDefinition`: `isBuff?: boolean`.
- `buildTurnQueue` (combat.ts): khi tính sort key cho 1 combatant là character, kiểm tra `combat.queuedActions` xem actor đó có `QueuedAction` nào trỏ tới skill có `isBuff: true` không (tra bằng `getSkill(queued.source.skillId).isBuff`) → nếu có, dùng `actor.speed + 20` làm khoá sort thay vì `actor.speed`. **Không** ghi đè `actor.speed` thật — chỉ là giá trị tạm thời dùng để sort, mất đi ngay sau khi `turnQueue` dựng xong (không rò rỉ sang round sau, không cần cơ chế "undo" như status effect).
- Không ảnh hưởng gì tới quái (monster không queue trước — AI chọn hành động tại chỗ ở đúng lượt của nó, `runMonsterTurn`, nên không có khái niệm "buff trước tấn công" cho quái).
- Nếu 2+ character cùng dùng skill `isBuff: true` trong 1 round, cả 2 đều +20 — tie-break vẫn theo rule cũ (`speed` bằng nhau → nhân vật trước quái, rồi theo thứ tự gốc trong `combatants`).

## 5. Elite/Boss skill kit (docs/gameplay-decisions/06-level-system.md §6.12)

- **Tái dùng `applySkillEffects`** (combat.ts, vốn viết cho character) thẳng cho quái — hàm này đã generic theo `Actor` (`isCharacter(source)` tự rẽ nhánh), và fear/accuracy roll (`rollHits`) đã luôn trả `true` khi source không phải character, nên quái dùng skill vẫn giữ đúng bất biến "quái luôn trúng" mà không cần sửa gì ở resolver.
- **Skill của quái không qua `queueAction`** — không tốn MP, không track `cooldownsRemaining`, không có khái niệm "chọn trước rồi resolve theo tốc độ" như character. `runMonsterTurn` gọi thẳng `applySkillEffects` tại đúng lượt của quái trong `turnQueue`, y hệt cách nó vốn gọi `resolveSkillEffect` cho đòn đánh thường trước đây.
- **Data**: `data/monster-skills.json` (song song `data/classes.json`, nhưng phẳng — không nhóm theo class) + `getMonsterSkill(id)` ở `src/data/monsters.ts`. Tái dùng nguyên `SkillDefinition` type cho mọi entry — `mpCost`/`slot`/`unlockLevel` bị bỏ qua khi resolve (chỉ có ý nghĩa cho player skill qua `queueAction`), giữ giá trị placeholder (`0`/`0`/`1`) để không cần thêm type mới. **Cập nhật (2026-08-17)**: 20 entry (4 skill × 5 archetype guard-room — Skeleton Guard, Giant Spider, Dragon, Zombie Knight, Dark Knight), thay vì 4 entry gốc chỉ cho `skeleton-guard`.
- **`MonsterArchetype.eliteSkillIds`/`bossSkillIds`** (optional, `types.ts`): archetype nào không set thì tier elite/boss của nó vẫn rơi về đòn đánh thường cũ (`amount 0`) — **cập nhật (2026-08-17)**: nay **5 archetype** cùng set (không còn chỉ `skeleton-guard`). Field mới `MonsterArchetype.guardOnly?: boolean` (4/5 archetype đánh dấu `true` — Skeleton Guard là ngoại lệ, vẫn spawn ở cả combat thường) đánh dấu archetype chỉ được chọn làm quái guard-room, không lẫn vào phòng combat thường — xem `src/data/floor.ts` (`GUARD_ROOM_ARCHETYPES`, lọc theo có đủ cả `eliteSkillIds` lẫn `bossSkillIds`; `COMBAT_ROOM_ARCHETYPES`, lọc bỏ `guardOnly: true`). **`BOSS_ARCHETYPE_ID` hằng số cũ (cố định `skeleton-guard`) đã bị xoá** — phòng guard-room giờ `rng.pick(GUARD_ROOM_ARCHETYPES)` random 1 trong 5 archetype mỗi lần build, thay vì luôn cùng 1 archetype.
- **`runMonsterTurn` (combat.ts)** rẽ nhánh theo `actor.tier` trước khi tới logic targeting cũ (`pickMonsterTarget`, tách ra từ nhánh `else` gốc để dùng chung cho cả quái thường lẫn skill Strike của elite/boss). Nếu không phải charge/release turn: decrement `executeCooldownTurns`, rồi roll `ctx.rng.chance(0.3)` cho Debuff (roll riêng theo status khác nhau tùy archetype — `weakened`/`poisoned`/`burning`/`stunned`), rồi tới elite/boss chung roll `ctx.rng.chance(0.3)` cho Cleave, cuối cùng fallback Strike. Toàn bộ logic này **generic theo `archetype.eliteSkillIds`/`bossSkillIds` đang trỏ tới skill nào** — không hardcode tên skill/archetype cụ thể trong `combat.ts`, nên hoạt động y hệt cho cả 5 archetype mà không cần rẽ nhánh riêng theo archetype.
- **Execute — tích lực 2 lượt thay vì trigger theo %HP (§6.12)**: state mới trên `Monster` (`types.ts`) — `executeCooldownTurns` (khởi tạo `EXECUTE_COOLDOWN_TURNS = 3` ở `spawnMonster`, chỉ cho tier boss), `isChargingExecute`, `executeTargetId`. Mỗi lượt boss (đầu `runMonsterTurn`, trước cả nhánh Debuff/Cleave):
  1. `isChargingExecute === true` → đọc `executeTargetId` (fallback `pickAggroWeighted` nếu mục tiêu đã chết giữa 2 lượt), gọi `applySkillEffects` với skill execute của đúng archetype (`amount 71`), reset `isChargingExecute = false`, `executeTargetId = undefined`, `executeCooldownTurns = EXECUTE_COOLDOWN_TURNS`, rồi `return` — không rơi xuống nhánh Debuff/Cleave/Strike cùng lượt.
  2. Ngược lại, nếu `executeCooldownTurns <= 0` → gọi `pickAggroWeighted` để **khoá** mục tiêu ngay (ghi vào `executeTargetId`, set `isChargingExecute = true`), log cảnh báo, `return` **không gây sát thương** — cả lượt đó chỉ để tích lực.
  3. Ngược lại → decrement `executeCooldownTurns`, tiếp tục rẽ nhánh Debuff/Cleave/Strike như cũ.
  - Vì mục tiêu được chọn 1 lần lúc tích lực (bước 2) và đọc lại nguyên vẹn lúc tung đòn (bước 1), thay đổi `aggro` **sau** khi đã khoá không ảnh hưởng gì — chỉ có tác dụng nếu dùng **trước** lượt tích lực trong cùng round (nhờ rule +20 speed cho buff, mục 1, khiến Shield Guard kịp resolve trước lượt boss nếu dùng cùng round).
  - `hasStunningStatus` check ở đầu `runMonsterTurn` vẫn chạy trước toàn bộ logic trên — nếu boss bị choáng đúng lượt lẽ ra tung Execute, `isChargingExecute` **giữ nguyên `true`** (turn bị bỏ qua hoàn toàn, không đọc tới nhánh boss), nên đòn vẫn tung ra ở lượt kế tiếp không bị choáng — stun trì hoãn chứ không hủy đòn đã tích lực.
