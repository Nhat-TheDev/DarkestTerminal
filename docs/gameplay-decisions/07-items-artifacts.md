# §7. Item & Artifact

*(mục 7 của `00-index.md`)*

**Trạng thái: spec tài liệu, chưa implement** — đúng quy ước đã dùng cho các mục khác lúc còn ở giai đoạn thiết kế (VD `01-class-skill.md` trước khi có code). `README.md` hiện vẫn liệt kê "Item/inventory" trong danh sách đã cắt khỏi scope prototype; mục này thay thế phần "chưa xác định" đó bằng spec đầy đủ, đợi lượt implement kế tiếp.

**Quy ước đặt tên (cập nhật 2026-08-17)**: mọi `id`/`name` của Item, Artifact, và 2 status effect mới phục vụ Item ở mục này đều bằng **tiếng Anh** — khớp hướng đổi tên đang áp dụng cho monster/class ở `data/monsters.json`/`data/classes.json` (xem `README.md`). Phần mô tả/giải thích trong tài liệu vẫn giữ tiếng Việt như toàn bộ `docs/gameplay-decisions/` — chỉ riêng `id`/`name` đổi.

Tách 2 khái niệm rõ ràng, không dùng chung 1 hệ thống:

| | Item | Artifact |
|---|---|---|
| Bản chất | Tiêu hao — dùng 1 lần, mất đi | Relic vĩnh viễn trong 1 run — nhặt là giữ tới khi permadeath |
| Hiệu quả | Tức thời, chủ động (người chơi chọn lúc nào dùng) | Bị động, liên tục suốt run (không cần "dùng") |
| Dùng trong combat? | Có — thay cho việc chọn skill ở pha ra lệnh | Không — cộng dồn thẳng vào chỉ số/hành vi, không chiếm lượt |
| Mất khi nào | Dùng xong (trừ 1 khỏi kho) | Party wipe (permadeath — đúng tinh thần rủi ro thật, `05-character-stats.md` mục 5) |
| Độ hiếm | Không phân hiếm — chỉ khác loại hiệu ứng | **4 bậc**: Common / Rare / Unique / Epic |

---

## 7.1 Item (tiêu hao)

### Cấu trúc dữ liệu

Tái dùng đúng sketch `ItemDefinition` đã có sẵn trong `../../dungeon-crawler-data-model.ts` mục 1.6, đơn giản hoá cho phạm vi hiện tại (chỉ loại tiêu hao — không có `equipment`/`keyItem`, xem `01-class-skill.md` mục 1.5 "Ghi chú thiết kế" bullet cuối, chỗ `usesPerCombat` được để dành cho item):

```
ItemDefinition {
  id: Id
  name: string
  description: string
  effects: SkillEffect[]   // dùng chung đúng resolver đã có — không effect kind mới nào cần cho item
}
```

Dùng trong combat: ở pha ra lệnh, nhân vật chọn "dùng vật phẩm" thay vì skill — trừ 1 số lượng khỏi `GameState.inventory[itemId]`, áp `effects` qua đúng `resolveSkillEffect` hiện có (0 thay đổi ở `resolver.ts`). Có thể dùng ngoài combat (VD hồi hunger/thirst khi đang đi trong dungeon loop, không cần đợi combat).

### Nguồn rơi

Rơi ngẫu nhiên khi giết **bất kỳ quái nào** (thường/Elite/Boss) — tỷ lệ đề xuất **15%/lần giết**, 1 item ngẫu nhiên (đều, không phân hiếm) trong toàn bộ pool 10 item bên dưới, cộng thẳng vào `GameState.inventory[itemId] += 1`. Không rơi từ Treasure/Event room (2 room đó dành cho Artifact — mục 7.2) — giữ 2 nguồn tách biệt cho 2 loại phần thưởng.

### Catalog — 10 item

| id | Name | Hiệu ứng (`effects`) | Ghi chú |
|---|---|---|---|
| `small-health-potion` | Small Health Potion | `heal 30` | |
| `large-health-potion` | Large Health Potion | `heal 70` | |
| `small-mana-potion` | Small Mana Potion | `restoreMp 20` | |
| `large-mana-potion` | Large Mana Potion | `restoreMp 45` | |
| `ration` | Ration | `modifyStat hunger +40` | Dùng ngoài combat, hồi đói |
| `water-flask` | Water Flask | `modifyStat thirst +40` | Dùng ngoài combat, hồi khát |
| `calming-draught` | Calming Draught | `modifyStat fear -25` | |
| `antidote` | Antidote | `removeStatusEffect` (gỡ 1 debuff bất kỳ, không cần chỉ định id — giống nhánh ally của Purify, `01-class-skill.md` mục 1.4) | |
| `whetstone` | Whetstone | `applyStatusEffect "empower"` (+6 attack, 2 lượt — status mới, xem bảng dưới) | Buff tạm thời qua item, không tốn lượt "dùng skill" của nhân vật khác trong round |
| `temporary-ward` | Temporary Ward | `applyStatusEffect "fortify"` (+8 defense, 2 lượt — status mới) | |

2 status mới cần thêm vào `data/status-effects.json` cho 2 item buff cuối (cùng shape với `rally`/`guard` đã có ở `01-class-skill.md` mục 1.5, chỉ khác nguồn kích hoạt là item thay vì skill — `id` đặt tiếng Anh vì gắn với item, khác quy ước tiếng Việt của status effect thuộc skill nhân vật):

| id | Name | `perTurnEffects` | Thời lượng |
|---|---|---|---|
| `empower` | Empower | `modifyCombatStat attack +6` | 2 lượt |
| `fortify` | Fortify | `modifyCombatStat defense +8` | 2 lượt |

**⚠️ Số liệu heal/restoreMp/tỷ lệ rơi (15%) là đề xuất ban đầu — cần playtest, giống mọi bảng số khác trong tài liệu này.**

---

## 7.2 Artifact (relic vĩnh viễn trong run)

### Trang bị — Artifact gắn lên 1 nhân vật cụ thể, không phải cả đội (cập nhật 2026-08-17)

**Quyết định**: Artifact là **trang bị** (equipment), không phải buff rơi thẳng vào cả đội như bản nháp trước. Nhặt được → vào kho chung chưa trang bị (`GameState.unequippedArtifactIds: Id[]`) → người chơi **chủ động gắn** vào 1 nhân vật bất kỳ ngoài combat (cùng màn hình quản lý đội, VD panel "Đoàn Thám Hiểm" đã có ở UI — không đổi trong lúc combat đang diễn ra, tránh xáo trộn loadout giữa trận).

```
Character.equippedArtifactIds: Id[]   // tối đa 3, field mới trên Character
GameState.unequippedArtifactIds: Id[] // kho chung, artifact đã nhặt nhưng chưa gắn cho ai
```

- **Tối đa 3 Artifact/nhân vật** — 4 nhân vật × 3 slot = **12 lượt trang bị** cho cả đội mỗi run.
- Gắn/gỡ **tự do, không tốn gì, không giới hạn số lần** — artifact không bị "tiêu hao" khi gỡ, chỉ chuyển lại kho chung, có thể gắn sang nhân vật khác bất kỳ lúc nào (ngoài combat).
- Nhặt được nhiều hơn 12 (tổng slot cả đội) → phần dư nằm trong kho chung, vẫn thuộc sở hữu nhưng **không có hiệu lực** cho tới khi được gắn (thay 1 artifact khác đang gắn) — tạo đúng tension "chọn 12 cái tốt nhất trong số đã nhặt được" của thể loại roguelite trang bị relic.
- **Hiệu ứng chỉ áp dụng cho đúng nhân vật đang gắn nó** — khác hẳn bản nháp trước ("cộng cho cả đội"). Xem lại từng loại hiệu ứng ở bảng "Vì sao" bên dưới, đã cập nhật theo hướng này.

### Cấu trúc dữ liệu hiệu ứng

Hiệu ứng **bị động, cộng dồn**, không đi qua resolver combat như skill/item — nhóm theo 4 phạm vi tác dụng:

```
ArtifactRarity = "common" | "rare" | "unique" | "epic"

ArtifactEffect =
  // Nhóm 1 — cộng thẳng chỉ số cho nhân vật đang trang bị
  | { kind: "statBoost"; stat: "attack" | "defense" | "maxHp" | "maxMp"; amount: number }

  // Nhóm 2 — hiệu ứng chiến đấu khác biệt, đều chỉ tính cho nhân vật đang trang bị
  | { kind: "reflectDamage"; percent: number }    // % sát thương quái gây cho ĐÚNG nhân vật đang trang bị bị phản ngược lại kẻ đánh
  | { kind: "poisonOnHit"; chance: number }       // mỗi đòn damage do ĐÚNG nhân vật đang trang bị gây ra có % này tự áp "poisoned" lên mục tiêu, không cần Poison Coat của Rogue
  | { kind: "lifesteal"; percent: number }        // mỗi đòn damage do ĐÚNG nhân vật đang trang bị gây ra, % sát thương đó hồi thẳng lại HP cho chính họ
  | { kind: "dodgeChance"; chance: number }       // mỗi đòn tấn công của quái nhắm vào ĐÚNG nhân vật đang trang bị có % này để né hoàn toàn (damage = 0), roll riêng, không liên quan tới fear-accuracy (`04-fear-combat.md` mục 4)
  | { kind: "healOnKill"; amount: number }        // mỗi khi ĐÚNG nhân vật đang trang bị hạ gục 1 quái (đòn cuối cùng), tự hồi thẳng `amount` HP cho chính họ

  // Nhóm 3 — tự động gây sát thương, gắn với nhân vật trang bị nhưng không tốn lượt của họ
  | { kind: "autoDamage"; amount: number }        // đầu mỗi round, miễn nhân vật trang bị còn sống, tự gây `amount` sát thương lên 1 quái còn sống ngẫu nhiên — không qua queueAction, không tốn lượt/MP, không chọn được mục tiêu

  // Nhóm 4 — tác động lên hệ thống ngoài combat (survival/cooldown là per-character sẵn có; EXP là ngoại lệ vì partyExp dùng chung)
  | { kind: "expBoost"; percent: number }         // cộng thêm % vào expReward của MỌI lượt giết quái trong lúc artifact đang được trang bị bởi bất kỳ ai (EXP là `partyExp` dùng chung — §6.9 — nên đây là ngoại lệ duy nhất không giới hạn theo 1 người)
  | { kind: "fearResist"; percent: number }       // giảm % mọi nguồn tăng fear của ĐÚNG nhân vật đang trang bị (`Character.survival.fear` vốn đã per-character — `03-survival-stats.md` mục 3), không áp cho fear giảm chủ động
  | { kind: "cooldownReduction"; turns: number }  // giảm thẳng `cooldownTurns` các skill của ĐÚNG nhân vật đang trang bị (tối thiểu 0) — `Character.cooldownsRemaining` vốn đã per-character
  | { kind: "survivalDrainReduction"; percent: number } // giảm % tốc độ giảm hunger/thirst mỗi hành động của ĐÚNG nhân vật đang trang bị (`03-survival-stats.md` mục 3: -1 hunger/-1.5 thirst gốc, vốn đã per-character)

ArtifactDefinition {
  id: Id
  name: string
  description: string
  rarity: ArtifactRarity
  effects: ArtifactEffect[]   // hầu hết chỉ 1, epic có thể ghép nhiều
}
```

**Cộng dồn khi trùng lặp**: 1 nhân vật gắn 2 artifact cùng loại (chiếm 2/3 slot của họ) → hiệu quả cộng thẳng cho riêng người đó (2× `statBoost`, 2 roll độc lập cho `poisonOnHit`/`dodgeChance`/v.v.) — đúng tinh thần roguelite "dồn relic cùng loại vào 1 carry", đối trọng lại việc quái mạnh dần vô hạn ở `06-level-system.md` §6.10. 2 nhân vật khác nhau cùng gắn 1 loại artifact thì **mỗi người tính riêng độc lập**, không cộng chung.

**Áp dụng cho ai**: `statBoost` cộng thẳng vào chỉ số của **đúng nhân vật đang gắn** (không nhân theo `growthWeights` — artifact nhặt được ngẫu nhiên, không phải lựa chọn theo class, xem lý do tương tự ở `06-level-system.md` §6.6 vì sao quái không dùng trọng số). Toàn bộ hiệu ứng nhóm 2-4 cũng chỉ tính cho đúng nhân vật đang gắn (trừ `expBoost` — ngoại lệ vì EXP dùng chung `partyExp`, xem chú thích ngay trong khối effect ở trên) — tính ở tầng `Character` (mới, cần thêm field `equippedArtifactIds`) thay vì `GameState`/`CombatState` như bản nháp trước.

### Nguồn rơi

4 nguồn, không loại trừ nhau (khác Elite/Boss ở `02-monster.md` mục 2 — nơi 2 loại đó loại trừ nhau theo tầng):

| Nguồn | Tỷ lệ rơi 1 Artifact | Ghi chú |
|---|---|---|
| Giết **Elite** (phòng cuối tầng, không phải Boss) | **35%** | Thấp hơn hẳn Boss — Elite xuất hiện hầu hết các tầng nên tần suất tự bù lại |
| Giết **Boss thật** (mỗi 5 tầng, `06-level-system.md` §6.11) | **100%** (chắc chắn) | Cột mốc lớn, luôn thưởng — không cần roll |
| **Treasure room** | **100%** (chắc chắn, khi ghé phòng) | Phòng loại mới — `RoomType` thêm `"treasure"` (đã có sẵn trong `src/types.ts` nhưng chưa dùng tới nay), không có combat |
| **Event room** | **100%** (chắc chắn, khi ghé phòng) | Phòng loại mới — `RoomType` thêm `"event"` (chưa tồn tại, cần thêm), thiên về Artifact hiếm hơn Treasure room (xem bảng độ hiếm theo nguồn bên dưới) |

**Quái thường** (không phải Elite/Boss) **không** rơi Artifact — chỉ rơi Item (mục 7.1). Giữ 2 nguồn tách biệt: quái thường/Elite/Boss đều có thể rơi Item, nhưng chỉ Elite/Boss/2 loại phòng mới rơi Artifact.

**⚠️ Treasure room/Event room hiện chưa có trong `data/floor-patterns.json`** (pattern hiện tại chỉ có 3 tag: combat rỗng, `free` (rest), `boss`) — cần thêm 2 tag mới + cập nhật `validatePattern`/`roomTypeForTag` (`src/data/floorPatterns.ts`) khi implement. Ngoài scope của lượt viết tài liệu này (không code).

### Độ hiếm & tỷ lệ rơi từng bậc

Khi 1 lượt rơi Artifact xảy ra (theo bảng nguồn ở trên), độ hiếm của Artifact nhận được roll riêng theo trọng số cố định, không phụ thuộc nguồn (Elite/Boss/Treasure/Event đều dùng chung bảng này — chỉ khác **có rơi hay không**, không khác **rơi gì**):

| Độ hiếm | Trọng số rơi | Số lượng trong catalog | Đặc điểm hiệu ứng |
|---|---|---|---|
| Common | **50%** | 10 | 1 `statBoost` nhỏ, hoặc 1 distinctive/system effect mức nhẹ nhất |
| Rare | **30%** | 9 | 1 `statBoost` lớn hơn, hoặc 1 distinctive/system effect mức nhẹ |
| Unique | **15%** | 7 | Distinctive/system effect mức rõ rệt, hoặc `autoDamage`, hoặc `statBoost` đa chỉ số |
| Epic | **5%** | 4 | Ghép ≥2 effect, mạnh nhất catalog |

### Catalog — 30 Artifact

**Common (10)**:

| id | Name | Hiệu ứng |
|---|---|---|
| `iron-gauntlet` | Iron Gauntlet | `statBoost attack +3` |
| `worn-wooden-shield` | Worn Wooden Shield | `statBoost defense +3` |
| `charm-of-life` | Charm of Life | `statBoost maxHp +20` |
| `small-mana-gem` | Small Mana Gem | `statBoost maxMp +10` |
| `sharp-claw` | Sharp Claw | `statBoost attack +4` |
| `stone-of-endurance` | Stone of Endurance | `statBoost maxHp +30` |
| `ring-of-focus` | Ring of Focus | `statBoost maxMp +15` |
| `warriors-necklace` | Warrior's Necklace | `statBoost defense +5` |
| `pendant-of-calm` | Pendant of Calm | `fearResist 10%` |
| `travelers-ration` | Traveler's Ration | `survivalDrainReduction 15%` |

**Rare (9)** — `statBoost` lớn hơn hẳn Common, hoặc distinctive/system effect mức nhẹ:

| id | Name | Hiệu ứng |
|---|---|---|
| `ancient-sword` | Ancient Sword | `statBoost attack +8` |
| `heart-of-stone` | Heart of Stone | `statBoost defense +8` |
| `eternal-vial` | Eternal Vial | `statBoost maxHp +50` |
| `arcane-core` | Arcane Core | `statBoost maxMp +25` |
| `thorned-armor` | Thorned Armor | `reflectDamage 5%` |
| `venomous-dagger-relic` | Venomous Dagger (Relic) | `poisonOnHit 6%` |
| `vampiric-fang` | Vampiric Fang | `lifesteal 5%` |
| `featherweight-boots` | Featherweight Boots | `dodgeChance 6%` |
| `quickcharge-rune` | Quickcharge Rune | `cooldownReduction 1` |

**Unique (7)** — distinctive/system effect mức rõ, hoặc `autoDamage`, hoặc đa chỉ số:

| id | Name | Hiệu ứng |
|---|---|---|
| `spiked-cloak` | Spiked Cloak | `reflectDamage 10%` |
| `serpent-ring` | Serpent Ring | `poisonOnHit 12%` |
| `thunder-totem` | Thunder Totem | `autoDamage 6` (mỗi round, 1 quái ngẫu nhiên) |
| `armor-of-wholeness` | Armor of Wholeness | `statBoost attack +6` + `statBoost defense +6` + `statBoost maxHp +40` |
| `bloodthirsty-blade` | Bloodthirsty Blade | `lifesteal 10%` |
| `phantom-step` | Phantom Step | `dodgeChance 12%` |
| `scholars-insight` | Scholar's Insight | `expBoost 15%` |

**Epic (4)** — ghép nhiều effect, mạnh nhất catalog:

| id | Name | Hiệu ứng |
|---|---|---|
| `crown-of-destruction` | Crown of Destruction | `autoDamage 12` + `poisonOnHit 8%` |
| `immortal-heart` | Immortal Heart | `reflectDamage 15%` + `statBoost defense +10` + `statBoost maxHp +60` |
| `reapers-covenant` | Reaper's Covenant | `healOnKill 25` + `lifesteal 8%` |
| `eternal-scholars-tome` | Eternal Scholar's Tome | `expBoost 25%` + `cooldownReduction 1` |

### Vì sao `autoDamage` không chọn được mục tiêu

Theo đúng yêu cầu — Artifact là phần thưởng bị động, không phải 1 skill người chơi điều khiển. `autoDamage` kích hoạt **đầu mỗi round** (trước pha ra lệnh của player, tương tự cách `darknessLevel`/ambient fear áp dụng — `03-survival-stats.md` mục 3), chọn 1 quái còn sống **ngẫu nhiên đều** (uniform, giống pattern `erratic` ở `02-monster.md` mục 2 — không theo `aggro` vì đây không phải hành động của quái nhắm vào party mà ngược lại) — không tốn MP, không qua `queueAction`, không hiện trong danh sách skill để chọn. Log kết quả như 1 dòng sự kiện riêng, tách biệt lượt của bất kỳ nhân vật nào.

### Vì sao đây là 9 hiệu ứng "khác biệt" đúng nghĩa (không phải biến thể của cái đã có)

Không cái nào trong nhóm 2-4 tồn tại dưới bất kỳ hình thức nào trong hệ skill/status hiện có (`01-class-skill.md` mục 1.5) — mỗi cái cần 1 hook riêng ở engine khi implement (ngoài scope tài liệu này):

- **`reflectDamage`**: sau khi 1 quái gây `damage` thành công lên **đúng nhân vật đang gắn artifact này** (không phải nhân vật khác trong party), roll `percent`, nếu trúng thì gây ngược `percent × damage vừa nhận` lên chính quái đó (không đi qua `defense` của quái — phản đòn không phải 1 đòn tấn công thường).
- **`poisonOnHit`**: sau khi **đúng nhân vật đang gắn artifact này** gây `damage` thành công lên 1 quái (bất kỳ skill/đòn thường nào của người đó, không chỉ Poison Coat), roll `chance`, nếu trúng thì `applyStatusEffect "poisoned"` lên quái đó — cùng cơ chế "on-hit rider" đã có cho Poison Coat (`docs/technical-decisions.md` §4.2), chỉ khác nguồn kích hoạt là artifact thay vì status tạm thời. Nhân vật khác trong party đánh trúng **không** kích hoạt hiệu ứng này trừ khi họ cũng tự gắn 1 artifact `poisonOnHit` riêng.
- **`lifesteal`**: hook ở đúng chỗ resolver tính `finalDamage` cho effect `damage` do **đúng nhân vật đang gắn artifact này** gây ra (`resolver.ts`) — sau khi trừ hp mục tiêu, cộng thêm `round(finalDamage × percent)` vào hp của chính họ (không vượt `maxHp`). Khác `heal` thường vì không phải 1 effect độc lập trong skill, mà ăn theo damage thật đã gây ra.
- **`dodgeChance`**: roll **trước** bước tính `finalDamage` khi quái nhắm `damage` vào **đúng nhân vật đang gắn artifact này** — trúng thì bỏ qua toàn bộ effect (damage = 0, không chỉ giảm), khác hẳn accuracy-roll theo fear đã có (`04-fear-combat.md` mục 4, vốn chỉ áp cho skill nhân vật nhắm địch, không áp cho đòn quái nhắm nhân vật). Quái nhắm vào đồng đội khác của họ thì không roll dodge này.
- **`healOnKill`**: hook ở đúng điểm 1 quái bị loại khỏi `CombatState.combatants` (hp ≤ 0) — **chỉ trigger nếu đòn kết liễu (effect `damage` cuối cùng khiến hp ≤ 0) do đúng nhân vật đang gắn artifact này gây ra**, hồi thẳng `amount` cho chính họ (không vượt `maxHp`, không phải cho đồng đội khác — khác thiết kế "hồi người thấp HP nhất" ở bản nháp trước, đổi theo đúng tinh thần "hiệu ứng chỉ định lên nhân vật đang trang bị").
- **`expBoost`**: nhân thêm vào bước `applyPartyExp` nhận `expGained` từ `game.ts` (`06-level-system.md` §6.9) — `expGained = round(expGained × (1 + tổng percent của mọi artifact expBoost đang được trang bị bởi bất kỳ ai trong party))`. Đây là **hiệu ứng duy nhất không giới hạn theo người gây kill** — vì `partyExp` là 1 giá trị dùng chung cho cả đội (§6.9), không có khái niệm "EXP của riêng 1 người" để giới hạn vào.
- **`fearResist`**: nhân vào **cả 2 nguồn tăng fear chủ động ngoài ý muốn** của **đúng nhân vật đang gắn artifact này** — ambient theo `darknessLevel` khi vào phòng mới, và `+15` cố định khi thua mini-game (`03-survival-stats.md` mục 3) — theo `fear_thật = round(fear_gốc × (1 − tổng percent))`, không áp cho fear giảm chủ động (skill Acolyte/item không đổi, tính đủ 100%). Đồng đội không gắn artifact này vẫn nhận fear đầy đủ như bình thường.
- **`cooldownReduction`**: trừ thẳng vào `cooldownTurns` được gán lúc 1 skill của **đúng nhân vật đang gắn artifact này** vào cooldown (`Character.cooldownsRemaining[skillId] = skill.cooldownTurns − tổng turns`, tối thiểu 0) — không hồi ngay skill đang cooldown sẵn có từ trước khi gắn artifact, không ảnh hưởng cooldown của đồng đội khác.
- **`survivalDrainReduction`**: nhân vào tốc độ giảm gốc mỗi hành động của **đúng nhân vật đang gắn artifact này** (`03-survival-stats.md` mục 3: `hunger -1`, `thirst -1.5`, vốn đã tính riêng từng `Character.survival`) — `giảm_thật = round(giảm_gốc × (1 − tổng percent), 1 chữ số thập phân)`.

**⚠️ Toàn bộ số liệu ở §7 (tỷ lệ rơi item 15%, tỷ lệ rơi Artifact theo nguồn 35%/100%, trọng số độ hiếm 50/30/15/5%, mọi con số hiệu ứng) là đề xuất ban đầu để có bộ khung đầy đủ — chưa playtest, sẽ cần chỉnh khi có dữ liệu chơi thật, giống mọi bảng số khác trong tài liệu này.**
