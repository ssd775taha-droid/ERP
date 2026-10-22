# يعرض عناوين السيرفر التي تكتبها أجهزة العميل ونقاط البيع، ويتحقق من فتح المنفذ في الجدار الناري.
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Host 'اكتب أحد هذه العناوين في برنامج العميل أو نقطة البيع:' -ForegroundColor Cyan
foreach ($i in $ips) { Write-Host "   http://${i}:3001" -ForegroundColor Green }
$rule = Get-NetFirewallRule -DisplayName 'ERP Server 3001' -ErrorAction SilentlyContinue
if (-not $rule) {
  Write-Host ''
  Write-Host 'قاعدة الجدار الناري غير موجودة: الأجهزة الأخرى قد لا تتصل.' -ForegroundColor Yellow
  $a = Read-Host 'لفتح المنفذ 3001 الآن اكتب y ثم Enter (سيُطلب إذن المسؤول)'
  if ($a -eq 'y') {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command "New-NetFirewallRule -DisplayName ''ERP Server 3001'' -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private,Domain | Out-Null"'
    Write-Host 'تم.' -ForegroundColor Green
  }
}
Read-Host 'Enter للإغلاق'
