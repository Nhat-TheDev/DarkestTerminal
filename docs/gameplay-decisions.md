# Gameplay / Nội dung — Quyết định

**Trạng thái**: Đã chốt
**Liên quan**: `../dungeon-crawler-design-doc.md` mục 1.3, 1.5; `../dungeon-crawler-data-model.ts`

---

## 1. Class & Skill

### Bảng chỉ số (level 1)

6 chỉ số class: **tấn công** (`attack`), **phòng thủ** (`defense`), **máu** (`maxHp`), **mana** (`maxMp`), **thu hút** (`aggro` — trọng số bị quái chọn làm mục tiêu, xem mục 2), **tốc độ** (`speed` — ưu tiên ra đòn trước, xem `docs/technical-decisions.md` §2).

| Class | attack | defense | maxHp | maxMp | aggro | speed |
|---|---|---|---|---|---|---|
| Cận Vệ (Vanguard) | 14 | 12 | 140 | 20 | 20 | 8 |
| Pháp Sư Bóng Tối (Shadow Mage) | 6 | 4 | 70 | 60 | 8 | 10 |
| Sát Thủ (Rogue) | 16 | 6 | 90 | 30 | 10 | 16 |
| Tu Sĩ (Chaplain) | 6 | 8 | 100 | 50 | 12 | 9 |

Thiết kế có chủ đích: Cận Vệ cao nhất `aggro` + `defense` + `maxHp`, thấp nhất `speed` (tank hút đòn, ra tay muộn); Pháp Sư thấp nhất mọi chỉ số phòng ngự/aggro (né bị nhắm) nhưng `speed` khá; Sát Thủ `speed`/`attack` cao nhất, `defense` thấp; Tu Sĩ cân bằng, `aggro` trung bình để không bị/không tránh được việc làm mục tiêu.

4 class, mỗi class 5 skill (2 mở sẵn ở cấp 1, 3 mở dần ở cấp 3/5/7). `slot`/`unlockLevel`/`usesPerCombat` khớp field cùng tên trong `SkillDefinition`.

### 1.1 Cận Vệ (Vanguard) — tank, chống chịu, giữ chân quái

| Slot | Lvl | Skill | MP | Target | Hiệu ứng |
|---|---|---|---|---|---|
| 0 | 1 | Chém Khiên | 0 | singleEnemy | `damage 10` |
| 1 | 1 | Trấn Thủ | 4 | self | `applyStatusEffect "phong-thu"` (buff, 2 lượt, mỗi lượt `modifyCombatStat defense +6`) |
| 2 | 3 | Khiêu Khích | 6 | self | `applyStatusEffect "khieu-khich"` (buff, 2 lượt, mỗi lượt `modifyCombatStat aggro +40`) — đẩy trọng số bị chọn làm mục tiêu của Cận Vệ lên rất cao (xem targeting theo aggro ở mục 2); vẫn là xác suất, không ép buộc tuyệt đối |
| 3 | 5 | Chặt Hạ | 10 | singleEnemy | `damage 22` |
| 4 | 7 | Bất Khuất | 0 | self | `heal 20%maxHp`, `usesPerCombat 1` — chỉ tự kích hoạt khi HP < 25% |

### 1.2 Pháp Sư Bóng Tối (Shadow Mage) — sát thương phép tầm xa, giòn

| Slot | Lvl | Skill | MP | Target | Hiệu ứng |
|---|---|---|---|---|---|
| 0 | 1 | Phi Ảnh | 5 | singleEnemy | `damage 14` |
| 1 | 1 | Tập Trung | 0 | self | `restoreMp 10` — lượt tích lũy, đánh đổi tempo |
| 2 | 3 | Quầng Tối | 12 | allEnemies | `damage 10` (AoE) |
| 3 | 5 | Nguyền Rủa | 8 | singleEnemy | `applyStatusEffect "nguyen-rua"` (debuff, 3 lượt, mỗi lượt `modifyCombatStat attack -4`) |
| 4 | 7 | Vực Thẳm | 18 | singleEnemy | `damage 40`, `usesPerCombat 1` |

### 1.3 Sát Thủ (Rogue) — burst đơn mục tiêu, tốc độ cao nhất nhóm

| Slot | Lvl | Skill | MP | Target | Hiệu ứng |
|---|---|---|---|---|---|
| 0 | 1 | Đâm Lén | 3 | singleEnemy | `damage 12` |
| 1 | 1 | Lẩn Tránh | 4 | self | `applyStatusEffect "ne-tranh"` (buff, 1 lượt, `modifyCombatStat defense +6`) |
| 2 | 3 | Tẩm Độc | 6 | singleEnemy | `applyStatusEffect "trung-doc"` (debuff thật — xem `curableByMiniGame`, 3 lượt, mỗi lượt `damage 4`) |
| 3 | 5 | Song Kích | 8 | singleEnemy | 2 effect trong list: `damage 10` + `damage 10`, resolve tuần tự |
| 4 | 7 | Nhát Chí Mạng | 14 | singleEnemy | `damage 35`, `usesPerCombat 1` |

### 1.4 Tu Sĩ (Chaplain) — hồi phục + hạ fear cả team

| Slot | Lvl | Skill | MP | Target | Hiệu ứng |
|---|---|---|---|---|---|
| 0 | 1 | Cầu Nguyện | 6 | singleAlly | `heal 16` |
| 1 | 1 | An Ủi | 4 | singleAlly | `modifyStat fear -10` |
| 2 | 3 | Thánh Ca | 10 | allAllies | `heal 10` + `modifyStat fear -6` |
| 3 | 5 | Thanh Tẩy | 8 | singleAlly | `removeStatusEffect` — gỡ 1 debuff bất kỳ ngay lập tức, không cần mini-game (cứu hộ khẩn cấp, đổi lại tốn MP cao so với mpCost trung bình) |
| 4 | 7 | Ánh Sáng Cứu Rỗi | 16 | allAllies | `heal 25` + `modifyStat fear -15`, `usesPerCombat 1` |

### Ghi chú thiết kế
- Mỗi class có đúng 1 skill "ultimate" (`usesPerCombat: 1`) ở slot 4.
- `modifyCombatStat` (buff/debuff attack/defense/aggro/speed) luôn đi qua `applyStatusEffect` — không có effect chỉnh combat-stat tức thời/vĩnh viễn, tất cả đều có `durationTurns` trên `StatusEffectDefinition`.
- `StatusEffectDefinition` dùng chung cho cả buff (VD "phong-thu") lẫn debuff (VD "trung-doc"): buff để `curableByMiniGame: []` và hết hạn qua `durationTurns`; debuff thật mới có `curableByMiniGame` khác rỗng.
- Khiêu Khích đổi target từ `singleEnemy` (ép buộc bằng status flag đọc riêng bởi AI) sang `self` (tự buff `aggro`) — thu hút giờ là cơ chế xác suất thống nhất, không có đường tắt "ép target 100%" nào khác trong hệ thống.

---

## 2. Monster — chỉ số, targeting theo aggro & AI pattern

### Công thức scaling theo độ sâu tầng (`floorDepth`, tầng 1 = depth 1)
- `attack = baseAttack + floorDepth * 2`
- `defense = baseDefense + floorDepth * 1`
- `maxHp = baseHp + floorDepth * 8` (hp khởi tạo = maxHp)
- `speed = baseSpeed` (không scale theo tầng)

Đây là công thức archetype → instance, dùng khi spawn quái vào `Room.monsterIds`; các field `attack/defense/hp/maxHp/speed` trên `Monster` luôn là giá trị đã resolve, không lưu công thức.

### Chọn mục tiêu theo `aggro` ("thu hút")

Quy tắc mặc định (dùng cho mọi pattern trừ khi nói khác ở dưới): **random có trọng số** trên toàn bộ nhân vật còn sống trong party, trọng số = `Character.aggro` hiện tại. Nhân vật `aggro` càng cao thì xác suất bị chọn làm mục tiêu càng lớn — đây chính là cách hiện thực hóa "thu hút" như 1 xác suất thay vì ép buộc cứng.

Công thức: `P(target = X) = X.aggro / tổng aggro toàn bộ nhân vật còn sống`.

### 3 AI pattern (`MonsterAiPattern`)
- **`aggressive`** (Hung Hãn): dùng thẳng quy tắc random có trọng số theo `aggro` ở trên.
- **`defensive`** (Phòng Thủ): nếu HP bản thân < 40% và có skill hồi/phòng thủ trong `skillIds` thì dùng skill đó (target: bản thân); ngược lại rơi về quy tắc random có trọng số theo `aggro` như `aggressive`.
- **`erratic`** (Hỗn Loạn): **bỏ qua** trọng số `aggro` — chọn target ngẫu nhiên đều (uniform) trong các nhân vật còn sống. Đây là điểm khác biệt thật sự của pattern này (không phải chỉ random hành động mà còn random cả việc có "nghe" threat hay không) — đúng chất quái "điên loạn", không đoán trước được kể cả khi có Khiêu Khích.

### Ví dụ archetype theo cụm tầng (minh họa, không bắt buộc đủ)
| Tên | Tầng | baseHp | baseAtk | baseDef | baseSpeed | AI | Ghi chú |
|---|---|---|---|---|---|---|---|
| Chuột Hầm Ngục | 1-3 | 18 | 5 | 2 | 7 | erratic | quái mở màn, tần suất cao |
| Dơi Đen | 1-3 | 14 | 6 | 1 | 14 | aggressive | speed cao, đánh sớm |
| Xương Sống Canh Gác | 4-6 | 40 | 10 | 6 | 8 | defensive | tanky, self-heal khi trúng skill |
| Bóng Ma Gào Thét | 7+ | 60 | 14 | 4 | 11 | erratic | trúng đòn → +fear phụ trội cho nạn nhân |

Boss: `isBoss: true`, xuất hiện mỗi 5 tầng, có 1 phase kích hoạt mini-game ở mốc 50% HP (chi tiết ở `docs/minigame-decisions.md` mục 1).

---

## 3. Ngưỡng số cho survival stats

Cả 3 chỉ số (`fear`, `hunger`, `thirst`) nằm trong khoảng **0–100**.

### Giá trị khởi tạo — giống nhau cho mọi class
`hunger: 100, thirst: 100, fear: 0`. Không có field riêng cho việc này trên `CharacterClass` (đã bỏ `baseStats` khỏi class) — đây là hằng số áp dụng khi tạo `Character` mới, độc lập với class, vì 3 chỉ số này không phải đặc trưng riêng của từng class như 6 chỉ số ở mục 1.

### Hunger / Thirst
- Mỗi hành động trong dungeon loop (di chuyển 1 phòng, hoặc 1 lượt combat): `hunger -1`, `thirst -1.5` (khát giảm nhanh hơn đói).
- Khi `hunger` hoặc `thirst` chạm 0: nhân vật nhận `damage = 2% maxHp` mỗi hành động tiếp theo cho tới khi được nạp lại qua item/rest room (2 chỉ số cộng dồn nếu cả hai cùng chạm đáy).
- Hồi qua item (`ItemDefinition.effects` với `modifyStat`) hoặc nghỉ tại rest room (hồi đầy `hunger`/`thirst`/`fear` về mức an toàn, xem mục 4).

### Fear
- Ambient theo tầng: mỗi khi vào phòng mới, `fear += darknessLevel` của `Floor` hiện tại (darkness tăng dần theo depth — công thức darkness cụ thể để tự do cho phần balancing sau, chỉ cần tăng đơn điệu theo `depth`).
- Thua mini-game: `fear += 15` (cố định, không phụ thuộc loại mini-game).
- Rest room: hồi `fear -= 30` khi nghỉ (không đưa fear về 0 hẳn — vẫn phải chủ động dùng item/skill nếu muốn an toàn tuyệt đối).

### 4 bậc fear (dùng chung cho mục 4 bên dưới)
| Bậc | Khoảng | Tên |
|---|---|---|
| 1 | 0–39 | Bình Tĩnh |
| 2 | 40–69 | Bất An |
| 3 | 70–99 | Hoảng Loạn |
| 4 | 100 | Suy Sụp |

---

## 4. Fear ảnh hưởng ngược lại combat — có, nhưng có trần và có lối thoát

Quyết định: **fear có ảnh hưởng thật tới hiệu suất combat**, áp dụng theo bậc ở mục 3, để giữ đúng tinh thần "rủi ro thật" của permadeath. Để tránh rủi ro chồng rủi ro biến thành tử vòng xoáy không kiểm soát được, ảnh hưởng bị **chặn trần ở bậc 4** và luôn có công cụ hạ fear chủ động (skill Tu Sĩ, item, rest room) đối trọng lại.

| Bậc fear | Ảnh hưởng combat |
|---|---|
| Bình Tĩnh (0-39) | Không ảnh hưởng |
| Bất An (40-69) | Độ chính xác kỹ năng nhắm địch giảm 10% |
| Hoảng Loạn (70-99) | Độ chính xác giảm 20%, sát thương gây ra giảm 15% |
| Suy Sụp (100) | Mỗi lượt có 25% khả năng "mất kiểm soát" — bỏ lượt hoàn toàn (tương đương stun); 75% còn lại hành động bình thường (không giảm thêm accuracy/damage so với bậc Hoảng Loạn) |

Ghi chú: đây là **soft cap có chủ đích** — bậc 4 không tăng nặng thêm theo fear (vì fear đã kịch trần 100), và party luôn có Tu Sĩ/item để kéo fear xuống trước khi vào combat quan trọng. Việc này để dành cho balancing thực tế khi playtest, số % ở trên là điểm khởi đầu, không phải số cuối cùng.

---

## 5. Hiệu quả & tăng trưởng của các chỉ số nhân vật

Mục 1-4 đã định nghĩa hiệu quả của `fear`/`hunger`/`thirst`, của `attack`/`defense` (qua công thức damage ở `technical-decisions.md` §3), của `aggro` (targeting, mục 2) và `speed` (thứ tự lượt, `technical-decisions.md` §2). Phần còn thiếu: **HP/MP hoạt động thế nào**, và **chỉ số thay đổi ra sao khi nhân vật lên cấp** — level hiện chỉ mới dùng để mở khóa skill (mục 1), chưa có tác dụng nào lên số liệu.

### HP
- HP về 0 (từ bất kỳ nguồn nào — damage combat, đói/khát cạn kiệt ở mục 3, hay `perTurnEffects` của status effect) → `Character.isAlive = false` **ngay lập tức**. Permadeath thật (1.2 trong design doc chính): không có effect, skill, hay item nào hồi sinh được nhân vật `isAlive = false`.
- Nếu đang giữa trận, nhân vật vừa chết bị bỏ qua khi `turnQueue` duyệt tới lượt kế (xử lý skip đã có ở `technical-decisions.md` §2, không cần thêm logic riêng).
- Monster hp ≤ 0 → loại khỏi `CombatState.combatants`, không có field `isAlive` riêng (monster không permadeath theo nghĩa narrative, đơn giản là biến mất khỏi trận).

### MP
- Không đủ MP trả `mpCost` của skill → skill đó **không hợp lệ để chọn** ở bước lựa chọn hành động (validate ở caller/UI, giống cách `usesPerCombat` được chặn trước khi gọi resolver — `technical-decisions.md` §3), resolver không bao giờ thấy trường hợp thiếu MP.
- MP **không tự hồi** theo hành động như hunger/thirst tự giảm — chỉ tăng qua skill/item có effect `restoreMp`, hồi đầy khi nghỉ tại rest room, hoặc hồi đầy khi lên cấp (xem bên dưới).

### Tăng trưởng theo cấp (level)
- Level dùng chung cho **cả party** (không track kinh nghiệm/XP riêng từng nhân vật — tránh phải thêm hệ thống XP mà một side project không cần): `Character.level = min(currentFloor.depth, 7)`, tự cập nhật mỗi khi cả party xuống tầng mới. Cấp tối đa = 7, trùng mốc mở skill cuối (slot 4, `unlockLevel: 7`) — nhân vật "hoàn thiện" đúng lúc có đủ 5 skill.
- Công thức tăng trưởng (tuyến tính, áp dụng như nhau cho mọi class để không phải cân bằng 4 đường cong riêng), tính từ giá trị base của class (`CharacterClass`) ở level 1:
  - `maxHp = baseMaxHp + (level - 1) * 8`
  - `maxMp = baseMaxMp + (level - 1) * 4`
  - `attack = baseAttack + (level - 1) * 2`
  - `defense = baseDefense + (level - 1) * 1`
- `aggro` và `speed` **không** tăng theo level — giữ nguyên `baseAggro`/`baseSpeed` suốt game. Đây là 2 chỉ số định hình vai trò/nhịp độ của class (ai bị nhắm, ai ra tay trước), không phải chỉ số sức mạnh thuần túy — cho tăng theo level sẽ làm targeting và thứ tự lượt ở tầng sâu lệch hẳn khỏi thiết kế ban đầu của từng class.
- Mỗi lần lên cấp: `hp`/`mp` hiện tại được đặt lại **đầy (= maxHp/maxMp mới)** — lên cấp = hồi phục toàn phần, tạo cảm giác "phần thưởng" tự nhiên khi xuống tầng mới, giống rest room nhưng gắn với mốc tiến triển thay vì phòng nghỉ.
