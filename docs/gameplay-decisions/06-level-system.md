# §6. Hệ thống level 1-100 & cân bằng sát thương

*(mục 6 của `00-index.md` — mọi tham chiếu "mục 6.X"/"§6.X" trong file này trỏ nội bộ, cùng file)*

### 6.1 Vì sao không giữ tuyến tính (linear) từ bản cũ

Công thức cũ (`+2 attack/level`, v.v.) tuyến tính suốt: hợp lý cho 1-7 cấp nhưng **vỡ trận** nếu kéo thẳng tới level 100 — thử ngoại suy: Vanguard đạt `attack = 14 + 99*2 = 212`. Vấn đề không phải con số này "to xấu", mà là hệ quả của nó: mọi skill có `amount` cố định (VD Shield Throw `damage 10`) chỉ còn là ~5% tổng sát thương ở cấp 100 thay vì ~40% ở cấp 1 — chọn skill nào gần như hết ý nghĩa, cả bộ kỹ năng dần trở thành "tấn công thường có tí flavor". Đây là lỗi kinh điển khi kéo dài công thức additive/subtractive quá xa mà không kiểm soát.

### 6.2 Tham khảo game cùng dạng

| Game | Công thức damage | Dải level | Ghi chú áp dụng được |
|---|---|---|---|
| Dragon Quest | Trừ trực tiếp, `dmg ≈ atk − def/2` | 1–50/99 | Additive **vẫn đi được xa** (tới 99) — nhưng chỉ vì bảng stat mỗi class được **tapered theo tier**, không tuyến tính đều |
| Fire Emblem | `dmg = atk − def` (giống hệ ta) | 1–20/30 | Cảnh báo: giữ additive mà KHÔNG tapered thì buộc phải cắt level thấp (~20-30) — đúng cái bẫy mục 6.1 |
| Pokémon | `((2·Lv/5+2)·Power·Atk/Def)/50+2` — tỉ lệ Atk/Def | 1–100 | Không dùng (đổi hẳn shape công thức, phải viết lại resolver) — ghi nhận làm phương án dự phòng nếu additive+taper sau này vẫn không đủ |
| ARPG (Diablo/PoE-style) | Mitigation %: `dmg × (1 − def/(def+K))` | không giới hạn | Cũng không dùng — cùng lý do; nhưng đây là hướng đi nếu về sau cần defense "không bao giờ vô hiệu hóa hoàn toàn" sát thương ở scale cực lớn |

**Quyết định (2026-08-17)**: giữ nguyên shape công thức đã implement — `damage = max(1, amount + attack − defense)` (không đổi resolver) — nhưng **tapered growth theo 5 tier** thay vì tuyến tính đều, theo đúng tinh thần Dragon Quest. Đánh đổi đã chấp nhận (xem 6.5).

**⚠️ Cập nhật (2026-08-19): đã đổi shape công thức** — phần "attack − defense" ở trên được thay bằng `mitigatedOffense(off, def)` dạng % mitigation (`off·(def/(60+def)) + def/30` bị trừ, thay vì trừ thẳng `def`) — xem `docs/technical-decisions.md` mục "Xử lý theo `effect.kind`" cho công thức đầy đủ, và ghi chú "hits-to-die" cuối §6.7 cho lý do. Quyết định "giữ nguyên shape công thức" ở trên chỉ còn đúng cho tapered growth (5 tier), không còn đúng cho bản thân phép trừ attack/defense nữa.

### 6.3 Bảng tăng trưởng theo tier

**Dùng chung cho cả nhân vật và quái**: nhân vật dùng biến `level`, nhân thêm `growthWeights` theo class (6.8); quái dùng biến `floorDepth` thay cho `level`, không qua trọng số vì không có class (6.6).

5 tier, mỗi tier có tốc độ tăng/level riêng (giảm dần — tier sau luôn ≤ tier trước):

| Tier | Khoảng level | Số lần lên cấp trong tier | attack/lvl | defense/lvl | maxHp/lvl | maxMp/lvl |
|---|---|---|---|---|---|---|
| 1 | 1–10 | 9 | 3 | 2 | 14 | 6 |
| 2 | 11–25 | 15 | 2 | 1 | 10 | 4 |
| 3 | 26–50 | 25 | 1 | 0.5 | 7 | 3 |
| 4 | 51–75 | 25 | 0.5 | 1/3 | 5 | 2 |
| 5 | 76–100 | 25 | 1/3 | 0.25 | 3 | 1 |

**Công thức**: `bonus(stat, level) = floor(Σ rate(stat, tier(l)) với l chạy từ 2 tới level)` — cộng dồn tốc độ của tier chứa level đang "tới", làm tròn xuống. `tier(l)` = tier chứa level `l` (VD level 11 dùng rate tier 2, level 50 vẫn dùng rate tier 3, level 51 chuyển sang tier 4).

Giá trị cuối cùng: `stat(level) = base<stat> + bonus(stat, level)`. `base<stat>` lấy từ bảng 6 chỉ số ở `01-class-skill.md` mục 1 (VD `baseAttack` của Vanguard = 14).

**⚠️ Cập nhật kiến trúc dữ liệu (2026-08-17)**: bảng 5 tier ở trên (`data/level-growth.json` field `tiers[]`) giờ **chỉ chứa 4 rate stat** (`attack`/`defense`/`maxHp`/`maxMp`), không còn cột `expCost` như bản trước — chi phí EXP lên cấp đã tách sang bảng `expTiers[]` riêng, bucket mịn hơn (mỗi 5 level thay vì theo 5 mốc lớn 10/25/50/75/100), xem §6.9.

### 6.4 Bảng mốc (bonus cộng thêm, áp dụng như nhau cho mọi class)

**Dùng chung cho cả nhân vật và quái** (xem ghi chú "Lưu ý" ngay dưới bảng): nhân vật dùng bảng này rồi nhân `growthWeights` theo class (6.8); quái dùng thẳng bảng này, không qua trọng số (6.6).

| Level | +attack | +defense | +maxHp | +maxMp |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | 0 |
| 10 | 27 | 18 | 126 | 54 |
| 25 | 57 | 33 | 276 | 114 |
| 50 | 82 | 45 | 451 | 189 |
| 75 | 94 | 53 | 576 | 239 |
| 100 | 102 | 60 | 651 | 264 |

**Lưu ý — bảng trên là đường cong dùng chung, không phải bonus thật nhận được**: từ khi thêm trọng số theo class (§6.8), bonus thật mỗi class = `round(bonus_ở_bảng_trên × growthWeights[class][stat])`. Bảng 6.4 vẫn giữ nguyên vì đây đúng là input chung (`growthBonus()`) mà `classGrowthBonus()` nhân trọng số lên trên — chỉ số quái vật (mục 6.6) vẫn dùng thẳng bảng này không qua trọng số, vì quái không có class.

Ví dụ Vanguard (base atk14/def**10**/hp140/mp20, `growthWeights` = {attack 0.8, defense 1.4, maxHp 1.3, maxMp 0.5}) ở level 100: `attack 96, defense 94, maxHp 986, maxMp 152` — thấp hơn nhiều so với con số 116/72/791/284 nếu không nhân trọng số (đó là số Vanguard sẽ có nếu dùng chung đường cong không trọng số như mọi class khác). Xem thêm ví dụ đối chiếu 4 class ở **mục 6.8**.

**Lưu ý về tính chất "hội tụ" (đã giải quyết ở §6.8)**: vì bonus gốc là **cộng thêm cố định như nhau cho mọi class** (không nhân theo base), bản đầu tiên của hệ thống này có vấn đề: khoảng cách **tương đối** giữa các class co lại theo level — VD attack Vanguard/Mage là 14/6 (gấp 2.3 lần) ở level 1 nhưng chỉ còn 116/108 (gấp 1.07 lần) ở level 100 nếu dùng chung một đường cong không trọng số. Đây từng là đánh đổi chấp nhận được để giữ additive đơn giản, nhưng làm mọi class "nhạt" dần thành gần giống nhau ở cấp cao — **§6.8 thay thế cách xử lý này** bằng trọng số riêng theo class, giữ (thậm chí khuếch đại đúng hướng) sự khác biệt giữa các class thay vì để nó hội tụ.

### 6.5 Sửa lỗi hệ số boss elite (phát hiện khi cân bằng số)

Công thức elite cũ (`(base + depth×rate) × 2` áp cho **cả** attack/defense/maxHp) từng ổn ở tầng 1 nhưng **vỡ ở tầng sâu**: defense được nhân đôi cùng lúc với growth tuyến tính khiến ở tầng 50, defense boss (≈102) gần bằng tổng sát thương tối đa của Vanguard (≈106) → damage floor về gần 1, boss gần như bất tử. Đây đúng là kiểu lỗi "defense-stacking" hay gặp khi buff toughness bằng cách nhân đều mọi chỉ số phòng ngự.

**Sửa**: hệ số elite tách riêng theo chỉ số, thiên về HP (boss "trâu" nhờ máu dày, không nhờ né/đỡ damage):
- `maxHp × 2.5` (giữ nguyên tinh thần "damage sponge")
- `attack × 1.4` (đủ đe dọa, không áp đảo)
- `defense × 1.15` (chỉ nhỉnh hơn quái thường — người chơi luôn gây được sát thương có ý nghĩa)

### 6.6 Quái vật dùng chung công thức (theo `floorDepth` thay cho `level`)

Vì `level = min(depth, 100)` (thiết kế gốc, đã thay bằng hệ EXP độc lập — xem §6.9), công thức ở `02-monster.md` mục 2 (`attack = baseAttack + floorDepth × 2`, v.v.) được thay bằng **đúng bảng tier ở 6.3**, chỉ đổi biến từ `level` sang `floorDepth` — giữ nguyên tính đối xứng nhân vật/quái đã có ở bản 1-7 (2 bên luôn cùng tốc độ tăng, tầng sâu bao nhiêu quái mạnh tương ứng bấy nhiêu).

### 6.7 Kiểm chứng cân bằng (time-to-kill, TTK)

**⚠️ Bảng số ở mục này đã re-simulate (2026-08-19)** bằng mô phỏng chạy trực tiếp trên code hiện hành (`createFloor`/`spawnMonster`/`createCharacter`/`levelForTotalExp` thật — script tạm, không commit vào repo), cùng phương pháp 40-seed đã mô tả ở bản 2026-08-17, cập nhật 2 điểm: (1) damage của Mage/Acolyte giờ tính qua `magicPower` thay vì `attack` cho đúng skill `isMagic` của chúng (§6.8, `01-class-skill.md` mục 1.6); (2) **phát hiện phụ, không liên quan `magicPower`**: bảng "level theo độ sâu tầng" của bản 2026-08-17 bị lệch nhiều so với hành vi thật hiện tại — mỗi tầng hiện sinh trung bình **8-12 phòng** (không phải "~3 phòng" như ước lượng tay cũ mà bản 2026-08-17 thay thế), khiến EXP tích lũy nhanh hơn hẳn số đã ghi trước đó. Không rõ nguyên nhân (thay đổi ở `floor-patterns.json`/`floorPatterns.ts` giữa 2 lần đo, hay bản 2026-08-17 tự nó đã tính sai) — ghi nhận là phát hiện mới, chưa điều tra thêm.

**Phương pháp**: mô phỏng party dọn sạch mọi phòng combat + guard-room liên tục từ tầng 1 tới tầng đích (dùng `createFloor(rng, depth)` thật cho từng tầng, cộng dồn `expReward` mọi quái gặp phải vào `partyExp`, tra `levelForTotalExp` để ra level tại mỗi mốc tầng), lặp lại trên 40 seed khác nhau rồi lấy trung bình.

**Level nhân vật theo độ sâu tầng** (trung bình 40 lượt mô phỏng, làm tròn — **đã đổi nhiều so với bản 2026-08-17**, xem ghi chú phát hiện phụ ở trên):

| Độ sâu tầng | 1 | 10 | 25 | 50 | 75 | 100 | 150 | 200 | 250 |
|---|---|---|---|---|---|---|---|---|---|
| Level nhân vật | 3 | 18 | 35 | 54 | 69 | 80 | 99 | 100 | 100 |

Party chạm trần level 100 quanh **tầng ~151** trung bình (so với ~262 ghi nhận ở bản trước) — pacing hiện tại nhanh hơn nhiều so với mục tiêu "level bám sát độ sâu tầng gần như 1-1" đã đặt ra ở §6.9 khi tăng `expCost` ×1.25; nhân vật giờ **over-level đáng kể** so với độ sâu tầng trong phần lớn game (VD tầng 50 → level 54, tầng 100 → level 80). Đây là phát hiện cần playtest/cân bằng lại `expTiers` hoặc số phòng/tầng, **nằm ngoài phạm vi thay đổi `magicPower`** — không tự sửa số liệu này trong lần cập nhật doc này, chỉ ghi nhận.

**Quái thường** (Dungeon Rat, đòn đánh thường của **Vanguard** — không có skill `isMagic`, không bị ảnh hưởng bởi thay đổi `magicPower`; vẫn là kịch bản chậm nhất trong 4 class vì `attack` growth weight thấp nhất nhóm, 0.8):

Bảng dưới dùng chỉ số Dungeon Rat hiện hành ở `02-monster.md` mục 2 (`baseDefense 1`, `baseHp 45`, `baseAttack 17`), level nhân vật lấy từ bảng trên (đã đổi so với bản trước).

| Độ sâu tầng | Level nhân vật | dmg (Vanguard) | HP quái | TTK Vanguard (hit) |
|---|---|---|---|---|
| 1 | 3 | 18 | 45 | 3 |
| 10 | 18 | 29 | 171 | 6 |
| 25 | 35 | 34 | 321 | 10 |
| 50 | 54 | 35 | 496 | 15 |
| 75 | 69 | 33 | 621 | 19 |
| 100 | 80 | 30 | 696 | 24 |
| 150 | 99 | 23 | 846 | 37 |
| 200 | 100 | 10 | 996 | 100 |
| 250 | 100 | 1 | 1146 | 1146 |

Đọc kết quả: pattern cũ vẫn giữ nguyên hình dạng (dmg Vanguard tăng rồi **sụp** khi HP/defense quái — tăng theo `floorDepth` không giới hạn — vượt qua tốc độ tăng `attack` chậm của Vanguard, chạm sàn ở tầng 250), chỉ dịch mốc theo bảng level mới: sụp bắt đầu rõ từ khoảng tầng 150-200 thay vì 150 như trước, do nhân vật giờ over-level hơn nên trụ được thêm 1 mốc tầng. Vẫn đúng vai trò tank/giữ chân của Vanguard, không phải carry sát thương — không phải bug.

**⚠️ Ghi chú (xem §6.11)**: bảng "Boss" bên dưới tính bằng `eliteMultiplier` — tức là quái trấn giữ phòng cuối tầng ở **đa số các tầng** (Elite, theo cách gọi mới ở §6.11). Từ §6.11 trở đi, cứ mỗi 5 tầng phòng đó là **Boss thật** (mạnh hơn, hệ số riêng) chứ không phải Elite — số liệu Boss thật nằm ở bảng riêng trong §6.11, không lặp lại ở đây.

**Elite/Boss guard-room** (dùng **Skeleton Guard** làm archetype tham chiếu — vẫn là 1 trong 5 archetype guard-room, xem `02-monster.md` mục 2; 4 archetype còn lại theo cùng công thức multiplier nhưng base stat khác, dao động quanh số dưới đây, xem bảng riêng ở §6.12):

Bảng dưới dùng chỉ số base Skeleton Guard hiện hành (`baseHp 55`, `baseAttack 23`, `baseDefense 10` — `02-monster.md` mục 2), `eliteMultiplier` không đổi (§6.5), skill sơ cấp mỗi class (Vanguard: Shield Throw `amount 10`, dùng `attack`; **Mage: Fireball `amount 10`, giờ dùng `magicPower`**; Rogue: Knife Throw `amount 12`, dùng `attack`; **Acolyte: Purify `amount 15` từ level 10 trở đi, giờ dùng `magicPower`**):

| Độ sâu tầng | Level | HP | Def | Vanguard (hit) | Mage (hit) | Rogue (hit) | Acolyte (hit) |
|---|---|---|---|---|---|---|---|
| 1 | 3 | 121 | 8 | 6 | 5 | 5 | — (chưa mở Purify) |
| 10 | 18 | 398 | 28 | 14 | 7 | 7 | 10 |
| 25 | 35 | 728 | 44 | 22 | 9 | 9 | 16 |
| 50 | 54 | 1113 | 57 | 33 | 12 | 12 | 22 |
| 75 | 69 | 1388 | 66 | 45 | 14 | 15 | 28 |
| 100 | 80 | 1553 | 74 | 58 | 15 | 16 | 34 |
| 150 | 99 | 1883 | 87 | 100 | 19 | 21 | 48 |
| 200 | 100 | 2213 | 101 | 443 | 26 | 28 | 86 |
| 250 | 100 | 2543 | 114 | 2543 (~bất tử) | 35 | 38 | 196 |

Đọc kết quả: **Rogue vẫn là carry vật lý mạnh nhất** (7-38 hit suốt game). **Mage** giờ hạ elite nhanh gần ngang Rogue (5-35 hit) — cải thiện rõ rệt so với bản trước dùng `attack` (từng 32-121 hit ở cùng mốc), đúng mục tiêu tách `magicPower`: Mage carry sát thương qua skill phép, không còn phụ thuộc `attack` thấp của nó. **Acolyte** (Purify là damage phụ, vai trò chính vẫn heal/hạ fear) giờ **không còn "bất tử hóa" elite** như bản trước (từng chạm sàn dmg=1 từ tầng ~25) — nhờ `magicPower`, Acolyte vẫn gây sát thương có ý nghĩa suốt game (16-86 hit), dù chậm hơn 3 class kia rõ rệt, đúng vai trò support không phải carry. **Vanguard** solo-elite hợp lý tới khoảng tầng 100-150 (58-100 hit), sau đó rơi tự do như Dungeon Rat ở trên — đúng vai trò tank/giữ chân, không phải carry. Kết luận thiết kế cũ ("tầng sâu chỉ Rogue/Mage hạ được quái") vẫn đúng hướng, nhưng Acolyte giờ đóng góp sát thương thật thay vì hoàn toàn vô hiệu — cân bằng party linh hoạt hơn bản trước.

**⚠️ Toàn bộ số liệu trên (level-theo-độ-sâu, TTK) phụ thuộc trực tiếp vào đường cong EXP ở §6.9 (`expReward` mỗi archetype + rate `0.1`/tầng + elite ×3/boss ×6 + `expTiers` ×1.25) và vào số phòng/tầng thực tế của `floor-patterns.json` — bảng level-theo-độ-sâu vừa phát hiện lệch nhiều so với lần đo trước (xem ghi chú đầu mục), nên các con số này **cần playtest/điều tra thêm về pacing tổng thể**, không chỉ về `magicPower`.**

**⚠️ Sát thương NHẬN vào ("mon → char") — công thức mitigation, ĐÃ implement vào `resolver.ts` (2026-08-19)**: song song với việc cân bằng sát thương gây ra ở trên, có 1 phân tích riêng (2026-08-19) về sát thương **quái gây cho nhân vật**, dùng công thức mitigation `finalDamage = max(1, round(amount + atk − atk·(def/(60+def)) − def/30))` (thay cho công thức additive `max(1, amount+atk−def)` đã chạy trước đó) — mục tiêu là tránh trường hợp defense cao khiến sát thương chạm sàn 1 quá dễ (VD Vanguard under-level đánh Boss). Công thức này áp dụng chung cho **cả 2 chiều** (nhân vật đánh quái lẫn quái đánh nhân vật, cùng 1 hàm `mitigatedOffense` trong resolver — không phân biệt hướng) — xem `docs/technical-decisions.md` cho công thức đầy đủ + lưu ý cân bằng phát sinh (sát thương đầu game tăng nhẹ so với công thức cũ). 2 hằng số `x=60,y=30` được chọn qua mô phỏng trước khi implement; dùng công thức đó, phát hiện Mage "chết trong 3-4 đòn" từ elite **xuyên suốt cả game** (không riêng cuối game), dẫn tới 2 vòng rebalance `growthWeights`/base của cả 4 class (ngân sách 4.0→4.5→5.0, xem §6.8) để giảm bớt độ mong manh cực đoan này. Hits-to-die trung bình từ Skeleton Guard elite (mô phỏng trước khi implement, dùng cùng công thức mitigation đã lên code thật) sau vòng rebalance ngân sách 5.0:

| Class | min – max (toàn game) | avg |
|---|---|---|
| Vanguard | 7.3 – 15.6 | 13.2 |
| Rogue | 4.7 – 9.6 | 8.2 |
| Acolyte | 5.0 – 9.0 | 7.8 |
| Mage | 3.4 – 6.0 | 5.2 |

So với ngân sách 4.5 trước đó (Mage avg 3.9), Mage đã bền hơn ~34%, và tỉ lệ Vanguard/Mage (tank vs glass cannon) thu hẹp từ 3.0 lần xuống 2.54 lần. Tỉ lệ Mage/Acolyte chỉ nhích nhẹ 0.61→0.67 vì ngân sách được nâng đều cho cả 4 class, không riêng Mage — nếu muốn Mage tiệm cận Rogue/Acolyte hơn nữa thì cần ưu tiên `defense`/`maxHp` của riêng Mage nhiều hơn tỉ lệ chung. **Công thức mitigation `x=60,y=30` đã implement vào `resolver.ts` và đang chạy thật** (2026-08-19) — bảng hits-to-die ở trên vẫn là số mô phỏng trước khi implement, nhưng dùng đúng công thức đã lên code nên số liệu vẫn phản ánh đúng hành vi hiện hành. **Phát hiện phát sinh khi verify bằng test thật**: ở defense thấp (đầu game), công thức mitigation trừ ít hơn phép trừ thẳng cũ, nên sát thương đầu game cao hơn bản trước 1 chút (bắt được qua 1 test end-to-end: boss tầng 1 chết trước khi kịp tung đòn kết liễu vì party gây damage cao hơn dự kiến, `test/engine.test.ts`) — chưa re-simulate bảng hits-to-die ở trên có tính tới hiệu ứng "đầu game dễ hơn" này (bảng chỉ mô phỏng chiều mon→char, không mô phỏng chiều ngược lại thay đổi TTK ra sao ở defense thấp).

**Giới hạn đã biết, chưa giải quyết trong lần cân bằng này**:
- Bảng TTK trên dùng giá trị trung bình (số phòng combat, số quái/phòng, archetype ngẫu nhiên trong 11 archetype combat thường) — chưa tính phương sai thực tế giữa các pattern/seed cụ thể trong `data/floor-patterns.json`.
- 4/5 archetype guard-room (Giant Spider, Dragon, Zombie Knight, Dark Knight) chưa có bảng TTK riêng như Skeleton Guard — số liệu dao động quanh bảng trên theo tỉ lệ `baseAttack`/`baseHp`/`baseDefense` khác nhau của từng archetype (`02-monster.md` mục 2), chưa mô phỏng đủ cả 5.

**Đã giải quyết**: mốc mở skill (slot 2-4) từng cố định ở level 3/5/7 — mở hết trong 7 level đầu, 93 level còn lại không có thêm nội dung skill mới. Đã dời sang **level 10/20/35** (`01-class-skill.md` mục 1, mọi class) để dàn đều hơn theo dải 1-100.

### 6.8 Tăng trưởng phụ thuộc class (`growthWeights`)

**Vấn đề cần giải quyết**: §6.4 dùng một đường cong `growthBonus()` chung cho mọi class (bonus cộng thêm giống hệt nhau bất kể class). Vì đây là bonus **cộng thêm cố định** trong khi base stat mỗi class khác nhau, khoảng cách *tương đối* giữa các class co lại theo level — tới cấp 100, Vanguard và Mage gần như cùng attack dù ở cấp 1 Vanguard gấp đôi. Cả 4 class dần "nhạt" thành giống nhau, mất bản sắc đúng lúc người chơi chơi lâu nhất (cấp cao).

**Giải pháp**: mỗi class có thêm `growthWeights: { attack, defense, maxHp, maxMp, magicPower }` — hệ số nhân riêng cho từng chỉ số, áp lên **cùng một đường cong `growthBonus()`** ở 6.3 (từ `2026-08-19`, `magicPower` dùng đúng rate của `attack` trên cùng bảng tier — xem `data/level-growth.json`):

```
classGrowthBonus(stat, level, weights) = round(growthBonus(stat, level) × weights[stat])
```

**⚠️ Cập nhật (2026-08-19): thêm chỉ số `magicPower`, ngân sách đổi 4.0 → 4.5 → 5.0**. `magicPower` là chỉ số tấn công riêng cho skill đánh dấu `isMagic` (fire/lightning/ice của Mage, holy heal/purge của Acolyte — xem `01-class-skill.md` mục 1.6) — resolver dùng `magicPower` thay `attack` cho đúng những skill này, `attack` vẫn giữ nguyên vai trò cũ cho mọi skill vật lý (kể cả đòn đánh thường của Mage/Acolyte). Ngân sách "không class nào được tổng tăng trưởng nhiều hơn class khác" tính trên cả 5 trọng số; sau 1 vòng rebalance thêm (đẩy mạnh phòng thủ/máu toàn bộ 4 class để giảm bớt độ mong manh cực đoan của Mage — xem ghi chú "hits-to-die" cuối §6.7), tổng hiện tại là **5.0** (không còn 4.5).

| Class | attack | magicPower | defense | maxHp | maxMp | Tổng | Lý do phân bổ |
|---|---|---|---|---|---|---|---|
| Vanguard | 1.0 | 0.4 | 1.5 | 1.5 | 0.6 | 5.0 | Tank — dồn tăng trưởng vào phòng thủ/máu để càng chơi lâu càng "trâu" hơn; `magicPower` chỉ ở mức tối thiểu vì không skill nào của Vanguard là `isMagic` |
| Mage | 0.1 | 1.7 | 0.7 | 0.9 | 1.6 | 5.0 | Glass cannon phép — gần như bỏ hẳn `attack` (0.1, chỉ còn phục vụ đòn đánh thường Bludgeon) để dồn tối đa cho `magicPower` (carry chính, cao nhất game) và mana (đạn dược, cao nhất nhóm); `defense`/`maxHp` được nâng nhẹ so với bản 4.5 (0.5/0.7 → 0.7/0.9) để bớt độ mong manh cực đoan, nhưng vẫn thấp nhất nhóm — Mage vẫn là class dễ chết nhất, chỉ là không còn chết trong 3-4 đòn như trước |
| Rogue | 1.7 | 0.3 | 0.9 | 1.3 | 0.8 | 5.0 | Glass cannon cận chiến — attack cao nhất game (carry sát thương vật lý chính), `magicPower` gần như 0 vì không skill nào là `isMagic` |
| Acolyte | 0.5 | 1.1 | 1.0 | 1.1 | 1.3 | 5.0 | Thuần hỗ trợ — `magicPower` khá cao (heal/purge/divine descent đều `isMagic`, đây là "sát thương phụ" thật của Acolyte), `attack` ở mức tối thiểu (chỉ còn phục vụ đòn đánh thường Punch), mana cao nhất trừ Mage, phòng thủ/máu khá để trụ vững gần party mà heal |

**Kết quả tới level 100** (`createCharacter`, base + `classGrowthBonus`):

| Class | attack | magicPower | defense | maxHp | maxMp |
|---|---|---|---|---|---|
| Vanguard | 116 | 41 | 100 | 1117 | 178 |
| Mage | 16 | 187 | 46 | 656 | 482 |
| Rogue | 189 | 31 | 60 | 936 | 241 |
| Acolyte | 57 | 122 | 68 | 816 | 393 |

So với level 1 (base thuần: Vanguard atk14/magicPower0, Mage atk6/magicPower14), sát thương thật của Mage giờ đọc qua `magicPower` chứ không phải `attack`: 14 → 187 ở level 100 (**13.4 lần**), vượt xa cả `attack` của Vanguard (116) — đúng tinh thần glass cannon phép. `attack` của Mage gần như đứng yên (6→16, weight chỉ 0.1) — đúng chủ đích, đòn Bludgeon miễn phí không còn ý nghĩa gì với Mage ở cấp cao, toàn bộ sát thương thật đi qua skill phép. Rogue vẫn là carry vật lý mạnh nhất (`attack` 16→189, **11.8 lần**, cao nhất game). `magicPower` của Vanguard/Rogue vẫn gần như không đáng kể (0→41 và 0→31). `defense`/`maxHp` của Mage (46/656) đã nhích lên đáng kể so với bản 4.5 (34/526, xem ghi chú "hits-to-die" cuối §6.7) nhưng vẫn thấp nhất nhóm rõ ràng — Vanguard 100/1117 (2.17× defense Mage), Rogue 60/936, Acolyte 68/816.

`growthWeights` chỉ áp dụng cho nhân vật (`party.ts`); quái vật vẫn dùng `growthBonus()` không trọng số (6.6) vì không có khái niệm class — mọi archetype quái tăng đều theo cùng một tốc độ, tách biệt hoàn toàn với hệ thống class của party.

### 6.9 Tách level nhân vật khỏi level tầng ngục — hệ EXP (**đã implement, đang chạy trong game thật**)

**Vấn đề của bản thiết kế cũ**: `05-character-stats.md` mục 5 (bản cũ) định nghĩa `Character.level = min(currentFloor.depth, 100)` — level nhân vật **luôn bằng đúng** độ sâu tầng đang đứng. Hệ quả: party không bao giờ under-level hay over-level so với tầng hiện tại, loại bỏ hoàn toàn rủi ro chiến thuật kiểu "tầng này quá sức, nên lùi lại farm tầng thấp trước" — một cơ chế đặc trưng của thể loại dungeon-crawler permadeath.

**Quyết định**: tách thành 2 trục tiến triển độc lập, không còn ràng buộc 1-1:

| Trục | Tăng khi nào | Tăng qua đâu | Trần |
|---|---|---|---|
| **Level nhân vật** (`Character.level`, vẫn dùng chung cho cả party — không track XP riêng từng người, giữ nguyên lý do ở `05-character-stats.md` mục 5: side project không cần hệ thống per-character phức tạp) | Giết quái (bất kỳ quái nào, kể cả boss) | EXP tích lũy (`GameState.partyExp`), tra bảng ngưỡng theo tier — công thức bên dưới | **100** (không đổi so với thiết kế cũ) |
| **Level tầng ngục** (`Floor.depth`) | Hạ quái trấn giữ phòng cuối tầng (Elite hoặc Boss — xem 6.11) | Tăng `depth` thêm 1 khi phòng đó được dọn sạch, sinh tầng mới | **Không giới hạn** — xem 6.10 |

**⚠️ Cập nhật trạng thái (2026-08-17)**: mục này **đã implement đầy đủ**, không còn là "spec chưa code" như ghi chú ban đầu — `Game.resolve()` (`src/engine/game.ts`) gọi `applyPartyExp(state, expGained)` (`src/engine/party.ts`) ngay khi 1 trận thắng, cộng EXP + lên cấp đồng loạt cả party nếu đủ ngưỡng; `Game.clearFinishedCombat()` gọi `advanceToNextFloor()` khi phòng vừa thắng là phòng guard-room (`type === "boss"`), sinh tầng kế qua `createFloor(ctx.rng, nextDepth)` — vòng lặp nhiều tầng **đang chạy thật trong game**, không còn giả định "prototype chỉ có 1 tầng" như README/bản ghi chú cũ.

Vì 2 trục không còn đồng bộ, đây là **thay đổi có chủ đích** so với triết lý "đối xứng nhân vật/quái" ở mục 6.6: quái vẫn scale theo `floorDepth` (không đổi), nhưng nhân vật giờ scale theo tiến độ combat thực tế của người chơi, không theo số tầng đã đi qua. Một party farm kỹ ở tầng thấp trước khi xuống sâu sẽ mạnh hơn 1 party rush thẳng qua boss — đúng tinh thần rủi ro/phần thưởng.

**Công thức EXP quái (cộng vào `partyExp` khi giết)**: dùng công thức **tuyến tính đơn giản** — không tái dùng đường cong tapered của combat stat, vì đã kiểm chứng (mục 6.7) rằng cộng dồn theo tier làm EXP tăng phi mã theo tầng (party max level ngay ở tầng ~29, triệt tiêu mục đích tách 2 trục):

```
expReward(archetype, floorDepth) = archetype.expReward + floor(floorDepth × 0.1)
```

Hệ số `0.1` (EXP bonus/tầng) là hằng số riêng, đặt cạnh `eliteMultiplier`/`bossMultiplier` trong `data/level-growth.json` (không phải 1 cột trong `tiers[]`). Quái trấn giữ phòng cuối tầng nhân hệ số EXP khác nhau tùy loại (§6.11) — Elite (đa số các tầng) nhân `eliteMultiplier.exp` (**x3**), Boss thật (mỗi 5 tầng) nhân `bossMultiplier.exp` (**x6** — gấp đôi Elite, xứng đáng vì hiếm và khó hơn hẳn).

**Công thức ngưỡng lên cấp nhân vật — `expTiers[]`, tách riêng khỏi bảng stat (⚠️ cập nhật kiến trúc 2026-08-17)**: bản đầu dùng chung ranh giới 5 tier với bảng stat ở 6.3 (1–10 / 11–25 / 26–50 / 51–75 / 76–100). Sau 2 vòng chỉnh cân bằng thực tế — (1) tăng thẳng `expCost` mỗi mốc ×5 vì leveling quá nhanh (party đã "gần gấp đôi" chỉ số ngay từ tầng 2, không cần dùng rest room vẫn qua tầng dễ dàng), (2) tách hẳn EXP-cost curve khỏi 5 tier stat, bucket lại mịn hơn theo **mỗi 5 level** (1-5, 6-10, ..., 96-100 — 20 bucket), rồi tăng thêm ×1.25 mỗi mốc — bảng hiện hành:

| Level | expCost/lần lên cấp | Level | expCost/lần lên cấp |
|---|---|---|---|
| 1-5 | 171 | 51-55 | 645 |
| 6-10 | 196 | 56-60 | 736 |
| 11-15 | 224 | 61-65 | 841 |
| 16-20 | 255 | 66-70 | 961 |
| 21-25 | 291 | 71-75 | 1098 |
| 26-30 | 332 | 76-80 | 1254 |
| 31-35 | 380 | 81-85 | 1432 |
| 36-40 | 434 | 86-90 | 1636 |
| 41-45 | 495 | 91-95 | 1869 |
| 46-50 | 565 | 96-100 | 2135 |

Tổng EXP cần để lên level 100: **79 579** (từ 12 738 ở bản gốc 5-tier trước cả 2 vòng chỉnh — tăng khoảng **×6.25**). Đường cong vẫn **tapered** (tăng đơn điệu, không nhảy bậc thang lớn như trước) — mỗi bucket ~×1.14 so với bucket trước, thay vì các bước nhảy 2× như 5-tier gốc.

`expCostForLevel(level)` = tổng dồn `expCost` của bucket 5-level chứa từng level, từ level 2 tới level đang xét (đúng công thức cumulative-sum như `growthBonus` ở mục 6.3, nhưng đọc từ `expTiers[]` qua hàm `expTierFor()` riêng, không dùng chung `tierFor()` của bảng stat nữa — `src/data/levelGrowth.ts`) — clamp trần ở level 100 (nhân vật vẫn cap, khác quái/tầng).

**Lên cấp**: mỗi khi `partyExp` vượt ngưỡng `expCostForLevel(nextLevel)`, cả party lên cấp đồng loạt (vẫn dùng chung 1 level, chỉ đổi nguồn kích hoạt) — `hp`/`mp` hồi đầy, mở khóa skill nếu `unlockLevel` khớp, giữ nguyên quy tắc "lên cấp = hồi phục toàn phần" ở `05-character-stats.md` mục 5.

**Lưu ý về tính agency**: với cấu trúc tầng hiện tại (`data/floor-patterns.json` — mọi phòng combat trên đường đi tới boss đều bắt buộc phải qua, không có phòng phụ để né hay quay lại farm thêm), người chơi **không thực sự có lựa chọn** "rush nhanh hay farm kỹ" — số quái giết được ở mỗi tầng gần như cố định theo pattern được chọn ngẫu nhiên. Việc tách 2 trục vì vậy hiện chỉ có tác dụng **định hình đường cong độ khó** (bao lâu thì party đạt max level so với tầng đang đứng), chưa tạo ra rủi ro/lựa chọn chiến thuật thật như hình dung ban đầu ở đầu mục 6.9. **Cập nhật (`07-items-artifacts.md` §7)**: Event room/Treasure room bổ sung thêm 1 dạng lựa chọn (ghé qua lấy Item/Artifact hay đi thẳng), nhưng chưa phải "quay lại farm" đúng nghĩa — đó vẫn là hướng mở rộng ngoài phạm vi hiện tại.

### 6.10 Level tầng ngục vô hạn — quái/boss không còn trần scale

Vì level tầng (`Floor.depth`) không còn giới hạn ở 100 (mục 6.9), công thức scale quái ở mục 6.6 (`growthBonus(stat, floorDepth)`) không thể tiếp tục dùng bản clamp-trần-100 — nếu giữ nguyên, quái ở tầng 101+ sẽ đứng yên mãi ở đúng mức tầng 100, làm game "hết thử thách" sau mốc đó.

**Quyết định**: thêm biến thể `growthBonusForDepth(stat, floorDepth)` — cùng công thức cumulative-sum theo tier như `growthBonus`, nhưng bỏ clamp trần (chỉ giữ clamp sàn ở level 1), tận dụng đúng cơ chế fallback sẵn có (`tierFor()` đã tự rơi về tier 5 khi không tier nào khớp `maxLevel`). Kết quả: từ tầng 101 trở đi, quái tiếp tục tăng stat mãi theo đúng tốc độ tier 5 (tier chậm nhất trong 5 tier) — không có trần cứng, nhưng cũng không tăng vọt đột ngột vì dùng đúng tốc độ chậm nhất.

**Hệ quả thiết kế cần lưu ý**: vì level nhân vật vẫn cap ở 100 (mục 6.9, chạm trần thật quanh tầng ~262 theo mô phỏng ở §6.7) nhưng level tầng vô hạn, sau khi party đạt max level, sức mạnh nhân vật đứng yên trong khi quái/boss tiếp tục mạnh dần vô thời hạn — **party chắc chắn sẽ thua ở một độ sâu đủ lớn**. Đây là mô hình "chơi được tới đâu hay tới đó" (score-attack roguelite), không phải bug — độ sâu tầng đạt được trước khi party bị xóa sổ trở thành thước đo thành tích của 1 lượt chơi, thay cho khái niệm "thắng game" cố định (không có trạng thái `gameOver: "victory"` nào được kích hoạt trong luồng chơi bình thường — hạ boss giờ luôn dẫn sang tầng kế tiếp qua `advanceToNextFloor()` thay vì kết thúc game, xem §6.9).

### 6.11 Tách Elite khỏi Boss thật — Boss mạnh hơn, đòi hỏi chiến thuật

**Quyết định**: phòng cuối mỗi tầng (tag `boss` trong pattern) không còn luôn là "boss" theo nghĩa cũ — tách thành 2 cấp:
- **Elite**: mặc định, xuất hiện ở hầu hết các tầng (dùng `eliteMultiplier` sẵn có ở §6.5 — `maxHp×2.5, attack×1.4, defense×1.15`, không đổi).
- **Boss thật**: xuất hiện **mỗi 5 tầng** (`floorDepth % 5 === 0`), **thay thế** Elite tầng đó (loại trừ nhau — không tầng nào có cả 2). Dùng hệ số riêng, mạnh hơn hẳn Elite trên cả 3 trục:

| Hệ số | Elite (§6.5) | Boss thật (mới) |
|---|---|---|
| maxHp | ×2.5 | **×3** |
| attack | ×1.4 | **×1.8** |
| defense | ×1.15 | **×1.3** |

Đặt tên `bossMultiplier` trong `data/level-growth.json`, cạnh `eliteMultiplier` — không đổi cấu trúc `EliteMultiplier`/`Tier`, chỉ thêm 1 object cùng shape. Cả `eliteMultiplier`/`bossMultiplier` **không đổi** qua 2 đợt rebalance monster/EXP gần đây — chỉ base stat của archetype (`baseAttack`, chủ yếu) và đường cong EXP thay đổi.

**Vì sao `defense×1.3`, không cao hơn**: DoT (Poisoned/Burning — `effect.amount` cố định, không trừ defense, xem `src/engine/resolver.ts`) không né được defense cao nên về lý thuyết là công cụ đối trọng, nhưng vì tổng damage DoT không scale theo tầng trong khi HP boss có, tỷ lệ DoT/HP boss giảm dần theo tầng — đẩy defense cao hơn không tạo ra lựa chọn chiến thuật thật, chỉ làm boss trơ lì hơn với mọi loại damage.

**Vì vậy "yêu cầu chiến thuật" ở Boss thật được đặt vào 2 chỗ khác, không phải damage-type**:
1. **`attack×1.8`** (so với Elite ×1.4) — Boss thật gây sát thương đáng kể mỗi đòn → buộc phối hợp Acolyte hồi máu chủ động, không thể để 1 người gánh chịu suốt trận như với Elite.
2. **Stunned** (`status-effects.json`, từ Lightning Bolt/Lightning Storm) vẫn là công cụ CC duy nhất bỏ qua hoàn toàn 1 lượt của Boss, không phụ thuộc defense — dùng đúng lúc Boss sắp ra đòn mạnh là chiến thuật thực chất hơn stack DoT.
3. **`defense×1.3`** (vừa phải, không đẩy cực đoan như bản thử ×1.6) giữ TTK bằng Rogue/Mage (2 class attack cao) ở mức khả thi xuyên suốt game, tránh Boss trở thành "tường số" không thể vượt qua chỉ vì thiếu 1 loại damage cụ thể.

**⚠️ Đã xác nhận**: "chiến thuật" ở đây được chốt là **thuần combat, siết bằng chỉ số** (phối hợp tank/heal/CC trong hệ thống hiện có), **không** mở lại mini-game boss-phase (`docs/minigame-decisions.md` §1, hiện vẫn nằm trong danh sách "chưa implement" ở `README.md`) — giữ đúng scope hiện tại. (Cập nhật §6.12: sau đó vẫn bổ sung thêm skill riêng cho Elite/Boss — không phải mini-game, vẫn thuần combat, chỉ thêm hành vi/tùy chọn hành động cho quái thay vì chỉ đổi chỉ số).

Bảng dưới dùng chỉ số base **Skeleton Guard** hiện hành ở `02-monster.md` mục 2 (`baseHp 55`, `baseAttack 23`, `baseDefense 10`); `bossMultiplier`/`eliteMultiplier` như ở trên; level theo độ sâu tầng dùng bảng mô phỏng đã cập nhật ở §6.7.

**TTK Boss thật vs Elite cùng tầng** (skill sơ cấp mỗi class, party ở level tương ứng theo §6.7 — dùng Rogue/Mage vì Vanguard/Acolyte "bất tử hóa" từ khá sớm, xem §6.7):

| Tầng | Level | Loại | HP | Def | Rogue (hit) | Mage (hit) |
|---|---|---|---|---|---|---|
| 10 | 8 | Elite | 453 | 32 | 19 | 42 |
| 10 | 8 | **Boss** | 543 | 36 | 26 | 78 |
| 25 | 19 | Elite | 828 | 49 | 20 | 32 |
| 25 | 19 | **Boss** | 993 | 56 | 29 | 53 |
| 50 | 33 | Elite | 1265 | 63 | 23 | 34 |
| 50 | 33 | **Boss** | 1518 | 72 | 33 | 53 |
| 100 | 55 | Elite | 1765 | 81 | 28 | 41 |
| 100 | 55 | **Boss** | 2118 | 91 | 39 | 63 |

Boss thật luôn khó hơn Elite cùng tầng rõ rệt (HP/def/TTK đều cao hơn) nhưng chưa tới mức bất khả thi cho Rogue/Mage — khớp mục tiêu "mạnh hơn, đòi hỏi chiến thuật" mà không phá vỡ nhịp chơi. Số liệu chính xác hơn bản trước nhờ mô phỏng thật (xem §6.7), nhưng xu hướng tổng thể không đổi.

**⚠️ Số liệu `bossMultiplier` (3/1.8/1.3) và `bossMultiplier.exp` (x6) chưa đổi qua các đợt rebalance gần đây, nhưng TTK thực tế đã dịch chuyển theo base stat/EXP mới — cần playtest lại để xác nhận cảm giác khó vẫn đúng ý đồ.**

### 6.12 Elite/Boss có skill riêng — AoE, kết liễu, debuff ngẫu nhiên

**Vấn đề gốc**: mọi quái (kể cả Elite/Boss) trước giờ chỉ có đúng 1 hành động — đòn đánh thường đơn mục tiêu (`amount 0`, chọn mục tiêu theo `aiPattern`), dù `Monster.skillIds`/`MonsterArchetype.skillIds` đã tồn tại trong type từ đầu. Elite/Boss chỉ là "quái thường nhân số", không có công cụ ép người chơi phản ứng khác đi (dồn heal, đổi mục tiêu, gỡ debuff).

**Quyết định**: cho riêng **Elite** và **Boss thật** (không áp dụng cho quái thường, kể cả 1 archetype guard-room khi spawn ở phòng combat thường) 1 bộ skill kích hoạt tại chỗ ở đúng lượt của chúng (không qua `queueAction`/MP/cooldown như player — quái luôn "miễn phí" và luôn trúng, giữ đúng bất biến sẵn có ở `resolver.ts`):

| Skill (tên chung) | Tier | Target | Hiệu ứng | Khi nào dùng |
|---|---|---|---|---|
| **Strike** (VD Cleaving Strike — Skeleton Guard) | Elite + Boss | 1 địch | `damage amount 3` | Hành động mặc định (thay `amount 0` cũ), chọn mục tiêu theo `aiPattern` như quái thường (`02-monster.md` mục 2) |
| **Cleave** (VD Sweeping Cleave) | Elite + Boss | Cả đội | `damage amount 2` | 30%/lượt, thay cho Strike |
| **Execute/Finishing Blow** | Chỉ Boss | 1 địch | `damage amount 71` | Xem cơ chế tích lực riêng bên dưới — **không** dựa theo %HP mục tiêu |
| **Debuff** (VD Crush — Skeleton Guard) | Chỉ Boss | 1 địch | `damage amount 4` + áp 1 status debuff riêng theo archetype (`weakened`/`poisoned`/`burning`/`stunned`) | 30%/lượt khi Boss không đang tích lực/tung Execute, thay cho roll Cleave/Strike |

**⚠️ Cập nhật (2026-08-17)**: bảng skill trên **giờ áp dụng cho cả 5 archetype guard-room**, không chỉ Skeleton Guard như bản gốc — mỗi archetype có bộ 4 skill riêng (`data/monster-skills.json`, tên khác nhau theo flavor, VD Giant Spider dùng "Venomous Bite"/"Web Barrage"/"Death Bite"/"Web Trap" áp `poisoned`; Dragon dùng "Claw Rake"/"Fire Breath"/"Inferno Bite"/"Scorching Breath" áp `burning`; Zombie Knight dùng "Rusted Blade"/"Rotting Swing"/"Grave Judgment"/"Diseased Strike" áp `weakened`; Dark Knight dùng "Shadow Slash"/"Dark Wave"/"Abyssal Judgment"/"Crushing Blow" áp `stunned`) nhưng **cùng 1 bộ `amount`** (3/2/71/4) và cùng cơ chế kích hoạt — chỉ khác debuff status để tạo bản sắc riêng cho mỗi archetype. `amount` của Strike đã giảm từ **8 xuống 3** so với bản gốc (xem lý do rebalance ở `02-monster.md` mục 2 "Vì sao giảm luôn `amount` của skill strike") — damage giờ đến chủ yếu từ `attack` đã scale theo `eliteMultiplier`/`bossMultiplier`, không phải từ `amount` cố định của skill.

Thứ tự ưu tiên mỗi lượt của Boss: **đang tích lực?** → tung Execute → nếu không, **hết cooldown Execute?** → bắt đầu tích lực (bỏ qua mọi hành động khác lượt đó) → nếu không, roll **Debuff** (30%) → roll **Cleave** (30%) → **Strike**. Elite (không có Execute/Debuff): roll **Cleave** (30%) → **Strike**.

**Execute — cơ chế "tích lực rồi dồn 1 đòn cực mạnh"** (không trigger theo %HP mục tiêu):

- **Cơ chế kích hoạt riêng, không qua roll `chance()` như Debuff/Cleave**: Boss track `executeCooldownTurns` (khởi tạo `EXECUTE_COOLDOWN_TURNS = 3` lúc spawn, `src/data/monsters.ts`). Khi cooldown chạm 0, lượt đó Boss **tích lực** thay vì tấn công — chọn 1 mục tiêu ngay lúc đó (vẫn theo `aggro` như bình thường, `pickAggroWeighted`) và **khoá lại** (`Monster.executeTargetId`), log cảnh báo tên mục tiêu, không gây sát thương gì lượt này. Lượt kế tiếp của Boss, bất kể cooldown/roll gì khác, **luôn** tung Execute vào đúng người đã khoá (đọc lại từ `executeTargetId`, không tính lại target) rồi reset cooldown về `EXECUTE_COOLDOWN_TURNS`.
- **Sát thương cố định, không phụ thuộc %HP hiện tại của mục tiêu**: `amount 71` cộng `attack` của Boss trừ `defense` của mục tiêu — xem bảng kiểm chứng bên dưới cho tỉ lệ % maxHp thực tế theo từng class.
- **Vì sao khoá mục tiêu lúc tích lực thay vì tính lại lúc tung đòn**: đây chính là "cảnh báo trước" (telegraph) — mục tiêu bị chọn dựa trên `aggro` **tại thời điểm tích lực**, nghĩa là Taunt dùng **trước lượt tích lực của Boss trong cùng round** (nhờ +20 speed ưu tiên buff, `01-class-skill.md` mục 1) có thể ảnh hưởng ai bị khoá. Nhưng **sau khi đã khoá**, đổi aggro/taunt ở round kế tiếp **không** cứu được người đó nữa — đúng tinh thần "đã tích lực thì phải hứng chịu hoặc chuẩn bị trước". Người chơi có 1 lượt cảnh báo rõ ràng (log tên mục tiêu) để quyết định: dồn heal cho người đó trước khi đòn tới, hoặc chấp nhận rủi ro mất người đó.

**`weakened`** (status effect, `data/status-effects.json`, id cũ `suy-yeu` đã đổi sang tiếng Anh) tận dụng đúng công cụ gỡ debuff sẵn có (Purify của Acolyte, nhánh ally = `removeStatusEffect`) — đặt Acolyte vào tình huống phải chọn giữa gỡ debuff hay heal ở đúng lượt Zombie Knight (hoặc Skeleton Guard) vừa trúng, thay vì heal luôn là lựa chọn mặc định duy nhất. 3 archetype guard-room còn lại dùng `poisoned`/`burning`/`stunned` cho debuff riêng (xem bảng skill ở trên) thay vì `weakened` — đa dạng hoá công cụ đối phó cần dùng tùy archetype gặp phải (gỡ debuff qua Purify chỉ hiệu quả với `weakened`/`poisoned`/`burning`/`stunned` nói chung, không riêng gì Zombie Knight).

**Kiểm chứng bằng số (party level 1, `createCharacter(..., level = 1)`)**, dùng **Skeleton Guard** ở tầng 1 làm tham chiếu (`amount` skill giống hệt 4 archetype guard-room còn lại, chỉ base stat khác — xem `02-monster.md` mục 2 để tính lại cho archetype khác):

| Loại | Atk | Def | HP | Class | maxHp | Strike (%maxHp) | Cleave (%maxHp) | Execute (%maxHp) |
|---|---|---|---|---|---|---|---|---|
| Elite | 32 | 12 | 138 | Vanguard | 140 | 25 (18%) | 24 (17%) | — |
| Elite | 32 | 12 | 138 | Mage | 70 | 31 (44%) | 30 (43%) | — |
| Elite | 32 | 12 | 138 | Rogue | 90 | 29 (32%) | 28 (31%) | — |
| Elite | 32 | 12 | 138 | Acolyte | 100 | 27 (27%) | 26 (26%) | — |
| Boss | 41 | 13 | 165 | Vanguard | 140 | 34 (24%) | 33 (24%) | 102 (**73%**) |
| Boss | 41 | 13 | 165 | Mage | 70 | 40 (57%) | 39 (56%) | 108 (**154%, dứt điểm**) |
| Boss | 41 | 13 | 165 | Rogue | 90 | 38 (42%) | 37 (41%) | 106 (**118%, dứt điểm**) |
| Boss | 41 | 13 | 165 | Acolyte | 100 | 36 (36%) | 35 (35%) | 104 (**104%, dứt điểm**) |

**⚠️ Con số Execute đã dịch chuyển đáng kể so với thiết kế gốc** (từng nhắm "~60% maxHp Vanguard" — mô tả này vẫn còn trong `data/monster-skills.json` nhưng **không còn khớp số liệu thật**): thực tế hiện tại là **73% maxHp Vanguard**, cao hơn hẳn mục tiêu gốc và giờ **luôn dứt điểm cả 3 class còn lại** (104-154%, trước là 88-131%) thay vì "Acolyte sát nút sống sót" như thiết kế ban đầu. Nguyên nhân: `baseAttack` Skeleton Guard tăng 14→23 (đợt rebalance quái thường) kéo theo `attack` Boss tăng qua `bossMultiplier.attack ×1.8` (`23×1.8≈41` so với `14×1.8≈25` trước đây), trong khi `amount 71` của Execute không đổi. **Chưa xử lý trong lần cập nhật tài liệu này** — cần quyết định giữa (a) hạ `amount` Execute để về lại đúng ~60% maxHp Vanguard, hay (b) chấp nhận Execute mạnh hơn như 1 hệ quả hợp lý của quái mạnh hơn nói chung và chỉ cập nhật lại target % trong mô tả thiết kế.

Đọc phần còn lại: Strike của Elite vẫn rơi đúng dải **20-45%** cho 3/4 class, Vanguard thấp hơn hẳn (18%, có chủ đích, tank chịu ít hơn đúng vai trò). Boss nhỉnh hơn Elite thêm ~5-13 điểm % (do base attack/defense Boss cao hơn qua `bossMultiplier`). Cleave (AoE) vẫn nhẹ hơn Strike trên từng target nhưng **chênh lệch đã thu hẹp còn ~1 điểm damage** (`amount` 2 vs 3, so với 2 vs 8 trước đây) — xem ghi chú ở `02-monster.md` mục 2 về hệ quả này.

**Đã giải quyết**: các con số ở mục này giờ tính cho cả 5 archetype guard-room (không chỉ `skeleton-guard` như bản gốc) — `MonsterArchetype.eliteSkillIds`/`bossSkillIds` đã được định nghĩa cho tất cả archetype guard-room, không còn optional-bỏ-trống cho 4 archetype mới thêm.
