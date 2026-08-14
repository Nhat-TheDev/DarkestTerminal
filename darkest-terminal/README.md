# darkest-terminal — Prototype

Prototype chơi được của thiết kế trong `../dungeon-crawler-design-doc.md` và
`../docs/*.md`: 1 tầng hầm ngục cố định, 4 nhân vật, 3 loại quái vật, combat
round 2 pha (ra lệnh + thực thi theo tốc độ). Chạy bằng [Bun](https://bun.sh)
+ [OpenTUI](https://github.com/anomalyco/opentui) như tech stack đã chốt.

## Chạy thử

```bash
bun install
bun run start
```

Điều khiển: nhấn **số** để chọn (di chuyển phòng / kỹ năng / mục tiêu),
nhấn phím bất kỳ để tiếp tục sau khi 1 round kết thúc, **q** để thoát.

## Test

```bash
bun test        # unit test cho engine (resolver, combat, aggro, ...) +
                 # smoke test headless cho UI (giả lập bàn phím qua @opentui/core/testing)
bun run typecheck
```

## Nội dung đã implement

- **7 phòng cố định** (không sinh procedural): 5 combat + 1 rest + 1 boss, dạng đồ thị rẽ nhánh — `src/data/floor.ts`
- **4 class** với 6 chỉ số + skill slot 0-1 (Cận Vệ, Pháp Sư Bóng Tối, Sát Thủ, Tu Sĩ) — `src/data/classes.ts`
- **3 loại quái** (Chuột Hầm Ngục, Dơi Đen, Xương Sống Canh Gác) + 1 biến thể "Đại Tướng" (elite, `isBoss: true`) trấn giữ phòng boss thay vì quái thứ 4 — `src/data/monsters.ts`
- **Combat 2 pha** (ra lệnh cả 4 nhân vật → thực thi theo tốc độ, quái quyết định tại chỗ), targeting theo `aggro` (random có trọng số), rule đổi/hủy mục tiêu khi target chết trước lượt — `src/engine/combat.ts`
- **Resolver `SkillEffect`** dùng chung skill/status-effect, buff/debuff qua `modifyCombatStat` (cài đặt 1 lần lúc áp, gỡ 1 lần lúc hết hạn), DoT (`trúng độc`) tick cuối mỗi round — `src/engine/resolver.ts`
- **3 survival stat** (fear/hunger/thirst, khởi tạo 100/100/0 mọi class), HP=0 → permadeath thật, fear ảnh hưởng ngược combat theo 4 bậc, rest room hồi đầy — `src/engine/survival.ts`, `src/engine/resolver.ts`
- **Level = min(floorDepth, 7)**: vì prototype chỉ có 1 tầng nên party giữ nguyên level 1 suốt ván (chỉ dùng được skill slot 0-1/mỗi class) — đúng thiết kế, không phải bug

## Đã cắt khỏi scope (so với design doc đầy đủ)

Để giữ prototype gọn và chơi được trong thời gian ngắn, các phần sau **chưa** implement:

- **4 mini-game** (Snake/Tetris/Brick Breaker/Magic Tiles) — không có debuff nào được "chữa" qua mini-game, debuff chỉ hết hạn theo `durationTurns`; boss cũng không có phase mini-game, chỉ là combat turn-based thuần
- **Item/inventory** — không có `ItemDefinition`, không nhặt/dùng vật phẩm
- **Procedural generation** — tầng duy nhất được viết tay (`src/data/floor.ts`), không dùng thuật toán ở `docs/technical-decisions.md` §1
- **FOV / pathfinding / rendering diff-based** — các rủi ro kỹ thuật nêu ở design doc mục 3 chưa cần tới ở quy mô 1 tầng, menu số

## Cấu trúc code

```
src/
  types.ts            # runtime types, đối chiếu ../dungeon-crawler-data-model.ts
  data/                # class/skill, monster, status effect, floor — dữ liệu tĩnh
  engine/              # logic thuần (rng, party, resolver, combat, survival, dungeon, game) — test được không cần UI
  ui/app.ts            # OpenTUI: layout + bàn phím, chỉ đọc/ghi qua Game
  main.ts              # entry point thật (createCliRenderer)
test/
  engine.test.ts       # unit test engine, bao gồm 1 playthrough kịch bản đầy đủ
  ui.test.ts           # smoke test headless: boot + chơi hết ván qua bàn phím giả lập
```
