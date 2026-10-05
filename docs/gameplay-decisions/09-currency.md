# §9. Currency — Cursed Coins

*(section 9 of `00-index.md`)*

**Source of truth for every number below**: `data/balance-config.json` fields `currency`/`events`/`runner`, read into `src/data/currency.ts`/`src/engine/events/*.ts`.

A single resource, separate from `partyExp`/`inventory`, tracked as `GameState.coins: number` — **party-wide, shared** (like `partyExp`, not per-character). Earned from combat kills (and by selling items to the Runner, 9.3), spent in 3 specific event rooms as an alternative to paying with HP, and at the Rest room's Runner (9.3).

## 9.1 Drop rule

**100% drop chance on every monster kill** (regular, Elite, and Boss alike) — unlike Items (`07-items-artifacts.md` §7.1, gated by `items.itemDropChance`), coins always drop. Amount depends on the monster's power, using a dedicated tier table rather than being derived from `expReward` (which already carries its own floor-depth/elite/boss scaling for a different purpose).

**Flat by tier, no floor-depth growth** — the amount is tied to how strong/weak the monster is, not to floor depth, keeping the coin economy roughly stable across the whole run rather than inflating late-game.

<!-- docs:begin coinDropByTier -->
*Generated from `data/balance-config.json` (`currency.coinDropByTier`) by `bun run docs:sync`. Do not edit.*

| Monster group | Coin drop (per kill) |
|---|---|
| `powerTier: "weak"` | 4–6 |
| `powerTier: "medium"` | 7–8 |
| `powerTier: "strong"` | 9–11 |
| Elite | 13–15 |
| Boss | 26–30 |
<!-- docs:end -->

Config: `currency.coinDropByTier: { weak: [min,max], medium: [min,max], strong: [min,max], elite: [min,max], boss: [min,max] }` (`data/balance-config.json`), read by `rollCoinDrop(monster, rng)` (`src/data/currency.ts`) — same shape/spirit as `rollItemDrop`. A room with multiple monsters rolls coins independently per monster, same as Items. Awarded in `Game.resolve()`'s victory branch, alongside item drops and Artifact grants.

## 9.2 Spend — Merchant, Gambling Den, Wandering Hermit

Exactly 3 events accept coins; Blood Altar and Collapsed Floor stay HP-only (`08-events.md` §8.4, §8.9, §8.10 for the mechanics; this section only covers the currency side):

| Event | Cost |
|---|---|
| Merchant — purchase | `events.merchantPriceCoins` per rarity, in the table below |
| Merchant — Refresh offers | `events.merchantRefreshCostCoins` (10), up to `events.merchantMaxRefreshes` (3) per visit |
| Gambling Den — entry | `events.gamblingDenRounds[0].stake` (20) |
| Wandering Hermit — Exchange fortune | `events.wanderingHermitExchangeCostCoins` (50) |

Merchant purchase price by rarity:

<!-- docs:begin map path=events.merchantPriceCoins keyHeader=Rarity valueHeader=Cost -->
*Generated from `data/balance-config.json` by `bun run docs:sync`. Do not edit.*

| Rarity | Cost |
|---|---|
| Common | 50 |
| Rare | 70 |
| Unique | 100 |
| Epic | 150 |
<!-- docs:end -->

An offer/action is locked (not just hidden) if the party can't afford it — coins can't go negative, unlike the HP-payment events, so this is a hard block rather than a per-character safety check.

## 9.3 Spend and earn — the Merchant's Runner

The Rest room's Runner (`03-survival-stats.md`, "The Merchant's Runner") adds a fourth place coins are spent and a way to earn them. Every other sink has a flat price, and the Rest room, which every path crosses at least once, otherwise offers nothing to spend coins on. His prices are flat per tier too, but the tier of what he stocks climbs with floor depth, so the coin he can absorb grows with the run:

- **Shop** — 5 items per visit, singly or as a lot of 3 at a price set by the item's tier (`runner.priceByTier`, `data/balance-config.json`); Refresh uses the Merchant's cost and limit. Trophies appear as a rare offer.
- **Buyback** — he pays one fifth of the single price for consumables and trophies (`runner.buybackDivisor`), and refuses what he never sells (Legendary trophies, Exploration Kit). Selling is a coin source, small enough that buying and reselling never profits.

The "exactly 3 events accept coins" rule in 9.2 counts event rooms only; the Runner is not an event room.
