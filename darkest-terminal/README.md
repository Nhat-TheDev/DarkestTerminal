# darkest-terminal — Prototype

Prototype chơi được của thiết kế trong `../dungeon-crawler-design-doc.md` và
`../docs/*.md`: 1 tầng hầm ngục random từ thư viện pattern, 4 nhân vật, 3 loại
quái vật, combat round 2 pha (ra lệnh + thực thi theo tốc độ). Chạy bằng
[Bun](https://bun.sh) + [OpenTUI](https://github.com/anomalyco/opentui) như
tech stack đã chốt.

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

- **Tầng random từ thư viện pattern** (xem "Dữ liệu thiết kế" bên dưới): mỗi ván chọn ngẫu nhiên 1 trong 4 pattern có sẵn, luôn 1 lối vào + 1 phòng boss cuối, tối đa 2 lần rẽ nhánh, **không ngõ cụt** — `src/data/floor.ts`, `src/data/floorPatterns.ts`
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
- **Multi-floor / xuống tầng** — chỉ có 1 tầng/ván; hạ boss tầng đó là thắng luôn, chưa có khái niệm "xuống tầng kế"
- **FOV / pathfinding / rendering diff-based** — các rủi ro kỹ thuật nêu ở design doc mục 3 chưa cần tới ở quy mô 1 tầng, menu số

## Dữ liệu thiết kế (JSON)

Toàn bộ số liệu/nội dung nhân vật, quái, hiệu ứng, sprite pixel-art, và thư
viện pattern tầng nằm trong `data/*.json` (không phải TypeScript) — sửa số
liệu hay thêm nội dung mới **không cần đụng code**, chỉ cần sửa JSON đúng
shape. Các module trong `src/data/`/`src/ui/sprites.ts` chỉ là lớp load +
kiểm tra nhẹ (vd. class phải có đúng 5 skill) rồi expose lại đúng API cũ
(`getClass`, `getSkill`, `getArchetype`, `spriteForClass`, ...) — phần còn
lại của code không cần biết dữ liệu tới từ JSON.

| File | Nội dung | Loader |
|---|---|---|
| `data/classes.json` | 4 class: chỉ số + đầy đủ 5 skill/class | `src/data/classes.ts` |
| `data/monsters.json` | 3 monster archetype: chỉ số base + AI pattern | `src/data/monsters.ts` |
| `data/status-effects.json` | Buff/debuff (phong-thu, trung-doc, ...) | `src/data/statusEffects.ts` |
| `data/sprites.json` | Pixel-art (lưới ký tự + palette) cho 4 class + 3 quái + boss | `src/ui/sprites.ts` |
| `data/floor-patterns.json` | Thư viện pattern cấu trúc tầng (xem mục dưới) | `src/data/floorPatterns.ts` |

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
`src/data/floor.ts` khi build pattern thành `Floor` thật — pattern chỉ quyết
định **cấu trúc**, không quyết định nội dung từng phòng.

## Giao diện

Tông màu tối (nền `#100d0a`/panel `#171310`), mỗi nhân vật/quái có 1 "khối"
màu riêng (chip nền màu + viết tắt, VD `CV` xanh thép cho Cận Vệ, `XS` xám
xương cho Xương Sống Canh Gác, boss tô đỏ). HP đổi màu theo ngưỡng
(xanh/vàng/đỏ), fear từ bậc 2 trở lên mới hiện nhãn màu.

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
palette.

Panel này cần khá nhiều chiều cao (13 pixel + 3 dòng nhãn + viền ≈ 18 dòng),
cộng với các panel khác → nên dùng terminal **tối thiểu ~45-50 dòng cao**;
terminal thấp hơn sẽ bị cắt mất phần dưới của khung (nhãn/HP).

Các panel còn lại:
- **Đoàn Thám Hiểm**: mỗi nhân vật tối giản còn 2 dòng (tên+chip, HP/MP);
  dòng 3 chỉ xuất hiện khi có cảnh báo thật sự (fear ≥ bậc 2, đói/khát thấp,
  đang dính hiệu ứng)
- **Quái Vật**: danh sách quái đang giao chiến + HP, ẩn khi không có quái
  trong phòng
- **Nhật Ký**: thu nhỏ còn 5 dòng cao (trước là 10), chỉ hiện log của round
  vừa resolve thay vì dồn cả trận

Toàn bộ theme/màu định nghĩa ở `src/ui/theme.ts` — đổi bảng màu hoặc thêm
class/quái mới thì chỉnh `PALETTE`/`CLASS_STYLE`/`MONSTER_STYLE` ở đó
(và thêm sprite tương ứng ở `src/ui/sprites.ts`).

## Cấu trúc code

```
data/                  # thiết kế dạng JSON — xem mục "Dữ liệu thiết kế" ở trên
  classes.json
  monsters.json
  status-effects.json
  sprites.json
  floor-patterns.json
src/
  types.ts            # runtime types, đối chiếu ../dungeon-crawler-data-model.ts
  data/                # loader cho data/*.json + logic build (spawnMonster, parse/validate pattern, build Floor)
    floorPatterns.ts   # parser + validator cho notation "stage.roomId[tag]"
  engine/              # logic thuần (rng, party, resolver, combat, survival, dungeon, game) — test được không cần UI
  ui/theme.ts          # bảng màu + helper dựng StyledText (chip, màu theo HP/fear)
  ui/sprites.ts        # load sprite pixel-art từ JSON + render vào khung cố định
  ui/app.ts            # OpenTUI: layout + bàn phím, chỉ đọc/ghi qua Game
  main.ts              # entry point thật (createCliRenderer)
test/
  engine.test.ts       # unit test engine, bao gồm 1 playthrough kịch bản đầy đủ
  ui.test.ts           # smoke test headless: boot + chơi hết ván qua bàn phím giả lập
  sprites.test.ts      # kích thước/palette từng sprite + hành vi renderSpriteInSlot
  floorPatterns.test.ts # mọi pattern: luật rẽ nhánh, reachability, parser/validator edge case
```
