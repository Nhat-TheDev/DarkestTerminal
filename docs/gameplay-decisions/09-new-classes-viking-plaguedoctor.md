# §9. Class mới: Viking & Plague Doctor — công thức cân bằng base stats

*(mục 9 của `00-index.md`)*

**Đây là đề xuất thiết kế cho hướng mở rộng trong tương lai — chưa được xây dựng vào game.** Không có Viking hay Plague Doctor trong `data/classes.json` hiện tại (chỉ có 4 class: Vanguard, Mage, Rogue, Acolyte — `01-class-skill.md` mục 1), và schema hiện tại của `src/types.ts` chưa có 2 field mà thiết kế này cần (`onHitAoeDamage`, `conditionalBonus` — xem §9.3.2). Toàn bộ số liệu dưới đây (base stats, growthWeights, skill) là đề xuất ban đầu, chưa playtest, sẽ tinh chỉnh khi (và nếu) được đưa vào implement.

## 9.1 Công thức cân bằng base stats (`Balance Points`)

So sánh "class này mạnh/yếu hơn class kia bao nhiêu" ở base stats (level 1) không cộng thẳng `attack + defense + maxHp + maxMp + magicPower` — 1 điểm mỗi chỉ số không có giá trị ngang nhau.

**Nguồn quy đổi**: dùng đúng tốc độ tăng/lượt của **tier 1** trong bảng tăng trưởng dùng chung (`06-level-system.md` §6.3): `attack 3, defense 2, maxHp 14, maxMp 6, magicPower 3` (mỗi lượt lên cấp). Vì đây là 1 đường cong chung cho mọi class (trước khi nhân `growthWeights`), coi như thiết kế gốc đã tự định nghĩa **tỉ giá quy đổi**: 3 điểm `attack` ⇔ 2 điểm `defense` ⇔ 14 điểm `maxHp` ⇔ 6 điểm `maxMp` ⇔ 3 điểm `magicPower`, tất cả đều = **1 "điểm cân bằng"**.

**Công thức** (chia — không phải nhân):

```
BalancePoints = attack/3 + defense/2 + maxHp/14 + maxMp/6 + magicPower/3
```

`aggro`/`speed` không đưa vào công thức.

**Cách dùng**: tính `BalancePoints` cho base stats mọi class, so với trung bình cả nhóm — class nào lệch quá xa (kinh nghiệm áp dụng ở mục 9.2/9.3 dưới: ngưỡng cảnh báo ~±10%) là dấu hiệu base stats bị lệch, cần chỉnh trước khi đi vào giai đoạn playtest số liệu skill.

### Bảng đối chiếu 6 class (base stats, level 1)

| Class | attack | magicPower | defense | maxHp | maxMp | BalancePoints | Lệch so với TB |
|---|---|---|---|---|---|---|---|
| Vanguard | 14 | 0 | 10 | 140 | 20 | 23.00 | +0.4% |
| Mage | 6 | 14 | 4 | 70 | 60 | 23.67 | +3.3% |
| Rogue *(đã rebalance — 9.2)* | 16 | 0 | 6 | 109 | 40 | 22.79 | −0.4% |
| Acolyte | 6 | 10 | 8 | 100 | 50 | 24.81 | +8.4% |
| Viking *(mới — 9.3)* | 18 | 6 | 6 | 105 | 30 | 23.50 | +2.7% |
| Plague Doctor *(mới — 9.4)* | 4 | 13 | 6 | 85 | 60 | 24.74 | +8.1% |
| **Trung bình 6 class** | | | | | | **≈ 23.59** | |

## 9.2 Rebalance Rogue (base stats)

Base stats gốc của Rogue: `attack 16, defense 6, maxHp 90, maxMp 30, magicPower 0` (`BalancePoints = 19.76`).

**Chỉnh**: `maxHp` 90→**109**, `maxMp` 30→**40**, giữ nguyên `attack`/`defense`/`aggro`/`speed`/`magicPower`.

`growthWeights` của Rogue (`attack 1.7, magicPower 0.3, defense 0.9, maxHp 1.3, maxMp 0.8`, tổng 5.0 — `06-level-system.md` §6.8) **không đổi**, chỉ base stats thay đổi.

## 9.3 Viking — berserker lai vật lý/sấm sét, rủi ro cao/sát thương cực cao

### Base stats

| Class | attack | magicPower | defense | maxHp | maxMp | aggro | speed |
|---|---|---|---|---|---|---|---|
| Viking | 18 | 6 | 6 | 105 | 30 | 16 | 11 |

`magicPower` nuôi phần dmg của proc bị động `storm-empowered` (§9.3.2), không dùng để scale skill chủ động — toàn bộ skill chủ động của Viking là vật lý.

### growthWeights (tổng 5.0)

| Class | attack | magicPower | defense | maxHp | maxMp | Tổng | Vai trò |
|---|---|---|---|---|---|---|---|
| Viking | 1.5 | 0.9 | 0.7 | 1.2 | 0.7 | 5.0 | Berserker lai |

### 9.3.1 Bảng skill

Đòn đánh thường (slot 0, giống mọi class — `01-class-skill.md` mục 1.0): **Chém Rìu** (`viking-axe-slash`), vật lý, `damage 0`.

| Slot | Lvl | Skill id | Tên | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `viking-lightning-axe` | Rìu Sét | 8 | self | `applyStatusEffect "storm-empowered"` + `modifyCombatStat defense -4` + `modifyCombatStat aggro +8` | ✅ | 4 lượt |
| 2 | 1 | `viking-frenzied-slash` | Chém Cuồng Nộ | 5 | singleEnemy | `damage 9` (vật lý) + 50% `applyStatusEffect "bleeding"` — **conditionalBonus**: nếu đang mang `storm-empowered`, `ignoreDefensePercent +30` | — | — |
| 3 | 10 | `viking-throw-axe` | Ném Rìu | 9 | singleEnemy | `damage 16` (vật lý) — **conditionalBonus**: `ignoreDefensePercent +30` nếu có `storm-empowered` | — | 2 lượt |
| 4 | 20 | `viking-spin-axe` | Xoay Rìu | 14 | allEnemies | `damage 14`/địch + 30% `applyStatusEffect "bleeding"` — **conditionalBonus**: `ignoreDefensePercent +30` nếu có `storm-empowered` | — | 3 lượt |
| 5 | 35 | `viking-thunder-god-fury` | Thần Sấm Cuồng Nộ | 20 | allEnemies | `damage 32`/địch — **luôn trúng** (isUltimate), **conditionalBonus**: `ignoreDefensePercent +60` nếu có `storm-empowered`, **và tự huỷ `storm-empowered`** sau khi dùng | — | 5 lượt |

*Toàn bộ skill 2-5 là vật lý thuần (không `isMagic`) — sát thương phép của Viking chỉ đến gián tiếp qua proc `storm-empowered` (9.3.2), không qua công thức skill trực tiếp như Mage/Acolyte.*

### 9.3.2 Cơ chế mới cần thêm vào engine

Viking cần **2 field mới không có sẵn** trong schema hiện tại (`src/types.ts`) — đây là phần vượt ngoài phạm vi "chỉ thêm data":

**a) `onHitAoeDamage` trên `StatusEffectDefinition`** — buff tự gây sát thương diện rộng mỗi khi bearer đánh trúng (basic attack hoặc skill), tương tự cơ chế on-hit rider đã có (`onHitStatusEffectId`, dùng bởi `poison-coat` — `docs/technical-decisions.md` §4.2) nhưng gây damage AoE thay vì áp status đơn mục tiêu:

```ts
onHitAoeDamage?: { amount: number; isMagic?: boolean; ignoreDefensePercent?: number };
```

Status effect mới `storm-empowered`:
```json
{
  "id": "storm-empowered",
  "name": "Cuồng Phong Sấm Sét",
  "durationTurns": 3,
  "onHitAoeDamage": { "amount": 6, "isMagic": true, "ignoreDefensePercent": 30 },
  "curableByMiniGame": []
}
```

**b) `conditionalBonus` trên `SkillDefinition`** — cộng thêm `ignoreDefensePercent` vào các effect `damage` của skill *chỉ khi* caster đang mang 1 status chỉ định, có thể tự huỷ status đó sau khi dùng (dùng cho ultimate slot 5):

```ts
conditionalBonus?: {
  requiresStatusId: Id;
  ignoreDefensePercentBonus: number;
  consumesStatus?: boolean;
};
```

Đặt ở cấp `SkillDefinition` (không phải `SkillEffect`) — chỉ phát sinh khi điều kiện đúng.

Status mới `bleeding` (DoT vật lý, cấu trúc giống `poisoned`):
```json
{
  "id": "bleeding",
  "name": "Chảy Máu",
  "perTurnEffects": [{ "kind": "damage", "amount": 5 }],
  "durationTurns": 3,
  "curableByMiniGame": []
}
```

## 9.4 Plague Doctor — debuffer/support, ưu tiên hiệu ứng hơn dmg thuần

### Base stats

| Class | attack | magicPower | defense | maxHp | maxMp | aggro | speed |
|---|---|---|---|---|---|---|---|
| Plague Doctor | 4 | 13 | 6 | 85 | 60 | 8 | 11 |

Vai trò: debuffer diện rộng (bỏng/độc/mù/suy yếu), kèm 1 skill heal đơn và 1 ultimate lưỡng dụng heal+debuff.

### growthWeights (tổng 5.0)

| Class | attack | magicPower | defense | maxHp | maxMp | Tổng | Vai trò |
|---|---|---|---|---|---|---|---|
| Plague Doctor | 0.2 | 1.5 | 0.9 | 1.1 | 1.3 | 5.0 | Debuffer/support |

### Bảng skill

Đòn đánh thường (slot 0): **Ném Bình Thuốc** (`plaguedoc-vial-toss`), `isMagic: true`, `damage 0`.

| Slot | Lvl | Skill id | Tên | MP | Target | Hiệu ứng | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `plaguedoc-fire-vial` | Bình Lửa | 4 | singleEnemy | `damage 5` + 60% `applyStatusEffect "burning"` | — | — |
| 2 | 1 | `plaguedoc-healing-draught` | Thuốc Hồi Sinh | 6 | singleAlly | `heal 15` | — | — |
| 3 | 10 | `plaguedoc-blinding-vial` | Bình Mù Mắt | 7 | singleEnemy | `damage 4` + 70% `applyStatusEffect "blinded"` | — | 2 lượt |
| 4 | 20 | `plaguedoc-toxic-fog` | Sương Độc Lan Rộng | 12 | allEnemies | `damage 5`/địch + 60% `applyStatusEffect "poisoned"` + 40% `applyStatusEffect "weakened"` | — | 3 lượt |
| 5 | 35 | `plaguedoc-total-plague` | Đại Dịch Toàn Diện | 22 | allAllies **và** allEnemies cùng lúc | đồng đội → `heal 20` + `removeStatusEffect`; địch → `damage 10` + 80% `applyStatusEffect "poisoned"` + 80% `applyStatusEffect "burning"` — **luôn trúng** (isUltimate) | — | 5 lượt |

*Toàn bộ skill là `isMagic: true`. Skill 5 dùng `effectsByRelation` (2 phe) — cơ chế đã có sẵn, giống `acolyte-divine-descent` (`01-class-skill.md` mục 1.4).*

### Status effect mới cần thêm

`burning`, `poisoned`, `weakened` đã có sẵn (`01-class-skill.md` mục 1.5), tái sử dụng nguyên bản. Chỉ `blinded` là mới:

```json
{
  "id": "blinded",
  "name": "Mù Mắt",
  "durationTurns": 2,
  "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": -4 }],
  "curableByMiniGame": []
}
```

## Ghi chú chung — việc còn lại trước khi implement

- **Data-only**: thêm 2 class vào `data/classes.json`, cập nhật base stats Rogue, thêm status `bleeding`/`blinded` vào `data/status-effects.json`.
- **Cần đổi code** (`src/types.ts` + combat resolver): field `onHitAoeDamage` (StatusEffectDefinition) và `conditionalBonus` (SkillDefinition) — 2 field này chỉ phục vụ riêng Viking.
- Số liệu MP/damage/cooldown cần playtest trước khi chốt.
