# تثبيت نظام ERP على Oracle Database XE المثبَّتة مباشرة على ويندوز (بدون Docker).
#   .\local\install-xe.ps1                       يسأل عن كلمة سر SYS ثم يثبّت ويفحص ويشغّل الاختبار الذاتي
#   .\local\install-xe.ps1 -Reinstall            يحذف كائنات النظام ويعيد تثبيتها (يحذف البيانات)
#   .\local\install-xe.ps1 -NoTest               بلا الاختبار الذاتي
#   خيارات: -SysPassword  -DbHost localhost  -Port 1521  -Service XEPDB1
# المتطلب: Oracle Database XE مثبّتة وتعمل، ومعها SQL*Plus (يأتي مع التثبيت). الخدمة يجب أن تكون القاعدة القابلة للتوصيل XEPDB1
# وليس XE (الجذر). إن مُنع تنفيذ السكربتات:  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
param(
  [string]$SysPassword,
  [string]$DbHost = 'localhost',
  [int]$Port = 1521,
  [string]$Service = 'XEPDB1',
  [switch]$Reinstall,
  [switch]$NoTest
)

$ErrorActionPreference = 'Continue'
$OracleDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvFile = Join-Path $OracleDir 'local\.env-xe'
$LogDir  = Join-Path $OracleDir 'local\logs'
# مخرجات sqlplus بترميز UTF-8 ليقرأها PowerShell سليمة، ومدخلاتنا له ASCII فقط
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:NLS_LANG = '.AL32UTF8'

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

function Find-SqlPlus {
  $c = Get-Command sqlplus.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $roots = @($env:ORACLE_HOME, 'C:\app', 'C:\oraclexe', 'C:\Oracle', (Join-Path $env:ProgramFiles 'Oracle')) |
           Where-Object { $_ -and (Test-Path $_) }
  foreach ($r in $roots) {
    $f = Get-ChildItem -Path $r -Filter sqlplus.exe -Recurse -Depth 8 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { return $f.FullName }
  }
  return $null
}

$SqlPlus = Find-SqlPlus
if (-not $SqlPlus) {
  Fail @"
لم أجد SQL*Plus. ثبّت Oracle Database XE لويندوز من موقع Oracle (يأتي معها SQL*Plus)، أو أضف مجلد bin الخاص بها إلى PATH
(مثلاً C:\app\<اسمك>\product\21c\dbhomeXE\bin) ثم أعد فتح PowerShell وأعد المحاولة.
"@
}
Write-Host "SQL*Plus: $SqlPlus"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# المنفذ: هل المستمع (Listener) يعمل؟
$tcp = New-Object System.Net.Sockets.TcpClient
try { $tcp.Connect($DbHost, $Port) } catch { }
$listening = $tcp.Connected
$tcp.Close()
if (-not $listening) {
  Fail "لا أحد يستمع على ${DbHost}:${Port}. تأكد أن خدمتي OracleServiceXE وOracleOraDB21Home1TNSListener تعملان (services.msc) أو شغّل الأمر: lsnrctl status"
}

# كلمة سر SYS (لا تُحفظ في أي ملف)
if (-not $SysPassword) {
  $sec = Read-Host 'كلمة سر SYS (التي أدخلتها عند تثبيت Oracle XE)' -AsSecureString
  $SysPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if ($SysPassword -notmatch '^[\x20-\x7E]+$' -or $SysPassword.Contains('"')) {
  Fail 'كلمة سر SYS يجب أن تكون حروفاً لاتينية وأرقاماً ورموزاً عادية بلا علامة اقتباس مزدوجة (ASCII).'
}

# كلمة سر مستخدم المخطط: تُولَّد مرة واحدة وتُحفظ في local\.env-xe (خارج git)
if (-not (Test-Path $EnvFile)) {
  $chars = (48..57) + (65..90) + (97..122)
  $pw = (-join ($chars | Get-Random -Count 14 | ForEach-Object { [char]$_ })) + 'A1'
  Set-Content -Path $EnvFile -Value "ERP_DB_PASSWORD=$pw" -Encoding ascii
  Write-Host 'أُنشئت كلمة سر لمستخدم المخطط erp_owner في local\.env-xe'
}
$AppPw = ((Get-Content $EnvFile | Where-Object { $_ -like 'ERP_DB_PASSWORD=*' }) -split '=', 2)[1].Trim()

$ConnSys = "CONNECT sys/`"$SysPassword`"@//${DbHost}:${Port}/${Service} AS SYSDBA"
$ConnApp = "CONNECT erp_owner/`"$AppPw`"@//${DbHost}:${Port}/${Service}"

# تشغيل SQL*Plus بنص يُرسَل عبر الإدخال القياسي (فلا تظهر كلمات السر في سطر الأوامر)، من مجلد oracle لتعمل المسارات النسبية
function Invoke-Sql([string]$script) {
  Push-Location $OracleDir
  try { return ($script | & $SqlPlus -s /nolog 2>&1 | Out-String) } finally { Pop-Location }
}
function Explain-Ora([string]$out) {
  if ($out -match 'ORA-01017') { return 'كلمة سر SYS خاطئة.' }
  if ($out -match 'ORA-12514|ORA-12154') { return "الخدمة '$Service' غير معروفة للمستمع. للقاعدة القابلة للتوصيل استخدم XEPDB1 (راجع: lsnrctl status)." }
  if ($out -match 'ORA-12541|ORA-12560') { return 'المستمع لا يعمل. شغّل خدمة TNSListener في services.msc.' }
  if ($out -match 'ORA-28000') { return 'الحساب مقفول.' }
  if ($out -match 'ORA-65096|ORA-65049') { return "أنت متصل بالقاعدة الجذر. استخدم -Service XEPDB1." }
  return $null
}

Write-Host 'اختبار الاتصال بالقاعدة...'
$out = Invoke-Sql "WHENEVER SQLERROR EXIT FAILURE`n$ConnSys`nSELECT 'CONNECTED_AS_SYS' FROM dual;`nEXIT"
if ($out -notmatch 'CONNECTED_AS_SYS') {
  $why = Explain-Ora $out
  if ($why) { Write-Host $why -ForegroundColor Yellow }
  Write-Host $out
  Fail 'تعذّر الاتصال بالقاعدة.'
}

Write-Host 'إنشاء مستخدم المخطط erp_owner ومنحه الصلاحيات...'
$out = Invoke-Sql "$ConnSys`n@local/xe_create_user.sql $AppPw`nEXIT"
$out | Out-File -Encoding utf8 (Join-Path $LogDir 'xe_create_user.log')
if ($out -notmatch 'GRANTED') {
  $why = Explain-Ora $out
  if ($why) { Write-Host $why -ForegroundColor Yellow }
  Write-Host $out
  Fail 'فشل إنشاء المستخدم. السجل في local\logs\xe_create_user.log'
}
if ($out -match 'USER_PASSWORD_RESET') { Write-Host 'المستخدم erp_owner موجود: أُعيد ضبط كلمة سره إلى المحفوظة في local\.env-xe' }

$out = Invoke-Sql "$ConnApp`nSET HEADING OFF FEEDBACK OFF PAGESIZE 0`nSELECT 'INSTALLED=' || COUNT(*) FROM user_tables WHERE table_name = 'ERP_ACCOUNTS';`nEXIT"
if ($out -notmatch 'INSTALLED=(\d+)') { Write-Host $out; Fail 'تعذّر الاتصال بمستخدم المخطط erp_owner.' }
$installed = [int]$Matches[1]

if ($installed -gt 0 -and -not $Reinstall) {
  Write-Host 'النظام مثبَّت مسبقاً. لإعادة التثبيت من الصفر (يحذف البيانات): .\local\install-xe.ps1 -Reinstall'
} else {
  if ($installed -gt 0) {
    Write-Host 'حذف كائنات النظام السابقة...'
    Invoke-Sql "$ConnApp`n@uninstall.sql`nEXIT" | Out-File -Encoding utf8 (Join-Path $LogDir 'uninstall.log')
  }
  Write-Host 'تثبيت المخطط والحزم (دقيقة تقريباً)...'
  $out = Invoke-Sql "$ConnApp`n@install.sql`nEXIT"
  $out | Out-File -Encoding utf8 (Join-Path $LogDir 'install.log')
  $errs = [regex]::Matches($out, '(ORA|PLS|SP2)-\d+[^\r\n]*')
  if ($errs.Count -gt 0) {
    Write-Host 'فشل التثبيت. أول الأخطاء (والسجل الكامل في local\logs\install.log):' -ForegroundColor Red
    $errs | Select-Object -First 10 | ForEach-Object { $_.Value }
    exit 1
  }
}

Write-Host 'فحص ما بعد التثبيت...'
$out = Invoke-Sql "$ConnApp`n@check_install.sql`nEXIT"
$out | Out-File -Encoding utf8 (Join-Path $LogDir 'check.log')
if ($out -notmatch 'CHECK_RESULT=OK') { Fail 'توجد كائنات غير صالحة أو أخطاء تجميع. راجع local\logs\check.log' }

if (-not $NoTest) {
  Write-Host 'الاختبار الذاتي (يتراجع عن كل بياناته)...'
  $out = Invoke-Sql "$ConnApp`nSET SERVEROUTPUT ON SIZE UNLIMITED`nSET LINESIZE 300`n@sql/15_selftest.sql`nEXIT"
  $out | Out-File -Encoding utf8 (Join-Path $LogDir 'selftest.log')
  if ($out -match 'RESULT pass=(\d+) fail=(\d+)') {
    Write-Host "نتيجة الاختبار الذاتي: نجح $($Matches[1]) · فشل $($Matches[2])"
    if ([int]$Matches[2] -ne 0) {
      [regex]::Matches($out, '(?m)^FAIL[^\r\n]*') | Select-Object -First 10 | ForEach-Object { $_.Value }
      Fail 'أرسل لي local\logs\selftest.log لأصلح ما فشل.'
    }
  } else {
    Fail 'لم يكتمل الاختبار الذاتي. راجع local\logs\selftest.log'
  }
}

Write-Host @"

تم. قاعدة البيانات جاهزة على جهازك:
  الخدمة  : ${DbHost}:${Port}/${Service}
  المستخدم: erp_owner
  كلمة السر: في الملف local\.env-xe
  سلسلة الاتصال لـ SQL Developer / Forms:  //${DbHost}:${Port}/${Service}
"@
