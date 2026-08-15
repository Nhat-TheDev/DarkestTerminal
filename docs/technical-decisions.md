# Kỹ thuật — Quyết định

**Trạng thái**: Đã chốt
**Liên quan**: `../dungeon-crawler-design-doc.md` mục 3; `../dungeon-crawler-data-model.ts`

---

## 1. Sinh room/floor: thư viện pattern (thay cho spanning tree)

**Quyết định đã đổi** (bản trước dùng random spanning tree generate-then-validate — xem lịch sử git nếu cần tham khảo). Lý do đổi: spanning tree ngẫu nhiên vẫn có thể sinh ra **ngõ cụt** (leaf node không dẫn tới đâu, ví dụ 1 nhánh phụ chỉ để rồi phải quay lại) — trải nghiệm không tốt cho 1 dungeon crawler muốn mọi lựa chọn của người chơi đều có ý nghĩa tiến triển. Quyết định mới: **tác giả thủ công 1 thư viện "pattern" tầng, lưu dạng dữ liệu, random chọn 1 pattern mỗi khi tạo tầng** — cấu trúc được đảm bảo đúng luật ngay từ lúc thiết kế pattern, không cần validate-and-retry.

### Notation
Một pattern là chuỗi các **stage** (cột) nối nhau bằng `-`; mỗi stage gồm 1+ phòng nối nhau bằng `,`; mỗi phòng là `stage.roomId[tag]`:
- `stage` = số thứ tự cột (0-indexed, phải khớp vị trí thực của nó trong chuỗi — bắt lỗi copy-paste).
- `roomId` = số hiệu phòng, duy nhất trong toàn pattern.
- `tag` = `""` (phòng combat thường), `"free"` (phòng nghỉ/rest), `"boss"` (phòng boss — bắt buộc là phòng duy nhất của stage cuối).

Ví dụ (pattern `pattern-fork-mid`, 7 phòng — khớp đúng số phòng "5 thường + 1 nghỉ + 1 boss" đã chốt trước đây):
```
0.1[]-1.2[],1.3[],1.4[]-2.5[]-3.6[free]-4.7[boss]
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

### Lưu trữ & runtime
- Thư viện pattern: `darkest-terminal/data/floor-patterns.json` — mảng `{ id, description, layout }`; hiện có 4 pattern mẫu (0, 1, 1, 2 branch stage; 5–9 phòng) minh họa đủ dải quy tắc cho phép.
- `createFloor(rng)` (`src/data/floor.ts`): random chọn 1 pattern qua `rng.pick`, parse layout, dựng `Room[]` với `connectedRoomIds` = toàn bộ phòng stage kế; gán tên phòng ngẫu nhiên (pool theo loại phòng, tránh trùng tên trong cùng tầng) và random 1-3 quái/phòng combat (đều từ 3 archetype, xem `gameplay-decisions.md` §2), 1 quái elite (`isBoss: true`) cho phòng boss.
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
  3. Nếu là **quái**: AI chọn hành động + mục tiêu **ngay tại thời điểm này** (không pre-commit như nhân vật) dựa trên trạng thái hiện tại — targeting theo `aggro` (`gameplay-decisions.md` §2).
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
- **`damage`**: với mỗi target, `finalDamage = max(1, effect.amount + source.attack - target.defense)`. Nếu `source` là character và đang ở bậc fear "Bất An"/"Hoảng Loạn" (mục 4, `gameplay-decisions.md`), áp thêm accuracy-roll và damage-multiplier tương ứng trước khi trừ hp; bậc "Suy Sụp" có thêm khả năng bỏ lượt được roll ở bước chọn hành động (pha ra lệnh), trước khi resolver được gọi (nên resolver không cần biết về case "mất lượt"). **Ngoại lệ khi `source === target`** (tick định kỳ của chính 1 status effect trên actor đang mang nó, VD DoT "Trúng Độc" — `tickStatusEffects` trong `resolver.ts` gọi lại `resolveSkillEffect` với `source`/`target` là cùng 1 actor): đây không phải "một đòn tấn công" nên **không** cộng/trừ attack/defense hay áp fear-multiplier — sát thương là `effect.amount` cố định, khớp mô tả "mỗi lượt damage 4" ở `gameplay-decisions.md` §1.3. Có regression test (`test/engine.test.ts`) chặn trường hợp DoT vô tình cộng thêm attack/defense của chính actor đang chịu DoT.
- **`heal`**: `target.hp = min(target.maxHp, target.hp + effect.amount)`.
- **`restoreMp`**: tương tự `heal` nhưng trên `target.mp`/`target.maxMp` (chỉ áp dụng cho `Character`).
- **`applyStatusEffect`** / **`removeStatusEffect`**: thêm/xóa entry `{ statusEffectId, turnsRemaining }` khỏi `target.activeStatusEffects` (danh sách unique theo `statusEffectId` — áp lại 1 status đang có sẵn chỉ refresh `turnsRemaining` về lại `durationTurns`, không stack chồng). `activeStatusEffects: ActiveStatusEffect[]` (không phải `statusEffectIds: Id[]` phẳng) vì cần track riêng số lượt còn lại cho từng instance — xem `ActiveStatusEffect` trong `dungeon-crawler-data-model.ts`/`darkest-terminal/src/types.ts`.
- **`modifyStat`**: `target.survival[effect.stat] += effect.amount` (`fear`/`hunger`/`thirst`, chỉ `Character`), sau đó clamp trong `[0, 100]`.
- **`modifyCombatStat`**: `target[effect.combatStat] += effect.amount` (`attack`/`defense`/`aggro`/`speed`; `aggro` chỉ có trên `Character`). Effect loại này chỉ xuất hiện bên trong `StatusEffectDefinition.perTurnEffects` (không đứng độc lập trong 1 skill), nên vòng đời buff/debuff = vòng đời của status effect chứa nó; khi status hết hạn (`durationTurns` về 0), resolver áp effect ngược dấu 1 lần để gỡ bù (đảm bảo không rò rỉ buff vĩnh viễn).
- **`triggerMiniGame`**: resolver KHÔNG tự resolve hp/mp ở đây — trả về tín hiệu "pending", caller (combat loop) chuyển `GameState.mode` sang `{ kind: "miniGame", session, reason }`. Khi mini-game hoàn tất, `MiniGameResult` được dịch ngược thành 1 danh sách `SkillEffect` phái sinh (VD `damage` tỉ lệ combo cho boss phase, hoặc rút ngắn `durationTurns` của debuff đang chữa) và đưa lại qua chính `resolveSkillEffect` — không có code path resolve riêng cho kết quả mini-game.

### Thứ tự & ranh giới trách nhiệm
- Một `SkillDefinition`/`ItemDefinition` có thể có nhiều `effects`; resolver áp dụng **tuần tự theo đúng thứ tự trong mảng**, effect sau thấy được state đã bị effect trước đó thay đổi (VD Song Kích của Sát Thủ = 2 effect `damage` liên tiếp, effect 2 tính trên hp đã bị effect 1 trừ).
- Trừ MP (skill) hoặc tiêu hao vật phẩm (item, nếu `!stackable` hoặc hết số lượng) xảy ra **ở pha ra lệnh, lúc `QueuedAction` được tạo** (§2) — không phải lúc resolver chạy. Resolver chỉ lo phần effect, không đụng vào chi phí kích hoạt; tới lúc resolver được gọi thì chi phí đã trừ xong từ trước, kể cả khi action sau đó fizzle vì mục tiêu chết.
- `usesPerCombat` cũng được kiểm tra & trừ ngay ở pha ra lệnh, cùng lúc với MP (resolver không biết và không cần biết về giới hạn số lần dùng).
