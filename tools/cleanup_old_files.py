#!/usr/bin/env python3
"""حذف (أو نقل) الملفات التي لم يتم العمل عليها منذ تاريخ معيّن.

الاستخدام:
  # معاينة فقط (لا يُحذف شيء):
  python cleanup_old_files.py ~/Documents --since 2024-01-01

  # نقل الملفات القديمة إلى مجلد حجر بدل حذفها (آمن، يمكن التراجع):
  python cleanup_old_files.py ~/Documents --since 2024-01-01 --move-to ~/OldFiles --apply

  # حذف نهائي (يطلب تأكيدًا بكتابة YES):
  python cleanup_old_files.py ~/Documents --since 2024-01-01 --delete --apply

"آخر عمل" = وقت آخر تعديل للملف (mtime)،
ويمكن اعتبار وقت آخر فتح (atime) عملًا أيضًا عبر --use-atime.
"""
import argparse
import os
import shutil
import sys
from datetime import datetime

# مجلدات لا تُمَسّ أبدًا (نظام / برامج / إعدادات)
PROTECTED_NAMES = {
    ".git", "node_modules", "AppData", "Windows", "Program Files",
    "Program Files (x86)", "ProgramData", "System32", "Library",
    "Applications", ".ssh", ".gnupg", ".config", "$Recycle.Bin",
}
PROTECTED_ROOTS = {"/", "/usr", "/bin", "/sbin", "/etc", "/var", "/boot", "/lib",
                   "/System", "/opt", "C:\\", "C:\\Windows"}


def last_worked(path, use_atime):
    st = os.stat(path)
    t = st.st_mtime
    if use_atime:
        t = max(t, st.st_atime)
    return t


def human(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def scan(root, cutoff, use_atime, exts, skip_dirs):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in PROTECTED_NAMES
                       and os.path.join(dirpath, d) not in skip_dirs]
        for name in filenames:
            p = os.path.join(dirpath, name)
            if os.path.islink(p):
                continue
            if exts and os.path.splitext(name)[1].lower() not in exts:
                continue
            try:
                if last_worked(p, use_atime) < cutoff:
                    yield p, os.path.getsize(p)
            except OSError:
                continue


def remove_empty_dirs(root):
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        if dirpath != root and not os.listdir(dirpath):
            try:
                os.rmdir(dirpath)
            except OSError:
                pass


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", help="المجلد المراد فحصه")
    ap.add_argument("--since", required=True, help="التاريخ بصيغة YYYY-MM-DD؛ أي ملف لم يُعمل عليه منذ هذا التاريخ يُعتبر قديمًا")
    ap.add_argument("--apply", action="store_true", help="تنفيذ فعلي (بدونه: معاينة فقط)")
    ap.add_argument("--delete", action="store_true", help="حذف نهائي (بدلاً من النقل)")
    ap.add_argument("--move-to", help="نقل الملفات القديمة إلى هذا المجلد مع الحفاظ على بنية المجلدات")
    ap.add_argument("--use-atime", action="store_true", help="اعتبار وقت آخر فتح للملف عملًا أيضًا")
    ap.add_argument("--ext", nargs="*", help="تقييد على امتدادات معينة مثل: .tmp .log .zip")
    ap.add_argument("--remove-empty-dirs", action="store_true", help="حذف المجلدات الفارغة بعد التنفيذ")
    args = ap.parse_args()

    root = os.path.abspath(os.path.expanduser(args.folder))
    if not os.path.isdir(root):
        sys.exit(f"المجلد غير موجود: {root}")
    if root in PROTECTED_ROOTS or os.path.dirname(root) == root or root == os.path.expanduser("~"):
        sys.exit("مرفوض: هذا مجلد نظام أو المجلد الرئيسي كاملاً. حدّد مجلدًا فرعيًا (مثل Documents أو Downloads).")

    try:
        cutoff = datetime.strptime(args.since, "%Y-%m-%d").timestamp()
    except ValueError:
        sys.exit("صيغة التاريخ خاطئة، استخدم YYYY-MM-DD")

    if args.delete == bool(args.move_to):
        if args.apply:
            sys.exit("اختر إما --delete أو --move-to <مجلد> (وليس كليهما).")

    dest = os.path.abspath(os.path.expanduser(args.move_to)) if args.move_to else None
    skip = {dest} if dest else set()
    exts = {e.lower() if e.startswith(".") else "." + e.lower() for e in args.ext} if args.ext else None

    files = list(scan(root, cutoff, args.use_atime, exts, skip))
    total = sum(s for _, s in files)
    for p, s in files:
        print(f"{human(s):>10}  {p}")
    print(f"\nعدد الملفات القديمة: {len(files)} | الحجم الكلي: {human(total)}")

    if not args.apply:
        print("وضع المعاينة: لم يتم تغيير أي شيء. أضف --apply للتنفيذ.")
        return
    if not files:
        return

    action = "حذف نهائي" if args.delete else f"نقل إلى {dest}"
    if input(f"سيتم {action} لعدد {len(files)} ملف. اكتب YES للمتابعة: ").strip() != "YES":
        sys.exit("أُلغيت العملية.")

    done = failed = 0
    for p, _ in files:
        try:
            if args.delete:
                os.remove(p)
            else:
                target = os.path.join(dest, os.path.relpath(p, root))
                os.makedirs(os.path.dirname(target), exist_ok=True)
                shutil.move(p, target)
            done += 1
        except OSError as e:
            failed += 1
            print(f"فشل: {p} ({e})")
    if args.remove_empty_dirs:
        remove_empty_dirs(root)
    print(f"تم: {done} | فشل: {failed}")


if __name__ == "__main__":
    main()
