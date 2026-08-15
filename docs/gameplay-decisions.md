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

4 class, mỗi class 5 skill (2 mở sẵn ở cấp 1, 3 mở dần ở cấp **10/20/35** — dời từ mốc 3/5/7 ban đầu để dàn đều hơn theo dải level 1-100, xem mục 6). `slot`/`unlockLevel`/`usesPerCombat` khớp field cùng tên trong `SkillDefinition`.

### 1.1 Cận Vệ (Vanguard) — tank, chống chịu, giữ chân quái

| Slot | Lvl | Skill | MP | Target | Hiệu ứng |
|---|---|---|---|---|---|
| 0 | 1 | Chém Khiên | 0 | singleEnemy | `damage 10` |
| 1 | 1 | Trấn Thủ | 4 | self | `applyStatusEffect "phong-thu"` (buff, 2 lượt, mỗi lượt `modifyCombatStat defense +6`) |
| 2 | 10 | Khiêu Khích | 6 | self | `applyStatusEffect "khieu-khich"` (buff, 2 lượt, mỗi lượt `modifyCombatStat aggro +40`) — đẩy trọng số bị chọn làm mục tiêu của Cận Vệ lên rất cao (xem targeting theo aggro ở mục 2); vẫn là xác suất, không ép buộc tuyệt đối |
| 3 | 20 | Chặt Hạ | 10 | singleEnemy | `damage 22` |
| 4 | 35 | Bất Khuất | 0 | self | `heal 20%maxHp`, `usesPerCombat 1` — chỉ tự kích hoạt khi HP < 25% |

### 1.2 Pháp Sư Bóng Tối (Shadow Mage) — sát thương phép tầm xa, giòn

| Slot | Lvl | Skill | MP | Target | Hiệu ứng |
|---|---|---|---|---|---|
| 0 | 1 | Phi Ảnh | 5 | singleEnemy | `damage 14` |
| 1 | 1 | Tập Trung | 0 | self | `restoreMp 10` — lượt tích lũy, đánh đổi tempo |
| 2 | 10 | Quầng Tối | 12 | allEnemies | `damage 10` (AoE) |
| 3 | 20 | Nguyền Rủa | 8 | singleEnemy | `applyStatusEffect "nguyen-rua"` (debuff, 3 lượt, mỗi lượt `modifyCombatStat attack -4`) |
| 4 | 35 | Vực Thẳm | 18 | singleEnemy | `damage 40`, `usesPerCombat 1` |

### 1.3 Sát Thủ (Rogue) — burst đơn mục tiêu, tốc độ cao nhất nhóm

| Slot | Lvl | Skill | MP | Target | Hiệu ứng |
|---|---|---|---|---|---|
| 0 | 1 | Đâm Lén | 3 | singleEnemy | `damage 12` |
| 1 | 1 | Lẩn Tránh | 4 | self | `applyStatusEffect "ne-tranh"` (buff, 1 lượt, `modifyCombatStat defense +6`) |
| 2 | 10 | Tẩm Độc | 6 | singleEnemy | `applyStatusEffect "trung-doc"` (debuff thật — xem `curableByMiniGame`, 3 lượt, mỗi lượt `damage 4`) |
| 3 | 20 | Song Kích | 8 | singleEnemy | 2 effect trong list: `damage 10` + `damage 10`, resolve tuần tự |
| 4 | 35 | Nhát Chí Mạng | 14 | singleEnemy | `damage 35`, `usesPerCombat 1` |

### 1.4 Tu Sĩ (Chaplain) — hồi phục + hạ fear cả team

| Slot | Lvl | Skill | MP | Target | Hiệu ứng |
|---|---|---|---|---|---|
| 0 | 1 | Cầu Nguyện | 6 | singleAlly | `heal 16` |
| 1 | 1 | An Ủi | 4 | singleAlly | `modifyStat fear -10` |
| 2 | 10 | Thánh Ca | 10 | allAllies | `heal 10` + `modifyStat fear -6` |
| 3 | 20 | Thanh Tẩy | 8 | singleAlly | `removeStatusEffect` — gỡ 1 debuff bất kỳ ngay lập tức, không cần mini-game (cứu hộ khẩn cấp, đổi lại tốn MP cao so với mpCost trung bình) |
| 4 | 35 | Ánh Sáng Cứu Rỗi | 16 | allAllies | `heal 25` + `modifyStat fear -15`, `usesPerCombat 1` |

### Ghi chú thiết kế
- Mỗi class có đúng 1 skill "ultimate" (`usesPerCombat: 1`) ở slot 4.
- `modifyCombatStat` (buff/debuff attack/defense/aggro/speed) luôn đi qua `applyStatusEffect` — không có effect chỉnh combat-stat tức thời/vĩnh viễn, tất cả đều có `durationTurns` trên `StatusEffectDefinition`.
- `StatusEffectDefinition` dùng chung cho cả buff (VD "phong-thu") lẫn debuff (VD "trung-doc"): buff để `curableByMiniGame: []` và hết hạn qua `durationTurns`; debuff thật mới có `curableByMiniGame` khác rỗng.
- Khiêu Khích đổi target từ `singleEnemy` (ép buộc bằng status flag đọc riêng bởi AI) sang `self` (tự buff `aggro`) — thu hút giờ là cơ chế xác suất thống nhất, không có đường tắt "ép target 100%" nào khác trong hệ thống.

---

## 2. Monster — chỉ số, targeting theo aggro & AI pattern

### Công thức scaling theo độ sâu tầng (`floorDepth`, tầng 1 = depth 1)

**Đã thay thế bởi mục 6.6** — công thức tuyến tính bên dưới là bản gốc (khi level cap còn là 7), giữ lại làm bối cảnh lịch sử; số liệu hiện hành tra ở **6.3/6.6** (`growthBonus(stat, floorDepth)`, tapered theo 5 tier, không tuyến tính):
- ~~`attack = baseAttack + floorDepth * 2`~~
- ~~`defense = baseDefense + floorDepth * 1`~~
- ~~`maxHp = baseHp + floorDepth * 8`~~ (hp khởi tạo = maxHp)
- `speed = baseSpeed` (không scale theo tầng — **vẫn đúng**, không đổi bởi 6.6)

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
- Level dùng chung cho **cả party** (không track kinh nghiệm/XP riêng từng nhân vật — tránh phải thêm hệ thống XP mà một side project không cần): `Character.level = min(currentFloor.depth, 100)`, tự cập nhật mỗi khi cả party xuống tầng mới. **Cấp tối đa nay là 100** (trước là 7, tính cho bản prototype 1 tầng) — công thức tăng trưởng đầy đủ + lý do đổi từ tuyến tính sang tapered theo tier: xem **mục 6**.
- `aggro` và `speed` **không** tăng theo level — giữ nguyên `baseAggro`/`baseSpeed` suốt game (quyết định không đổi). Đây là 2 chỉ số định hình vai trò/nhịp độ của class (ai bị nhắm, ai ra tay trước), không phải chỉ số sức mạnh thuần túy — cho tăng theo level sẽ làm targeting và thứ tự lượt ở tầng sâu lệch hẳn khỏi thiết kế ban đầu của từng class.
- Mỗi lần lên cấp: `hp`/`mp` hiện tại được đặt lại **đầy (= maxHp/maxMp mới)** — lên cấp = hồi phục toàn phần, tạo cảm giác "phần thưởng" tự nhiên khi xuống tầng mới, giống rest room nhưng gắn với mốc tiến triển thay vì phòng nghỉ.

---

## 6. Hệ thống level 1-100 & cân bằng sát thương

### 6.1 Vì sao không giữ tuyến tính (linear) từ bản cũ

Công thức cũ (`+2 attack/level`, v.v.) tuyến tính suốt: hợp lý cho 1-7 cấp nhưng **vỡ trận** nếu kéo thẳng tới level 100 — thử ngoại suy: Cận Vệ đạt `attack = 14 + 99*2 = 212`. Vấn đề không phải con số này "to xấu", mà là hệ quả của nó: mọi skill có `amount` cố định (VD Chém Khiên `damage 10`) chỉ còn là ~5% tổng sát thương ở cấp 100 thay vì ~40% ở cấp 1 — chọn skill nào gần như hết ý nghĩa, cả bộ kỹ năng dần trở thành "tấn công thường có tí flavor". Đây là lỗi kinh điển khi kéo dài công thức additive/subtractive quá xa mà không kiểm soát.

### 6.2 Tham khảo game cùng dạng

| Game | Công thức damage | Dải level | Ghi chú áp dụng được |
|---|---|---|---|
| Dragon Quest | Trừ trực tiếp, `dmg ≈ atk − def/2` | 1–50/99 | Additive **vẫn đi được xa** (tới 99) — nhưng chỉ vì bảng stat mỗi class được **tapered theo tier**, không tuyến tính đều |
| Fire Emblem | `dmg = atk − def` (giống hệ ta) | 1–20/30 | Cảnh báo: giữ additive mà KHÔNG tapered thì buộc phải cắt level thấp (~20-30) — đúng cái bẫy mục 6.1 |
| Pokémon | `((2·Lv/5+2)·Power·Atk/Def)/50+2` — tỉ lệ Atk/Def | 1–100 | Không dùng (đổi hẳn shape công thức, phải viết lại resolver) — ghi nhận làm phương án dự phòng nếu additive+taper sau này vẫn không đủ |
| ARPG (Diablo/PoE-style) | Mitigation %: `dmg × (1 − def/(def+K))` | không giới hạn | Cũng không dùng — cùng lý do; nhưng đây là hướng đi nếu về sau cần defense "không bao giờ vô hiệu hóa hoàn toàn" sát thương ở scale cực lớn |

**Quyết định**: giữ nguyên shape công thức đã implement — `damage = max(1, amount + attack − defense)` (không đổi resolver) — nhưng **tapered growth theo 5 tier** thay vì tuyến tính đều, theo đúng tinh thần Dragon Quest. Đánh đổi đã chấp nhận (xem 6.5).

### 6.3 Bảng tăng trưởng theo tier

5 tier, mỗi tier có tốc độ tăng/level riêng (giảm dần — tier sau luôn ≤ tier trước):

| Tier | Khoảng level | Số lần lên cấp trong tier | attack/lvl | defense/lvl | maxHp/lvl | maxMp/lvl |
|---|---|---|---|---|---|---|
| 1 | 1–10 | 9 | 3 | 2 | 14 | 6 |
| 2 | 11–25 | 15 | 2 | 1 | 10 | 4 |
| 3 | 26–50 | 25 | 1 | 0.5 | 7 | 3 |
| 4 | 51–75 | 25 | 0.5 | 1/3 | 5 | 2 |
| 5 | 76–100 | 25 | 1/3 | 0.25 | 3 | 1 |

**Công thức**: `bonus(stat, level) = floor(Σ rate(stat, tier(l)) với l chạy từ 2 tới level)` — cộng dồn tốc độ của tier chứa level đang "tới", làm tròn xuống. `tier(l)` = tier chứa level `l` (VD level 11 dùng rate tier 2, level 50 vẫn dùng rate tier 3, level 51 chuyển sang tier 4).

Giá trị cuối cùng: `stat(level) = base<stat> + bonus(stat, level)`. `base<stat>` lấy từ bảng 6 chỉ số ở mục 1 (VD `baseAttack` của Cận Vệ = 14).

### 6.4 Bảng mốc (bonus cộng thêm, áp dụng như nhau cho mọi class)

| Level | +attack | +defense | +maxHp | +maxMp |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | 0 |
| 10 | 27 | 18 | 126 | 54 |
| 25 | 57 | 33 | 276 | 114 |
| 50 | 82 | 45 | 451 | 189 |
| 75 | 94 | 53 | 576 | 239 |
| 100 | 102 | 60 | 651 | 264 |

**Lưu ý — bảng trên là đường cong dùng chung, không phải bonus thật nhận được**: từ khi thêm trọng số theo class (§6.8), bonus thật mỗi class = `round(bonus_ở_bảng_trên × growthWeights[class][stat])`. Bảng 6.4 vẫn giữ nguyên vì đây đúng là input chung (`growthBonus()`) mà `classGrowthBonus()` nhân trọng số lên trên — chỉ số quái vật (mục 6.6) vẫn dùng thẳng bảng này không qua trọng số, vì quái không có class.

Ví dụ Cận Vệ (base atk14/def12/hp140/mp20, `growthWeights` = {attack 0.8, defense 1.4, maxHp 1.3, maxMp 0.5}) ở level 100: `attack 96, defense 96, maxHp 986, maxMp 152` — thấp hơn nhiều so với con số 116/72/791/284 nếu không nhân trọng số (đó là số Cận Vệ sẽ có nếu dùng chung đường cong không trọng số như mọi class khác). Xem thêm ví dụ đối chiếu 4 class ở **mục 6.8**.

**Lưu ý về tính chất "hội tụ" (đã giải quyết ở §6.8)**: vì bonus gốc là **cộng thêm cố định như nhau cho mọi class** (không nhân theo base), bản đầu tiên của hệ thống này có vấn đề: khoảng cách **tương đối** giữa các class co lại theo level — VD attack Cận Vệ/Pháp Sư là 14/6 (gấp 2.3 lần) ở level 1 nhưng chỉ còn 116/108 (gấp 1.07 lần) ở level 100 nếu dùng chung một đường cong không trọng số. Đây từng là đánh đổi chấp nhận được để giữ additive đơn giản, nhưng làm mọi class "nhạt" dần thành gần giống nhau ở cấp cao — **§6.8 thay thế cách xử lý này** bằng trọng số riêng theo class, giữ (thậm chí khuếch đại đúng hướng) sự khác biệt giữa các class thay vì để nó hội tụ.

### 6.5 Sửa lỗi hệ số boss elite (phát hiện khi cân bằng số)

Công thức elite cũ (`(base + depth×rate) × 2` áp cho **cả** attack/defense/maxHp) từng ổn ở tầng 1 nhưng **vỡ ở tầng sâu**: defense được nhân đôi cùng lúc với growth tuyến tính khiến ở tầng 50, defense boss (≈102) gần bằng tổng sát thương tối đa của Cận Vệ (≈106) → damage floor về gần 1, boss gần như bất tử. Đây đúng là kiểu lỗi "defense-stacking" hay gặp khi buff toughness bằng cách nhân đều mọi chỉ số phòng ngự.

**Sửa**: hệ số elite tách riêng theo chỉ số, thiên về HP (boss "trâu" nhờ máu dày, không nhờ né/đỡ damage):
- `maxHp × 2.5` (giữ nguyên tinh thần "damage sponge")
- `attack × 1.4` (đủ đe dọa, không áp đảo)
- `defense × 1.15` (chỉ nhỉnh hơn quái thường — người chơi luôn gây được sát thương có ý nghĩa)

### 6.6 Quái vật dùng chung công thức (theo `floorDepth` thay cho `level`)

Vì `level = min(depth, 100)`, công thức mục 2 (`attack = baseAttack + floorDepth × 2`, v.v.) được thay bằng **đúng bảng tier ở 6.3**, chỉ đổi biến từ `level` sang `floorDepth` — giữ nguyên tính đối xứng nhân vật/quái đã có ở bản 1-7 (2 bên luôn cùng tốc độ tăng, tầng sâu bao nhiêu quái mạnh tương ứng bấy nhiêu).

### 6.7 Kiểm chứng cân bằng (time-to-kill, TTK)

**Cập nhật sau §6.8**: từ khi attack có trọng số riêng theo class, TTK không còn là một con số chung cho cả party — Cận Vệ (attack weight 0.8, thấp nhất trừ Tu Sĩ) và Sát Thủ (attack weight 1.4, cao nhất) cho hai bức tranh rất khác nhau. Bảng dưới tách theo class để không đánh giá nhầm "cả party yếu" chỉ vì nhìn qua đúng mỗi Cận Vệ.

**Quái thường** — vẫn tính bằng Chém Khiên (`amount 10`) của Cận Vệ vs Chuột Hầm Ngục cùng tầng, vì Cận Vệ là class attack thấp nhất trong nhóm còn ra đòn được (Tu Sĩ không có skill damage — xem 6.8) → đây là kịch bản chậm nhất có thể xảy ra, mọi class khác chết quái thường nhanh hơn số này:

| Level | dmg vs quái thường | TTK 1 người | TTK party (round) |
|---|---|---|---|
| 1 | 22 | 1 hit | 1 |
| 10 | 26 | 6 hit | 2 |
| 25 | 35 | 9 hit | 3 |
| 50 | 43 | 11 hit | 4 |
| 75 | 44 | 14 hit | 5 |
| 100 | 44 | 16 hit | 6 |

Quái thường vẫn luôn chết trong ≤6 round dù chỉ tính bằng class đánh yếu nhất — không "bơm" quá tay dù defense quái có tăng theo tầng.

**Boss** — dmg và TTK-party (÷3, party có ~3 nhân vật tấn công/round) của **kỹ năng cơ bản mỗi class** vs Xương Sống Canh Gác bản boss (elite) cùng tầng:

| Level | Cận Vệ (w0.8) | Pháp Sư (w1.3) | Sát Thủ (w1.4) | Tu Sĩ (w0.6) |
|---|---|---|---|---|
| 1 | 2 round | 4 round | 2 round | — (0 skill damage) |
| 10 | 8 round | 7 round | 4 round | — |
| 25 | 11 round | 6 round | 5 round | — |
| 50 | 14 round | 7 round | 5 round | — |
| 75 | 17 round | 8 round | 6 round | — |
| 100 | 20 round | 8 round | 7 round | — |

Đọc kết quả: **Sát Thủ và Pháp Sư** (2 class attack cao) giữ TTK boss ổn định quanh 5-8 round suốt 1-100 — đúng vai trò "carry sát thương" của cả game, không bao giờ chạm ngưỡng bất tử. **Cận Vệ** (tank, attack weight thấp nhất trong các class có đánh) chậm dần rõ rệt (2→20 round) — **đây là chủ đích**, không phải lỗi cân bằng: Cận Vệ được thiết kế để gánh chịu đòn và giữ chân quái (`baseAggro` cao nhất, skill Khiêu Khích/Trấn Thủ), không phải để solo boss; trong party thật, Cận Vệ đánh xen kẽ Sát Thủ/Pháp Sư nên TTK thực tế của cả đội bám theo cột nhanh nhất, không theo cột Cận Vệ. **Tu Sĩ** không có skill gây damage (thuần hỗ trợ, xem 6.8) nên không tính TTK — vai trò của Tu Sĩ là heal/hạ fear, không phải diệt quái.

**Giới hạn đã biết, không giải quyết trong lần cân bằng này** (ghi nhận để tránh hiểu nhầm là bỏ sót):
- Prototype hiện chỉ có 3 archetype quái dùng chung cho mọi tầng — game đầy đủ (nhiều tầng hơn) nên bổ sung archetype mới theo cụm tầng (đã có gợi ý ở bảng mục 2: 1-3 / 4-6 / 7+) để "quái yếu" luôn thấy yếu, không bị scale theo tầng tới mức ngang quái mạnh.

**Đã giải quyết**: mốc mở skill (slot 2-4) từng cố định ở level 3/5/7 — mở hết trong 7 level đầu, 93 level còn lại không có thêm nội dung skill mới. Đã dời sang **level 10/20/35** (mục 1, mọi class) để dàn đều hơn theo dải 1-100.

### 6.8 Tăng trưởng phụ thuộc class (`growthWeights`)

**Vấn đề cần giải quyết**: §6.4 dùng một đường cong `growthBonus()` chung cho mọi class (bonus cộng thêm giống hệt nhau bất kể class). Vì đây là bonus **cộng thêm cố định** trong khi base stat mỗi class khác nhau, khoảng cách *tương đối* giữa các class co lại theo level — tới cấp 100, Cận Vệ và Pháp Sư gần như cùng attack dù ở cấp 1 Cận Vệ gấp đôi. Cả 4 class dần "nhạt" thành giống nhau, mất bản sắc đúng lúc người chơi chơi lâu nhất (cấp cao).

**Giải pháp**: mỗi class có thêm `growthWeights: { attack, defense, maxHp, maxMp }` — hệ số nhân riêng cho từng chỉ số, áp lên **cùng một đường cong `growthBonus()`** ở 6.3:

```
classGrowthBonus(stat, level, weights) = round(growthBonus(stat, level) × weights[stat])
```

**Quy ước "ngân sách" 4.0**: 4 trọng số của một class luôn cộng lại đúng **4.0** — nghĩa là không class nào được tổng lượng tăng trưởng nhiều hơn class khác, chỉ **phân bổ khác nhau**. Giữ tổng cố định để cân bằng ở việc chọn trọng số (đẩy mạnh chỉ số nào thì phải hy sinh chỉ số khác), không phải ở việc "class này mạnh hơn class kia toàn diện".

| Class | attack | defense | maxHp | maxMp | Tổng | Lý do phân bổ |
|---|---|---|---|---|---|---|
| Cận Vệ | 0.8 | 1.4 | 1.3 | 0.5 | 4.0 | Tank — dồn tăng trưởng vào phòng thủ/máu để càng chơi lâu càng "trâu" hơn, hy sinh attack/mana vì không phải class carry sát thương hay dùng nhiều skill tốn mana |
| Pháp Sư Bóng Tối | 1.3 | 0.6 | 0.7 | 1.4 | 4.0 | Glass cannon phép — attack và mana (đạn dược của class) tăng mạnh nhất, đánh đổi bằng phòng thủ/máu thấp nhất nhóm (rủi ro chết nếu bị nhắm, đúng tinh thần "giòn") |
| Sát Thủ | 1.4 | 0.7 | 1.1 | 0.8 | 4.0 | Glass cannon cận chiến — attack cao nhất game (carry sát thương chính), maxHp vẫn khá (1.1, cao hơn Pháp Sư) vì phải đứng gần quái để đánh, không có tầm bắn xa như Pháp Sư |
| Tu Sĩ | 0.6 | 1.1 | 1.0 | 1.3 | 4.0 | Thuần hỗ trợ — attack thấp nhất (không cần, kit không có skill damage), mana cao nhất trừ Pháp Sư (mọi skill của Tu Sĩ đều tốn MP), phòng thủ/máu khá để trụ vững gần party mà heal |

**Kết quả tới level 100** (`createCharacter`, base + `classGrowthBonus`):

| Class | attack | defense | maxHp | maxMp |
|---|---|---|---|---|
| Cận Vệ | 96 | 96 | 986 | 152 |
| Pháp Sư Bóng Tối | 139 | 40 | 526 | 430 |
| Sát Thủ | 159 | 48 | 806 | 241 |
| Tu Sĩ | 67 | 74 | 751 | 393 |

So với level 1 (base thuần: Cận Vệ atk14/def12, Pháp Sư atk6/def4), tỉ lệ attack Cận Vệ/Pháp Sư đi từ **2.3 lần** (level 1) sang **0.69 lần** (level 100, Pháp Sư giờ attack cao hơn) — không hội tụ về 1.07 lần như mô hình cũ ở 6.4, mà **đảo chiều đúng hướng thiết kế**: Pháp Sư là class sát thương phép, tới cấp cao attack của nó vượt hẳn Cận Vệ (class tank) là hợp lý. Ngược lại tỉ lệ defense Cận Vệ/Pháp Sư giữ **2.4 lần** ở cấp 100 (so với 3.0 lần ở cấp 1) — gần như không co lại, vì cả hai class đều có defense weight thấp hơn attack/maxHp theo đúng vai trò của chúng.

`growthWeights` chỉ áp dụng cho nhân vật (`party.ts`); quái vật vẫn dùng `growthBonus()` không trọng số (6.6) vì không có khái niệm class — mọi archetype quái tăng đều theo cùng một tốc độ, tách biệt hoàn toàn với hệ thống class của party.
