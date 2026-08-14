# Kỹ thuật — Quyết định

**Trạng thái**: Đã chốt
**Liên quan**: `../dungeon-crawler-design-doc.md` mục 3; `../dungeon-crawler-data-model.ts`

---

## 1. Thuật toán procedural generation cho room/floor

Cách tiếp cận: **generate-then-validate** trên đồ thị trừu tượng (không phải carve grid vật lý trước) — dựng cấu trúc rẽ nhánh bằng spanning tree ngẫu nhiên trước, gán loại phòng sau, validate rồi mới quyết định giữ hay sinh lại.

### Bước 1 — Số phòng & khung đồ thị
1. Chọn `roomCount` ngẫu nhiên trong [5, 10].
2. Tạo `roomCount` node trống (chưa gán `RoomType`).
3. Dựng **random spanning tree** phủ toàn bộ node (randomized Prim's: bắt đầu từ 1 node, lặp lại chọn ngẫu nhiên 1 cạnh nối 1 node-trong-cây với 1 node-ngoài-cây, tới khi hết node). Kết quả đảm bảo:
   - Toàn bộ đồ thị liên thông (đi được hết mọi phòng).
   - Có node degree > 2 một cách tự nhiên (spanning tree ngẫu nhiên không phải chuỗi tuyến tính trừ phi random rơi đúng vào 1 đường thẳng — xác suất thấp, và có thể ép tối thiểu 1 node degree ≥ 3 nếu roomCount ≥ 6 bằng cách retry bước dựng cây).
4. (Tuỳ chọn, không bắt buộc) thêm tối đa 1-2 cạnh phụ giữa các node chưa kề nhau để tạo vòng lặp (loop) trong đồ thị, tăng cảm giác "dungeon" thay vì cây thuần — xác suất thêm mỗi cạnh ứng viên: 20%.

### Bước 2 — Gán RoomType
1. `entryRoomId` = 1 node bất kỳ có degree thấp (ưu tiên leaf) làm lối vào.
2. Chạy BFS từ `entryRoomId` để tính khoảng cách mọi node → chọn node xa nhất (leaf ưu tiên) làm phòng `boss`.
3. Trong các node còn lại, chọn ngẫu nhiên 1-2 node làm `rest`, với ràng buộc: mỗi phòng `rest` phải cách phòng `rest` khác (và cách `entry`) tối thiểu 2 bước đồ thị — tránh 2 phòng nghỉ dính sát nhau hoặc trùng lối vào.
4. Các node còn lại gán ngẫu nhiên theo trọng số: 60% `combat`, 15% `treasure`, 15% `empty`, 10% `rest` bổ sung nếu chưa đủ 1-2 phòng rest.

### Bước 3 — Validate & retry
Kiểm tra sau khi gán xong:
- Đúng 1 phòng `boss`, đúng 1-2 phòng `rest`, đồ thị liên thông (đã đảm bảo từ bước 1 nên chỉ cần assert, không cần tính lại).
- Không có phòng `rest`/`boss` nào trùng `entryRoomId`.

Nếu bất kỳ điều kiện nào fail (hiếm, chủ yếu khi `roomCount` chạm biên dưới 5) → sinh lại từ Bước 1 với seed khác. Đây chính là phần "constraint-satisfaction" đã nêu trong rủi ro kỹ thuật ở design doc — xử lý bằng generate-and-test đơn giản thay vì solver phức tạp, chấp nhận được vì không gian ràng buộc nhỏ (tối đa 10 node).

`darknessLevel` của `Floor` = hàm đơn điệu tăng theo `depth` (công thức cụ thể để dành cho balancing sau, chỉ cần đảm bảo tăng dần).

---

## 2. Thuật toán turn queue / initiative

- Tại thời điểm bắt đầu combat (`CombatState` được tạo): với mỗi combatant, tính
  - Character: `initiative = characterClass.baseInitiative + roll(1, 6)`
  - Monster: `initiative = monster.initiative + roll(1, 6)`

  (`roll(1,6)` = số nguyên ngẫu nhiên đều trong [1,6], thêm biến thiên để thứ tự lượt không hoàn toàn tĩnh giữa các trận dù cùng đội hình.)
- Gán giá trị này vào `Combatant.initiative`, dựng `CombatState.turnQueue` bằng cách sort **giảm dần** theo initiative; hòa initiative → ưu tiên `kind: "character"` trước `"monster"` (party luôn được lợi thế nhỏ khi hòa), rồi tới thứ tự `combatants` gốc làm tie-break cuối.
- `turnQueue` được tính **1 lần duy nhất khi combat bắt đầu** và giữ nguyên thứ tự suốt trận (không re-roll mỗi round) — ưu tiên đơn giản & dễ đoán hơn cho một side project, đúng tinh thần "không over-engineer".
- Vòng lặp lượt:
  1. `activeTurnIndex` trỏ vào phần tử hiện tại của `turnQueue`.
  2. Nếu combatant tại `activeTurnIndex` đã chết (`Character.isAlive === false` hoặc `Monster` hp ≤ 0) → bỏ qua, tăng `activeTurnIndex`, không tốn "lượt" thực (không tính vào lịch sử, chỉ là skip khi duyệt).
  3. Combatant còn sống hành động xong → `activeTurnIndex += 1`.
  4. Nếu `activeTurnIndex` vượt quá cuối `turnQueue` → reset về 0 và `roundNumber += 1`.
- Combat kết thúc khi toàn bộ `monster` trong `combatants` chết (thắng) hoặc toàn bộ `character` chết (permadeath toàn đội — game over, không phải "thua trận" thông thường).

---

## 3. Resolver function cho SkillEffect

Một hàm thuần túy duy nhất, dùng chung cho cả skill lẫn item (đúng nguyên tắc data-driven đã chốt):

```
resolveSkillEffect(effect: SkillEffect, source: Combatant, targets: Combatant[], ctx: GameState): void
```

### Xử lý theo `effect.kind`
- **`damage`**: với mỗi target, `finalDamage = max(1, effect.amount + source.attack - target.defense)`. Nếu `source` là character và đang ở bậc fear "Bất An"/"Hoảng Loạn" (mục 4, `gameplay-decisions.md`), áp thêm accuracy-roll và damage-multiplier tương ứng trước khi trừ hp; bậc "Suy Sụp" có thêm khả năng bỏ lượt được roll ở bước chọn hành động, trước khi resolver được gọi (nên resolver không cần biết về case "mất lượt").
- **`heal`**: `target.stats.hp = min(target.stats.maxHp, target.stats.hp + effect.amount)`.
- **`restoreMp`**: tương tự `heal` nhưng trên `mp`/`maxMp`.
- **`applyStatusEffect`** / **`removeStatusEffect`**: thêm/xóa `effect.statusEffectId` khỏi `target.statusEffectIds` (danh sách unique — áp lại 1 status đang có sẵn chỉ refresh `durationTurns`, không stack chồng).
- **`modifyStat`**: `target.stats[effect.stat] += effect.amount`, sau đó clamp: `hp`/`mp` trong `[0, max tương ứng]`; `fear`/`hunger`/`thirst` trong `[0, 100]`.
- **`modifyCombatStat`**: `target.attack`/`target.defense` (hoặc `initiative` nếu về sau cần) `+= effect.amount`. Effect loại này chỉ xuất hiện bên trong `StatusEffectDefinition.perTurnEffects` (không đứng độc lập trong 1 skill), nên vòng đời buff/debuff = vòng đời của status effect chứa nó; khi status hết hạn (`durationTurns` về 0), resolver áp effect ngược dấu 1 lần để gỡ bù (đảm bảo không rò rỉ buff vĩnh viễn).
- **`triggerMiniGame`**: resolver KHÔNG tự resolve hp/mp ở đây — trả về tín hiệu "pending", caller (combat loop) chuyển `GameState.mode` sang `{ kind: "miniGame", session, reason }`. Khi mini-game hoàn tất, `MiniGameResult` được dịch ngược thành 1 danh sách `SkillEffect` phái sinh (VD `damage` tỉ lệ combo cho boss phase, hoặc rút ngắn `durationTurns` của debuff đang chữa) và đưa lại qua chính `resolveSkillEffect` — không có code path resolve riêng cho kết quả mini-game.

### Thứ tự & ranh giới trách nhiệm
- Một `SkillDefinition`/`ItemDefinition` có thể có nhiều `effects`; resolver áp dụng **tuần tự theo đúng thứ tự trong mảng**, effect sau thấy được state đã bị effect trước đó thay đổi (VD Song Kích của Sát Thủ = 2 effect `damage` liên tiếp, effect 2 tính trên hp đã bị effect 1 trừ).
- Trừ MP (skill) hoặc tiêu hao vật phẩm (item, nếu `!stackable` hoặc hết số lượng) xảy ra **trước** khi gọi resolver, do caller đảm nhiệm — resolver chỉ lo phần effect, không đụng vào chi phí kích hoạt.
- `usesPerCombat` cũng được caller kiểm tra trước khi cho phép gọi resolver (resolver không biết và không cần biết về giới hạn số lần dùng).
