# §9. Currency — Cursed Coins

*(section 9 of `00-index.md`)*

**Source of truth for every number below**: `data/balance-config.json` fields `currency`/`events`, read into `src/data/currency.ts`/`src/engine/events/*.ts`.

A single resource, separate from `partyExp`/`inventory`, tracked as `GameState.coins: number` — **party-wide, shared** (like `partyExp`, not per-character). Earned exclusively from combat kills, spent in 3 specific event rooms as an alternative to paying with HP.

## 9.1 Drop rule

**100% drop chance on every monster kill** (regular, Elite, and Boss alike) — unlike Items (`07-items-artifacts.md` §7.1, gated by `items.itemDropChance`), coins always drop. Amount depends on the monster's power, using a dedicated tier table rather than being derived from `expReward` (which already carries its own floor-depth/elite/boss scaling for a different purpose).

**Flat by tier, no floor-depth growth** — the amount is tied to how strong/weak the monster is, not to floor depth, keeping the coin economy roughly stable across the whole run rather than inflating late-game.

| Monster group | Coin drop (per kill) |
|---|---|
| `powerTier: "weak"` | 4–6 |
| `powerTier: "medium"` | 7–8 |
| `powerTier: "strong"` | 9–11 |
| Elite | 13–15 |
| Boss | 26–30 |

Config: `currency.coinDropByTier: { weak: [min,max], medium: [min,max], strong: [min,max], elite: [min,max], boss: [min,max] }` (`data/balance-config.json`), read by `rollCoinDrop(monster, rng)` (`src/data/currency.ts`) — same shape/spirit as `rollItemDrop`. A room with multiple monsters rolls coins independently per monster, same as Items. Awarded in `Game.resolve()`'s victory branch, alongside item drops and Artifact grants.

## 9.2 Spend — Merchant, Gambling Den, Wandering Hermit

Exactly 3 events accept coins; Blood Altar and Collapsed Floor stay HP-only (`08-events.md` §8.4, §8.9, §8.10 for the mechanics; this section only covers the currency side):

| Event | Cost |
|---|---|
| Merchant — purchase | `events.merchantPriceCoins` per rarity: Common 50 / Rare 70 / Unique 100 / Epic 150 |
| Merchant — Refresh offers | `events.merchantRefreshCostCoins` (10), up to `events.merchantMaxRefreshes` (3) per visit |
| Gambling Den — entry | `events.gamblingDenRounds[0].stake` (20) |
| Wandering Hermit — Exchange fortune | `events.wanderingHermitExchangeCostCoins` (50) |

An offer/action is locked (not just hidden) if the party can't afford it — coins can't go negative, unlike the HP-payment events, so this is a hard block rather than a per-character safety check.
