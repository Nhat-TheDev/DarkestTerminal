# darkest-terminal — Prototype

Prototype chơi được của thiết kế trong `./docs/design-doc.md` và
`./docs/*.md`: hầm ngục nhiều tầng random từ thư viện pattern (xuống tầng khi
hạ quái trấn giữ phòng cuối), 4 nhân vật, nhiều loại quái vật thường +
elite/boss, combat round 2 pha (ra lệnh + thực thi theo tốc độ). Chạy bằng
[Bun](https://bun.sh) + [OpenTUI](https://github.com/anomalyco/opentui) như
tech stack đã chốt.

## Chạy thử

```bash
bun install
bun run start
```

Mở màn hình tiêu đề (splash screen) trước, nhấn phím bất kỳ để vào game
thật. Điều khiển trong game: nhấn **số** để chọn (di chuyển phòng / kỹ năng /
mục tiêu / lựa chọn rest room), nhấn phím bất kỳ để tiếp tục sau khi 1 round
kết thúc, **↑/↓** để cuộn nhật ký chiến đấu, **q** để thoát.

## Test

```bash
bun test        # unit test cho engine (resolver, combat, aggro, ...) +
                 # smoke test headless cho UI (giả lập bàn phím qua @opentui/core/testing)
bun run typecheck
bun run sprite-editor  # công cụ dev: chỉnh sprite pixel-art qua trình duyệt (tools/sprite-editor/)
```

## Nội dung đã implement

- **Nhiều tầng hầm ngục, xuống tầng thật** — mỗi tầng random 1 trong 4 pattern có sẵn (xem "Floor pattern" bên dưới), luôn 1 lối vào + 1 phòng guard-room (elite/boss) cuối, tối đa 2 lần rẽ nhánh, **không ngõ cụt**. Hạ quái trấn giữ phòng cuối tầng → sinh tầng kế ngay (`Game.advanceToNextFloor`, `docs/gameplay-decisions/06-level-system.md` §6.9) — không có trạng thái "thắng game" cố định, chơi được tới đâu hay tới đó (§6.10) — `src/data/floor.ts`, `src/data/floorPatterns.ts`, `src/engine/game.ts`
- **4 class** với 6 chỉ số + đòn đánh thường (slot 0, miễn phí) + skill riêng slot 1-2 (Vanguard, Mage, Rogue, Acolyte — id/name/skill đều tiếng Anh) — `src/data/classes.ts`
- **11 loại quái thường** (Dungeon Rat, Black Bat, Slime, Skeleton, Zombie, Snake, Lizard, Spider, Skeleton Archer, Skeleton Warrior, Skeleton Guard) + **5 archetype guard-room** (Skeleton Guard dùng chung, cộng Giant Spider/Dragon/Zombie Knight/Dark Knight riêng cho elite/boss) trấn giữ phòng boss mỗi tầng, random chọn 1 trong 5 mỗi lần — `src/data/monsters.ts`
- **Combat 2 pha** (ra lệnh cả 4 nhân vật → thực thi theo tốc độ, quái quyết định tại chỗ), targeting theo `aggro` (random có trọng số), rule đổi/hủy mục tiêu khi target chết trước lượt — `src/engine/combat.ts`
- **Skill kit riêng cho Elite/Boss** (`docs/gameplay-decisions/06-level-system.md` §6.12, cả 5 archetype guard-room): đòn strike đơn mục tiêu (mạnh hơn đòn thường) + cleave AoE (30%/lượt) cho cả 2 tier; riêng Boss thêm 1 debuff riêng theo archetype (sát thương + weakened/poisoned/burning/stunned, 30%/lượt) và Finishing Blow — tích lực 1 lượt (khoá mục tiêu theo aggro, log cảnh báo), lượt sau tung sát thương cố định rất cao, không dựa theo %HP mục tiêu — `data/monster-skills.json`, `src/engine/combat.ts`
- **Resolver `SkillEffect`** dùng chung skill/status-effect, buff/debuff qua `modifyCombatStat` (cài đặt 1 lần lúc áp, gỡ 1 lần lúc hết hạn), DoT (`poisoned`) tick cuối mỗi round — `src/engine/resolver.ts`
- **3 survival stat** (fear/hunger/thirst, khởi tạo 100/100/0 mọi class), HP=0 → permadeath thật, fear ảnh hưởng ngược combat theo 4 bậc — `src/engine/survival.ts`, `src/engine/resolver.ts`. **Rest room** cho 3 lựa chọn (Ăn uống: +50% maxHp/maxMp; Trò chuyện: +10% maxHp/maxMp + fear -20; Bỏ qua) — **hiện không hồi `hunger`/`thirst`**, xem ghi chú lệch thiết kế ở `docs/gameplay-decisions/03-survival-stats.md` §3.
- **Hệ thống level 1-100, đã implement và đang chạy trong game** (`docs/gameplay-decisions/06-level-system.md` §6): `attack`/`defense`/`maxHp`/`maxMp` tăng theo 5 tier tapered (nhanh dần chậm lại, không tuyến tính) qua `growthBonus()` — dùng chung cho `createCharacter` (theo `level`) và `spawnMonster` (theo `floorDepth`, cùng công thức). Nhân vật còn nhân thêm `growthWeights` riêng theo class (§6.8, `classGrowthBonus()`) — VD Vanguard dồn tăng trưởng vào defense/maxHp, Mage dồn vào attack/maxMp — để 4 class không "hội tụ" thành giống nhau ở cấp cao; quái vật vẫn dùng `growthBonus()` không trọng số. Boss dùng hệ số elite bất đối xứng (`maxHp×2.5, attack×1.4, defense×1.15`) thay vì nhân đều ×2 mọi chỉ số — bản cũ khiến defense boss ở tầng sâu gần bằng tổng sát thương, gần bất tử. Level nhân vật (chung party, cap 100, tăng qua EXP giết quái) tách hoàn toàn khỏi level tầng ngục (`Floor.depth`, không giới hạn, tăng khi hạ guard-room) — `Game.resolve()` gọi `applyPartyExp` ngay sau mỗi trận thắng, `Game.advanceToNextFloor()` sinh tầng kế khi hạ guard-room (§6.9).
- **Màn hình tiêu đề (splash screen)** trước khi vào game — dựng bằng font chữ khối tự viết (`src/ui/bigText.ts`, `test/bigText.test.ts`) — `src/ui/mainMenu.ts`, `src/main.ts`

## Đã cắt khỏi scope (so với design doc đầy đủ)

Để giữ prototype gọn và chơi được trong thời gian ngắn, các phần sau **chưa** implement:

- **4 mini-game** (Snake/Tetris/Brick Breaker/Magic Tiles) — không có debuff nào được "chữa" qua mini-game, debuff chỉ hết hạn theo `durationTurns`; boss cũng không có phase mini-game, chỉ là combat turn-based thuần
- **Item/inventory** — không có `ItemDefinition`, không nhặt/dùng vật phẩm. Spec đầy đủ (10 item tiêu hao + 30 Artifact **trang bị** — tối đa 3/nhân vật, hiệu ứng chỉ tính cho người đang gắn — 11 loại hiệu ứng, 4 bậc hiếm, nguồn rơi Elite/Boss/Treasure/Event room) đã viết ở `docs/gameplay-decisions/07-items-artifacts.md` §7 — chưa implement.
- **Treasure room / Event room** — 2 loại phòng mới cần cho nguồn rơi Artifact (`07-items-artifacts.md` §7) chưa có trong `data/floor-patterns.json` (hiện chỉ 3 tag: combat rỗng, `free`/rest, `boss`).
- **FOV / pathfinding / rendering diff-based** — các rủi ro kỹ thuật nêu ở design doc mục 3 chưa cần tới ở quy mô hiện tại, menu số

**Đã implement từ bản trước** (từng nằm trong danh sách này): **multi-floor / xuống tầng thật** — xem bullet đầu tiên ở "Nội dung đã implement" — không còn giới hạn "1 tầng/ván" như bản gốc.

## Dữ liệu thiết kế (JSON)

Toàn bộ số liệu/nội dung nhân vật, quái, hiệu ứng, sprite pixel-art, và thư
viện pattern tầng nằm trong `data/*.json` (không phải TypeScript) — sửa số
liệu hay thêm nội dung mới **không cần đụng code**, chỉ cần sửa JSON đúng
shape. Các module trong `src/data/`/`src/ui/sprites.ts` chỉ là lớp load +
kiểm tra nhẹ (vd. class phải có đúng 6 skill: 1 đánh thường + 5 riêng) rồi
expose lại đúng API cũ (`getClass`, `getSkill`, `getArchetype`,
`spriteForClass`, ...) — phần còn lại của code không cần biết dữ liệu tới từ
JSON.

| File | Nội dung | Loader |
|---|---|---|
| `data/classes.json` | 4 class (id/name tiếng Anh: Vanguard/Mage/Rogue/Acolyte): chỉ số + đầy đủ 6 skill/class (1 đánh thường + 5 riêng) | `src/data/classes.ts` |
| `data/monsters.json` | 15 monster archetype (11 combat thường + 5 guard-room, Skeleton Guard thuộc cả 2): chỉ số base + AI pattern + `guardOnly` flag | `src/data/monsters.ts` |
| `data/monster-skills.json` | 20 skill riêng Elite/Boss (strike/cleave/execute/debuff × 5 archetype guard-room) | `src/data/monsters.ts` |
| `data/status-effects.json` | Buff/debuff (id/name tiếng Anh: `guard`, `taunt`, `rally`, `poison-coat`, `poisoned`, `burning`, `stunned`, `weakened`, ...) | `src/data/statusEffects.ts` |
| `data/sprites.json` | Pixel-art (lưới ký tự + palette) cho 4 class + 15 monster archetype + 1 boss dùng chung (elite/boss tier) | `src/ui/sprites.ts` |
| `data/floor-patterns.json` | Thư viện pattern cấu trúc tầng (xem mục dưới) | `src/data/floorPatterns.ts` |
| `data/level-growth.json` | 5 tier tốc độ tăng chỉ số theo level/depth + hệ số elite/boss + `expTiers` (20 bucket 5-level, ngưỡng EXP lên cấp) — **đã implement**, không còn chỉ là spec | `src/data/levelGrowth.ts` |

## Floor pattern — cấu trúc tầng dạng dữ liệu

Thay vì thuật toán sinh ngẫu nhiên (spanning tree — đã bỏ, xem
`docs/technical-decisions.md` §1 để biết lý do), tầng được chọn ngẫu nhiên từ
1 **thư viện pattern viết tay**, lưu ở `data/floor-patterns.json`. Mỗi pattern
là 1 chuỗi `layout`:

```
0.1[]-1.2[],1.3[],1.4[]-2.5[]-3.6[free]-4.7[boss]
```

- Tách theo `-` = các **stage** (cột), theo thứ tự 0,1,2,...
- Trong 1 stage, các phòng cách nhau bằng `,`
- Mỗi phòng: `stage.roomId[tag]` — `tag` rỗng = phòng combat, `free` = phòng
  nghỉ, `boss` = phòng boss (bắt buộc là phòng duy nhất ở stage cuối)
- **Mọi phòng ở stage N nối tới tất cả phòng ở stage N+1**, không có cạnh
  nào khác (không nối lùi, không nối tắt) — nhờ vậy **không thể có ngõ cụt**
  và **mọi nhánh rẽ đều tự hội tụ về boss**, đúng yêu cầu, mà không cần thuật
  toán validate riêng.

Luật khi thêm pattern mới (bị chặn bởi `validatePattern` ở
`src/data/floorPatterns.ts`, có test ở `test/floorPatterns.test.ts`):
- Stage 0 đúng 1 phòng (lối vào).
- Stage cuối đúng 1 phòng, tag `boss`.
- **Tối đa 2 stage có nhiều hơn 1 phòng** (tối đa 2 lần rẽ nhánh).
- `roomId` không trùng trong cùng pattern.

Tên phòng, loại quái/số lượng quái mỗi phòng combat được random ở
`src/data/floor.ts` khi build pattern thành `Floor` thật (dùng lại **mỗi
tầng**, không chỉ tầng đầu — `depth` truyền vào `createFloor` tăng dần qua
`Game.advanceToNextFloor()`) — pattern chỉ quyết định **cấu trúc**, không
quyết định nội dung từng phòng.

## Giao diện

Mở màn hình tiêu đề (`src/ui/mainMenu.ts`) trước khi vào game — nhấn phím bất
kỳ để bắt đầu. Trong game: tông màu tối (nền `#100d0a`/panel `#171310`), mỗi
nhân vật/quái có 1 "khối" màu riêng (chip nền màu + viết tắt, VD `VG` xanh
thép cho Vanguard, `GRD` xám xương cho Skeleton Guard, boss tô đỏ). HP đổi
màu theo ngưỡng (xanh/vàng/đỏ), fear từ bậc 2 trở lên mới hiện nhãn màu.

### Khung "Chiến Trường" — pixel art

Panel riêng ngay dưới header, hiện đoàn 4 nhân vật (trái) và quái/boss trong
phòng hiện tại (phải), dạng pixel: **1 pixel = 1 ô ký tự** (space + màu nền,
không dùng ký tự hiển thị) — kích thước pixel là lựa chọn thiết kế, chọn 1:1
để giữ khung gọn thay vì nhân đôi bề ngang cho "vuông" hơn. Nhân vật/quái
thường cao tối đa **10 pixel**, boss cao tối đa **13 pixel** (rộng hơn — 11
so với 9 cột); mọi đơn vị được **căn đáy** trong 1 khung chung 13 pixel nên
dù cao thấp khác nhau vẫn "đứng chung 1 mặt đất". Dưới mỗi sprite là 2 dòng
chữ (viết tắt + HP hiện tại) — chi tiết đầy đủ (tên dài, MP, hiệu ứng...) vẫn
nằm ở panel "Đoàn Thám Hiểm"/"Quái Vật" bên dưới, khung pixel chỉ để nhìn
nhanh. Dữ liệu sprite (lưới ký tự → màu hex) ở `src/ui/sprites.ts`, có test
riêng (`test/sprites.test.ts`) chặn lỗi lệch hàng/cột hoặc thiếu màu trong
palette. Chỉnh sprite trực quan qua trình duyệt bằng `bun run sprite-editor`
(`tools/sprite-editor/`) thay vì sửa tay lưới ký tự trong JSON.

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
  dính đáy mặc định) — giữ toàn bộ lịch sử log của cả ván (`logHistory`,
  không reset qua các trận/tầng) thay vì chỉ hiện đúng round vừa resolve như
  bản trước

Toàn bộ theme/màu định nghĩa ở `src/ui/theme.ts` — đổi bảng màu hoặc thêm
class/quái mới thì chỉnh `PALETTE`/`CLASS_STYLE`/`MONSTER_STYLE` ở đó
(và thêm sprite tương ứng ở `src/ui/sprites.ts`).

## Cấu trúc code

```
data/                  # thiết kế dạng JSON — xem mục "Dữ liệu thiết kế" ở trên
  classes.json
  monsters.json
  monster-skills.json
  status-effects.json
  sprites.json
  floor-patterns.json
  level-growth.json
src/
  types.ts            # runtime types, đối chiếu ./dungeon-crawler-data-model.ts
  data/                # loader cho data/*.json + logic build (spawnMonster, parse/validate pattern, build Floor)
    floorPatterns.ts   # parser + validator cho notation "stage.roomId[tag]"
    levelGrowth.ts      # growthBonus(stat, level) 5-tier + hệ số elite/boss + expTiers — dùng chung character/monster
  engine/              # logic thuần (rng, party, resolver, combat, survival, dungeon, game) — test được không cần UI
  ui/theme.ts          # bảng màu + helper dựng StyledText (chip, màu theo HP/fear)
  ui/sprites.ts        # load sprite pixel-art từ JSON + render vào khung cố định
  ui/bigText.ts        # font chữ khối tự viết cho màn hình tiêu đề
  ui/mainMenu.ts        # màn hình tiêu đề, chờ phím bất kỳ rồi mới boot App
  ui/app.ts            # OpenTUI: layout + bàn phím, chỉ đọc/ghi qua Game
  main.ts              # entry point thật (createCliRenderer → mainMenu → App)
tools/
  sprite-editor/        # dev tool: chỉnh sprite pixel-art qua trình duyệt (bun run sprite-editor)
test/
  engine.test.ts       # unit test engine, bao gồm 1 playthrough kịch bản đầy đủ
  ui.test.ts           # smoke test headless: boot + chơi hết ván qua bàn phím giả lập
  sprites.test.ts      # kích thước/palette từng sprite + hành vi renderSpriteInSlot
  bigText.test.ts      # font chữ khối: mọi glyph cùng chiều rộng theo hàng
  floorPatterns.test.ts # mọi pattern: luật rẽ nhánh, reachability, parser/validator edge case
  levelGrowth.test.ts  # bảng mốc 1-100 khớp docs, regression cho lỗi elite boss "gần bất tử" đã sửa
```
