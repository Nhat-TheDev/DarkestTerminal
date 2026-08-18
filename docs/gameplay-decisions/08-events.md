# §8. Event Room

*(mục 8 của `00-index.md`)*

**Trạng thái: spec tài liệu, chưa implement** — cùng quy ước với `07-items-artifacts.md` lúc còn ở giai đoạn thiết kế. Mục này lấp khoảng trống mà `07-items-artifacts.md` §7.2 đã chỉ ra ở dòng "Treasure room/Event room hiện chưa có trong `data/floor-patterns.json`" — định nghĩa **Event room hoạt động ra sao**, tách khỏi Treasure room (Treasure room giữ nguyên spec cũ: 100% Artifact, không combat, không lựa chọn — xem `07-items-artifacts.md` §7.2 bảng "Nguồn rơi").

**Quy ước đặt tên**: `id` bằng tiếng Anh (khớp §7), mô tả/flavor text tiếng Việt.

---

## 8.1 Tổng quan cơ chế

Mỗi lần party bước vào 1 phòng có `RoomType === "event"`, hệ thống roll đều **1 trong 5 loại sự kiện**, 20%/loại, độc lập với tầng/trạng thái party:

| id | Tên | Combat? | Trả giá? | Phần thưởng |
|---|---|---|---|---|
| `open-chest` | Mở Rương | Không | Không | 1 Artifact, chắc chắn |
| `guardian-fight` | Đánh Quái Canh Giữ | Có | Không (rủi ro thua trận) | 1 Artifact nếu thắng |
| `merchant` | Gặp Thương Nhân | Không | HP (theo lựa chọn) | 1 Artifact cụ thể nếu mua |
| `blood-altar` | Đổi HP Lấy Artifact | Không | HP (cố định) | 1 Artifact ngẫu nhiên nếu trả |
| `desecrated-altar` | Phá Tế Đàn | Có | Không (rủi ro thua trận) | 1 Artifact nếu thắng |

Toàn bộ Artifact thưởng ở §8 dùng chung đúng 1 bảng độ hiếm 50/30/15/5% (Common/Rare/Unique/Epic) đã định nghĩa ở `07-items-artifacts.md` §7.2 "Độ hiếm & tỷ lệ rơi từng bậc" — không tạo bảng độ hiếm riêng cho Event room.

**Dữ liệu đề xuất**:

```
EventDefinition {
  id: Id
  name: string
  description: string
  kind: "instantReward" | "combatReward" | "merchant" | "hpGamble"
}
```

`guardian-fight` và `desecrated-altar` cùng dùng `kind: "combatReward"` — **cùng cơ chế xử lý ở engine, chỉ khác `id`/`name`/`description`** để tạo cảm giác đa dạng khi chơi nhiều run mà không nhân đôi logic combat-reward trong code.

---

## 8.2 Mở Rương (`open-chest`)

Không combat, không trả giá. Vào phòng → cho ngay **1 Artifact** roll theo bảng độ hiếm chuẩn, cộng vào `GameState.unequippedArtifactIds` — hệt cơ chế Treasure room ở `07-items-artifacts.md` §7.2, chỉ khác đây là 1 trong 5 kết quả có thể của Event room thay vì phòng riêng biệt.

---

## 8.3 Đánh Quái Canh Giữ (`guardian-fight`) & Phá Tế Đàn (`desecrated-altar`)

**Cơ chế chung** (`kind: "combatReward"`):

- Spawn **1-2 quái** từ đúng pool quái thường của tầng hiện tại (không phải Elite/Boss riêng — tái dùng `spawnMonster()` ở `src/data/monsters.ts:55-84`), scale thêm **+20% baseHp/baseAttack/baseDefense** so với mức spawn thường cùng tầng — nặng hơn combat room bình thường, nhẹ hơn hẳn Elite (không dùng `eliteSkillIds`).
- Thắng trận → chắc chắn **1 Artifact** roll theo bảng độ hiếm chuẩn.
- Thua trận / bỏ chạy → không có Artifact, áp dụng đúng hệ quả combat-loss hiện có của game (không có luật riêng cho Event room).

**Khác biệt duy nhất giữa 2 id**: flavor text.
- `guardian-fight`: "1 nhóm quái đang canh giữ báu vật trong phòng này."
- `desecrated-altar`: "Tế đàn phát sáng — hành động phá nó khiến quái canh giữ nổi giận và tấn công."

---

## 8.4 Gặp Thương Nhân (`merchant`)

Không combat. Khi vào phòng:

1. Roll sẵn **2-3 Artifact cụ thể** (mỗi cái roll độc lập 1 lần theo bảng độ hiếm chuẩn §7.2) — cố định cho lượt ghé phòng này, không đổi nếu rời rồi quay lại (nếu game cho phép quay lại phòng).
2. Mỗi offer hiển thị rõ **tên, mô tả, độ hiếm, giá HP** trước khi mua:

| Độ hiếm | Giá (% maxHP của nhân vật trả) |
|---|---|
| Common | 15% |
| Rare | 25% |
| Unique | 35% |
| Epic | 50% |

3. Người chơi chọn **1 nhân vật bất kỳ trong party** để trả giá (không nhất thiết là người sẽ gắn Artifact — Artifact vẫn vào kho chung `unequippedArtifactIds` như mọi nguồn khác, gắn cho ai là quyết định riêng ở màn hình quản lý đội).
4. Mua tối đa **1 offer** mỗi lượt ghé phòng, hoặc từ chối tất cả và rời đi tay không.
5. **Giới hạn an toàn**: nếu giá tính theo % maxHP ≥ HP hiện tại của nhân vật được chọn (tức sẽ khiến HP về 0 trở xuống), offer đó bị **khoá/ẩn** cho nhân vật đó — không thể giao dịch tới mức tử vong. Người chơi có thể đổi sang chọn nhân vật khác đủ HP, hoặc bỏ qua offer đó.

---

## 8.5 Đổi HP Lấy Artifact (`blood-altar`)

Không combat. Khi vào phòng, người chơi có thể:

- Chọn 1 nhân vật trong party, trả **cố định 25% maxHP** của nhân vật đó (làm tròn xuống) → nhận ngay **1 Artifact hoàn toàn ngẫu nhiên** theo đúng bảng độ hiếm chuẩn §7.2 (không biết trước sẽ nhận gì — khác Thương Nhân ở chỗ không thấy trước Artifact cụ thể).
- Hoặc từ chối, rời phòng không mất gì.

**Giới hạn an toàn**: cùng luật với Thương Nhân (§8.4 mục 5) — nếu 25% maxHP ≥ HP hiện tại của nhân vật đang chọn, lựa chọn "trả giá" bị khoá cho nhân vật đó cho tới khi chọn nhân vật khác đủ HP hoặc rời phòng.

---

## 8.6 Việc cần làm khi implement (ngoài scope tài liệu này)

Liệt kê lại đúng tinh thần ghi chú ở `07-items-artifacts.md` §7.2, áp dụng thêm cho Event room:

- `data/floor-patterns.json`: thêm tag phát sinh `RoomType "event"` (hiện tại `roomTypeForTag()` ở `src/data/floorPatterns.ts:17-33` đã map tag → `"event"` nhưng pattern generator chưa emit tag đó — xem `07-items-artifacts.md` dòng 137).
- `ROOM_SPAWN_STRATEGIES` ở `src/data/floor.ts:100-103`: hiện chỉ wire `combat`/`boss` — cần thêm nhánh cho `"event"` (không spawn quái sẵn khi tạo floor, quái của `guardian-fight`/`desecrated-altar` spawn **khi resolve loại event**, không phải lúc build floor, vì loại event chỉ roll ra lúc bước vào phòng).
- Cần 1 bước roll `EventDefinition` khi player `moveToRoom` (`src/engine/dungeon.ts:29`) vào phòng type `"event"`, lưu kết quả roll vào state của phòng đó (để không roll lại nếu quay lại phòng cũ, nếu game hỗ trợ quay lại).
- Item mới `grave-dust`/`venom-gland`/`rat-whisker`/`bat-fang`/`slime-core`/`dragon-scale` (xem `07-items-artifacts.md` §7.1 "Item đặc trưng theo quái") cần thêm vào `data/items.json` (file item catalog — chưa tồn tại, sẽ tạo cùng lúc implement toàn bộ §7).
- UI: màn hình cho `merchant` (hiện offer + giá + chọn nhân vật trả) và `blood-altar` (xác nhận trả giá + chọn nhân vật) — chưa có màn hình tương tự trong `src/ui/` hiện tại, cần thiết kế mới.

**⚠️ Toàn bộ số liệu ở §8 (roll đều 20%/loại, +20% stat quái combat-reward, giá HP theo độ hiếm 15/25/35/50%, mức cố định 25% cho Blood Altar) là đề xuất ban đầu — chưa playtest, sẽ cần chỉnh khi có dữ liệu chơi thật, giống mọi bảng số khác trong `docs/gameplay-decisions/`.**
