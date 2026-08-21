# §7. Item & Artifact

*(mục 7 của `00-index.md`)*

Item (§7.1) và Artifact (§7.2) là 2 hệ thống phần thưởng tách biệt, xem `src/engine/artifacts.ts`, `src/data/items.ts`, `src/data/artifacts.ts`.

**Quy ước đặt tên**: mọi `id`/`name` của Item, Artifact, và status effect phục vụ 2 hệ thống này đều bằng **tiếng Anh** — khớp quy ước đặt tên của monster/class ở `data/monsters.json`/`data/classes.json`. Phần mô tả/giải thích trong tài liệu vẫn giữ tiếng Việt như toàn bộ `docs/gameplay-decisions/`.

Tách 2 khái niệm rõ ràng, không dùng chung 1 hệ thống:

| | Item | Artifact |
|---|---|---|
| Bản chất | Tiêu hao — dùng 1 lần, mất đi | Relic vĩnh viễn trong 1 run — nhặt là giữ tới khi permadeath |
| Hiệu quả | Tức thời, chủ động (người chơi chọn lúc nào dùng) | Bị động, liên tục suốt run (không cần "dùng") |
| Dùng trong combat? | Có — thay cho việc chọn skill ở pha ra lệnh | Không — cộng dồn thẳng vào chỉ số/hành vi, không chiếm lượt |
| Mất khi nào | Dùng xong (trừ 1 khỏi kho) | Party wipe (permadeath, `05-character-stats.md` mục 5) |
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

Rơi ngẫu nhiên khi giết **bất kỳ quái nào** (thường/Elite/Boss) — tỷ lệ **60%/lần giết**. Không rơi từ Treasure/Event room (2 room đó dành cho Artifact — mục 7.2, cũng xem `08-events.md`).

Khi roll 60% trúng, item cụ thể được chọn từ **pool kết hợp** = 10 item chung (catalog bên dưới) + (các) item đặc trưng của đúng `archetypeId` vừa bị giết (bảng "Item đặc trưng theo quái" bên dưới), với trọng số:

- **50%** tổng dành cho item đặc trưng của loại quái đó. **1 quái có thể thuộc nhiều nhóm cùng lúc** (VD Zombie Knight vừa thuộc nhóm Zombie vừa thuộc nhóm Knight/Warrior) → nếu quái có N item đặc trưng áp dụng, 50% này **chia đều N phần** (N=1 → trọn 50% cho item đó; N=2 → 25%/item). Mọi archetype trong `data/monsters.json` đều đã có ít nhất 1 item đặc trưng (không có trường hợp fallback).
- **50%** còn lại chia đều cho 10 item pool chung (~5%/item)

Cộng thẳng vào `GameState.inventory[itemId] += 1` như cũ, không đổi cơ chế dùng item trong/ngoài combat.

**Ví dụ**: phòng 3 quái → mỗi quái roll độc lập 60% → tối đa 3 item rơi (không giới hạn cộng dồn), trung bình ~1.8 item/phòng 3 quái.

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

### Item đặc trưng theo quái

9 item, gán theo **nhóm quái theo tên/tab** (1 quái có thể thuộc nhiều nhóm — xem cơ chế roll đa-nhóm ở trên). Tái dùng tối đa `effects: SkillEffect[]` + resolver hiện có; 2 item cuối (`rotten-flesh`, `venom-thorn`) dùng status effect mới, ghi rõ ở ghi chú.

| id | Name | Gán cho `archetypeId` | Hiệu ứng (`effects`) | Ghi chú |
|---|---|---|---|---|
| `grave-dust` | Grave Dust | `skeleton`, `skeleton-archer`, `skeleton-guard` (nhóm Skeleton "thường/lính gác", 3 archetype) | `applyStatusEffect "fortify"` (+8 defense, 2 lượt, tự thân) | Bụi xương hoá cứng da thịt người dùng |
| `broken-blade-fragment` | Broken Blade Fragment | `skeleton-warrior`, `zombie-knight`, `dark-knight` (nhóm "chiến binh cầm vũ khí", 3 archetype) | `applyStatusEffect "empower"` (+6 attack, 2 lượt, tự thân — tái dùng status có sẵn) | Mảnh vũ khí gãy còn sắc, người nhặt học được cách ra đòn hiểm hơn |
| `rotten-flesh` | Rotten Flesh | `zombie`, `zombie-knight` (nhóm "xác sống", 2 archetype) | `applyStatusEffect "distracted"` (`modifyCombatStat aggro -20`, 1 lượt, tự thân) | Mùi hôi thối khiến quái khác bớt chú ý tới người mang — giảm aggro tạm thời |
| `venom-gland` | Venom Gland | `snake`, `lizard`, `spider` (nhóm Bò sát/Côn trùng cỡ nhỏ, 3 archetype) | `applyStatusEffect "poison-coat"` (tự thân, 3 lượt — tái dùng đúng status của skill Rogue "Poison Coat", `01-class-skill.md` §1.4: mọi đòn `damage` gây ra trong lúc buff còn hiệu lực tự kèm `poisoned` lên mục tiêu trúng đòn) | Tẩm độc vũ khí như skill sát thủ |
| `venom-thorn` | Venom Thorn | `giant-spider` (tách riêng khỏi nhóm Bò sát nhỏ — đại diện "động vật lớn") | `applyStatusEffect "poison-vulnerable"` nhắm 1 quái mục tiêu (status mới, xem ghi chú) | Gai độc không tự gây poison — chỉ khiến mục tiêu chịu sát thương poison gấp đôi nếu đang/sẽ bị `poisoned` từ nguồn khác (Venom Gland, Poison Coat, skill Rogue...) |
| `rat-meat` | Rat Meat | `dungeon-rat` | `applyStatusEffect "regeneration"` (status mới: `heal 10`/lượt, 3 lượt, tự thân, không xếp chồng — xem ghi chú) | Hồi máu theo lượt |
| `bat-blood` | Bat Blood | `black-bat` | `heal 20` (tức thì, tự thân) | |
| `slime-solution` | Slime Solution | `slime` | `restoreMp 20` (tức thì, tự thân) | |
| `dragon-scale` | Dragon Scale | `dragon` | `applyStatusEffect "fortify"` nhắm **allAllies** (+8 defense, 2 lượt, cả đội — tái dùng status `fortify`, giống pattern skill Rally của Vanguard `01-class-skill.md` §1.2) | `dragon` là `guardOnly` (chỉ gặp ở Elite/Boss). Item duy nhất dùng target `allAllies` thay vì tự thân |

**3 status effect mới cần thêm vào `data/status-effects.json`** (ngoài `empower`/`fortify`/`poison-coat`/`poisoned` đã có sẵn):

| id | Name | `perTurnEffects` | Thời lượng | Ghi chú hành vi mới |
|---|---|---|---|---|
| `distracted` | Distracted | `modifyCombatStat aggro -20` | 1 lượt | Dùng đúng `modifyCombatStat` sẵn có trên field `aggro` — giá trị âm thay vì dương như `taunt` |
| `regeneration` | Regeneration | `heal 10` | 3 lượt | **Không xếp chồng**: tái áp dụng khi đang hiệu lực chỉ làm mới thời lượng về 3, không cộng thêm instance mới — đây vốn đã là hành vi mặc định của `applyStatusEffectToActor`, không cần code riêng |
| `poison-vulnerable` | Poison Vulnerable | *(không có, chỉ khuếch đại)* | 2 lượt | Dùng field `vulnerableTo?: { statusEffectId: Id; multiplier: number }` trên `StatusEffectDefinition` — actor mang status này thì mọi tick sát thương của `poisoned` trên actor đó nhân `multiplier` (2.0 = gấp đôi, 4 HP/lượt gốc → 8 HP/lượt). Không tự gây `poisoned` — chỉ khuếch đại nếu đã/sẽ dính từ nguồn khác |

---

## 7.2 Artifact (relic vĩnh viễn trong run)

### Trang bị — Artifact gắn lên 1 nhân vật cụ thể, không phải cả đội

Artifact là **trang bị** (equipment). Nhặt được → vào kho chung chưa trang bị (`GameState.unequippedArtifactIds: Id[]`) → người chơi **chủ động gắn** vào 1 nhân vật bất kỳ ngoài combat (cùng màn hình quản lý đội, panel "Đoàn Thám Hiểm" — không đổi trong lúc combat đang diễn ra, tránh xáo trộn loadout giữa trận).

```
Character.equippedArtifactIds: Id[]   // tối đa 3, field mới trên Character
GameState.unequippedArtifactIds: Id[] // kho chung, artifact đã nhặt nhưng chưa gắn cho ai
```

- **Tối đa 3 Artifact/nhân vật** — 4 nhân vật × 3 slot = **12 lượt trang bị** cho cả đội mỗi run.
- Gắn/gỡ **tự do, không tốn gì, không giới hạn số lần** — artifact không bị "tiêu hao" khi gỡ, chỉ chuyển lại kho chung, có thể gắn sang nhân vật khác bất kỳ lúc nào (ngoài combat).
- Nhặt được nhiều hơn 12 (tổng slot cả đội) → phần dư nằm trong kho chung, vẫn thuộc sở hữu nhưng **không có hiệu lực** cho tới khi được gắn (thay 1 artifact khác đang gắn).
- **Hiệu ứng chỉ áp dụng cho đúng nhân vật đang gắn nó** (trừ `expBoost`, ngoại lệ vì EXP dùng chung — xem bảng "Vì sao" bên dưới).

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

**Cộng dồn khi trùng lặp**: 1 nhân vật gắn 2 artifact cùng loại (chiếm 2/3 slot của họ) → hiệu quả cộng thẳng cho riêng người đó (2× `statBoost`, 2 roll độc lập cho `poisonOnHit`/`dodgeChance`/v.v.). 2 nhân vật khác nhau cùng gắn 1 loại artifact thì **mỗi người tính riêng độc lập**, không cộng chung.

**Áp dụng cho ai**: `statBoost` cộng thẳng vào chỉ số của **đúng nhân vật đang gắn** (không nhân theo `growthWeights`). Toàn bộ hiệu ứng nhóm 2-4 cũng chỉ tính cho đúng nhân vật đang gắn (trừ `expBoost` — ngoại lệ vì EXP dùng chung `partyExp`, xem chú thích ngay trong khối effect ở trên) — tính ở tầng `Character` (field `equippedArtifactIds`).

### Nguồn rơi

4 nguồn, không loại trừ nhau (khác Elite/Boss ở `02-monster.md` mục 2 — nơi 2 loại đó loại trừ nhau theo tầng):

| Nguồn | Tỷ lệ rơi 1 Artifact | Ghi chú |
|---|---|---|
| Giết **Elite** (phòng cuối tầng, không phải Boss) | **100%** | Độ hiếm roll theo bảng "Elite" riêng bên dưới — không bao giờ ra Epic |
| Giết **Boss thật** (mỗi 5 tầng, `06-level-system.md` §6.11) | **100%** | Độ hiếm roll theo bảng "Boss" riêng bên dưới — không bao giờ ra Common/Rare |
| **Treasure room** | **100%** (chắc chắn, khi ghé phòng) | `RoomType "treasure"` tồn tại trong code nhưng floor generator hiện chưa sinh ra loại phòng này (chỉ sinh Event room ở branch stage) — trên thực tế chưa gặp được trong game |
| **Event room** | **100%** (chắc chắn, khi ghé phòng) | Xem `08-events.md` §8 cho 11 loại sự kiện cụ thể. Độ hiếm dùng bảng "Treasure/Event" bên dưới |

**Quái thường** (không phải Elite/Boss) **không** rơi Artifact — chỉ rơi Item (mục 7.1). Giữ 2 nguồn tách biệt: quái thường/Elite/Boss đều có thể rơi Item, nhưng chỉ Elite/Boss/2 loại phòng mới rơi Artifact.

### Độ hiếm & tỷ lệ rơi từng bậc

**Elite và Boss có bảng độ hiếm riêng, tách biệt hoàn toàn** (không chỉ chênh trọng số):

**Elite** — chỉ roll trong {Common, Rare, Unique}, **không bao giờ Epic**:

| Độ hiếm | Trọng số rơi |
|---|---|
| Common | **55%** |
| Rare | **35%** |
| Unique | **10%** |
| Epic | **0%** (không thể rơi) |

**Boss** — chỉ roll trong {Unique, Epic}, **không bao giờ Common/Rare**:

| Độ hiếm | Trọng số rơi |
|---|---|
| Common | **0%** (không thể rơi) |
| Rare | **0%** (không thể rơi) |
| Unique | **65%** |
| Epic | **35%** |

**Treasure room / Event room** — giữ nguyên bảng gốc, đứng giữa Elite và Boss về độ tốt trung bình:

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

### Cơ chế kích hoạt `autoDamage`

`autoDamage` kích hoạt **đầu mỗi round** (trước pha ra lệnh của player — cùng round boundary mà fear-gain theo combat cũng dùng, `03-survival-stats.md` mục 3), chọn 1 quái còn sống **ngẫu nhiên đều** (uniform, giống pattern `erratic` ở `02-monster.md` mục 2, không theo `aggro`) — không tốn MP, không qua `queueAction`, không hiện trong danh sách skill để chọn. Log kết quả như 1 dòng sự kiện riêng, tách biệt lượt của bất kỳ nhân vật nào.

### Hook engine của 9 hiệu ứng nhóm 2-4

Không cái nào trong nhóm 2-4 tồn tại dưới bất kỳ hình thức nào trong hệ skill/status hiện có (`01-class-skill.md` mục 1.5) — mỗi cái có 1 hook riêng trong engine:

- **`reflectDamage`**: sau khi 1 quái gây `damage` thành công lên **đúng nhân vật đang gắn artifact này** (không phải nhân vật khác trong party), roll `percent`, nếu trúng thì gây ngược `percent × damage vừa nhận` lên chính quái đó (không đi qua `defense` của quái — phản đòn không phải 1 đòn tấn công thường).
- **`poisonOnHit`**: sau khi **đúng nhân vật đang gắn artifact này** gây `damage` thành công lên 1 quái (bất kỳ skill/đòn thường nào của người đó, không chỉ Poison Coat), roll `chance`, nếu trúng thì `applyStatusEffect "poisoned"` lên quái đó — cùng cơ chế "on-hit rider" đã có cho Poison Coat (`docs/technical-decisions.md` §4.2), chỉ khác nguồn kích hoạt là artifact thay vì status tạm thời. Nhân vật khác trong party đánh trúng **không** kích hoạt hiệu ứng này trừ khi họ cũng tự gắn 1 artifact `poisonOnHit` riêng.
- **`lifesteal`**: hook ở đúng chỗ resolver tính `finalDamage` cho effect `damage` do **đúng nhân vật đang gắn artifact này** gây ra (`resolver.ts`) — sau khi trừ hp mục tiêu, cộng thêm `round(finalDamage × percent)` vào hp của chính họ (không vượt `maxHp`).
- **`dodgeChance`**: roll **trước** bước tính `finalDamage` khi quái nhắm `damage` vào **đúng nhân vật đang gắn artifact này** — trúng thì bỏ qua toàn bộ effect (damage = 0, không chỉ giảm), khác hẳn accuracy-roll theo fear đã có (`04-fear-combat.md` mục 4, vốn chỉ áp cho skill nhân vật nhắm địch, không áp cho đòn quái nhắm nhân vật). Quái nhắm vào đồng đội khác của họ thì không roll dodge này.
- **`healOnKill`**: hook ở đúng điểm 1 quái bị loại khỏi `CombatState.combatants` (hp ≤ 0) — **chỉ trigger nếu đòn kết liễu (effect `damage` cuối cùng khiến hp ≤ 0) do đúng nhân vật đang gắn artifact này gây ra**, hồi thẳng `amount` cho chính họ (không vượt `maxHp`, không phải cho đồng đội khác).
- **`expBoost`**: nhân thêm vào bước `applyPartyExp` nhận `expGained` từ `game.ts` (`06-level-system.md` §6.9) — `expGained = round(expGained × (1 + tổng percent của mọi artifact expBoost đang được trang bị bởi bất kỳ ai trong party))`. Đây là **hiệu ứng duy nhất không giới hạn theo người gây kill** — `partyExp` là 1 giá trị dùng chung cho cả đội (§6.9).
- **`fearResist`**: nhân vào **fear-gain theo round combat** của **đúng nhân vật đang gắn artifact này** (`fearGainForRound` — `03-survival-stats.md` mục 3) — theo `fear_thật = round(fear_gốc × (1 − tổng percent))`, không áp cho fear giảm chủ động (skill Acolyte/item không đổi, tính đủ 100%) hay relief thắng trận. Đồng đội không gắn artifact này vẫn nhận fear đầy đủ như bình thường.
- **`cooldownReduction`**: trừ thẳng vào `cooldownTurns` được gán lúc 1 skill của **đúng nhân vật đang gắn artifact này** vào cooldown (`Character.cooldownsRemaining[skillId] = skill.cooldownTurns − tổng turns`, tối thiểu 0) — không hồi ngay skill đang cooldown sẵn có từ trước khi gắn artifact, không ảnh hưởng cooldown của đồng đội khác.
- **`survivalDrainReduction`**: nhân vào tốc độ giảm gốc mỗi hành động của **đúng nhân vật đang gắn artifact này** (`03-survival-stats.md` mục 3: `hunger -1`, `thirst -1.5`, vốn đã tính riêng từng `Character.survival`) — `giảm_thật = round(giảm_gốc × (1 − tổng percent), 1 chữ số thập phân)`.
