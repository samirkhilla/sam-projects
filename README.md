# Sam Projects — الإعلانات والتحديثات

ملفات التحكم في برامج **Sam** (سمير خلة للبرمجيات). كل برنامج بيقرا ملفه أول ما يفتح:

| البرنامج | ملف التحكم |
|---|---|
| SamFontAppearance | [SamFontAppearance.ini](SamFontAppearance.ini) |
| SamNews | [SamNews.ini](SamNews.ini) |
| SamSlideShow | [SamSlideShow.ini](SamSlideShow.ini) |
| SamStocks | [SamStocks.ini](SamStocks.ini) |
| SamWindowsUpdateControl | [SamWindowsUpdateControl.ini](SamWindowsUpdateControl.ini) |
| SamWindowsWasher | [SamWindowsWasher.ini](SamWindowsWasher.ini) |
| SamNetSpeed | [SamNetSpeed.ini](SamNetSpeed.ini) |
| SamDriverUpdate | [SamDriverUpdate.ini](SamDriverUpdate.ini) |
| SamUSBDoctor | [SamUSBDoctor.ini](SamUSBDoctor.ini) |

## إضافة إعلان لمعلن
1. ارفع صورة الإعلان في فولدر `ads` (مقاس 1280×720، jpg).
2. افتح ملف البرنامج (أو كل البرامج) واضغط أيقونة القلم.
3. انسخ جزء `[ad]` وحطه في الأول، وغيّر: `title` و`text` و`image` (رابط الصورة) و`link` (موقع المعلن) و`seconds`.
4. اضغط **Commit changes**.

رابط الصورة بيبقى بالشكل ده:
`https://raw.githubusercontent.com/samirkhilla/sam-projects/main/ads/اسم_الصورة.jpg`

## نزول نسخة جديدة من برنامج
في جزء `[update]`: غيّر `version` لرقم النسخة الجديدة، وحط في `download` رابط التحميل. ولو `mandatory=yes` البرنامج مش هيشتغل غير بعد التحديث.
