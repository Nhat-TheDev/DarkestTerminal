# Điều gì khiến một game cuốn hút? — Phân tích áp dụng cho Darkest Terminal

**Mục đích tài liệu**: tổng hợp khung lý thuyết chung về "engagement" trong
game, sau đó soi chiếu vào các hệ thống hiện có của Darkest Terminal (đối
chiếu với [`design-doc.md`](./design-doc.md) và các file trong
[`gameplay-decisions/`](./gameplay-decisions/00-index.md)) để chỉ ra điểm
mạnh đang có và cơ hội cải thiện.

---

## 1. Khung phân tích chung: 8 trụ cột của sự cuốn hút

### 1.1 Core loop ngắn, rõ, nhưng không lặp vô nghĩa
Người chơi phải hiểu "tôi đang làm gì và tại sao" trong vài giây đầu, và vòng
lặp đó (di chuyển → đánh nhau → nhặt đồ → di chuyển tiếp) phải đủ ngắn để lặp
lại hàng chục lần mỗi phiên mà không thấy nhàm. Vòng lặp càng ngắn thì mỗi
lượt lặp càng cần có ít nhất một biến số thay đổi (bố cục tầng, quái, phần
thưởng) để không bị máy móc.

### 1.2 Phản hồi tức thời và rõ ràng (feedback / "juice")
Mọi hành động của người chơi cần một phản hồi ngay lập tức và dễ đọc: sát
thương hiện số, trạng thái đổi màu, log kể lại chuyện gì vừa xảy ra. Thiếu
phản hồi rõ = người chơi không chắc lựa chọn của mình có ý nghĩa gì, dẫn đến
mất kết nối cảm xúc với trò chơi.

### 1.3 Tiến triển & làm chủ (progression & mastery)
Người chơi cần cảm thấy mình *giỏi lên* — không chỉ nhân vật mạnh lên (level,
gear) mà cả người chơi hiểu hệ thống sâu hơn (thứ tự target, khi nào dùng kỹ
năng nào, cách đọc aggro). Đây là lý do các game roguelike sống lâu: cái chết
dạy người chơi điều gì đó cho lần chơi sau, chứ không chỉ là mất trắng.

### 1.4 Rủi ro – phần thưởng (risk/reward) và cái giá phải trả là thật
Một quyết định chỉ có ý nghĩa khi nó có cái giá. Permadeath, tài nguyên hữu
hạn, đánh đổi không thể hoàn tác — tất cả biến mỗi lựa chọn nhỏ thành một
khoảnh khắc căng thẳng thật sự, thay vì "cứ thử, sai thì load lại".

### 1.5 Phần thưởng biến thiên (variable rewards)
Loot ngẫu nhiên, tỉ lệ rơi đồ, event ngẫu nhiên... phần thưởng *không đoán
trước được hoàn toàn* nhưng vẫn nằm trong một khung xác suất người chơi có
thể cảm nhận được, là cơ chế tạo động lực chơi tiếp mạnh nhất (variable-ratio
reinforcement) — miễn là không lạm dụng đến mức thành ép người chơi "cày" vô
nghĩa.

### 1.6 Lựa chọn có ý nghĩa (meaningful choice) & tiếc nuối (loss aversion)
Lựa chọn hay nhất là lựa chọn *không có đáp án đúng tuyệt đối* và *không thể
sửa sai*. Cảm giác tiếc nuối sau một quyết định (mất mát tiềm năng) khiến
người chơi nhớ trận đấu đó lâu hơn nhiều so với một trận thắng suôn sẻ.

### 1.7 Đường cong khó tăng dần khớp kỹ năng (flow)
Độ khó phải leo thang song song với năng lực người chơi. Quá dễ → chán; quá
khó đột ngột → bỏ cuộc. Với game không có "màn cuối" (như dungeon crawler vô
tận), đường cong khó cần tăng *mượt và liên tục* vì không có điểm dừng tự
nhiên để reset kỳ vọng.

### 1.8 Ý nghĩa & bối cảnh (narrative/atmosphere)
Kể cả một game cơ chế thuần túy cũng cần một lớp "vì sao tôi quan tâm" — bầu
không khí, NPC lặp lại, một câu chuyện dù nhỏ giọt — để người chơi gắn bó về
mặt cảm xúc chứ không chỉ tối ưu số liệu.

---

## 2. Đối chiếu với Darkest Terminal — đang làm tốt điều gì

| Trụ cột | Hệ thống hiện có | Nhận xét |
|---|---|---|
| Core loop | Room → combat/event → room → rest → floor tiếp | Ngắn, rõ, có nhịp nghỉ (rest room) xen giữa để tránh mệt |
| Risk/reward thật | **True permadeath** (§1.2 design-doc) | Cái giá tối đa — không có gì "thật" hơn mất nhân vật vĩnh viễn |
| Lựa chọn có tiếc nuối | **Artifact**: quyết định equip/discard ngay lập tức, gần như không thể đổi (§1.6) | Đây là cơ chế loss-aversion rất mạnh — đúng công thức "không đáp án đúng tuyệt đối, không sửa sai" |
| Quản lý tài nguyên tạo căng thẳng liên tục | Fear (theo nhân vật) + Satiety (theo party) chảy song song với HP/MP | Hai đồng hồ đếm ngược buộc người chơi phải lên kế hoạch dài hạn, không chỉ combat từng trận |
| Tiến triển kép | Level nhân vật (EXP, có trần) tách biệt với độ sâu tầng (không trần) | Tạo áp lực "mình có đang xuống nhanh hơn khả năng không" — chính là cơ chế flow cho roguelike vô tận |
| Phần thưởng biến thiên | Drop rate item/artifact theo rarity, event room random theo tier, Gambling Den | Đủ lớp ngẫu nhiên nhưng vẫn có cấu trúc (tier) để người chơi đoán được kỳ vọng |
| Chiều sâu chiến thuật/mastery | Command phase mù (chọn hành động trước khi thấy quái làm gì) + speed order + aggro | Bắt người chơi phải *dự đoán* thay vì phản ứng — chiều sâu thật, không phải RNG thuần |
| Bối cảnh/ý nghĩa | Event room có narrative chains, NPC lặp lại nhiều lượt ghé | Vượt xa "flavor text" một lần, tạo cảm giác thế giới nhớ người chơi |

Đây là một bộ hệ thống rất tự nhất quán theo triết lý *roguelike cổ điển*:
mọi cuốn hút đến từ **rủi ro thật + thông tin không đầy đủ + tài nguyên hữu
hạn**, không dựa vào phần thưởng ảo hay ép buộc.

---

## 3. Khoảng trống / cơ hội tăng độ cuốn hút

### 3.1 Không có "meta-progression" giữa các lượt chơi
Vì permadeath là vĩnh viễn và không có gì tồn tại qua lượt chơi mới, người
chơi thua một run dài (ví dụ xuống tới tầng 20) có thể cảm thấy "mất trắng"
theo nghĩa tệ chứ không phải theo nghĩa "đau nhưng đáng" — khác với các
roguelike thành công gần đây (Hades, Slay the Spire) luôn có một lớp
unlock/progress nhỏ tồn tại qua cái chết (class mới, khởi đầu tốt hơn, lore
mở khóa) để biến "thua" thành "gần hơn một bước", không phải "về vạch xuất
phát tuyệt đối". Đây là đòn bẩy lớn nhất còn thiếu nếu mục tiêu là giữ chân
người chơi qua nhiều lượt chơi, chứ không phải một trải nghiệm one-shot.

### 3.2 Không có mốc thành tựu / checkpoint cảm nhận được
Vì tầng là vô hạn và "endless" theo thiết kế (`design-doc.md` §1.4: "không có
màn cuối"), người chơi không có điểm mốc rõ để so sánh bản thân qua các lượt
("lần này mình xuống sâu hơn lần trước 3 tầng"). Một số cột mốc nhẹ (ví dụ:
ghi nhận độ sâu kỷ lục, một câu thoại/sự kiện đặc biệt ở tầng 10/25/50) sẽ
cho người chơi một thước đo tiến bộ rõ ràng mà không phá vỡ triết lý "không
màn cuối".

### 3.3 Mini-game (đã có trong "Future direction" nhưng chưa cài đặt)
`minigame-decisions.md` đã spec 4 mini-game dùng để chữa debuff và làm boss
phase, nhưng chưa được nối vào game. Đây chính là cơ chế phá vỡ nhịp điệu
turn-based thuần túy — một khoảnh khắc đòi hỏi phản xạ/kỹ năng tay thay vì
chỉ ra quyết định, giúp đa dạng hoá "loại căng thẳng" mà người chơi trải
qua, tránh mệt mỏi vì combat lặp cùng một dạng tương tác suốt run.

### 3.4 Không có seed / chế độ chơi lại có kiểm soát
Vì tầng sinh ngẫu nhiên hoàn toàn runtime, không có cách nào để chia sẻ một
run cụ thể ("thử seed này xem, khó vãi") hoặc chạy lại một tầng để luyện kỹ
năng. Với một game phụ thuộc nhiều vào kỹ năng đọc tình huống + roster class,
seed sharing là cách rẻ để tạo động lực xã hội (so sánh, thử thách bạn bè)
mà không cần multiplayer thật.

### 3.5 Phản hồi trong môi trường terminal
Vì không có âm thanh và giới hạn ở màu/ký tự, "juice" phải dồn hết vào log
combat + màu sắc + pixel art (đã làm khá tốt theo README). Nhưng nên rà soát
xem những khoảnh khắc quan trọng nhất — hạ gục Boss, mất một nhân vật vĩnh
viễn, nhặt Artifact hiếm — có được nhấn nhá đủ mạnh (tạm dừng, màu riêng,
dòng chữ đặc biệt) để tương xứng với trọng lượng cảm xúc của chúng hay
không, so với một lần đánh thường.

### 3.6 Đường cong khó nên được theo dõi định lượng
Vì độ sâu tầng "scale độc lập với level nhân vật" (§1.4/§gameplay-decisions
06), đây là điểm dễ mất cân bằng nhất trong toàn bộ thiết kế: nếu tầng khó
lên nhanh hơn khả năng cày level một chút, flow sẽ vỡ theo hướng "quá khó
đột ngột" — đúng thứ giết chết roguelike nhanh nhất. Nên có dữ liệu thực tế
(win rate theo độ sâu tầng, tầng nào có tỉ lệ toàn diệt cao bất thường) chứ
không chỉ tin vào công thức lý thuyết trong `level-growth.json`.

---

## 4. Tóm tắt ưu tiên nếu muốn tăng engagement tiếp theo

1. **Cao nhất, đúng trọng tâm game**: thêm một lớp meta-progression nhẹ tồn
   tại qua permadeath (không phá vỡ "true permadeath" trong một run, chỉ
   thêm thứ tồn tại *giữa* các run).
2. **Rẻ, hiệu quả**: mốc độ sâu ghi nhận kỷ lục + một dòng phản hồi đặc biệt
   ở các tầng mốc.
3. **Đã có sẵn kế hoạch**: hoàn thiện mini-game để đa dạng hoá dạng tương
   tác.
4. **Về lâu dài**: cơ chế seed để tạo động lực chia sẻ/so sánh giữa người
   chơi mà không cần multiplayer.
5. **Bảo trì liên tục**: theo dõi số liệu win-rate theo tầng để giữ đường
   cong khó nằm trong vùng flow, đặc biệt vì level nhân vật và độ sâu tầng
   scale độc lập với nhau.
