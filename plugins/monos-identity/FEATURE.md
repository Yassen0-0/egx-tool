# monos-identity: هوية Monos

## هتعمل إيه
بتحط شعار Monos في شاشة المحادثة الفاضية (خانة `conversation.hero.brand.mark`). من غيرها، المضيف بيعرض شعاره الافتراضي اللي هو الحوت.

باقي الهوية في التطبيق نفسه، زي الاسم والأيقونة والقوائم ونوافذ About والتحديث، **مش جوه البلوجن ده**. دي بتيجي من سكربتات `scripts/`، لأن البلوجن ما يقدرش يوصلها:
- `scripts/rebrand-desktop.sh` بيبني `/Applications/Monos.app`، وبيقفل التحديث التلقائي، وبيعيد التوقيع.
- `scripts/asar-brand.py` بيعدّل نصوص الواجهة جوه `app.asar`.
- `scripts/strip-deepseek-profile.py` بيقفل إضافات DeepSeek في ملف الإعدادات.
- الشرح والتاريخ الكامل في `docs/REBRAND-MONOS.md`، وأصول الأيقونة في `assets/monos/`.

## شكلها
مربع أخضر `#37B77A` جواه خط صاعد أبيض. مقاسه 34px، وهو نفس رسمة `MonosIcon` في `shared/identity.js`.

## الاختبارات
- `render.test.mjs`: الخانة بتتسجل، والشعار بيبقى `svg`.
- `format.test.mjs`: مافيش ألوان hex غير لونين البراند.

## لو باظت
- **تقفلها:** `- id: monos-identity` ومعاه `disabled: true`. ساعتها الحوت هيرجع في المحادثة الفاضية بس.
- **لو مشكلة الهوية في التطبيق نفسه:**
  - شغّل `python3 scripts/asar-brand.py --check /Applications/Monos.app`. ده بيقولك اللي ناقص من غير ما يكتب أي حاجة.
  - أو اقفل التطبيق وشغّل `./scripts/rebrand-desktop.sh`.
