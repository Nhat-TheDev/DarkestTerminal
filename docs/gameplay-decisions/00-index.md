# Gameplay / Nội dung — Quyết định (mục lục)

**Trạng thái**: Đã chốt
**Liên quan**: `../design-doc.md` mục 1.3, 1.5, 1.6; `../../dungeon-crawler-data-model.ts`

Tài liệu này trước đây là 1 file `gameplay-decisions.md` duy nhất, đã tách theo từng mục lớn để dễ đọc/dễ sửa (2026-08-17) — số thứ tự mục (§1, §6.9, ...) **giữ nguyên không đổi** qua các file, chỉ nội dung được di chuyển sang file riêng theo đúng mục nó thuộc về. Khi 1 mục tham chiếu sang mục ở file khác, ghi rõ tên file + số mục (VD "xem `06-level-system.md` §6.9").

| File | Mục | Nội dung |
|---|---|---|
| [`01-class-skill.md`](./01-class-skill.md) | §1 | 4 class, 6 skill/class, status effects dùng bởi skill, ghi chú thiết kế combat |
| [`02-monster.md`](./02-monster.md) | §2 | Công thức scaling quái theo tầng, targeting theo aggro, 3 AI pattern, 3 cấp độ quái (thường/Elite/Boss) |
| [`03-survival-stats.md`](./03-survival-stats.md) | §3 | Ngưỡng số fear/hunger/thirst, 4 bậc fear |
| [`04-fear-combat.md`](./04-fear-combat.md) | §4 | Fear ảnh hưởng ngược lại combat, roll accuracy AoE, ultimate |
| [`05-character-stats.md`](./05-character-stats.md) | §5 | HP/MP hoạt động thế nào, tăng trưởng theo cấp |
| [`06-level-system.md`](./06-level-system.md) | §6 (6.1-6.12) | Hệ thống level 1-100, EXP, level tầng ngục vô hạn, Elite/Boss, skill riêng Elite/Boss |
| [`07-items-artifacts.md`](./07-items-artifacts.md) | §7 | Item tiêu hao + Artifact (relic vĩnh viễn trong run), độ hiếm, nguồn rơi, item đặc trưng theo quái |
| [`08-events.md`](./08-events.md) | §8 | Event room: 5 loại sự kiện (mở rương, đánh quái canh giữ, thương nhân, đổi HP lấy artifact, phá tế đàn) |

Các file khác trong `docs/` (`technical-decisions.md`, `minigame-decisions.md`) tham chiếu vào tài liệu này qua đường dẫn `gameplay-decisions/<file>.md §N` thay vì `gameplay-decisions.md §N` như trước.
