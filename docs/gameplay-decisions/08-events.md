# §8. Event Room

*(mục 8 của `00-index.md`)*

**Trạng thái: đã implement** — engine + data + UI đều đã code (xem `src/engine/dungeon.ts`, `src/engine/game.ts`, `src/data/events.ts`, `data/events.json`). Event room tách khỏi Treasure room (Treasure room giữ nguyên spec ở `07-items-artifacts.md` §7.2: 100% Artifact, không combat, không lựa chọn — nhưng floor generator hiện không sinh loại phòng đó, xem ghi chú ở §7.2).

**Quy ước đặt tên**: `id` bằng tiếng Anh (khớp §7), mô tả/flavor text tiếng Việt.

---

## 8.1 Tổng quan cơ chế

Mỗi lần party bước vào 1 phòng có `RoomType === "event"`, hệ thống roll **1 trong 11 loại sự kiện**, chia 2 tier, roll đều trong từng tier:

| Tier | Trọng số tổng | Roll đều/loại | Gồm |
|---|---|---|---|
| **Common** (nhẹ, quen thuộc, ít rẽ nhánh) | 65% | 16.25%/loại (4 loại) | `open-chest`, `guardian-fight`, `merchant`, `desecrated-altar` |
| **Rare** (nặng, có rủi ro/đánh đổi sâu) | 35% | 5%/loại (7 loại) | `blood-altar`, `cursed-shrine`, `twin-altars`, `sacrificial-circle`, `gambling-den`, `wandering-hermit`, `collapsed-floor` |

Roll độc lập với tầng/trạng thái party — không có logic đặc biệt cho tầng cao/thấp.

Toàn bộ Artifact thưởng ở §8 dùng chung đúng 1 bảng độ hiếm 50/30/15/5% (Common/Rare/Unique/Epic) đã định nghĩa ở `07-items-artifacts.md` §7.2 "Độ hiếm & tỷ lệ rơi từng bậc", **trừ khi event tự nêu bảng riêng** (VD `collapsed-floor` chỉ roll Unique/Epic, `sacrificial-circle` roll có sàn tier tối thiểu).

```
EventDefinition {
  id: Id
  name: string
  description: string
  kind: "instantReward" | "combatReward" | "merchant" | "hpGamble" | "choiceReveal" | "artifactExchange" | "rescueGamble"
  forceEquip?: boolean       // true chỉ cho twin-altars, xem §8.13
}
```

`guardian-fight` và `desecrated-altar` cùng dùng `kind: "combatReward"` — **cùng cơ chế xử lý ở engine, chỉ khác `id`/`name`/`description`** để tạo cảm giác đa dạng khi chơi nhiều run mà không nhân đôi logic combat-reward trong code. Tương tự, `cursed-shrine`/`twin-altars` dùng chung `kind: "choiceReveal"` (hiện thông tin trước khi quyết định); `sacrificial-circle`/`gambling-den`/`wandering-hermit` dùng chung `kind: "artifactExchange"` (thao tác trên artifact đã sở hữu thay vì roll mới đơn thuần).

---

## 8.2 Mở Rương (`open-chest`) — *Common*

> "Một chiếc rương gỗ sồi nứt nẻ nằm lệch giữa đống đá vụn, nắp hé mở như đang chờ ai đó đủ tò mò để lại gần."

Không combat, không trả giá. Vào phòng → cho ngay **1 Artifact** roll theo bảng độ hiếm chuẩn, cộng vào `GameState.unequippedArtifactIds` — hệt cơ chế Treasure room ở `07-items-artifacts.md` §7.2, chỉ khác đây là 1 trong 11 kết quả có thể của Event room thay vì phòng riêng biệt.

---

## 8.3 Đánh Quái Canh Giữ (`guardian-fight`) & Phá Tế Đàn (`desecrated-altar`) — *Common*

**Cơ chế chung** (`kind: "combatReward"`):

- Spawn **1-2 quái** từ đúng pool quái thường của tầng hiện tại (không phải Elite/Boss riêng — tái dùng `spawnMonster()` ở `src/data/monsters.ts:55-84`), scale thêm **+20% baseHp/baseAttack/baseDefense** so với mức spawn thường cùng tầng — nặng hơn combat room bình thường, nhẹ hơn hẳn Elite (không dùng `eliteSkillIds`).
- Thắng trận → chắc chắn **1 Artifact** roll theo bảng độ hiếm chuẩn.
- Thua trận / bỏ chạy → không có Artifact, áp dụng đúng hệ quả combat-loss hiện có của game (không có luật riêng cho Event room).

**Khác biệt duy nhất giữa 2 id**: flavor text.
- `guardian-fight`: "Tiếng móng vuốt cà lên đá vọng ra từ góc tối — thứ gì đó đang canh giữ báu vật trong phòng này, và nó vừa đánh hơi thấy các bạn."
- `desecrated-altar`: "Tế đàn đá rực lên thứ ánh sáng đỏ nhợt, phập phồng như đang thở — chạm vào nó chắc chắn sẽ đánh thức thứ đang ngủ bên dưới."

---

## 8.4 Gặp Thương Nhân (`merchant`) — *Common*

> "Ánh đèn dầu run rẩy hắt lên tấm vải trải đầy món hàng kỳ lạ. Một bóng người cúi đầu chào, tay vẫy nhẹ mời các bạn lại gần."

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

## 8.5 Đổi HP Lấy Artifact (`blood-altar`) — *Rare*

> "Những đường khắc cổ trên bệ đá rỉ ra thứ chất lỏng sẫm màu, vẫn còn ấm. Nó đòi một cái giá bằng máu, không hơn không kém."

Không combat. Khi vào phòng, người chơi có thể:

- Chọn 1 nhân vật trong party, trả **cố định 25% maxHP** của nhân vật đó (làm tròn xuống) → nhận ngay **1 Artifact hoàn toàn ngẫu nhiên** theo đúng bảng độ hiếm chuẩn §7.2 (không biết trước sẽ nhận gì — khác Thương Nhân ở chỗ không thấy trước Artifact cụ thể).
- Hoặc từ chối, rời phòng không mất gì.

**Giới hạn an toàn**: cùng luật với Thương Nhân (§8.4 mục 5) — nếu 25% maxHP ≥ HP hiện tại của nhân vật đang chọn, lựa chọn "trả giá" bị khoá cho nhân vật đó cho tới khi chọn nhân vật khác đủ HP hoặc rời phòng.

---

## 8.6 Cơ chế nền mới — Cursed Artifact

6 event mới ở §8.7–8.12 cần 1 khái niệm chưa tồn tại trong `07-items-artifacts.md` §7.2: **Artifact có effect âm**. Mở rộng schema:

```
ArtifactDefinition {
  ...
  isCursed?: boolean   // true = artifact có ≥1 effect âm, hiển thị cảnh báo khi offer ở event
}
```

Không cần thêm `ArtifactEffect` kind mới — tái dùng field có sẵn với giá trị âm/nghịch đảo:

| Effect | Cách dùng cho Cursed |
|---|---|
| `statBoost` | `amount` âm (VD `maxHp -20`) — tái dùng nguyên field |
| `curseAggroBoost` | `{ kind: "curseAggroBoost"; amount: number }` — cộng aggro cho nhân vật đang gắn, quái ưu tiên nhắm người này |
| `curseDrainBoost` | `{ kind: "curseDrainBoost"; percent: number }` — nghịch đảo `survivalDrainReduction`, tăng tốc độ giảm hunger/thirst |

**Catalog gợi ý — 4 Cursed Artifact**, mỗi cái luôn ghép 1 effect âm + 1 effect dương mạnh hơn mức thường (tension "được cái này mất cái kia", không phải trap thuần tuý):

| id | Name | Effect âm | Effect dương bù lại |
|---|---|---|---|
| `blackened-locket` | Blackened Locket | `statBoost maxHp -20` | `statBoost attack +10` |
| `shackle-of-hunger` | Shackle of Hunger | `curseDrainBoost 30%` | `statBoost attack +8` |
| `unstable-core` | Unstable Core | `curseAggroBoost 25` | `statBoost maxMp +30` |
| `heavy-guilt` | Heavy Guilt | `statBoost defense -6` | `lifesteal 8%` |

Cursed Artifact **chiếm slot trang bị bình thường** — cái giá là tốn 1/3 slot của nhân vật, không mất gì thêm khi gắn. Chỉ xuất hiện qua `cursed-shrine` (§8.7) hoặc làm kết quả xui của `sacrificial-circle`/`gambling-den` nếu roll trúng đúng 4 id này trong pool chuẩn.

---

## 8.7 Đền Thờ Nguyền Rủa (`cursed-shrine`) — *Rare*

> "Bức tượng có 3 con mắt. Một trong số chúng đang mở."

**Không combat** (`kind: "choiceReveal"`). Roll sẵn **1 Artifact ngẫu nhiên có thể là Cursed** (30% rơi vào pool 4 Cursed Artifact ở §8.6, 70% roll bình thường theo bảng chuẩn) — **hiển thị rõ trước khi nhận** (khác `blood-altar` — thấy được artifact cụ thể, biết nó nguyền hay không, chỉ không biết trước sẽ ra gì cho tới khi roll xong 1 lần).

- Bước 1: roll, hiện kết quả (tên + toàn bộ effect, kể cả effect âm nếu có).
- Bước 2: người chơi chọn **Nhận** hoặc **Từ chối** (không mất gì nếu từ chối — không giống `blood-altar` phải trả trước).
- Nếu Nhận: vào kho chung như artifact thường, **optional-equip** theo quy tắc chung §8.13 (không bắt buộc gắn ngay, kể cả nếu là Cursed) — nguy cơ chỉ hiện thực khi người chơi chủ động trang bị sau.

---

## 8.8 Hai Bàn Thờ (`twin-altars`) — *Rare*

> "Hai bệ đá đối diện nhau. Chọn 1 — bệ còn lại vỡ vụn ngay khi bạn chạm bệ kia."

**Không combat** (`kind: "choiceReveal"`, `forceEquip: true` — event duy nhất bắt buộc trang bị ngay, xem §8.13). Không trả giá bằng resource — trả giá bằng cơ hội bỏ lỡ.

- Roll sẵn **2 Artifact cụ thể độc lập** (2 roll riêng theo bảng chuẩn), hiện đầy đủ tên/hiệu ứng/độ hiếm cả 2 cùng lúc.
- Chọn **đúng 1**, cái còn lại biến mất vĩnh viễn (không rời phòng rồi quay lại đổi ý — chọn xong phòng cleared ngay).
- **Không có lựa chọn "từ chối cả 2"** — đây là phòng buộc quyết định, khác mọi event khác trong game (điểm khác biệt chủ đích, không phải thiếu sót).
- Artifact được chọn **bắt buộc trang bị ngay** vào 1 nhân vật do người chơi chỉ định — nếu party đã đầy 12/12 slot, bắt buộc gỡ 1 artifact đang gắn (bất kỳ) để lấy chỗ (xem §8.13).

---

## 8.9 Vòng Nghi Lễ (`sacrificial-circle`) — *Rare*

> "Máu khô đã cũ trên đá. Vòng tròn không nhận lễ vật tầm thường — chỉ nhận thứ đã có phép."

**Không combat** (`kind: "artifactExchange"`). Hiến tế **1 Artifact** (từ kho chung hoặc đang gắn — nếu đang gắn thì tự gỡ trước khi hiến) để roll 1 Artifact mới, độ hiếm ràng buộc ở mức **bằng hoặc cao hơn** artifact hiến tế (renormalize bảng chuẩn 50/30/15/5, loại các tier thấp hơn ngưỡng):

| Hiến tế (tier) | Bảng roll kết quả |
|---|---|
| Common | Common 50% / Rare 30% / Unique 15% / Epic 5% *(= bảng gốc, không lợi gì — hiến Common chỉ để đổi vận nếu không cần giữ)* |
| Rare | Rare 60% / Unique 30% / Epic 10% |
| Unique | Unique 75% / Epic 25% |
| Epic | Epic 100% *(reroll sang 1 Epic khác trong catalog, không đổi tier)* |

Chọn artifact để hiến từ danh sách sở hữu (kho chung + đang gắn trên toàn party), xác nhận → roll ngay, kết quả **optional-equip** theo quy tắc chung §8.13. Không giới hạn số lần hiến tế trong 1 lượt ghé phòng nếu vẫn còn artifact để hiến — mỗi lần hiến/roll tính là 1 hành động riêng, có thể lặp lại tới khi hài lòng hoặc hết artifact.

---

## 8.10 Sòng Bạc Lang Thang (`gambling-den`) — *Rare*

> "Một gã lạ mặt xóc 3 chiếc cốc úp ngược, cười khẩy trong bóng tối. 'Đưa ta thứ ngươi có. Ta gấp đôi nó, hoặc giữ luôn.'"

**Không combat** (`kind: "artifactExchange"`). Cược **1 Artifact** — chỉ chọn từ kho chưa gắn (`unequippedArtifactIds`, không cược artifact đang gắn để tránh phải tự động gỡ) — để đổi lấy cơ hội nhân đôi cùng tier:

- Chọn 1 artifact chưa gắn, xác nhận cược.
- Roll 50/50:
  - **Thắng**: giữ nguyên artifact đã cược, **cộng thêm 1 Artifact khác roll trong đúng tier vừa cược** (VD cược Rare → thắng nhận thêm 1 Rare khác, không nhất thiết cùng id — nếu tier đó chỉ còn đúng id đã cược thì cho phép trùng).
  - **Thua**: **mất artifact đã cược** (rời khỏi kho vĩnh viễn), không nhận gì.
- Không có artifact chưa gắn nào → chỉ có thể rời đi.

Artifact thắng thêm **optional-equip** theo §8.13.

---

## 8.11 Ẩn Sĩ Lang Thang (`wandering-hermit`) — *Rare*

> "Ông già ngồi thiền giữa đống đổ nát, mắt nhắm nghiền. 'Ta không bán gì. Ta chỉ... trao đổi thôi.'"

**Không combat** (`kind: "artifactExchange"`), không tạo Artifact mới — dịch vụ tương tác với artifact đã có, lấp khoảng trống "lỡ gắn artifact nguyền rồi hối hận". Chọn đúng 1 trong các dịch vụ (miễn phí, dùng 1 lần/lượt ghé phòng):

| Dịch vụ | Điều kiện | Hiệu quả |
|---|---|---|
| Gỡ nguyền | Có ≥1 Cursed Artifact đang gắn trong party | Gỡ artifact đó khỏi nhân vật, artifact **biến mất hoàn toàn** (không về kho chung — cái giá là mất luôn, kể cả phần dương đi kèm) |
| Đổi vận | Có ≥1 Artifact bất kỳ (kho chung hoặc đang gắn) | Chọn 1 artifact, đổi lấy 1 Artifact ngẫu nhiên khác roll theo bảng chuẩn (không được chọn cái mới, giữ nguyên rủi ro "đổi mù") |
| *(không có gì để tương tác)* | — | Chỉ có thể rời đi |

Kết quả "Đổi vận" **optional-equip** theo §8.13.

---

## 8.12 Sàn Nhà Sập (`collapsed-floor`) — *Rare*

> "Một bước sai và cả người rơi xuống tầng dưới. Có tiếng rên yếu ớt vọng lên từ khe nứt — vẫn còn ai đó mắc kẹt."

Cơ chế cứu người: trả trước 1 mức HP cố định để thử cứu, kết quả quyết định có thưởng hay không.

- Chọn 1 nhân vật "trèo xuống cứu": trả **cố định 15% maxHP** của người đó (làm tròn xuống) — trả dù kết quả thế nào, đây là cái giá của việc thử.
- Roll 60/40:
  - **60% (cứu được)**: nhận **1 Artifact**, roll giới hạn trong {Unique, Epic} — dùng lại đúng tỷ lệ bảng Boss đã có ở `07-items-artifacts.md` §7.2 (Unique 65% / Epic 35%), không tạo bảng mới.
  - **40% (không kịp)**: không nhận gì thêm — chỉ mất 15% maxHP đã trả trước.
- Giới hạn an toàn: nếu 15% maxHP ≥ HP hiện tại của nhân vật được chọn, lựa chọn "Trèo xuống cứu" bị khoá cho người đó.
- Có thể bỏ qua từ đầu, không mất gì.

Artifact thưởng (nếu có) **optional-equip** theo §8.13.

---

## 8.13 Nhận Artifact từ Event — quy tắc trang bị

`07-items-artifacts.md` §7.2 định nghĩa artifact nhặt được luôn vào kho chung `unequippedArtifactIds` trước, gắn/gỡ là hành động rời, tự do, không giới hạn số lần, tối đa **3 artifact/nhân vật × 4 nhân vật = 12 slot toàn đội**.

**10/11 event** (mọi event trừ `twin-altars`): artifact vào thẳng kho chung, không có màn hình hỏi "gắn ngay hay để đó" riêng — người chơi gắn khi nào tuỳ ý ở màn hình quản lý đội (đã có sẵn, phím `a`). Đây là cách hiện thực đơn giản hơn so với việc làm 1 màn hình riêng ngay lúc nhận cho từng event, nhưng vẫn giữ đúng tinh thần "artifact là tài sản, gắn khi nào là quyền người chơi" của §7.2.

**`twin-altars` (`forceEquip: true`)** — event duy nhất bắt buộc trang bị ngay, không có lựa chọn "để đó":

- Sau khi chọn 1 trong 2 Artifact hiện ra, người chơi **bắt buộc chỉ định ngay 1 nhân vật** để gắn.
- Nhân vật được chỉ định đã đủ 3/3 slot → **bắt buộc** chọn 1 artifact đang gắn trên nhân vật đó để gỡ trước (không được né bằng cách chọn nhân vật khác đã đầy).
