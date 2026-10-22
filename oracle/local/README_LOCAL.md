# تثبيت نظام ERP (Oracle) على جهازك

## ما ستحصل عليه
أمر واحد يشغّل قاعدة **Oracle XE 21c** في Docker على جهازك، وينشئ مستخدم المخطط `erp_owner`، ويثبّت كل الجداول والحزم والعروض، ويفحص أنها صالحة، ثم يشغّل الاختبار الذاتي (213 فحصاً) ويطبع النتيجة. بعدها تتصل بقاعدتك بأي أداة (SQL Developer مثلاً).

## المتطلبات
- **Docker Desktop** (ويندوز أو ماك) أو Docker Engine (لينكس)، وشغّله قبل البدء. خصّص له **4 جيجابايت RAM** على الأقل و**4 جيجابايت** مساحة قرص.
- اتصال بالإنترنت أول مرة (تُسحب صورة Oracle XE نحو 1.5 جيجابايت).
- ملاحظة ترخيص: Oracle XE مجانية للتطوير والإنتاج بحدود (قاعدة حتى 12 جيجابايت بيانات، وذاكرة 2 جيجابايت، ومعالجان). مناسبة لتجربة هذا النظام، وليست بديلاً عن ترخيص Oracle Enterprise لمؤسسة كبيرة.

## التثبيت

**ويندوز (PowerShell):**
```powershell
cd oracle
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # إن مُنع تنفيذ السكربتات
.\local\install-local.ps1
```
**ماك / لينكس / WSL / Git Bash:**
```bash
cd oracle
./local/install-local.sh
```
أول مرة تستغرق 4–8 دقائق (سحب الصورة وتهيئة القاعدة). النتيجة المرجوة في آخر السطور: `---- نجح 213 · فشل 0` ثم «تم. قاعدة البيانات تعمل الآن على جهازك».

الخيارات: `--reinstall` / `-Reinstall` (حذف كائنات النظام وإعادة تثبيتها: **يحذف البيانات**)، و`--no-test` / `-NoTest` (بلا الاختبار الذاتي). متغيرات اختيارية: `ERP_ORACLE_PORT` (الافتراضي 1521)، `ERP_ORACLE_NAME`، `ERP_ORACLE_IMAGE`.

**إن ظهر خطأ `429 Too Many Requests` من Docker Hub** استخدم مرآة Google للصورة نفسها:
`export ERP_ORACLE_IMAGE=mirror.gcr.io/gvenzl/oracle-xe:21-slim` (ويندوز: `$env:ERP_ORACLE_IMAGE = "mirror.gcr.io/gvenzl/oracle-xe:21-slim"`) ثم أعد التشغيل.

## الاتصال بقاعدتك
| | |
|---|---|
| الخدمة | `localhost:1521/XEPDB1` (أو المنفذ الذي اخترته) |
| المستخدم | `erp_owner` |
| كلمة السر | في الملف `oracle/local/.env` (ولّدها السكربت عشوائياً، والملف خارج git) |

**SQL Developer:** اتصال جديد ← نوع Basic ← Hostname `localhost`، Port `1521`، **Service name** `XEPDB1`، والمستخدم وكلمة السر أعلاه.

**SQL*Plus من داخل الحاوية:** `docker exec -it erp-oracle sqlplus erp_owner@//localhost/XEPDB1`

**Oracle Forms/Reports (ملف `tnsnames.ora` على الجهاز الذي فيه Forms):**
```
ERPXE =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = localhost)(PORT = 1521))
    (CONNECT_DATA = (SERVICE_NAME = XEPDB1)))
```
ثم الاتصال بـ `erp_owner/كلمة_السر@ERPXE`. اضبط `NLS_LANG=ARABIC_SAUDI ARABIA.AL32UTF8` (أو `.AL32UTF8`) على جهاز Forms.

## الإيقاف والتشغيل والحذف
```bash
docker stop erp-oracle        # إيقاف (البيانات محفوظة)
docker start erp-oracle       # تشغيل
docker rm -f erp-oracle && docker volume rm erp-oracle-data   # حذف كل شيء نهائياً
```

## Docker لا يستجيب (الرسالة «المحرّك لا يستجيب»)
نافذة Docker Desktop مفتوحة لا تعني أن المحرّك يعمل. افعل بالترتيب:
1. انظر أسفل يسار نافذة Docker Desktop: يجب أن تقرأ **Engine running** بالأخضر. إن قرأت «starting» فانتظر دقيقة أو اثنتين (التشغيل الأول أبطأ).
2. إن بقي متوقفاً: أغلق Docker Desktop تماماً (أيقونته في شريط المهام ← Quit) ثم افتحه من جديد.
3. في ويندوز يحتاج Docker Desktop خاصية WSL 2 والمحاكاة الافتراضية: افتح PowerShell بصلاحية المدير ونفّذ `wsl --update` ثم أعد تشغيل الجهاز. وتأكد أن **Virtualization** مفعّلة في Task Manager ← Performance ← CPU.
4. اختبر بنفسك: `docker version` ثم `docker run --rm hello-world`. يجب أن يطبع القسمين Client وServer بلا أخطاء. إن ظهر خطأ فأرسله لي كما هو.

## إن فشل شيء
السكربت يطبع أول الأخطاء ويحفظ السجلات في `oracle/local/logs/` (`install.log` و`check.log` و`selftest.log`). **أرسل لي الملف المعنيّ** لأصلحه.

## بدون Docker (تثبيت يدوي على Oracle موجود)
على قاعدة Oracle 19c أو XE (أي قاعدة قابلة للتوصيل أو عادية)، ببيانات اعتماد مدير:
```sql
-- بصلاحية مدير (في القاعدة القابلة للتوصيل إن وُجدت)
CREATE USER erp_owner IDENTIFIED BY "كلمة_سر_قوية" QUOTA UNLIMITED ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE, CREATE PROCEDURE, CREATE TYPE, CREATE TRIGGER TO erp_owner;
```
ثم من مجلد `oracle/` وبمستخدم `erp_owner` (مع `NLS_LANG` بترميز UTF-8):
```
sqlplus erp_owner/كلمة_السر@//host:1521/service @install.sql
sqlplus erp_owner/كلمة_السر@//host:1521/service @check_install.sql      -- يجب أن ينتهي بـ «لا أخطاء»
SET SERVEROUTPUT ON SIZE UNLIMITED
@sql/15_selftest.sql                                                      -- يجب أن ينتهي بـ «فشل 0»
```

## واجهات Oracle Forms وReports
هذه لا يمكن تثبيتها بسكربت: تحتاج منتج **Oracle Forms and Reports 12c** (من موقع Oracle، وبترخيصه)، وتُبنى الشاشات والتقارير بأداتي Forms Builder وReports Builder اعتماداً على `forms/FORMS_SPEC.md` و`reports/REPORTS_SPEC.md`. تحقق من **مصفوفة التوافق** لإصدار Forms الذي ستثبّته مع إصدار قاعدة البيانات (الاختبار هنا على XE 21c، وأعلن Forms 12.2.1.4 دعمه الرسمي لقواعد حتى 19c؛ قد يعمل مع 21c لكنه غير مؤكد عندي).

## تطبيق «تمام برو» الأصلي (Node.js)
مشروع مستقل في جذر المستودع، لا علاقة له بقاعدة Oracle: `npm install` ثم `npm start` (يعمل على `http://localhost:3000` ويحتاج Node 22 أو أحدث). التفاصيل في `README.md` الجذر.

## ما اختُبر وما لم يُختبر
| | الحالة |
|---|---|
| تثبيت كامل نظيف على Oracle XE 21c، وإعادة التثبيت، وحذف الكائنات | **مُختبَر** (حاوية Docker) |
| 193 كائناً صالحاً بلا أخطاء تجميع | **مُختبَر** |
| الاختبار الذاتي 213 فحصاً | **مُختبَر: 213 نجاح · 0 فشل** |
| 29 استعلام تقرير على بيانات حقيقية | **مُختبَر: بلا أخطاء** |
| سكربت `install-local.sh` (من الصفر، والتكرار، و`--reinstall`) | **مُختبَر** |
| سكربت `install-local.ps1` (ويندوز) | **غير مُختبَر** (لا ويندوز عندي)، كُتب بحذر على نمط السكربت الآخر |
| Oracle 19c (النسخة المطلوبة أصلاً) | **غير مُختبَر** (الكود لا يستخدم ميزات بعد 19c، لكن لم أشغّله عليها) |
| شاشات Forms وتقارير Reports كملفات `.fmb` / `.rdf` | **لم تُبنَ** (تصميم ومواصفات فقط) |
