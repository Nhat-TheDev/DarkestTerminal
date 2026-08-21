# §6. Hệ thống level 1-100 & cân bằng sát thương

*(mục 6 của `00-index.md` — mọi tham chiếu "mục 6.X"/"§6.X" trong file này trỏ nội bộ, cùng file)*

### 6.1 Công thức tăng trưởng

Hệ thống dùng **tapered growth theo 5 tier**, không dùng công thức tuyến tính đều theo level.

### 6.2 Công thức damage

Shape resolver: `damage = amount + mitigatedOffense(offense, defense)` (công thức mitigation đầy đủ ở §6.7), kết hợp **tapered growth theo 5 tier** (§6.3) và tính đối xứng nhân vật/quái (§6.6).

### 6.3 Bảng tăng trưởng theo tier

**Dùng chung cho cả nhân vật và quái**: nhân vật dùng biến `level`, nhân thêm `growthWeights` theo class (§6.8); quái dùng biến `floorDepth` thay cho `level`, không qua trọng số (§6.6).

5 tier, mỗi tier có tốc độ tăng/level riêng (giảm dần — tier sau luôn ≤ tier trước), định nghĩa ở `data/level-growth.json` field `tiers[]`:

| Tier | Khoảng level | Số lần lên cấp trong tier | attack/lvl | defense/lvl | maxHp/lvl | maxMp/lvl |
|---|---|---|---|---|---|---|
| 1 | 1–10 | 9 | 3 | 2 | 14 | 6 |
| 2 | 11–25 | 15 | 2 | 1 | 10 | 4 |
| 3 | 26–50 | 25 | 1 | 0.5 | 7 | 3 |
| 4 | 51–75 | 25 | 0.5 | 1/3 | 5 | 2 |
| 5 | 76–100 | 25 | 1/3 | 0.25 | 3 | 1 |

`magicPower` (§6.8) dùng đúng rate của `attack` trên cùng bảng tier.

**Công thức**: `bonus(stat, level) = floor(Σ rate(stat, tier(l)) với l chạy từ 2 tới level)` — cộng dồn tốc độ của tier chứa level đang "tới", làm tròn xuống. `tier(l)` = tier chứa level `l` (VD level 11 dùng rate tier 2, level 50 vẫn dùng rate tier 3, level 51 chuyển sang tier 4).

Giá trị cuối cùng: `stat(level) = base<stat> + bonus(stat, level)`. `base<stat>` lấy từ bảng 6 chỉ số ở `01-class-skill.md` mục 1 (VD `baseAttack` của Vanguard = 14).

Chi phí EXP để lên cấp tách riêng khỏi bảng 5 tier stat ở trên — bucket mịn hơn (mỗi 5 level), đặt ở `expTiers[]` cùng file, xem §6.9.

### 6.4 Bảng mốc (bonus cộng thêm, áp dụng như nhau cho mọi class)

**Dùng chung cho cả nhân vật và quái**: nhân vật dùng bảng này rồi nhân `growthWeights` theo class (§6.8); quái dùng thẳng bảng này, không qua trọng số (§6.6).

| Level | +attack | +defense | +maxHp | +maxMp |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | 0 |
| 10 | 27 | 18 | 126 | 54 |
| 25 | 57 | 33 | 276 | 114 |
| 50 | 82 | 45 | 451 | 189 |
| 75 | 94 | 53 | 576 | 239 |
| 100 | 102 | 60 | 651 | 264 |

**Đây là đường cong dùng chung, không phải bonus thật nhận được**: bonus thật mỗi class = `round(bonus_ở_bảng_trên × growthWeights[class][stat])` (§6.8). Chỉ số quái vật (§6.6) vẫn dùng thẳng bảng này không qua trọng số.

### 6.5 Hệ số elite/boss tách riêng theo chỉ số, không nhân đều

Hệ số elite/boss tách riêng theo từng chỉ số, thiên về HP — xem bảng số thật ở §6.11.

### 6.6 Quái vật dùng chung công thức (theo `floorDepth` thay cho `level`)

Quái không có khái niệm `level` riêng — chỉ số quái scale theo `floorDepth` bằng đúng bảng tier ở §6.3 (`growthBonusForDepth`, `src/data/monsters.ts`), giữ nguyên tính đối xứng nhân vật/quái: cả 2 bên cùng tốc độ tăng, tầng sâu bao nhiêu quái mạnh tương ứng bấy nhiêu.

### 6.7 Kiểm chứng cân bằng (time-to-kill, TTK)

**Phương pháp**: mô phỏng party dọn sạch mọi phòng combat + guard-room liên tục từ tầng 1 tới tầng đích (dùng `createFloor(rng, depth)` thật cho từng tầng, cộng dồn `expReward` mọi quái gặp phải vào `partyExp`, tra `levelForTotalExp` để ra level tại mỗi mốc tầng), lặp lại trên nhiều seed khác nhau rồi lấy trung bình. Mỗi tầng sinh trung bình **~7-8 phòng combat/guard** (`generateFloorLayout`, `technical-decisions.md` §1).

**Level nhân vật theo độ sâu tầng** (trung bình nhiều lượt mô phỏng, làm tròn):

| Độ sâu tầng | 1 | 10 | 25 | 50 | 75 | 100 | 150 | 200 | 250 |
|---|---|---|---|---|---|---|---|---|---|
| Level nhân vật | 2 | 18 | 35 | 54 | 68 | 80 | 99 | 100 | 100 |

Party chạm trần level 100 quanh **tầng ~152** trung bình (VD tầng 50 → level 54, tầng 100 → level 80).

**Quái thường** (Dungeon Rat, đòn đánh thường của **Vanguard** — không có skill `isMagic`, vẫn là kịch bản chậm nhất trong 4 class vì `attack` growth weight thấp nhất nhóm, 1.0 so với Rogue 1.7):

Bảng dưới dùng chỉ số Dungeon Rat hiện hành ở `02-monster.md` mục 2 (`baseDefense 1`, `baseHp 45`, `baseAttack 17`), level nhân vật lấy từ bảng trên.

| Độ sâu tầng | Level nhân vật | dmg (Vanguard) | HP quái | TTK Vanguard (hit) |
|---|---|---|---|---|
| 1 | 2 | 17 | 45 | 3 |
| 10 | 18 | 43 | 171 | 4 |
| 25 | 35 | 51 | 321 | 7 |
| 50 | 54 | 54 | 496 | 10 |
| 75 | 68 | 53 | 621 | 12 |
| 100 | 80 | 53 | 696 | 14 |
| 150 | 99 | 50 | 846 | 17 |
| 200 | 100 | 45 | 996 | 23 |
| 250 | 100 | 41 | 1146 | 28 |

**Elite guard-room** (dùng **Skeleton Guard** làm archetype tham chiếu — 1 trong 5 archetype guard-room, xem `02-monster.md` mục 2; 4 archetype còn lại theo cùng công thức multiplier nhưng base stat khác):

Bảng dưới dùng chỉ số base Skeleton Guard hiện hành (`baseHp 55`, `baseAttack 23`, `baseDefense 7`), hệ số elite (§6.11), skill sơ cấp mỗi class (Vanguard: Shield Throw `amount 10`, dùng `attack`; Mage: Fireball `amount 10`, dùng `magicPower`; Rogue: Knife Throw `amount 12`, dùng `attack`; Acolyte: Purify `amount 15` từ level 10 trở đi, dùng `magicPower`):

| Độ sâu tầng | Level | HP | Def | Vanguard (hit) | Mage (hit) | Rogue (hit) | Acolyte (hit) |
|---|---|---|---|---|---|---|---|
| 1 | 2 | 121 | 8 | 5 | 5 | 5 | — (chưa mở Purify) |
| 10 | 18 | 398 | 28 | 9 | 6 | 6 | 8 |
| 25 | 35 | 728 | 44 | 14 | 9 | 9 | 12 |
| 50 | 54 | 1113 | 57 | 20 | 13 | 13 | 18 |
| 75 | 68 | 1388 | 66 | 24 | 16 | 16 | 22 |
| 100 | 80 | 1553 | 74 | 28 | 18 | 18 | 25 |
| 150 | 99 | 1883 | 87 | 35 | 23 | 22 | 31 |
| 200 | 100 | 2213 | 101 | 45 | 30 | 29 | 39 |
| 250 | 100 | 2543 | 114 | 56 | 36 | 35 | 48 |

**Sát thương NHẬN vào ("mon → char")** dùng công thức mitigation `finalDamage = max(1, round(amount + off − off·(def/(60+def)) − def/30))` (`mitigatedOffense` trong `resolver.ts`). Công thức áp dụng chung cho **cả 2 chiều** (nhân vật đánh quái lẫn quái đánh nhân vật, cùng 1 hàm `mitigatedOffense`, không phân biệt hướng). 2 hằng số dùng trong công thức: `x=60, y=30` (`data/balance-config.json` field `combat.defenseMitigationX`/`Y`).

Hits-to-die trung bình từ Skeleton Guard **Elite** đánh vào từng class (đòn đánh thường, `amount 0`), tổng hợp trên toàn dải tầng ở bảng level-theo-độ-sâu trên:

| Class | min – max (toàn game) | avg |
|---|---|---|
| Vanguard | 6.2 – 15.6 | 13.1 |
| Rogue | 3.9 – 9.6 | 8.1 |
| Acolyte | 4.3 – 9.0 | 7.7 |
| Mage | 2.9 – 6.0 | 5.1 |

**Giới hạn đã biết**:
- Bảng TTK trên dùng giá trị trung bình (số phòng combat, số quái/phòng, archetype ngẫu nhiên trong 11 archetype combat thường) — chưa tính phương sai giữa các seed cụ thể.
- 4/5 archetype guard-room (Giant Spider, Dragon, Zombie Knight, Dark Knight) chưa có bảng TTK riêng như Skeleton Guard — số liệu dao động quanh bảng trên theo tỉ lệ `baseAttack`/`baseHp`/`baseDefense` khác nhau của từng archetype (`02-monster.md` mục 2).
- Mốc mở skill (slot 2-4) nằm ở level 10/20/35 (`01-class-skill.md` mục 1, mọi class), dàn đều theo dải 1-100 thay vì dồn hết vào 7 level đầu.

### 6.8 Tăng trưởng phụ thuộc class (`growthWeights`)

Mỗi class có thêm `growthWeights: { attack, defense, maxHp, maxMp, magicPower }` — hệ số nhân riêng cho từng chỉ số, áp lên **cùng một đường cong `growthBonus()`** ở §6.3:

```
classGrowthBonus(stat, level, weights) = round(growthBonus(stat, level) × weights[stat])
```

`magicPower` là chỉ số tấn công riêng cho skill đánh dấu `isMagic` (fire/lightning/ice của Mage, holy heal/purge của Acolyte — xem `01-class-skill.md` mục 1.6) — resolver dùng `magicPower` thay `attack` cho đúng những skill này; `attack` vẫn giữ nguyên vai trò cũ cho mọi skill vật lý (kể cả đòn đánh thường của Mage/Acolyte). Ngân sách "không class nào được tổng tăng trưởng nhiều hơn class khác" tính trên cả 5 trọng số — tổng hiện tại là **5.0** cho mọi class:

| Class | attack | magicPower | defense | maxHp | maxMp | Tổng | Vai trò |
|---|---|---|---|---|---|---|---|
| Vanguard | 1.0 | 0.4 | 1.5 | 1.5 | 0.6 | 5.0 | Tank |
| Mage | 0.1 | 1.7 | 0.7 | 0.9 | 1.6 | 5.0 | Glass cannon phép |
| Rogue | 1.7 | 0.3 | 0.9 | 1.3 | 0.8 | 5.0 | Glass cannon cận chiến |
| Acolyte | 0.5 | 1.1 | 1.0 | 1.1 | 1.3 | 5.0 | Thuần hỗ trợ |

**Kết quả tới level 100** (`createCharacter`, base + `classGrowthBonus`):

| Class | attack | magicPower | defense | maxHp | maxMp |
|---|---|---|---|---|---|
| Vanguard | 116 | 41 | 100 | 1117 | 178 |
| Mage | 16 | 187 | 46 | 656 | 482 |
| Rogue | 189 | 31 | 60 | 936 | 241 |
| Acolyte | 57 | 122 | 68 | 816 | 393 |

`growthWeights` chỉ áp dụng cho nhân vật (`party.ts`); quái vật vẫn dùng `growthBonus()` không trọng số (§6.6).

### 6.9 Tách level nhân vật khỏi level tầng ngục — hệ EXP

Level nhân vật và độ sâu tầng ngục là **2 trục tiến triển độc lập**, không ràng buộc 1-1:

| Trục | Tăng khi nào | Tăng qua đâu | Trần |
|---|---|---|---|
| **Level nhân vật** (`Character.level`, dùng chung cho cả party — không track XP riêng từng người) | Giết quái (bất kỳ quái nào, kể cả boss) | EXP tích lũy (`GameState.partyExp`), tra bảng ngưỡng theo tier — công thức bên dưới | **100** |
| **Level tầng ngục** (`Floor.depth`) | Hạ quái trấn giữ phòng cuối tầng (Elite hoặc Boss — xem §6.11) | Tăng `depth` thêm 1 khi phòng đó được dọn sạch, sinh tầng mới | **Không giới hạn** — xem §6.10 |

`Game.resolve()` (`src/engine/game.ts`) gọi `applyPartyExp(state, expGained)` (`src/engine/party.ts`) ngay khi 1 trận thắng, cộng EXP + lên cấp đồng loạt cả party nếu đủ ngưỡng; `Game.clearFinishedCombat()` gọi `advanceToNextFloor()` khi phòng vừa thắng là phòng guard-room (`type === "boss"`), sinh tầng kế qua `createFloor(ctx.rng, nextDepth)`.

Quái scale theo `floorDepth` (không đổi, §6.6); nhân vật scale theo tiến độ combat thực tế của người chơi, không theo số tầng đã đi qua.

**Công thức EXP quái (cộng vào `partyExp` khi giết)**: dùng công thức **tuyến tính đơn giản**:

```
expReward(archetype, floorDepth) = archetype.expReward + floor(floorDepth × 0.1)
```

Hệ số `0.1` (EXP bonus/tầng) là hằng số riêng, đặt cạnh `eliteMultiplier`/`bossMultiplier` trong `data/level-growth.json` (không phải 1 cột trong `tiers[]`). Quái trấn giữ phòng cuối tầng nhân hệ số EXP khác nhau tùy loại (§6.11) — Elite (đa số các tầng) nhân `eliteMultiplier.exp` (**x3**), Boss thật (mỗi 5 tầng) nhân `bossMultiplier.exp` (**x6**).

**Ngưỡng lên cấp nhân vật — `expTiers[]`**, tách riêng khỏi bảng stat, bucket theo **mỗi 5 level** (1-5, 6-10, ..., 96-100 — 20 bucket):

| Level | expCost/lần lên cấp | Level | expCost/lần lên cấp |
|---|---|---|---|
| 1-5 | 115 | 51-55 | 490 |
| 6-10 | 135 | 56-60 | 555 |
| 11-15 | 150 | 61-65 | 640 |
| 16-20 | 165 | 66-70 | 730 |
| 21-25 | 195 | 71-75 | 825 |
| 26-30 | 255 | 76-80 | 945 |
| 31-35 | 285 | 81-85 | 1080 |
| 36-40 | 330 | 86-90 | 1230 |
| 41-45 | 375 | 91-95 | 1410 |
| 46-50 | 430 | 96-100 | 1605 |

Tổng EXP cần để lên level 100: **59 610**.

`expCostForLevel(level)` = tổng dồn `expCost` của bucket 5-level chứa từng level, từ level 2 tới level đang xét (đúng công thức cumulative-sum như `growthBonus` ở §6.3, nhưng đọc từ `expTiers[]` qua hàm `expTierFor()` riêng, không dùng chung `tierFor()` của bảng stat — `src/data/levelGrowth.ts`) — clamp trần ở level 100 (nhân vật vẫn cap, khác quái/tầng).

**Lên cấp**: mỗi khi `partyExp` vượt ngưỡng `expCostForLevel(nextLevel)`, cả party lên cấp đồng loạt (vẫn dùng chung 1 level, chỉ đổi nguồn kích hoạt) — `hp`/`mp` hồi đầy, mở khóa skill nếu `unlockLevel` khớp, giữ nguyên quy tắc "lên cấp = hồi phục toàn phần" ở `05-character-stats.md` mục 5.

Số quái giết được ở mỗi tầng cố định theo layout được sinh ra (`technical-decisions.md` §1) — không có cơ chế farm thêm trong 1 tầng. Event room (`08-events.md` §8) là lựa chọn ghé qua lấy Item/Artifact hay đi thẳng.

### 6.10 Level tầng ngục vô hạn — quái/boss không còn trần scale

Công thức scale quái ở §6.6 không dùng clamp-trần-100 cho `floorDepth` (§6.9).

`growthBonusForDepth(stat, floorDepth)` — cùng công thức cumulative-sum theo tier như `growthBonus`, nhưng bỏ clamp trần (chỉ giữ clamp sàn ở level 1), dùng cơ chế fallback sẵn có (`tierFor()` tự rơi về tier 5 khi không tier nào khớp `maxLevel`). Từ tầng 101 trở đi, quái tiếp tục tăng stat theo tốc độ tier 5.

**Hệ quả**: level nhân vật cap ở 100 (§6.9, chạm trần thật quanh tầng ~152 theo mô phỏng ở §6.7); level tầng vô hạn. Sau khi party đạt max level, sức mạnh nhân vật đứng yên trong khi quái/boss tiếp tục mạnh dần vô thời hạn. Không có trạng thái `gameOver: "victory"` — hạ boss luôn dẫn sang tầng kế tiếp qua `advanceToNextFloor()`.

### 6.11 Elite khác Boss thật — Boss mạnh hơn, đòi hỏi chiến thuật

Phòng cuối mỗi tầng (tag `boss` trong pattern) chia thành 2 cấp quái:
- **Elite**: mặc định, xuất hiện ở hầu hết các tầng — `eliteMultiplier` (`data/level-growth.json`): `maxHp×2.2, attack×1.4, defense×1.1`.
- **Boss thật**: xuất hiện **mỗi 5 tầng** (`floorDepth % 5 === 0`, `bossFloorInterval`), **thay thế** Elite tầng đó (loại trừ nhau — không tầng nào có cả 2). Dùng hệ số riêng, mạnh hơn hẳn Elite trên cả 3 trục — `bossMultiplier`: `maxHp×2.7, attack×1.8, defense×1.2`.

| Hệ số | Elite | Boss thật |
|---|---|---|
| maxHp | ×2.2 | ×2.7 |
| attack | ×1.4 | ×1.8 |
| defense | ×1.1 | ×1.2 |

DoT (Poisoned/Burning — `effect.amount` cố định, không trừ defense, `src/engine/resolver.ts`) không né được defense cao. **Stunned** (`data/status-effects.json`, từ Lightning Bolt/Lightning Storm) bỏ qua hoàn toàn 1 lượt của Boss, không phụ thuộc defense.

Bảng dưới dùng chỉ số base **Skeleton Guard** (`baseHp 55`, `baseAttack 23`, `baseDefense 7` — `02-monster.md` mục 2); level theo độ sâu tầng dùng bảng mô phỏng ở §6.7.

**TTK Boss thật vs Elite cùng tầng** (skill sơ cấp Rogue/Mage, party ở level tương ứng theo §6.7 — dùng Rogue/Mage vì Vanguard/Acolyte "bất tử hóa" từ khá sớm, xem §6.7):

| Tầng | Level | Loại | HP | Def | Rogue (hit) | Mage (hit) |
|---|---|---|---|---|---|---|
| 10 | 18 | Elite | 398 | 28 | 6 | 6 |
| 10 | 18 | **Boss** | 489 | 30 | 7 | 8 |
| 25 | 35 | Elite | 728 | 44 | 9 | 9 |
| 25 | 35 | **Boss** | 894 | 48 | 11 | 12 |
| 50 | 54 | Elite | 1113 | 57 | 13 | 13 |
| 50 | 54 | **Boss** | 1366 | 62 | 16 | 17 |
| 100 | 80 | Elite | 1553 | 74 | 18 | 18 |
| 100 | 80 | **Boss** | 1906 | 80 | 23 | 23 |

Không có mini-game boss-phase. Xem §6.12 cho bộ skill riêng của Elite/Boss.

### 6.12 Elite/Boss có skill riêng — AoE, kết liễu, debuff ngẫu nhiên

Elite và Boss thật (không áp dụng cho quái thường, kể cả 1 archetype guard-room khi spawn ở phòng combat thường) có 1 bộ skill kích hoạt tại chỗ ở đúng lượt của chúng (không qua `queueAction`/MP/cooldown như player — quái luôn "miễn phí" và luôn trúng, giữ đúng bất biến sẵn có ở `resolver.ts`). Bảng skill áp dụng cho cả 5 archetype guard-room (`data/monster-skills.json`), mỗi archetype có tên riêng theo flavor nhưng cùng 1 bộ `amount` và cơ chế kích hoạt — chỉ khác debuff status để tạo bản sắc riêng cho mỗi archetype (Skeleton Guard → `weakened`; Giant Spider → `poisoned`; Dragon → `burning`; Zombie Knight → `weakened`; Dark Knight → `stunned`):

| Skill (tên chung) | Tier | Target | Hiệu ứng | Khi nào dùng |
|---|---|---|---|---|
| **Strike** (VD Cleaving Strike — Skeleton Guard) | Elite + Boss | 1 địch | `damage amount 3` | Hành động mặc định, chọn mục tiêu theo `aiPattern` như quái thường (`02-monster.md` mục 2) |
| **Cleave** (VD Sweeping Cleave) | Elite + Boss | Cả đội | `damage amount 2` | 30%/lượt, thay cho Strike |
| **Execute/Finishing Blow** | Chỉ Boss | 1 địch | `damage amount 71`, `ignoreDefensePercent 50` (chỉ tính 50% defense mục tiêu) | Xem cơ chế tích lực riêng bên dưới — **không** dựa theo %HP mục tiêu |
| **Debuff** (VD Crush — Skeleton Guard) | Chỉ Boss | 1 địch | `damage amount 4` + áp 1 status debuff riêng theo archetype (`weakened`/`poisoned`/`burning`/`stunned`) | 30%/lượt khi Boss không đang tích lực/tung Execute, thay cho roll Cleave/Strike |

Thứ tự ưu tiên mỗi lượt của Boss: **đang tích lực?** → tung Execute → nếu không, **hết cooldown Execute?** → bắt đầu tích lực (bỏ qua mọi hành động khác lượt đó) → nếu không, roll **Debuff** (30%) → roll **Cleave** (30%) → **Strike**. Elite (không có Execute/Debuff): roll **Cleave** (30%) → **Strike**.

**Execute — cơ chế "tích lực rồi dồn 1 đòn cực mạnh"** (không trigger theo %HP mục tiêu):

- **Cơ chế kích hoạt riêng, không qua roll `chance()` như Debuff/Cleave**: Boss track `executeCooldownTurns` (khởi tạo `EXECUTE_COOLDOWN_TURNS = 3` lúc spawn, `src/data/monsters.ts`). Khi cooldown chạm 0, lượt đó Boss **tích lực** thay vì tấn công — chọn 1 mục tiêu ngay lúc đó (vẫn theo `aggro` như bình thường, `pickAggroWeighted`) và **khoá lại** (`Monster.executeTargetId`), log cảnh báo tên mục tiêu, không gây sát thương gì lượt này. Lượt kế tiếp của Boss, bất kể cooldown/roll gì khác, **luôn** tung Execute vào đúng người đã khoá (đọc lại từ `executeTargetId`, không tính lại target) rồi reset cooldown về `EXECUTE_COOLDOWN_TURNS`.
- **Sát thương gần như cố định, chỉ chịu 1 nửa defense mục tiêu**: `amount 71` cộng `attack` của Boss trừ `defense` mục tiêu đã giảm 50% (`ignoreDefensePercent 50`) — xem bảng kiểm chứng bên dưới cho tỉ lệ % maxHp thực tế theo từng class.
- **Mục tiêu khoá tại thời điểm tích lực**: mục tiêu bị chọn dựa trên `aggro` tại thời điểm tích lực — Taunt dùng trước lượt tích lực của Boss trong cùng round (+40 aggro của status `taunt`, `01-class-skill.md` mục 1) có thể ảnh hưởng ai bị khoá. Sau khi đã khoá, đổi aggro/taunt ở round kế tiếp không ảnh hưởng target đã chọn. Log cảnh báo tên mục tiêu hiện ngay khi khoá.

`weakened` (`data/status-effects.json`) gỡ được bằng Purify của Acolyte (nhánh ally = `removeStatusEffect`). 3 archetype guard-room còn lại dùng `poisoned`/`burning`/`stunned` cho debuff riêng thay vì `weakened`.

**Kiểm chứng bằng số (party level 1, `createCharacter(..., level = 1)`)**, dùng **Skeleton Guard** ở tầng 1 làm tham chiếu:

| Loại | Atk | Def | HP | Class | maxHp | Strike (%maxHp) | Cleave (%maxHp) | Execute (%maxHp) |
|---|---|---|---|---|---|---|---|---|
| Elite | 32 | 8 | 121 | Vanguard | 140 | 30 (21%) | 29 (21%) | — |
| Elite | 32 | 8 | 121 | Mage | 70 | 33 (47%) | 32 (46%) | — |
| Elite | 32 | 8 | 121 | Rogue | 90 | 32 (36%) | 31 (34%) | — |
| Elite | 32 | 8 | 121 | Acolyte | 100 | 31 (31%) | 30 (30%) | — |
| Boss | 41 | 8 | 149 | Vanguard | 140 | 38 (27%) | 37 (26%) | 109 (**78%**) |
| Boss | 41 | 8 | 149 | Mage | 70 | 41 (59%) | 40 (57%) | 111 (**159%, dứt điểm**) |
| Boss | 41 | 8 | 149 | Rogue | 90 | 40 (44%) | 39 (43%) | 110 (**122%, dứt điểm**) |
| Boss | 41 | 8 | 149 | Acolyte | 100 | 39 (39%) | 38 (38%) | 109 (**109%, dứt điểm**) |
