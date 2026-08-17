# §5. Hiệu quả & tăng trưởng của các chỉ số nhân vật

*(mục 5 của `00-index.md`)*

Mục 1-4 (`01-class-skill.md`, `02-monster.md`, `03-survival-stats.md`, `04-fear-combat.md`) đã định nghĩa hiệu quả của `fear`/`hunger`/`thirst`, của `attack`/`defense` (qua công thức damage ở `docs/technical-decisions.md` §3), của `aggro` (targeting, `02-monster.md` mục 2) và `speed` (thứ tự lượt, `docs/technical-decisions.md` §2). Phần còn thiếu: **HP/MP hoạt động thế nào**, và **chỉ số thay đổi ra sao khi nhân vật lên cấp**.

### HP
- HP về 0 (từ bất kỳ nguồn nào — damage combat, đói/khát cạn kiệt ở `03-survival-stats.md` mục 3, hay `perTurnEffects` của status effect) → `Character.isAlive = false` **ngay lập tức**. Permadeath thật (1.2 trong design doc chính): không có effect, skill, hay item nào hồi sinh được nhân vật `isAlive = false`.
- Nếu đang giữa trận, nhân vật vừa chết bị bỏ qua khi `turnQueue` duyệt tới lượt kế (xử lý skip đã có ở `docs/technical-decisions.md` §2, không cần thêm logic riêng).
- Monster hp ≤ 0 → loại khỏi `CombatState.combatants`, không có field `isAlive` riêng (monster không permadeath theo nghĩa narrative, đơn giản là biến mất khỏi trận).

### MP
- Không đủ MP trả `mpCost` của skill → skill đó **không hợp lệ để chọn** ở bước lựa chọn hành động (validate ở caller/UI, giống cách `usesPerCombat` được chặn trước khi gọi resolver — `docs/technical-decisions.md` §3), resolver không bao giờ thấy trường hợp thiếu MP.
- MP **không tự hồi** theo hành động như hunger/thirst tự giảm — chỉ tăng qua skill/item có effect `restoreMp`, hồi đầy khi nghỉ tại rest room, hoặc hồi đầy khi lên cấp (xem bên dưới).

### Tăng trưởng theo cấp (level)
- Level dùng chung cho cả party (không track XP riêng từng người). Nguồn tăng level: EXP tích lũy do giết quái — xem `06-level-system.md` **§6.9**, tách riêng khỏi level tầng ngục (§6.10). Cấp tối đa **100**; công thức tăng trưởng đầy đủ ở `06-level-system.md` §6.
- `aggro` và `speed` **không** tăng theo level — giữ nguyên `baseAggro`/`baseSpeed` suốt game (quyết định không đổi). Đây là 2 chỉ số định hình vai trò/nhịp độ của class (ai bị nhắm, ai ra tay trước), không phải chỉ số sức mạnh thuần túy — cho tăng theo level sẽ làm targeting và thứ tự lượt ở tầng sâu lệch hẳn khỏi thiết kế ban đầu của từng class.
- Mỗi lần lên cấp: `hp`/`mp` hiện tại được đặt lại **đầy (= maxHp/maxMp mới)** — lên cấp = hồi phục toàn phần, tạo cảm giác "phần thưởng" tự nhiên. Trigger lên cấp: "đủ EXP để lên cấp" (`06-level-system.md` §6.9) — level không gắn với việc xuống tầng.
