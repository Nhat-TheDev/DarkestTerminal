# §3. Ngưỡng số cho survival stats

*(mục 3 của `00-index.md`)*

Cả 3 chỉ số (`fear`, `hunger`, `thirst`) nằm trong khoảng **0–100**.

### Giá trị khởi tạo — giống nhau cho mọi class
`hunger: 100, thirst: 100, fear: 0`. Không có field riêng cho việc này trên `CharacterClass` (đã bỏ `baseStats` khỏi class) — đây là hằng số áp dụng khi tạo `Character` mới, độc lập với class, vì 3 chỉ số này không phải đặc trưng riêng của từng class như 6 chỉ số ở `01-class-skill.md` mục 1.

### Hunger / Thirst
- Mỗi hành động trong dungeon loop (di chuyển 1 phòng, hoặc 1 lượt combat): `hunger -1`, `thirst -1.5` (khát giảm nhanh hơn đói).
- Khi `hunger` hoặc `thirst` chạm 0: nhân vật nhận `damage = 2% maxHp` mỗi hành động tiếp theo cho tới khi được nạp lại qua item (2 chỉ số cộng dồn nếu cả hai cùng chạm đáy).
- Hồi qua item (`ItemDefinition.effects` với `modifyStat` — xem `07-items-artifacts.md` §7, chưa implement).
- **⚠️ Rest room hiện KHÔNG hồi `hunger`/`thirst`** — xem ghi chú "Rest room — cập nhật hành vi thật" bên dưới; đây là điểm lệch giữa thiết kế gốc (mục này) và code hiện hành, chưa được giải quyết.

### Fear
- Ambient theo tầng: mỗi khi vào phòng mới, `fear += darknessLevel` của `Floor` hiện tại (darkness tăng dần theo depth — công thức darkness cụ thể để tự do cho phần balancing sau, chỉ cần tăng đơn điệu theo `depth`).
- Thua mini-game: `fear += 15` (cố định, không phụ thuộc loại mini-game).
- Rest room (lựa chọn "Trò chuyện"): `fear -= 20` — xem chi tiết ở ghi chú bên dưới, con số và cơ chế đã đổi khác thiết kế gốc.

### Rest room — cập nhật hành vi thật (2026-08-17, `src/engine/survival.ts`/`src/engine/game.ts`)

Thiết kế gốc ở mục này mô tả rest room là 1 hành động duy nhất, tự động hồi đầy cả 3 chỉ số. **Code hiện hành khác hẳn** — vào phòng rest room, người chơi chọn 1 trong 3 lựa chọn (`Game.restAction`), mỗi lựa chọn chỉ tác động `hp`/`mp`/`fear`, **không đụng đến `hunger`/`thirst`**:

| Lựa chọn | Hiệu ứng |
|---|---|
| **Ăn uống** (`restEatDrink`) | `hp += 50% maxHp`, `mp += 50% maxMp` |
| **Trò chuyện** (`restChat`) | `hp += 10% maxHp`, `mp += 10% maxMp`, `fear -= 20` |
| **Bỏ qua** | Không hiệu ứng gì, chỉ đánh dấu phòng đã dọn (`room.cleared = true`) và đi tiếp |

Cả 3 lựa chọn đều đánh dấu phòng đã "cleared" sau khi chọn (không lặp lại được). Đây là 1 phần của quyết định "chỉnh EXP curve để rest room có ý nghĩa hơn" (`06-level-system.md` §6.9) — nhưng bản thân cơ chế rest room (3 lựa chọn, không hồi hunger/thirst) là 1 thay đổi độc lập, chưa có ghi chú quyết định riêng giải thích lý do bỏ hồi hunger/thirst — **cần bổ sung quyết định thiết kế rõ ràng** (có chủ đích để hunger/thirst chỉ hồi qua item — chưa implement — hay là thiếu sót cần vá) ở lần cập nhật tài liệu kế tiếp.

### 4 bậc fear (dùng chung cho `04-fear-combat.md` mục 4 bên dưới)
| Bậc | Khoảng | Tên |
|---|---|---|
| 1 | 0–39 | Bình Tĩnh |
| 2 | 40–69 | Bất An |
| 3 | 70–99 | Hoảng Loạn |
| 4 | 100 | Suy Sụp |
