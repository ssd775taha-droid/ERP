# يفعّل/يلغي الطباعة الصامتة لإيصالات نقطة البيع (بلا نافذة اختيار الطابعة). الطابعة الافتراضية في ويندوز هي التي تطبع.
Add-Type -AssemblyName System.Windows.Forms
$f = Join-Path $PSScriptRoot 'silent-print.txt'
if (Test-Path $f) { Remove-Item $f -Force; [System.Windows.Forms.MessageBox]::Show('أُلغيت الطباعة الصامتة: ستظهر نافذة الطباعة.') | Out-Null }
else { Set-Content $f 'on'; [System.Windows.Forms.MessageBox]::Show('فُعّلت الطباعة الصامتة: تُطبع الإيصالات مباشرة على الطابعة الافتراضية. أعد فتح برنامج نقطة البيع.') | Out-Null }
