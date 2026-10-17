# نشر مجاني دائم على Oracle Cloud (Always Free)

البيانات تبقى على قرص الخادم، والرابط يعمل 24 ساعة بلا نوم.

1. أنشئ حسابًا على oracle.com/cloud/free (يطلب بطاقة للتحقق فقط ولا يخصم).
2. أنشئ Instance: صورة **Ubuntu 22.04**، والشكل **VM.Standard.A1.Flex** (1 OCPU و6GB يكفي) أو **E2.1.Micro**. نزّل مفتاح SSH.
3. من الشبكة (VCN > Security List) افتح دخول TCP على المنفذين **80** و**443** من `0.0.0.0/0`.
4. ادخل بالـ SSH وشغّل:
   ```
   curl -fsSL https://raw.githubusercontent.com/ssd775taha-droid/ERP/main/deploy/oracle/setup.sh | bash
   ```
   لتفعيل المساعد الذكي أضف مفتاحك بعد `bash -s --`.
5. افتح الرابط الذي يطبعه السكربت (بصيغة `https://1-2-3-4.sslip.io`)، وأنشئ حساب المالك فورًا.

التحديث لاحقًا: `cd ~/erp && git pull && cd deploy/oracle && sudo docker compose up -d --build`.
النسخ الاحتياطية اليومية تُحفظ داخل وحدة التخزين `erp-data`.
