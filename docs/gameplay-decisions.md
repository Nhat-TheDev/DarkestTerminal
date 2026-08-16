# Gameplay / Nội dung — Quyết định

**Trạng thái**: Đã chốt
**Liên quan**: `../dungeon-crawler-design-doc.md` mục 1.3, 1.5; `../dungeon-crawler-data-model.ts`

---

## 1. Class & Skill

**Cập nhật (2026-08-16)**: chuyển từ "5 skill/class" sang **"6 skill/class = 1 đòn đánh thường dùng chung + 5 skill riêng"**, cộng 4 cơ chế engine mới (proc theo %, buff tự thêm hiệu ứng khi đánh trúng, choáng bỏ lượt, skill tác dụng khác nhau tùy phe mục tiêu) và cooldown theo lượt cho 1 số skill mạnh. Đợt cập nhật này **chỉ ở tài liệu** — số liệu dưới đây là spec để implement sau, code (`data/classes.json`, `src/types.ts`, `src/engine/combat.ts`, ...) chưa đổi theo.

### Bảng chỉ số (level 1)

6 chỉ số class: **tấn công** (`attack`), **phòng thủ** (`defense`), **máu** (`maxHp`), **mana** (`maxMp`), **thu hút** (`aggro` — trọng số bị quái chọn làm mục tiêu, xem mục 2), **tốc độ** (`speed` — ưu tiên ra đòn trước, xem `docs/technical-decisions.md` §2).

| Class | attack | defense | maxHp | maxMp | aggro | speed |
|---|---|---|---|---|---|---|
| Cận Vệ (Vanguard) | 14 | 12 | 140 | 20 | 20 | 8 |
| Pháp Sư (Mage) | 6 | 4 | 70 | 60 | 8 | 10 |
| Sát Thủ (Rogue) | 16 | 6 | 90 | 30 | 10 | 16 |
| Tu Sĩ (Chaplain) | 6 | 8 | 100 | 50 | 12 | 9 |

Thiết kế có chủ đích: Cận Vệ cao nhất `aggro` + `defense` + `maxHp`, thấp nhất `speed` (tank hút đòn, ra tay muộn); Pháp Sư thấp nhất mọi chỉ số phòng ngự/aggro (né bị nhắm) nhưng `speed` khá; Sát Thủ `speed`/`attack` cao nhất, `defense` thấp; Tu Sĩ cân bằng, `aggro` trung bình để không bị/không tránh được việc làm mục tiêu.

**Đổi tên**: "Pháp Sư Bóng Tối" (Shadow Mage) → **"Pháp Sư" (Mage)**, bỏ hệ bóng tối, chuyển sang hệ lửa/sét/băng. `id` code-side đề xuất đổi từ `shadow-mage` → `mage` khi implement (kéo theo `data/sprites.json`, `src/ui/theme.ts`).

4 class, mỗi class **6 skill = 1 đòn đánh thường (slot 0, dùng chung mọi class) + 5 skill riêng (slot 1-5)**. 2 skill riêng đầu mở sẵn ở cấp 1 (cộng đòn đánh thường luôn có), 3 skill riêng còn lại mở dần ở cấp **10/20/35** (không đổi so với bản trước). `slot`/`unlockLevel`/`cooldownTurns` khớp field cùng tên trong `SkillDefinition` (`cooldownTurns` là field mới, xem `docs/technical-decisions.md` §4) — **`usesPerCombat` không còn dùng cho skill** (mục 1.5, bullet cuối "Ghi chú thiết kế").

### 1.0 Đòn đánh thường (mọi class, slot 0)

Miễn phí (`mpCost 0`), luôn có sẵn từ cấp 1, không giới hạn số lần dùng, không cooldown, `target: singleEnemy`, `effects: [{ kind: "damage", amount: 0 }]` → sát thương = `max(1, attack − defense)`, đúng nghĩa "sát thương cơ bản" (giống công thức quái vật đánh thường). Tên/vũ khí theo class, không có ý nghĩa cơ chế nào khác ngoài fallback miễn phí khi hết MP:

| Class | Vũ khí | Tên đòn thường |
|---|---|---|
| Cận Vệ | Kiếm | Chém |
| Sát Thủ | Dao | Đâm |
| Pháp Sư | Gậy | Đập |
| Tu Sĩ | Tay không | Đấm |

### 1.1 Cận Vệ (Vanguard) — tank, chống chịu, giữ chân quái

| Slot | Lvl | Skill | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Che Chắn | 8 | self | `applyStatusEffect "phong-thu"` (+6 def, 1 lượt) **+** `applyStatusEffect "khieu-khich"` (+40 aggro, 1 lượt) — 2 status độc lập, cùng áp 1 lúc | ✅ | 2 lượt |
| 2 | 1 | Ném Khiên | 5 | singleEnemy | `damage 10` | — | — |
| 3 | 10 | Khích Lệ | 12 | allAllies | `modifyStat fear -8` (tức thì, cả đội) + `applyStatusEffect "khich-le"` (+4 attack, 1 lượt, cả đội) | ✅ | 2 lượt |
| 4 | 20 | Va Chạm Dữ Dội | 14 | allEnemies | `damage 12`/địch — roll độ chính xác **riêng từng địch** (mục 4) | — | 3 lượt |
| 5 | 35 | Giáng Kiếm | 14 | singleEnemy | `damage 30` — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (mục 4) | — | 5 lượt |

*Che Chắn gánh cả vai trò "thu hút" (aggro) lẫn "phòng thủ" — Cận Vệ không mất khả năng tank dù Khích Lệ giờ là buff cả đội thay vì tự taunt. Cột "Buff?" đánh dấu skill nhận `isBuff: true` — xem quy tắc `durationTurns`/cooldown/speed dành riêng cho buff ở mục 1.5 và `docs/technical-decisions.md` §4.7.*

### 1.2 Pháp Sư (Mage) — sát thương phép tầm xa, giòn; hệ lửa/sét/băng

| Slot | Lvl | Skill | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Cầu Lửa | 5 | singleEnemy | `damage 10` + 30% `applyStatusEffect "bong"` (2 lượt) | — | — |
| 2 | 1 | Phóng Sét | 6 | singleEnemy | `damage 12` + 20% `applyStatusEffect "choang"` (1 lượt) | — | — |
| 3 | 10 | Cột Lửa | 14 | allEnemies | `damage 12`/địch + 50% `applyStatusEffect "bong"` (2 lượt) **mỗi địch** (roll riêng từng địch, cả accuracy lẫn proc) | — | 2 lượt |
| 4 | 20 | Bão Sét | 16 | allEnemies | `damage 13`/địch + 30% `applyStatusEffect "choang"` (1 lượt) **mỗi địch** | — | 3 lượt |
| 5 | 35 | Kỷ Băng Hà | 20 | allEnemies | `damage 22`/địch — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (mục 4) | — | 5 lượt |

*Pháp Sư đổi hẳn hệ (bóng tối → lửa/sét/băng), mất "Nguyền Rủa" (debuff attack) — kit mới thuần sát thương + proc bỏng/choáng thay cho khống chế cứng. "Tập Trung" (hồi mp) cũng mất — vai trò "hành động miễn phí khi hết mana" nay do đòn Đập (slot 0) đảm nhiệm.*

### 1.3 Sát Thủ (Rogue) — burst đơn mục tiêu, tốc độ cao nhất nhóm

| Slot | Lvl | Skill | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Tẩm Độc | 3 | self | `applyStatusEffect "dao-doc"` (self-buff, 3 lượt, **không** tự gây damage — mọi đòn `damage` do actor này gây ra trong lúc buff còn hiệu lực tự kèm `applyStatusEffect "trung-doc"` lên mục tiêu trúng đòn, xem "on-hit rider" ở `docs/technical-decisions.md` §4) | ✅ | 4 lượt |
| 2 | 1 | Phóng Dao | 4 | singleEnemy | `damage 12` | — | — |
| 3 | 10 | Đâm Lén | 8 | singleEnemy | `damage 20` | — | 1 lượt |
| 4 | 20 | Bom Độc | 10 | allEnemies | `applyStatusEffect "trung-doc"` mỗi địch — roll độ chính xác riêng từng địch | — | 3 lượt |
| 5 | 35 | Đột Kích Liên Hoàn | 16 | singleEnemy | `damage 12` × 3 (liên tiếp) — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (mục 4) | — | 5 lượt |

*Tẩm Độc chuyển từ "gây độc 1 địch" sang self-buff "tẩm độc lên vũ khí" — rẻ hơn (mp 6→3) vì giá trị giờ đến gián tiếp qua các đòn đánh sau đó. Sát Thủ không còn skill phòng thủ riêng ("Lẩn Tránh" bị bỏ) — kit mới 100% tấn công/debuff, rủi ro cao đúng vai trò glass cannon.*

**⚠️ Về Tẩm Độc và luật "buff luôn 1 lượt"**: `dao-doc` **không** bị ép về 1 lượt như Che Chắn/Khích Lệ, dù cũng là self-buff — lý do: `dao-doc` không mang `modifyCombatStat` (không phải buff chỉ số), nó là buff-rider (bật cơ chế "đòn đánh tự kèm độc"), nếu rút còn 1 lượt thì chỉ ăn được đúng 1 đòn trước khi tắt, gần như vô dụng so với việc dùng thẳng Bom Độc. Đây là cách hiểu của tôi cho quy tắc "buff luôn 1 lượt" — nếu bạn muốn áp cả cho rider-buff kiểu này (tức Tẩm Độc cũng chỉ 1 lượt), nói tôi sửa lại; cooldown 4 lượt ở trên tôi tính theo công thức chung "lượt tác dụng + 1" (3+1) phòng trường hợp bạn đồng ý giữ 3 lượt.

### 1.4 Tu Sĩ (Chaplain) — hồi phục + hạ fear cả team

| Slot | Lvl | Skill | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Cầu Nguyện | 4 | singleAlly | `modifyStat fear -10` | — | — |
| 2 | 1 | Chữa Trị | 6 | singleAlly | `heal 16` | — | — |
| 3 | 10 | Thanh Tẩy | 9 | **singleAlly HOẶC singleEnemy** (người chơi chọn phe lúc target) | nhắm đồng đội → `removeStatusEffect` (gỡ 1 debuff); nhắm địch → `damage 15` | — | 1 lượt |
| 4 | 20 | Chữa Trị Nâng Cao | 10 | allAllies | `heal 10` + `modifyStat fear -6` | — | 2 lượt |
| 5 | 35 | Thần Giáng | 20 | **allAllies VÀ allEnemies cùng lúc** | đồng đội → `heal 25` + `modifyStat fear -15`; địch → `damage 20` — **luôn trúng**, hiệu quả giảm theo fear qua công thức ultimate riêng (mục 4) | — | 5 lượt |

*Không skill nào của Tu Sĩ đánh dấu "Buff?" — `modifyStat fear` là chỉnh tức thì (không qua `applyStatusEffect`/`durationTurns`) nên không thuộc phạm vi luật buff ở mục 1.5, dù về bản chất vẫn là hỗ trợ.*

*Tu Sĩ lần đầu có lựa chọn gây sát thương thật (Thanh Tẩy nhắm địch, Thần Giáng, và đòn Đấm slot 0) — đảo ngược quyết định cũ "Tu Sĩ không có skill gây damage" (xem ghi chú §6.7/§6.8 bên dưới).*

### 1.5 Status Effects — bảng tổng hợp & hiệu ứng đầy đủ

**Cập nhật (2026-08-16, cùng ngày)**: tách riêng thành mục này thay vì chỉ nhắc rải rác trong bảng skill, để tra cứu 1 chỗ. 7 status đang được dùng bởi bộ kit 6 skill/class ở mục 1.1-1.4:

| id | Tên | Loại | Hiệu ứng (`perTurnEffects` / field đặc biệt) | Thời lượng | Chữa qua mini-game | Dùng bởi |
|---|---|---|---|---|---|---|
| `phong-thu` | Phòng Thủ | Buff | `modifyCombatStat defense +6` | 1 lượt | — (buff không cần "chữa") | Che Chắn (Cận Vệ) |
| `khieu-khich` | Khiêu Khích | Buff | `modifyCombatStat aggro +40` | 1 lượt | — | Che Chắn (Cận Vệ) |
| `khich-le` | Khích Lệ | Buff | `modifyCombatStat attack +4` | 1 lượt | — | Khích Lệ (Cận Vệ) |
| `dao-doc` | Tẩm Độc (lưỡi dao) | Buff (rider, không phải stat-buff) | không có `perTurnEffects`; field mới `onHitStatusEffectId: "trung-doc"` — xem `docs/technical-decisions.md` §4.2 | 3 lượt (ngoại lệ, xem ghi chú ở mục 1.3) | — | Tẩm Độc (Sát Thủ) |
| `trung-doc` | Trúng Độc | Debuff | `damage 4`/lượt | 3 lượt | Snake, `clearScore 8` | on-hit rider của Tẩm Độc; Bom Độc (Sát Thủ) |
| `bong` | Bỏng | Debuff | `damage 5`/lượt | 2 lượt | Không chữa được qua mini-game (chủ đích — phân biệt với Trúng Độc) | Cầu Lửa 30%, Cột Lửa 50% (Pháp Sư) |
| `choang` | Choáng | Control (debuff) | không có `perTurnEffects` thường; field mới `stuns: true` — xem `docs/technical-decisions.md` §4.3 | 1 lượt | Không chữa được qua mini-game | Phóng Sét 20%, Bão Sét 30% (Pháp Sư) |

**Đã xoá khỏi hệ thống** (mồ côi từ đợt đổi bộ kit 6 skill — không còn skill nào tham chiếu): `ne-tranh` (từng của "Lẩn Tránh" — Sát Thủ, skill đã bỏ), `nguyen-rua` (từng của "Nguyền Rủa" — Pháp Sư, skill đã bỏ).

**Trả lời câu hỏi "có giá trị duy trì (`durationTurns`) mặc định hay không?"**: có, ở **code level** đã có sẵn — `applyStatusEffectToActor` (`resolver.ts`) dùng `def.durationTurns ?? 1`, tức là 1 status không khai báo `durationTurns` sẽ tự hiểu là **1 lượt**. Chính thức hoá thành quy ước:
- **Buff (mang `modifyCombatStat`, tự actor áp lên mình/đồng đội)**: **mặc định 1 lượt**, khớp luật mới "buff luôn 1 lượt" — không cần set `durationTurns` tường minh trong JSON nữa nếu là 1, nhưng vẫn nên ghi rõ cho dễ đọc.
- **Debuff/control (Trúng Độc, Bỏng, Choáng) và buff-rider không phải stat-buff (Tẩm Độc)**: **luôn phải khai báo `durationTurns` tường minh**, không dựa vào default — để tránh 1 debuff lỡ quên set field rồi vô tình chỉ kéo dài 1 lượt (bug cân bằng, không phải bug kỹ thuật, khó phát hiện qua test).

### Ghi chú thiết kế
- Mỗi class có đúng 1 skill "ultimate" ở slot 5 — **luôn trúng, không roll accuracy**, nhưng hiệu quả (damage/heal) giảm theo bậc fear qua công thức riêng, thay cho combo roll-trúng-trượt + giảm 15% dùng cho skill thường (mục 4). Ultimate dùng `isUltimate: true` + `cooldownTurns: 5` — **không còn `usesPerCombat`** (xem bullet cuối).
- `modifyCombatStat` (buff/debuff attack/defense/aggro/speed) luôn đi qua `applyStatusEffect` — không có effect chỉnh combat-stat tức thời/vĩnh viễn, tất cả đều có `durationTurns` trên `StatusEffectDefinition`.
- `StatusEffectDefinition` dùng chung cho cả buff (VD "phong-thu") lẫn debuff (VD "trung-doc"): buff để `curableByMiniGame: []` và hết hạn qua `durationTurns`; debuff thật mới có `curableByMiniGame` khác rỗng. Bảng đầy đủ + quy ước default duration: mục 1.5.
- **Skill có `chance` trên 1 effect** (VD Cầu Lửa 30% bỏng) chỉ roll effect đó, tách biệt roll accuracy của toàn skill — effect `damage` chính vẫn luôn áp nếu skill trúng, chỉ effect phụ (proc) là xác suất.
- **Skill AoE** (`allEnemies`, hoặc nửa "địch" của skill 2 phe): roll accuracy **riêng cho từng mục tiêu**, không phải 1 roll chung cho cả skill — 1 địch né được không có nghĩa cả nhóm né được.
- **Skill 2 phe** (Thanh Tẩy, Thần Giáng): hiệu ứng áp dụng phụ thuộc mục tiêu là đồng đội hay địch, không dùng chung 1 effect list — xem `effectsByRelation` ở `docs/technical-decisions.md` §4.
- **Cooldown** (`cooldownTurns`): mọi skill riêng slot 3-5 đều có cooldown (slot 1-2 vẫn miễn phí cooldown vì rẻ/mở sớm) — mục đích chặn spam khi lên cấp cao, MP dư dả không còn là rào cản tự nhiên. 2 công thức:
  - **Skill buff** (`isBuff: true` — Che Chắn, Khích Lệ, Tẩm Độc): `cooldownTurns = durationTurns của status chính + 1`.
  - **Skill damage/utility khác + ultimate**: gán tay theo độ mạnh, không theo công thức cố định (ultimate cố định `5 lượt`).
- **`usesPerCombat` không còn dùng cho skill nữa** — gỡ khỏi toàn bộ 24 skill (kể cả 4 ultimate, nay dùng `cooldownTurns: 5` thay thế). Field này **vẫn giữ trong hệ thống** để dành cho 1 chức năng khác chưa xác định (nhiều khả năng là item, xem `dungeon-crawler-design-doc.md` mục 1.6 — hiện out of scope), không xoá khỏi type.
- **Skill buff luôn +20 speed** cho lượt tính thứ tự trong round nó được dùng ("buff được ưu tiên, tấn công sau" — buff cần landing trước khi các đòn tấn công/khác của round đó resolve). Chỉ áp cho 3 skill đánh dấu "Buff?" ở bảng mỗi class (Che Chắn, Khích Lệ, Tẩm Độc) — **không** áp cho skill hỗ trợ không mang status (Cầu Nguyện, Chữa Trị, Chữa Trị Nâng Cao của Tu Sĩ chỉnh tức thời, không qua `applyStatusEffect`). Đây là bonus tạm thời chỉ cho việc sắp thứ tự lượt của round hiện tại, không cộng dồn vào `speed` gốc của nhân vật — thiết kế kỹ thuật ở `docs/technical-decisions.md` §4.7.
- Số liệu MP/damage/cooldown ở trên là **đề xuất đầu**, sẽ tinh chỉnh tiếp khi có bản chơi được để playtest — giống tinh thần mọi con số balancing khác trong tài liệu này.

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

**Cập nhật 2026-08-16 (§6.11) — 3 cấp độ quái, không phải chỉ "boss"**: phòng tag `boss` trong `data/floor-patterns.json` (mọi pattern đều có đúng 1 phòng này, ở cuối) **không phải lúc nào cũng là Boss thật** — mặc định trấn giữ bởi 1 **Elite** (như trước: `eliteMultiplier` ở §6.5), nhưng cứ **mỗi 5 tầng** (`depth % 5 === 0`), phòng đó thay bằng 1 **Boss thật** mạnh hơn hẳn Elite (hệ số riêng, xem §6.11) — 2 loại này loại trừ nhau, tầng nào có Boss thì không có Elite. Hạ quái trấn giữ phòng đó (dù là Elite hay Boss) vẫn là điều kiện lên tầng kế theo §6.9. Mini-game boss-phase (mốc 50% HP, chi tiết `docs/minigame-decisions.md` mục 1) **chưa áp dụng cho cả Elite lẫn Boss** — đã xác nhận giữ Boss thuần combat, siết bằng chỉ số thay vì mini-game (§6.11).

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

### 4.1 Cập nhật (2026-08-16) — roll accuracy theo từng mục tiêu (AoE) + ultimate luôn trúng nhưng giảm hiệu quả theo fear

Bảng trên vẫn là quy tắc **mặc định cho skill thường** (đơn mục tiêu hoặc AoE), nhưng cách áp dụng tách làm 2 trường hợp kể từ khi thêm skill AoE/ultimate ở mục 1:

- **Skill đơn mục tiêu** (`singleEnemy`, nửa "địch" khi người chơi chọn địch cho skill 2 phe kiểu Thanh Tẩy): roll accuracy 1 lần cho cả skill — không đổi so với trước.
- **Skill AoE nhắm địch** (`allEnemies`, nửa "địch" của skill 2 phe kiểu Thần Giáng): roll accuracy **riêng cho từng địch** trong danh sách mục tiêu — 1 địch có thể trúng trong khi địch khác né được cùng 1 lần dùng skill. Nửa "đồng đội" của skill 2 phe (heal/buff) không roll accuracy, giữ nguyên quy tắc cũ (fear chỉ ảnh hưởng "kỹ năng nhắm địch").
- **Skill ultimate** (skill ở slot 5, `isUltimate: true`, `cooldownTurns: 5`): **bỏ qua hoàn toàn** roll accuracy lẫn mức giảm 15% sát thương ở bảng trên — ultimate luôn thi triển thành công. Thay vào đó, **hiệu quả** (giá trị `amount` của mọi effect `damage`/`heal` trong skill) bị nhân hệ số theo bậc fear của người dùng, **trước khi** đưa vào công thức sát thương/hồi máu bình thường:

  | Bậc fear | Hệ số hiệu quả ultimate |
  |---|---|
  | Bình Tĩnh (0-39) | 100% |
  | Bất An (40-69) | 90% |
  | Hoảng Loạn (70-99) | 75% |
  | Suy Sụp (100) | 60% |

  *Đề xuất ban đầu, cần playtest để chốt số cuối — nguyên tắc là ultimate "chắc trúng" nhưng phạt bằng độ mạnh thay vì tỉ lệ trúng/trượt, tránh cảm giác "dồn hết vào 1 đòn quyết định rồi trượt trắng tay" ở đúng lúc cần nó nhất (fear cao).*

  Kỹ thuật: cần 1 field đánh dấu "đây là ultimate" tách biệt khỏi `usesPerCombat` (để không vô tình áp luật này lên 1 skill thường nào đó lỡ có `usesPerCombat: 1` vì lý do khác) — xem `docs/technical-decisions.md` §4.

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
- **Đã thay thế bởi mục 6.9** (2026-08-16) — công thức gốc bên dưới giữ lại làm bối cảnh lịch sử, không còn đúng: ~~Level dùng chung cho **cả party** (không track kinh nghiệm/XP riêng từng nhân vật — tránh phải thêm hệ thống XP mà một side project không cần): `Character.level = min(currentFloor.depth, 100)`, tự cập nhật mỗi khi cả party xuống tầng mới.~~ Level vẫn dùng chung cho cả party (điểm này KHÔNG đổi), nhưng nguồn tăng level đổi từ "độ sâu tầng" sang "EXP tích lũy do giết quái" — xem **mục 6.9** để tách rõ khỏi level tầng ngục (mục 6.10). **Cấp tối đa vẫn là 100** — công thức tăng trưởng đầy đủ + lý do đổi từ tuyến tính sang tapered theo tier: xem **mục 6**.
- `aggro` và `speed` **không** tăng theo level — giữ nguyên `baseAggro`/`baseSpeed` suốt game (quyết định không đổi). Đây là 2 chỉ số định hình vai trò/nhịp độ của class (ai bị nhắm, ai ra tay trước), không phải chỉ số sức mạnh thuần túy — cho tăng theo level sẽ làm targeting và thứ tự lượt ở tầng sâu lệch hẳn khỏi thiết kế ban đầu của từng class.
- Mỗi lần lên cấp: `hp`/`mp` hiện tại được đặt lại **đầy (= maxHp/maxMp mới)** — lên cấp = hồi phục toàn phần, tạo cảm giác "phần thưởng" tự nhiên. **Cập nhật 6.9**: trigger đổi từ "xuống tầng mới" sang "đủ EXP để lên cấp" (level không còn gắn với việc xuống tầng).

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

**✅ Đã tính lại (2026-08-16)**, thay cho bảng cũ dùng bộ kit 5-skill — 2 lý do phải làm lại:
1. Bộ kit đổi sang 6 skill/class (mục 1): "Chém Khiên `amount 10`" cũ tách thành đòn đánh thường `amount 0` + "Ném Khiên" `amount 10` riêng; Tu Sĩ nay có đòn đánh thường (Đấm) + Thanh Tẩy/Thần Giáng gây damage khi nhắm địch, không còn "0 skill damage" như trước.
2. **Level nhân vật và level tầng không còn đồng bộ 1-1** (mục 6.9/6.10) — bảng cũ giả định "level = depth", giờ phải mô phỏng cả 2 trục cùng lúc mới đọc đúng TTK ở 1 tầng cụ thể.

**Phương pháp**: mô phỏng 1 lượt chơi "đi hết đường bắt buộc mỗi tầng" (không có lựa chọn farm thêm — xem lưu ý agency ở 6.9), dùng đúng công thức đã chốt (`growthBonus`/`growthBonusForDepth`, `expReward`, `expCostForLevel` ở 6.3/6.9/6.10) để suy ra **level nhân vật thực tế ở mỗi độ sâu tầng**, rồi tính TTK bằng skill/damage thật của bộ kit 6-skill tại đúng level đó — không còn giả định level=depth.

**Level nhân vật theo độ sâu tầng** (party đi hết đường bắt buộc mỗi tầng — trung bình ~3 phòng combat × ~2 quái/phòng + 1 boss, theo `data/floor-patterns.json`):

| Độ sâu tầng | 1 | 10 | 25 | 50 | 75 | 100 | 150 | 200 |
|---|---|---|---|---|---|---|---|---|
| Level nhân vật | 5 | 27 | 48 | 70 | 87 | **100 (max)** | 100 | 100 |

Party chạm trần level 100 quanh **tầng ~94-100** — trùng hợp gần khớp với mốc tầng 100 cũ, dù giờ 2 trục độc lập hoàn toàn (không phải do cố ép bằng nhau, mà do hệ số EXP tuyến tính 0.1/tầng ở 6.9 vừa đủ để 2 đường cong gặp nhau quanh đó). Từ tầng ~100 trở đi, nhân vật đứng yên trong khi quái/boss tiếp tục mạnh dần vô hạn (6.10).

**Quái thường** (Chuột Hầm Ngục, `Ném Khiên amount 10` của Cận Vệ — vẫn là kịch bản chậm nhất, class khác chết quái nhanh hơn số này):

| Độ sâu tầng | Level nhân vật | dmg | HP quái | TTK 1 người (hit) |
|---|---|---|---|---|
| 1 | 5 | 32 | 18 | 1 |
| 10 | 27 | 51 | 144 | 3 |
| 25 | 48 | 53 | 294 | 6 |
| 50 | 70 | 51 | 469 | 10 |
| 75 | 87 | 47 | 594 | 13 |
| 100 | 100 | 44 | 669 | 16 |
| 150 | 100 (đứng yên) | 32 | 819 | 26 |
| 200 | 100 (đứng yên) | 19 | 969 | 51 |
| 250 | 100 (đứng yên) | 7 | 1119 | 160 |

Đọc kết quả: nhờ over-level tự nhiên ở nửa đầu game (level nhân vật vượt xa độ sâu tầng — VD tầng 10 đã level 27), TTK quái thường **tốt hơn hẳn** bảng cũ ở early-mid game (3-13 hit thay vì 6-14 hit ở cùng mốc tầng). Nhưng vì nhân vật đứng yên ở max level trong khi quái tiếp tục mạnh dần vô hạn, TTK **sụp đổ nhanh sau tầng ~150** — tới tầng 250 cần 160 hit, thực chất là bất khả thi trong 1 trận (giới hạn khả năng chịu đựng của party). Đây chính là "điểm kết thúc tự nhiên" của roguelite vô hạn đã nói ở 6.10, không phải lỗi.

**⚠️ Ghi chú (2026-08-16, xem §6.11)**: bảng "Boss" bên dưới tính bằng `eliteMultiplier` — tức là quái trấn giữ phòng cuối tầng ở **đa số các tầng** (Elite, theo cách gọi mới ở §6.11). Từ §6.11 trở đi, cứ mỗi 5 tầng phòng đó là **Boss thật** (mạnh hơn, hệ số riêng) chứ không phải Elite — số liệu Boss thật nằm ở bảng riêng trong §6.11, không lặp lại ở đây.

**Elite** (Xương Sống Canh Gác bản elite, skill sơ cấp mỗi class — Vanguard: Ném Khiên 10, Pháp Sư: Phóng Sét 12, Sát Thủ: Phóng Dao 12, Tu Sĩ: Thanh Tẩy 15 từ level 10 trở đi):

| Độ sâu tầng | Level | HP boss | Def boss | Cận Vệ (hit) | Pháp Sư (hit) | Sát Thủ (hit) | Tu Sĩ (hit) |
|---|---|---|---|---|---|---|---|
| 1 | 5 | 100 | 7 | 4 | 4 | 3 | — (chưa mở Thanh Tẩy) |
| 10 | 27 | 415 | 28 | 10 | 7 | 5 | 15 |
| 25 | 48 | 790 | 45 | 19 | 11 | 9 | 33 |
| 50 | 70 | 1228 | 59 | 32 | 16 | 13 | 73 |
| 75 | 87 | 1540 | 68 | 46 | 20 | 16 | 129 |
| 100 | 100 | 1728 | 76 | 58 | 24 | 19 | 288 |
| 150 | 100 | 2103 | 90 | 132 | 35 | 26 | 2103 (~bất tử) |
| 200 | 100 | 2478 | 105 | 2478 (~bất tử) | 54 | 38 | 2478 (~bất tử) |
| 250 | 100 | 2853 | 118 | 2853 (~bất tử) | 87 | 54 | 2853 (~bất tử) |

Đọc kết quả: **Sát Thủ và Pháp Sư** (2 class attack cao) vẫn giữ vai trò carry sát thương suốt game — tới tận tầng 250 vẫn hạ boss được trong 38-87 hit (khả thi qua nhiều round với party 4 người đánh xen kẽ). **Cận Vệ** solo-boss hợp lý tới khoảng tầng 100 (58 hit), sau đó rơi tự do — đúng vai trò tank/giữ chân quái, không phải carry, y hệt kết luận bảng cũ. **Tu Sĩ** với Thanh Tẩy (damage phụ, vai trò chính là heal/hạ fear) đuối hơn hẳn 3 class kia ngay từ đầu và "bất tử hóa" boss từ khoảng tầng 150 trở đi — đúng thiết kế (không phải carry sát thương) nhưng cho thấy rõ: **quái/boss tầng sâu chỉ có thể bị hạ bởi Sát Thủ/Pháp Sư dẫn đầu sát thương**, Cận Vệ/Tu Sĩ đóng vai trò hỗ trợ (giữ chân, heal, hạ fear) để 2 class kia sống sót đủ lâu ra đòn — khớp với thiết kế vai trò ở mục 1, nhưng đáng lưu ý khi playtest thật: nếu party thiếu Sát Thủ/Pháp Sư, tầng sâu (150+) gần như không thể vượt qua.

**⚠️ Toàn bộ số liệu trên (level-theo-độ-sâu, TTK) phụ thuộc trực tiếp vào hệ số EXP đề xuất ở 6.9 (`expReward` + rate `0.1`/tầng + elite x3) — đây là số ban đầu để bảng trên chạy được, chưa qua playtest, cần chỉnh lại nếu chọn tốc độ lên cấp khác.**

**Giới hạn đã biết, không giải quyết trong lần cân bằng này** (ghi nhận để tránh hiểu nhầm là bỏ sót):
- Prototype hiện chỉ có 3 archetype quái dùng chung cho mọi tầng — game đầy đủ (nhiều tầng hơn) nên bổ sung archetype mới theo cụm tầng (đã có gợi ý ở bảng mục 2: 1-3 / 4-6 / 7+) để "quái yếu" luôn thấy yếu, không bị scale theo tầng tới mức ngang quái mạnh.
- Bảng TTK trên dùng giá trị trung bình (số phòng combat, số quái/phòng, archetype ngẫu nhiên) — chưa tính phương sai thực tế giữa các pattern/seed cụ thể trong `data/floor-patterns.json`.

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
| Pháp Sư | 1.3 | 0.6 | 0.7 | 1.4 | 4.0 | Glass cannon phép — attack và mana (đạn dược của class) tăng mạnh nhất, đánh đổi bằng phòng thủ/máu thấp nhất nhóm (rủi ro chết nếu bị nhắm, đúng tinh thần "giòn") |
| Sát Thủ | 1.4 | 0.7 | 1.1 | 0.8 | 4.0 | Glass cannon cận chiến — attack cao nhất game (carry sát thương chính), maxHp vẫn khá (1.1, cao hơn Pháp Sư) vì phải đứng gần quái để đánh, không có tầm bắn xa như Pháp Sư |
| Tu Sĩ | 0.6 | 1.1 | 1.0 | 1.3 | 4.0 | Thuần hỗ trợ — attack thấp nhất (heal/hạ fear vẫn là vai trò chính; đòn đánh thường + Thanh Tẩy/Thần Giáng nhắm địch ở bộ kit mới chỉ là sát thương phụ, không đổi định hướng growth weight), mana cao nhất trừ Pháp Sư (mọi skill riêng của Tu Sĩ đều tốn MP), phòng thủ/máu khá để trụ vững gần party mà heal |

**Kết quả tới level 100** (`createCharacter`, base + `classGrowthBonus`):

| Class | attack | defense | maxHp | maxMp |
|---|---|---|---|---|
| Cận Vệ | 96 | 96 | 986 | 152 |
| Pháp Sư | 139 | 40 | 526 | 430 |
| Sát Thủ | 159 | 48 | 806 | 241 |
| Tu Sĩ | 67 | 74 | 751 | 393 |

So với level 1 (base thuần: Cận Vệ atk14/def12, Pháp Sư atk6/def4), tỉ lệ attack Cận Vệ/Pháp Sư đi từ **2.3 lần** (level 1) sang **0.69 lần** (level 100, Pháp Sư giờ attack cao hơn) — không hội tụ về 1.07 lần như mô hình cũ ở 6.4, mà **đảo chiều đúng hướng thiết kế**: Pháp Sư là class sát thương phép, tới cấp cao attack của nó vượt hẳn Cận Vệ (class tank) là hợp lý. Ngược lại tỉ lệ defense Cận Vệ/Pháp Sư giữ **2.4 lần** ở cấp 100 (so với 3.0 lần ở cấp 1) — gần như không co lại, vì cả hai class đều có defense weight thấp hơn attack/maxHp theo đúng vai trò của chúng.

`growthWeights` chỉ áp dụng cho nhân vật (`party.ts`); quái vật vẫn dùng `growthBonus()` không trọng số (6.6) vì không có khái niệm class — mọi archetype quái tăng đều theo cùng một tốc độ, tách biệt hoàn toàn với hệ thống class của party.

### 6.9 Tách level nhân vật khỏi level tầng ngục — hệ EXP (cập nhật 2026-08-16)

**Vấn đề của bản thiết kế cũ**: mục 5 định nghĩa `Character.level = min(currentFloor.depth, 100)` — level nhân vật **luôn bằng đúng** độ sâu tầng đang đứng. Hệ quả: party không bao giờ under-level hay over-level so với tầng hiện tại, loại bỏ hoàn toàn rủi ro chiến thuật kiểu "tầng này quá sức, nên lùi lại farm tầng thấp trước" — một cơ chế đặc trưng của thể loại dungeon-crawler permadeath. Ngoài ra cơ chế này **chưa từng được thực thi trong game thật**: bản prototype trước đó chỉ có 1 tầng cố định (`depth` hardcode ở `floor.ts`, chưa có vòng lặp nhiều tầng), nên `Character.level` trong thực tế luôn là 1 suốt game.

**Quyết định**: tách thành 2 trục tiến triển độc lập, không còn ràng buộc 1-1:

| Trục | Tăng khi nào | Tăng qua đâu | Trần |
|---|---|---|---|
| **Level nhân vật** (`Character.level`, vẫn dùng chung cho cả party — không track XP riêng từng người, giữ nguyên lý do ở mục 5: side project không cần hệ thống per-character phức tạp) | Giết quái (bất kỳ quái nào, kể cả boss) | EXP tích lũy (`GameState.partyExp`), tra bảng ngưỡng theo tier — công thức bên dưới | **100** (không đổi so với thiết kế cũ) |
| **Level tầng ngục** (`Floor.depth`) | Hạ quái trấn giữ phòng cuối tầng (Elite hoặc Boss — xem 6.11) | Tăng `depth` thêm 1 khi phòng đó được dọn sạch, sinh tầng mới | **Không giới hạn** — xem 6.10 |

Vì 2 trục không còn đồng bộ, đây là **thay đổi có chủ đích** so với triết lý "đối xứng nhân vật/quái" ở mục 6.6: quái vẫn scale theo `floorDepth` (không đổi), nhưng nhân vật giờ scale theo tiến độ combat thực tế của người chơi, không theo số tầng đã đi qua. Một party farm kỹ ở tầng thấp trước khi xuống sâu sẽ mạnh hơn 1 party rush thẳng qua boss — đúng tinh thần rủi ro/phần thưởng.

**Công thức EXP quái (cộng vào `partyExp` khi giết) — sửa sau kiểm chứng 6.7 (2026-08-16)**: bản nháp đầu tiên định tái dùng `growthBonus` cộng dồn theo tier (giống attack/defense/hp) để tính bonus EXP theo tầng, nhưng mô phỏng số ở mục 6.7 cho thấy cách này làm EXP tăng phi mã theo tầng (cộng dồn không trần trong khi `expCost` mỗi tier chỉ là hằng số) — party đạt level 100 ngay ở tầng ~29, triệt tiêu mục đích tách 2 trục (party gần như luôn max level bất kể tầng). **Sửa**: dùng công thức **tuyến tính đơn giản** thay vì tái dùng đường cong tapered của combat stat — ít code hơn (không cần thêm cột vào `tiers[]`, không cần sửa `Tier` interface):

```
expReward(archetype, floorDepth) = archetype.expReward + floor(floorDepth × 0.1)
```

Hệ số `0.1` (EXP bonus/tầng) là hằng số riêng, đặt cạnh `eliteMultiplier`/`bossMultiplier` trong `data/level-growth.json` (không phải 1 cột trong `tiers[]`). **Cập nhật sau khi tách Elite/Boss (§6.11)**: quái trấn giữ phòng cuối tầng nhân hệ số EXP khác nhau tùy loại — Elite (đa số các tầng) nhân `eliteMultiplier.exp` (**x3**, hạ từ x4 nháp đầu sau kiểm chứng ở 6.7), Boss thật (mỗi 5 tầng) nhân `bossMultiplier.exp` (**x6** — gấp đôi Elite, xứng đáng vì hiếm và khó hơn hẳn).

**Công thức ngưỡng lên cấp nhân vật**: thêm cột `expCost` vào cùng `tiers[]` (cùng ranh giới 5 tier ở mục 6.3: 1–10 / 11–25 / 26–50 / 51–75 / 76–100) — càng về tier sau, chi phí lên 1 cấp càng cao, cùng tinh thần "chậm dần" như tốc độ tăng stat:

| Tier | Khoảng level | expCost / lần lên cấp trong tier |
|---|---|---|
| 1 | 1–10 | 20 |
| 2 | 11–25 | 40 |
| 3 | 26–50 | 80 |
| 4 | 51–75 | 150 |
| 5 | 76–100 | 250 |

`expCostForLevel(level)` = tổng dồn `expCost` của tier chứa từng level, từ level 2 tới level đang xét (đúng công thức cumulative-sum như `growthBonus` ở mục 6.3) — clamp trần ở level 100 (nhân vật vẫn cap, khác quái/tầng).

**Lên cấp**: mỗi khi `partyExp` vượt ngưỡng `expCostForLevel(nextLevel)`, cả party lên cấp đồng loạt (vẫn dùng chung 1 level, chỉ đổi nguồn kích hoạt) — `hp`/`mp` hồi đầy, mở khóa skill nếu `unlockLevel` khớp, giữ nguyên quy tắc "lên cấp = hồi phục toàn phần" ở mục 5.

**⚠️ Số liệu ở 2 bảng trên (expReward mỗi archetype, expCost mỗi tier, hệ số elite exp x3) đã qua 1 vòng kiểm chứng bằng mô phỏng ở mục 6.7 (không còn là đoán mò thuần túy), nhưng vẫn chỉ là con số khởi tạo — cần chỉnh tiếp khi có dữ liệu chơi thật.**

**Lưu ý về tính agency**: với cấu trúc tầng hiện tại (`data/floor-patterns.json` — mọi phòng combat trên đường đi tới boss đều bắt buộc phải qua, không có phòng phụ để né hay quay lại farm thêm), người chơi **không thực sự có lựa chọn** "rush nhanh hay farm kỹ" — số quái giết được ở mỗi tầng gần như cố định theo pattern được chọn ngẫu nhiên. Việc tách 2 trục vì vậy hiện chỉ có tác dụng **định hình đường cong độ khó** (bao lâu thì party đạt max level so với tầng đang đứng), chưa tạo ra rủi ro/lựa chọn chiến thuật thật như hình dung ban đầu ở đầu mục 6.9 — muốn có lựa chọn thật cần thêm nội dung kiểu "quay lại tầng cũ" hoặc "phòng phụ tùy chọn", nằm ngoài phạm vi thay đổi lần này.

### 6.10 Level tầng ngục vô hạn — quái/boss không còn trần scale (cập nhật 2026-08-16)

Vì level tầng (`Floor.depth`) không còn giới hạn ở 100 (mục 6.9), công thức scale quái ở mục 6.6 (`growthBonus(stat, floorDepth)`) không thể tiếp tục dùng bản clamp-trần-100 — nếu giữ nguyên, quái ở tầng 101+ sẽ đứng yên mãi ở đúng mức tầng 100, làm game "hết thử thách" sau mốc đó.

**Quyết định**: thêm biến thể `growthBonusForDepth(stat, floorDepth)` — cùng công thức cumulative-sum theo tier như `growthBonus`, nhưng bỏ clamp trần (chỉ giữ clamp sàn ở level 1), tận dụng đúng cơ chế fallback sẵn có (`tierFor()` đã tự rơi về tier 5 khi không tier nào khớp `maxLevel`). Kết quả: từ tầng 101 trở đi, quái tiếp tục tăng stat mãi theo đúng tốc độ tier 5 (tier chậm nhất trong 5 tier) — không có trần cứng, nhưng cũng không tăng vọt đột ngột vì dùng đúng tốc độ chậm nhất.

**Hệ quả thiết kế cần lưu ý**: vì level nhân vật vẫn cap ở 100 (mục 6.9) nhưng level tầng vô hạn, sau khi party đạt max level, sức mạnh nhân vật đứng yên trong khi quái/boss tiếp tục mạnh dần vô thời hạn — **party chắc chắn sẽ thua ở một độ sâu đủ lớn**. Đây là mô hình "chơi được tới đâu hay tới đó" (score-attack roguelite), không phải bug — độ sâu tầng đạt được trước khi party bị xóa sổ trở thành thước đo thành tích của 1 lượt chơi, thay cho khái niệm "thắng game" cố định (không còn trạng thái `gameOver: "victory"` nào được kích hoạt trong luồng chơi bình thường nữa — hạ boss giờ luôn dẫn sang tầng kế tiếp thay vì kết thúc game).

### 6.11 Tách Elite khỏi Boss thật — Boss mạnh hơn, đòi hỏi chiến thuật (cập nhật 2026-08-16)

**Quyết định**: phòng cuối mỗi tầng (tag `boss` trong pattern) không còn luôn là "boss" theo nghĩa cũ — tách thành 2 cấp:
- **Elite**: mặc định, xuất hiện ở hầu hết các tầng (dùng `eliteMultiplier` sẵn có ở §6.5 — `maxHp×2.5, attack×1.4, defense×1.15`, không đổi).
- **Boss thật**: xuất hiện **mỗi 5 tầng** (`floorDepth % 5 === 0`), **thay thế** Elite tầng đó (loại trừ nhau — không tầng nào có cả 2). Dùng hệ số riêng, mạnh hơn hẳn Elite trên cả 3 trục:

| Hệ số | Elite (§6.5) | Boss thật (mới) |
|---|---|---|
| maxHp | ×2.5 | **×3** |
| attack | ×1.4 | **×1.8** |
| defense | ×1.15 | **×1.3** |

Đặt tên `bossMultiplier` trong `data/level-growth.json`, cạnh `eliteMultiplier` — không đổi cấu trúc `EliteMultiplier`/`Tier`, chỉ thêm 1 object cùng shape.

**Vì sao đây là bộ số được chọn, không phải phương án defense cao hơn nhiều (đã thử và loại)**: mô phỏng ban đầu thử `defense×1.6` (đẩy rất cao so với Elite) để ép người chơi phải dùng damage "né được defense" (DoT — Trúng Độc/Bỏng, xem `src/engine/resolver.ts`: tick DoT dùng `effect.amount` thẳng, **không trừ defense**, khác hẳn damage thường). Nhưng kiểm chứng bằng số cho thấy **DoT hiện tại (`Trúng Độc` 4/lượt×3, `Bỏng` 5/lượt×2 — cố định, không scale theo level/tầng) không hề trở nên hấp dẫn hơn khi defense boss tăng**: vì HP boss cũng tăng cùng lúc theo cùng hệ số, DoT (tổng cố định ~22) tụt từ ~1.7% xuống ~0.8% HP boss khi đi từ tầng 25 sang tầng 100, trong khi damage vũ khí (dù bị defense ăn bớt) vẫn chiếm 2.4-5.9% HP mỗi đòn — **DoT không phải "câu trả lời" cho defense cao như kỳ vọng ban đầu, trừ khi tự nó cũng được thiết kế scale theo tầng (ngoài phạm vi thay đổi lần này)**.

**Vì vậy "yêu cầu chiến thuật" ở Boss thật được đặt vào 2 chỗ khác, không phải damage-type**:
1. **`attack×1.8`** (so với Elite ×1.4) — Boss thật gây sát thương đáng kể mỗi đòn (~7-13% maxHp của Cận Vệ/lượt ở tầng 10-100 khi tanking) → buộc phối hợp Tu Sĩ hồi máu chủ động, không thể để 1 người gánh chịu suốt trận như với Elite.
2. **Choáng** (`status-effects.json`, từ Phóng Sét/Bão Sét) vẫn là công cụ CC duy nhất bỏ qua hoàn toàn 1 lượt của Boss, không phụ thuộc defense — dùng đúng lúc Boss sắp ra đòn mạnh là chiến thuật thực chất hơn stack DoT.
3. **`defense×1.3`** (vừa phải, không đẩy cực đoan như bản thử ×1.6) giữ TTK bằng Sát Thủ/Pháp Sư (2 class attack cao) ở mức khả thi xuyên suốt game (8-40 hit tùy tầng — xem bảng dưới), tránh Boss trở thành "tường số" không thể vượt qua chỉ vì thiếu 1 loại damage cụ thể.

**⚠️ Đã hỏi và xác nhận (2026-08-16)**: "chiến thuật" ở đây được chốt là **thuần combat, siết bằng chỉ số** (phối hợp tank/heal/CC trong hệ thống hiện có), **không** mở lại mini-game boss-phase (`docs/minigame-decisions.md` §1, hiện vẫn nằm trong danh sách "chưa implement" ở `README.md`) — giữ đúng scope prototype.

**TTK Boss thật vs Elite cùng tầng** (skill sơ cấp mỗi class, party ở level tương ứng theo 6.9):

| Tầng | Level | Loại | HP | Def | Cận Vệ | Pháp Sư | Sát Thủ | Tu Sĩ |
|---|---|---|---|---|---|---|---|---|
| 10 | 26 | Elite | 415 | 28 | 10 | 7 | 6 | 15 |
| 10 | 26 | **Boss** | 498 | 31 | 13 | 9 | 7 | — |
| 25 | 46 | Elite | 790 | 45 | 20 | 11 | 9 | 35 |
| 25 | 46 | **Boss** | 948 | 51 | 28 | 14 | 12 | — |
| 50 | 68 | Elite | 1228 | 59 | 33 | 16 | 13 | 73 |
| 50 | 68 | **Boss** | 1473 | 66 | 48 | 22 | 17 | — |
| 100 | 100 | Elite | 1728 | 76 | 58 | 24 | 19 | 288 |
| 100 | 100 | **Boss** | 2073 | 86 | 104 | 32 | 25 | — |

Boss thật luôn khó hơn Elite cùng tầng rõ rệt (HP/def/TTK đều cao hơn ~20-40%) nhưng chưa tới mức bất khả thi cho Sát Thủ/Pháp Sư — khớp mục tiêu "mạnh hơn, đòi hỏi chiến thuật" mà không phá vỡ nhịp chơi. Cột Tu Sĩ để trống vì Thanh Tẩy (damage phụ) không đủ để tính TTK có ý nghĩa vs Boss — đúng vai trò support, không phải carry.

**⚠️ Số liệu `bossMultiplier` (3/1.8/1.3) và `bossMultiplier.exp` (x6) là đề xuất ban đầu đã qua 1 vòng mô phỏng, chưa playtest thật — cần chỉnh khi có dữ liệu chơi thật, giống mọi bảng số khác trong tài liệu này.**
