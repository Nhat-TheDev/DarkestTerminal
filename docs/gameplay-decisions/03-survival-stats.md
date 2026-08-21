# §3. Ngưỡng số cho survival stats

*(mục 3 của `00-index.md`)*

Cả 3 chỉ số (`fear`, `hunger`, `thirst`) nằm trong khoảng **0–100**.

### Giá trị khởi tạo — giống nhau cho mọi class
`hunger: 100, thirst: 100, fear: 0`. Không có field riêng cho việc này trên `CharacterClass` — đây là hằng số áp dụng khi tạo `Character` mới, độc lập với class.

### Hunger / Thirst
- Mỗi hành động trong dungeon loop (di chuyển 1 phòng, hoặc 1 lượt combat): `hunger -1`, `thirst -1.5` (khát giảm nhanh hơn đói).
- Khi `hunger` hoặc `thirst` chạm 0: nhân vật nhận `damage = 2% maxHp` mỗi hành động tiếp theo cho tới khi được nạp lại (2 chỉ số cộng dồn nếu cả hai cùng chạm đáy).
- Hồi qua item: `Ration` (+40 hunger) và `Water Flask` (+40 thirst), dùng effect `modifyStat` giống mọi item khác (`07-items-artifacts.md` §7).
- Rest room **không** hồi `hunger`/`thirst` — cả 3 lựa chọn của rest room chỉ tác động `hp`/`mp`/`fear` (xem mục "Rest room" bên dưới); hunger/thirst chỉ hồi được qua item.

### Fear
- **Theo round combat**: cuối mỗi round mà trận **chưa kết thúc**, mỗi nhân vật còn sống nhận thêm fear:
  - `+1` bình thường, hoặc **`+3` thay vào đó (không cộng dồn với `+1`)** nếu nhân vật đang dưới **60% maxHP**.
  - Cả 2 mức đều **scale +5%/tầng** (`depth 1` = mức gốc, không bonus), mỗi mức có trần riêng: mức thường tối đa **3/round**, mức dưới 60% HP tối đa **6/round**.
  - Bị giảm theo artifact `fearResist` — xem `07-items-artifacts.md` §7.2.
  - Implementation: `fearGainForRound`/`applyRoundFear` trong `src/engine/survival.ts`, gọi từ `resolveRound` (`src/engine/combat.ts`) mỗi round không kết thúc trận.
- **Thắng trận**: `fear -= 10` cho cả team (mọi nhân vật còn sống); nếu trận đó có **Elite hoặc Boss** thì `fear -= 15` **thay thế** (không cộng dồn với `-10`) — xét theo tier thật của quái vừa hạ (`Monster.tier !== "normal"`), không phải theo loại phòng. Implementation: `applyVictoryFearRelief`, gọi từ `finalizeRound` khi `outcome === "victory"`.
- Thua mini-game: `fear += 15` (cố định, không phụ thuộc loại mini-game).
- Rest room (lựa chọn "Trò chuyện"): `fear -= 20`.

Fear không tăng khi di chuyển giữa các phòng — chỉ tăng trong lúc combat kéo dài (theo round, như mô tả ở trên).

### Rest room

Vào phòng rest room, người chơi chọn 1 trong 3 lựa chọn (`Game.restAction`), mỗi lựa chọn chỉ tác động `hp`/`mp`/`fear`, không đụng đến `hunger`/`thirst`:

| Lựa chọn | Hiệu ứng |
|---|---|
| **Ăn uống** (`restEatDrink`) | `hp += 50% maxHp`, `mp += 50% maxMp` |
| **Trò chuyện** (`restChat`) | `hp += 10% maxHp`, `mp += 10% maxMp`, `fear -= 20` |
| **Bỏ qua** | Không hiệu ứng gì, chỉ đánh dấu phòng đã dọn (`room.cleared = true`) và đi tiếp |

Cả 3 lựa chọn đều đánh dấu phòng đã "cleared" sau khi chọn (không lặp lại được).

### 4 bậc fear (dùng chung cho `04-fear-combat.md` mục 4 bên dưới)
| Bậc | Khoảng | Tên |
|---|---|---|
| 1 | 0–39 | Bình Tĩnh |
| 2 | 40–69 | Bất An |
| 3 | 70–99 | Hoảng Loạn |
| 4 | 100 | Suy Sụp |
