# monos-portfolio: المحفظة

## هتعمل إيه
بتعرض المحفظة اللي **إنت بتدخلها بنفسك**، ومافيش ربط بأي وسيط. لكل سهم: حركة اليوم الأول، وبعدين القيمة، والربح والخسارة، ونصيب السهم من المحفظة، وحالته مقابل تقييمه.

## شكلها
- الشريط الجانبي فيه خانة «المحفظة».
- كارت الملخص (`SummaryCard`): «اليوم» بخط كبير، وبعده القيمة الحالية، والربح والخسارة، والتكلفة، وحالة التقييم.
- فورم الإضافة (`AddForm`): بالكمية أو بالمبلغ، ومعاه الإجمالي وإنت بتكتب.
- جدول الأسهم (`HoldingRow`): تعديل وحذف، وترتيب (`HOLDING_SORTS`).
- بتستخدم ستايل الجدول من `shared/market.css`.

## هتتصرف إزاي
- البيانات من المخزن المشترك `monos` (`shared/identity.js`، وهو `pageShared`). عشان كده أيقونة «Monos» في الشريط الجانبي، اللي هي بلوجن `monos-market`، والمحفظة بيعرضوا نفس الرقم.
- بعد أي إضافة أو تعديل أو حذف، المخزن بيتحدث (`monos.refresh()`).
- «اليوم» بيتحسب من الأسعار الحديثة بس. السهم اللي سعره قديم أو مالوش سعر ما بيدخلش في الحساب.

## البيانات
بتقرا من `monos-core`:
- `GET /egx/api/portfolio`
- `/market`
- `/universe`

وبتكتب في:
- `POST /egx/api/holdings`
- `PATCH /egx/api/holdings/<id>`
- `DELETE /egx/api/holdings/<id>`

## الاختبارات
- `render.test.mjs`
- `host-routes.test.mjs`: مسارات `/holdings`.
- `mcp/tests/test_store.py` و`test_monos_data.py` و`test_cli.py`.

## لو باظت
- **تقفلها لوحدها:** `- id: monos-portfolio` ومعاه `disabled: true`. بياناتك في `data/egx.sqlite` ما بتتأثرش.
- **أمر للفحص:** `uv run --project mcp egx-cli portfolio-summary`.
