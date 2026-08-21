# darkest-terminal — Prototype

Prototype chơi được của thiết kế trong `./docs/design-doc.md` và
`./docs/*.md`: hầm ngục nhiều tầng random từ thuật toán sinh tầng, xuống tầng
khi hạ quái trấn giữ phòng cuối, party 4 nhân vật (chọn từ 4 class), nhiều
loại quái vật thường + elite/boss, combat round 2 pha (ra lệnh + thực thi
theo tốc độ), item/artifact/event room. Chạy bằng [Bun](https://bun.sh) +
[OpenTUI](https://github.com/anomalyco/opentui).

## Chạy thử

```bash
bun install
bun run start
```

Mở màn hình tiêu đề (splash screen) trước, nhấn phím bất kỳ để vào menu
**Chơi mới** / **Tiếp tục** (chỉ hiện khi đã có save). Chơi mới → chọn 4
class cho party (phím số để chọn/bỏ chọn, phím bất kỳ để xác nhận khi đủ 4).
Tiếp tục → chọn 1 trong các save có sẵn.

Điều khiển trong game: nhấn **số** để chọn (di chuyển phòng / kỹ năng / vật
phẩm / mục tiêu / lựa chọn rest room / event), nhấn phím bất kỳ để tiếp tục
sau khi 1 round kết thúc, **↑/↓** để cuộn nhật ký chiến đấu, **q** để thoát.

## Test

```bash
bun test        # unit test cho engine (resolver, combat, aggro, level, floor pattern, ...) +
                 # smoke test headless cho UI (giả lập bàn phím qua @opentui/core/testing)
bun run typecheck
bun run sprite-editor  # công cụ dev: chỉnh sprite pixel-art qua trình duyệt (tools/sprite-editor/)
```

## Nội dung đã implement

- **Nhiều tầng hầm ngục, xuống tầng thật** — mỗi tầng sinh bằng thuật toán runtime (xem "Cấu trúc tầng" bên dưới), luôn 1 lối vào + 1 phòng guard-room (elite/boss) cuối, không có ngõ cụt, mọi nhánh rẽ đều hội tụ về boss. Hạ quái trấn giữ phòng cuối tầng → sinh tầng kế ngay — không có trạng thái "thắng game" cố định, chơi được tới đâu hay tới đó — `src/data/floor.ts`, `src/data/floorPatterns.ts`, `src/engine/game.ts`
- **4 class** với 6 chỉ số + đòn đánh thường (slot 0, miễn phí) + skill riêng slot 1-2 (Vanguard, Mage, Rogue, Acolyte) — `src/data/classes.ts`
- **Chọn nhân vật đầu game + save/load** — party 4 nhân vật chọn thủ công từ 4 class ở màn character select; lưu/tiếp tục game qua danh sách save — `src/ui/characterSelect.ts`, `src/ui/saveSelect.ts`, `src/engine/save.ts`
- **11 loại quái thường** + **5 archetype guard-room** (dùng chung Skeleton Guard, cộng riêng cho elite/boss) trấn giữ phòng boss mỗi tầng, random chọn 1 trong 5 mỗi lần — `src/data/monsters.ts`
- **Combat 2 pha** (ra lệnh cả 4 nhân vật → thực thi theo tốc độ, quái quyết định tại chỗ), targeting theo `aggro` (random có trọng số), rule đổi/hủy mục tiêu khi target chết trước lượt — `src/engine/combat.ts`
- **Skill kit riêng cho Elite/Boss** (cả 5 archetype guard-room): đòn strike đơn mục tiêu + cleave AoE cho cả 2 tier; Boss thêm 1 debuff riêng theo archetype và cơ chế tích lực rồi tung sát thương cố định rất cao (Finishing Blow) — `data/monster-skills.json`, `src/engine/combat.ts`
- **Resolver `SkillEffect`** dùng chung skill/status-effect/item, buff/debuff qua `modifyCombatStat`, DoT tick cuối mỗi round — `src/engine/resolver.ts`
- **3 survival stat** (fear/hunger/thirst), HP=0 → permadeath thật, fear ảnh hưởng ngược combat theo 4 bậc — `src/engine/survival.ts`, `src/engine/resolver.ts`. Rest room cho 3 lựa chọn hồi phục.
- **Hệ thống level 1-100**: `attack`/`defense`/`maxHp`/`maxMp` tăng theo tier tapered qua `growthBonus()`, dùng chung cho nhân vật (theo `level`) và quái (theo `floorDepth`). Nhân vật còn nhân thêm `growthWeights` riêng theo class để 4 class không hội tụ giống nhau ở cấp cao. Level nhân vật (chung party, cap 100, tăng qua EXP giết quái) tách hoàn toàn khỏi level tầng ngục (`Floor.depth`, không giới hạn) — chi tiết ở [`docs/gameplay-decisions/06-level-system.md`](./docs/gameplay-decisions/06-level-system.md)
- **Item tiêu hao + Artifact trang bị** — item rơi từ quái, dùng trong/ngoài combat; artifact gắn vào 1 nhân vật cụ thể (tối đa 3/nhân vật), hiệu ứng chỉ tính cho người đang gắn — `src/data/items.ts`, `src/data/artifacts.ts`, `src/engine/artifacts.ts`, chi tiết ở [`docs/gameplay-decisions/07-items-artifacts.md`](./docs/gameplay-decisions/07-items-artifacts.md)
- **Event room** — phòng sự kiện random 1 trong nhiều loại sự kiện khi bước vào, chia 2 tier độ hiếm — `src/data/events.ts`, chi tiết ở [`docs/gameplay-decisions/08-events.md`](./docs/gameplay-decisions/08-events.md)
- **Màn hình tiêu đề (splash screen)** trước khi vào game — dựng bằng font chữ khối tự viết (`src/ui/bigText.ts`, `test/bigText.test.ts`) — `src/ui/mainMenu.ts`, `src/main.ts`

## Đã cắt khỏi scope (so với design doc đầy đủ)

Chưa implement: **4 mini-game** (Snake/Tetris/Brick Breaker/Magic Tiles — debuff chỉ hết hạn theo `durationTurns`, boss không có phase mini-game) và **FOV/pathfinding/rendering diff-based**. Xem mục "Định hướng tương lai" ở [`docs/design-doc.md`](./docs/design-doc.md) để biết spec đầy đủ của các phần này.

## Dữ liệu thiết kế (JSON)

Toàn bộ số liệu/nội dung nhân vật, quái, hiệu ứng, item, artifact, event,
sprite pixel-art, và text UI nằm trong `data/*.json` (không phải TypeScript)
— sửa số liệu hay thêm nội dung mới không cần đụng code, chỉ cần sửa JSON
đúng shape. Các module trong `src/data/`/`src/ui/sprites.ts` chỉ là lớp load
+ kiểm tra nhẹ rồi expose lại API (`getClass`, `getSkill`, `getArchetype`,
`getItem`, `getArtifact`, `getEvent`, `spriteForClass`, `t`, ...) — phần còn
lại của code không cần biết dữ liệu tới từ JSON.

| File | Nội dung | Loader |
|---|---|---|
| `data/classes.json` | 4 class (Vanguard/Mage/Rogue/Acolyte): chỉ số + đầy đủ 6 skill/class | `src/data/classes.ts` |
| `data/monsters.json` | 15 monster archetype (11 combat thường + 5 guard-room): chỉ số base + AI pattern + `guardOnly` flag | `src/data/monsters.ts` |
| `data/monster-skills.json` | Skill riêng Elite/Boss (strike/cleave/execute/debuff × 5 archetype guard-room) | `src/data/monsters.ts` |
| `data/status-effects.json` | Buff/debuff (`guard`, `taunt`, `rally`, `poison-coat`, `poisoned`, `burning`, `stunned`, `weakened`, ...) | `src/data/statusEffects.ts` |
| `data/items.json` | Item tiêu hao (10 item dùng chung + item đặc trưng theo archetype) | `src/data/items.ts` |
| `data/artifacts.json` | Artifact trang bị (nhiều bậc hiếm, nhiều loại hiệu ứng) | `src/data/artifacts.ts` |
| `data/events.json` | Sự kiện cho event room (2 tier độ hiếm) | `src/data/events.ts` |
| `data/level-growth.json` | Tier tốc độ tăng chỉ số theo level/depth + hệ số elite/boss + `expTiers` | `src/data/levelGrowth.ts` |
| `data/balance-config.json` | Hằng số cân bằng dùng chung (tỉ lệ rơi, trọng số, ngưỡng...) | `src/data/balanceConfig.ts` |
| `data/sprites.json` | Pixel-art (lưới ký tự + palette) cho 4 class + 15 monster archetype + 1 boss dùng chung | `src/ui/sprites.ts` |
| `data/strings.json` | Toàn bộ text hiển thị trong UI | `src/data/strings.ts` |

## Cấu trúc tầng — sinh runtime

Tầng được sinh trực tiếp bằng thuật toán ở runtime (`generateFloorLayout`,
`src/data/floorPatterns.ts`). Cấu trúc dựa trên khái niệm **stage** (cột):
**mọi phòng ở stage N nối tới tất cả phòng ở stage N+1**, không có cạnh nào
khác. Không có ngõ cụt, mọi nhánh rẽ đều hội tụ về boss.

Stage 0 luôn là lối vào (1 phòng), stage cuối luôn là phòng boss (1 phòng).
Ngã rẽ chèn thêm 1 phòng combat + 1 phòng event song song; phòng nghỉ (rest)
được rải ngẫu nhiên trên các stage còn lại. Luật chi tiết (số phòng tối
thiểu/tối đa, số ngã rẽ, khoảng cách giữa 2 ngã rẽ, ...) và invariant được
test bằng property-based test: **[`docs/technical-decisions.md`](./docs/technical-decisions.md)** mục 1.

Tên phòng, loại quái/số lượng quái mỗi phòng combat được random ở
`src/data/floor.ts` khi build layout thành `Floor` thật (dùng lại mỗi tầng,
`depth` tăng dần qua `Game.advanceToNextFloor()`) — layout chỉ quyết định
**cấu trúc**, không quyết định nội dung từng phòng.

## Giao diện

Trước khi vào game: màn hình tiêu đề (`src/ui/mainMenu.ts`) → chọn nhân vật
(`src/ui/characterSelect.ts`) hoặc chọn save (`src/ui/saveSelect.ts`). Trong
game: tông màu tối (nền `#100d0a`/panel `#171310`), mỗi nhân vật/quái có 1
"khối" màu riêng (chip nền màu + viết tắt, VD `VG` xanh thép cho Vanguard,
`GRD` xám xương cho Skeleton Guard, boss tô đỏ). HP đổi màu theo ngưỡng
(xanh/vàng/đỏ), fear từ bậc 2 trở lên mới hiện nhãn màu.

### Khung "Chiến Trường" — pixel art

Panel riêng ngay dưới header, hiện đoàn 4 nhân vật (trái) và quái/boss trong
phòng hiện tại (phải), dạng pixel: **1 pixel = 1 ô ký tự** (space + màu nền,
không dùng ký tự hiển thị). Nhân vật/quái thường cao tối đa **10 pixel**,
boss cao tối đa **13 pixel** (rộng hơn — 11 so với 9 cột); mọi đơn vị được
căn đáy trong 1 khung chung 13 pixel. Dưới mỗi sprite là 2 dòng chữ (viết
tắt + HP hiện tại) — chi tiết đầy đủ (tên dài, MP, hiệu ứng...) nằm ở panel
"Đoàn Thám Hiểm"/"Quái Vật" bên dưới. Dữ liệu sprite ở `src/ui/sprites.ts`,
có test riêng (`test/sprites.test.ts`) chặn lỗi lệch hàng/cột hoặc thiếu màu
trong palette. Chỉnh sprite trực quan qua trình duyệt bằng
`bun run sprite-editor` (`tools/sprite-editor/`) thay vì sửa tay lưới ký tự
trong JSON.

Panel này cần khá nhiều chiều cao (13 pixel + 3 dòng nhãn + viền ≈ 18 dòng),
cộng với các panel khác → nên dùng terminal **tối thiểu ~45-50 dòng cao**;
terminal thấp hơn sẽ bị cắt mất phần dưới của khung (nhãn/HP).

Các panel còn lại:
- **Đoàn Thám Hiểm**: mỗi nhân vật tối giản còn 2 dòng (tên+chip, HP/MP);
  dòng 3 chỉ xuất hiện khi có cảnh báo thật sự (fear ≥ bậc 2, đói/khát thấp,
  đang dính hiệu ứng)
- **Quái Vật**: danh sách quái đang giao chiến + HP, ẩn khi không có quái
  trong phòng
- **Nhật Ký**: 8 dòng cao, **cuộn được** (`↑`/`↓`, `ScrollBoxRenderable`,
  dính đáy mặc định) — giữ toàn bộ lịch sử log của cả ván

Toàn bộ theme/màu định nghĩa ở `src/ui/theme.ts` — đổi bảng màu hoặc thêm
class/quái mới thì chỉnh `PALETTE`/`CLASS_STYLE`/`MONSTER_STYLE` ở đó (và
thêm sprite tương ứng ở `src/ui/sprites.ts`).

## Cấu trúc code

```
data/                  # thiết kế dạng JSON — xem mục "Dữ liệu thiết kế" ở trên
  classes.json
  monsters.json
  monster-skills.json
  status-effects.json
  items.json
  artifacts.json
  events.json
  level-growth.json
  balance-config.json
  sprites.json
  strings.json
src/
  types.ts            # runtime types, đối chiếu ./dungeon-crawler-data-model.ts
  data/                # loader cho data/*.json + logic build (spawnMonster, sinh layout tầng, ...)
    floorPatterns.ts   # generateFloorLayout(rng) — sinh cấu trúc tầng ở runtime
    levelGrowth.ts      # growthBonus(stat, level) theo tier + hệ số elite/boss + expTiers
    balanceConfig.ts    # hằng số cân bằng dùng chung, đọc từ data/balance-config.json
    strings.ts          # loader text UI từ data/strings.json
  engine/              # logic thuần (rng, party, resolver, combat, survival, dungeon, artifacts, save, game) — test được không cần UI
  ui/theme.ts          # bảng màu + helper dựng StyledText (chip, màu theo HP/fear)
  ui/sprites.ts        # load sprite pixel-art từ JSON + render vào khung cố định
  ui/bigText.ts        # font chữ khối tự viết cho màn hình tiêu đề
  ui/mainMenu.ts        # màn hình tiêu đề, chờ phím bất kỳ rồi mới boot App
  ui/characterSelect.ts # chọn 4 class cho party khi bắt đầu game mới
  ui/saveSelect.ts      # chọn save để tiếp tục
  ui/app.ts            # OpenTUI: layout + bàn phím, chỉ đọc/ghi qua Game
  main.ts              # entry point thật (createCliRenderer → mainMenu → characterSelect/saveSelect → App)
tools/
  sprite-editor/        # dev tool: chỉnh sprite pixel-art qua trình duyệt (bun run sprite-editor)
test/
  engine.test.ts       # unit test engine, bao gồm 1 playthrough kịch bản đầy đủ
  ui.test.ts           # smoke test headless: boot + chơi hết ván qua bàn phím giả lập
  sprites.test.ts      # kích thước/palette từng sprite + hành vi renderSpriteInSlot
  bigText.test.ts      # font chữ khối: mọi glyph cùng chiều rộng theo hàng
  floorPatterns.test.ts # property-based test cho generateFloorLayout: luật rẽ nhánh, reachability, validator
  levelGrowth.test.ts  # bảng mốc 1-100 khớp docs, regression cho lỗi elite boss "gần bất tử"
```
