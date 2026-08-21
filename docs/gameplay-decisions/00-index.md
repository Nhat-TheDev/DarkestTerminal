# Gameplay / Nội dung — Quyết định (mục lục)

**Liên quan**: `../design-doc.md` mục 1, `../../dungeon-crawler-data-model.ts`

Mỗi mục lớn tách ra 1 file riêng để dễ đọc/dễ sửa. Số thứ tự mục (§1, §6.9,
...) dùng để các file tham chiếu chéo lẫn nhau — VD "xem `06-level-system.md` §6.9".

| File | Mục | Nội dung |
|---|---|---|
| [`01-class-skill.md`](./01-class-skill.md) | §1 | 4 class, 6 skill/class, status effects dùng bởi skill |
| [`02-monster.md`](./02-monster.md) | §2 | Công thức scaling quái theo tầng, targeting theo aggro, AI pattern, 3 cấp độ quái (thường/Elite/Boss) |
| [`03-survival-stats.md`](./03-survival-stats.md) | §3 | Ngưỡng số fear/hunger/thirst, 4 bậc fear |
| [`04-fear-combat.md`](./04-fear-combat.md) | §4 | Fear ảnh hưởng ngược lại combat, roll accuracy AoE, ultimate |
| [`05-character-stats.md`](./05-character-stats.md) | §5 | HP/MP hoạt động thế nào, tăng trưởng theo cấp |
| [`06-level-system.md`](./06-level-system.md) | §6 | Hệ thống level 1-100, EXP, level tầng ngục vô hạn, Elite/Boss, skill riêng Elite/Boss |
| [`07-items-artifacts.md`](./07-items-artifacts.md) | §7 | Item tiêu hao + Artifact (relic vĩnh viễn trong run), độ hiếm, nguồn rơi |
| [`08-events.md`](./08-events.md) | §8 | Event room: các loại sự kiện chia theo tier độ hiếm |
| [`09-new-classes-viking-plaguedoctor.md`](./09-new-classes-viking-plaguedoctor.md) | §9 | **Chưa implement** — đề xuất 2 class mới Viking & Plague Doctor, xem "Định hướng tương lai" ở `../design-doc.md` |

Các file khác trong `docs/` (`technical-decisions.md`, `minigame-decisions.md`) tham chiếu vào tài liệu này qua đường dẫn `gameplay-decisions/<file>.md §N`.
