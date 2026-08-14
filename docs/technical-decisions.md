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
- **`damage`**: với mỗi target, `finalDamage = max(1, effect.amount + source.attack - target.defense)`. Nếu `source` là character và đang ở bậc fear "Bất An"/"Hoảng Loạn" (mục 4, `gameplay-decisions.md`), áp thêm accuracy-roll và damage-multiplier tương ứng trước khi trừ hp; bậc "Suy Sụp" có thêm khả năng bỏ lượt được roll ở bước chọn hành động (pha ra lệnh), trước khi resolver được gọi (nên resolver không cần biết về case "mất lượt").
- **`heal`**: `target.hp = min(target.maxHp, target.hp + effect.amount)`.
- **`restoreMp`**: tương tự `heal` nhưng trên `target.mp`/`target.maxMp` (chỉ áp dụng cho `Character`).
- **`applyStatusEffect`** / **`removeStatusEffect`**: thêm/xóa `effect.statusEffectId` khỏi `target.statusEffectIds` (danh sách unique — áp lại 1 status đang có sẵn chỉ refresh `durationTurns`, không stack chồng).
- **`modifyStat`**: `target.survival[effect.stat] += effect.amount` (`fear`/`hunger`/`thirst`, chỉ `Character`), sau đó clamp trong `[0, 100]`.
- **`modifyCombatStat`**: `target[effect.combatStat] += effect.amount` (`attack`/`defense`/`aggro`/`speed`; `aggro` chỉ có trên `Character`). Effect loại này chỉ xuất hiện bên trong `StatusEffectDefinition.perTurnEffects` (không đứng độc lập trong 1 skill), nên vòng đời buff/debuff = vòng đời của status effect chứa nó; khi status hết hạn (`durationTurns` về 0), resolver áp effect ngược dấu 1 lần để gỡ bù (đảm bảo không rò rỉ buff vĩnh viễn).
- **`triggerMiniGame`**: resolver KHÔNG tự resolve hp/mp ở đây — trả về tín hiệu "pending", caller (combat loop) chuyển `GameState.mode` sang `{ kind: "miniGame", session, reason }`. Khi mini-game hoàn tất, `MiniGameResult` được dịch ngược thành 1 danh sách `SkillEffect` phái sinh (VD `damage` tỉ lệ combo cho boss phase, hoặc rút ngắn `durationTurns` của debuff đang chữa) và đưa lại qua chính `resolveSkillEffect` — không có code path resolve riêng cho kết quả mini-game.

### Thứ tự & ranh giới trách nhiệm
- Một `SkillDefinition`/`ItemDefinition` có thể có nhiều `effects`; resolver áp dụng **tuần tự theo đúng thứ tự trong mảng**, effect sau thấy được state đã bị effect trước đó thay đổi (VD Song Kích của Sát Thủ = 2 effect `damage` liên tiếp, effect 2 tính trên hp đã bị effect 1 trừ).
- Trừ MP (skill) hoặc tiêu hao vật phẩm (item, nếu `!stackable` hoặc hết số lượng) xảy ra **ở pha ra lệnh, lúc `QueuedAction` được tạo** (§2) — không phải lúc resolver chạy. Resolver chỉ lo phần effect, không đụng vào chi phí kích hoạt; tới lúc resolver được gọi thì chi phí đã trừ xong từ trước, kể cả khi action sau đó fizzle vì mục tiêu chết.
- `usesPerCombat` cũng được kiểm tra & trừ ngay ở pha ra lệnh, cùng lúc với MP (resolver không biết và không cần biết về giới hạn số lần dùng).
