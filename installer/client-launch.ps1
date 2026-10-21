# تشغيل برنامج العميل أو نقطة البيع: يقرأ عنوان السيرفر من server.txt ويفتح الواجهة في نافذة تطبيق مستقلة (Edge أو Chrome).
# -Mode client|pos   ·   -Reconfigure لتغيير عنوان السيرفر
param([string]$Mode = 'client', [switch]$Reconfigure)
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
$cfg = Join-Path $PSScriptRoot 'server.txt'
function Norm($a) {
  $a = ($a -replace '\s', '').TrimEnd('/')
  if (-not $a) { return '' }
  if ($a -notmatch '^https?://') { $a = "http://$a" }
  if ($a -notmatch ':\d+$') { $a = "${a}:3001" }
  return $a
}
function Ask($def) { Norm ([Microsoft.VisualBasic.Interaction]::InputBox("اكتب عنوان السيرفر (مثال: 192.168.1.10 أو 192.168.1.10:3001)", 'عنوان سيرفر ERP', $def)) }
$url = ''
if ((Test-Path $cfg) -and -not $Reconfigure) { $url = Norm (Get-Content $cfg -Raw) }
while (-not $url -or $Reconfigure) {
  $url = Ask $url
  if (-not $url) { exit 0 }
  [System.IO.File]::WriteAllText($cfg, $url)
  if ($Reconfigure) { [System.Windows.Forms.MessageBox]::Show("حُفظ العنوان: $url") | Out-Null; $Reconfigure = $false }
}
$ok = $false
try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "$url/healthz"; $ok = ($r.StatusCode -eq 200) } catch { }
if (-not $ok) {
  $ans = [System.Windows.Forms.MessageBox]::Show("تعذّر الاتصال بالسيرفر على $url`nتأكد أن جهاز السيرفر يعمل وأن الشبكة والجدار الناري يسمحان بالمنفذ.`n`nهل تريد تغيير العنوان؟", 'ERP', 'YesNo', 'Warning')
  if ($ans -eq 'Yes') { & $PSCommandPath -Mode $Mode -Reconfigure }
  exit 1
}
$q = if ($Mode -eq 'pos') { '/?mode=pos#/pos/sell' } else { '/?mode=full' }
$full = "$url$q"
$exe = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
         "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { Start-Process $full; exit 0 }
# ملف تعريف مستقل: يضمن تطبيق خيارات النافذة، ولا يختلط بتصفح المستخدم
$prof = Join-Path $env:LOCALAPPDATA "ERP-$Mode\profile"
$argv = @("--app=$full", "--user-data-dir=`"$prof`"", '--start-maximized', '--no-first-run', '--disable-features=Translate')
# طباعة صامتة إلى الطابعة الافتراضية دون نافذة اختيار (للإيصال الحراري) في نقطة البيع فقط
if ($Mode -eq 'pos' -and (Test-Path (Join-Path $PSScriptRoot 'silent-print.txt'))) { $argv += '--kiosk-printing' }
Start-Process $exe -ArgumentList $argv
