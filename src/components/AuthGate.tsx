import React from 'react';
import {
  BookOpen,
  CheckCircle2,
  Layers,
  Mic,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  Loader2,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const AuthGate: React.FC = () => {
  const { signInWithGoogle, enterGuestMode, signingIn, enteringGuest, authError } = useAuth();
  const busy = signingIn || enteringGuest;

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-[#FAF9F6] text-[#1A1816] flex flex-col justify-between px-4 py-8 sm:px-8"
    >
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between border-b border-[#E5E2DC] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1E3A5F] text-white flex items-center justify-center shadow-sm">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-[#1A1816]">
              پلتفرم مشارکتی دیتابیس و کتاب‌های مرجع تخصصی خودرو
            </h1>
            <p className="text-xs text-[#57534E]">
              تکمیل تیمی دانش فنی خودرو · ۶ جلد کتاب مرجع · مدیریت فایل‌های WinOLS 2.24 و Google Workspace
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl w-full mx-auto my-auto py-8 sm:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Editorial Value Column */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[#1E3A5F] tracking-wide">
                پایگاه دانش تیمی خودرو، ECU، مالتی‌پلکس، دیاگ و WinOLS 2.24
              </p>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1A1816] leading-snug text-balance">
                با مشارکت تیمی، جامع‌ترین کتاب‌ها و دیتابیس مرجع تخصصی خودرو را بسازید
              </h2>
              <p className="text-sm sm:text-base text-[#57534E] leading-8">
                جزوات متنی، فایل‌های PDF و Word، فایل‌های صوتی تخصصی و پروژه‌های WinOLS 2.24 (.ols و .kp) را
                بارگذاری کنید؛ سامانه بخش‌های جدید را به‌صورت هوشمند (Delta-Merge) به ۶ جلد مرجع می‌افزاید،
                فایل‌ها را در Google Drive دسته‌بندی می‌کند و گزارش مشارکت و امتیاز شما را ثبت می‌نماید.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
              <div className="bg-white border border-[#E5E2DC] rounded-xl p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-[#1E3A5F] font-semibold text-sm">
                  <Layers className="w-4 h-4 shrink-0" />
                  ۶ جلد کتاب مرجع خودرشدشونده
                </div>
                <p className="text-xs text-[#57534E] leading-6">
                  از مکانیک، برق و مالتی‌پلکس و دیاگ تا ساختار ECU، نقشه‌خوانی پیشرفته WinOLS و خودروهای هیبریدی/برقی.
                </p>
              </div>

              <div className="bg-white border border-[#E5E2DC] rounded-xl p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-[#14532D] font-semibold text-sm">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  دروازه‌بان هوشمند و صفر-مصرف توکن تکراری
                </div>
                <p className="text-xs text-[#57534E] leading-6">
                  فایل‌های تکراری (SHA-256) و غیرمرتبط با خودرو پیش از مصرف هوش مصنوعی شناسایی شده و فقط دانش جدید اضافه می‌شود.
                </p>
              </div>

              <div className="bg-white border border-[#E5E2DC] rounded-xl p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-[#1E3A5F] font-semibold text-sm">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  فضای کاری باز با Drive، Docs، Sheets و PDF
                </div>
                <p className="text-xs text-[#57534E] leading-6">
                  مطالعه کتاب‌ها و PDF درون اپلیکیشن، ویرایش در Google Docs، مرور پوشه‌های .ols/.kp در Drive و گزارش زنده Google Sheets.
                </p>
              </div>

              <div className="bg-white border border-[#E5E2DC] rounded-xl p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-[#854D0E] font-semibold text-sm">
                  <Mic className="w-4 h-4 shrink-0" />
                  تبدیل صوت تخصصی، امتیازدهی و نیازهای دیتابیس
                </div>
                <p className="text-xs text-[#57534E] leading-6">
                  تبدیل فایل صوتی به متن تخصصی خودرو، محاسبه شفاف درصد محتوای جدید، امتیاز مشارکت و جدول برترین‌های تیم.
                </p>
              </div>
            </div>
          </div>

          {/* Sign-In & Guest Access Card */}
          <div className="lg:col-span-5">
            <div className="bg-white border border-[#D6D0C4] rounded-2xl p-6 sm:p-8 shadow-sm space-y-5">
              <div className="space-y-2 text-center">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-[#EEF3F8] text-[#1E3A5F] flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-[#1A1816]">
                  ورود به پلتفرم مشارکتی خودرو
                </h3>
                <p className="text-xs sm:text-sm text-[#57534E] leading-6">
                  با حساب گوگل وارد شوید تا امتیازها و همگام‌سازی Drive/Docs/Sheets به نام شما ثبت شود، یا به‌صورت مهمان مشارکت کنید.
                </p>
              </div>

              {authError && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#FDF2F0] border border-[#F5C6CB] text-[#9A3412] text-xs leading-6">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={signInWithGoogle}
                  disabled={busy}
                  className="w-full min-h-[48px] flex items-center justify-center gap-3 px-5 py-3 rounded-xl bg-[#1E3A5F] hover:bg-[#162C49] text-white font-semibold text-sm transition-colors shadow-sm disabled:opacity-60 cursor-pointer"
                >
                  {signingIn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      در حال اتصال به حساب گوگل...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 bg-white rounded-full p-0.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="#4285F4"
                          d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                        />
                        <path
                          fill="#34A853"
                          d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                        />
                      </svg>
                      ورود با حساب گوگل
                    </>
                  )}
                </button>

                <div className="relative flex items-center py-0.5">
                  <div className="flex-1 border-t border-[#E5E2DC]" />
                  <span className="px-3 text-[11px] text-[#78716C]">یا بدون نیاز به لاگین</span>
                  <div className="flex-1 border-t border-[#E5E2DC]" />
                </div>

                <button
                  type="button"
                  onClick={() => void enterGuestMode()}
                  disabled={busy}
                  className="w-full min-h-[46px] flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-xl border border-[#1E3A5F]/35 bg-[#F5F8FC] hover:bg-[#E8F0F8] text-[#1E3A5F] font-bold text-sm transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {enteringGuest ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      در حال آماده‌سازی میز کار مهمان...
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-4 h-4 shrink-0" />
                      <span>ورود سریع به‌عنوان مهمان</span>
                    </>
                  )}
                </button>
              </div>

              <div
                data-testid="authgate-automotive-notice"
                className="rounded-xl border border-[#DFD8CA] bg-[#FAF8F3] p-3.5 space-y-1.5 text-right"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#1E3A5F]">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>شفافیت حریم خصوصی و تخصص‌گرایی حوزه خودرو</span>
                </div>
                <ul className="space-y-1 text-[11px] leading-5 text-[#57534E]">
                  <li>
                    <strong className="text-[#1A1816]">۱. صرفاً اسناد خودرو:</strong>{' '}
                    پلتفرم ویژه تمامی حوزه‌های خودرو (مکانیک، برق و مالتی‌پلکس، دیاگ، گیربکس، هیبرید/برقی، داینو و ریمپ) است.
                  </li>
                  <li>
                    <strong className="text-[#1A1816]">۲. غنی‌سازی ناشناس دانش فنی:</strong>{' '}
                    داده‌های فنی پس از حذف کامل اطلاعات شخصی، تماس، پلاک و شاسی برای ارتقای دانش مرجع استفاده می‌شوند.
                  </li>
                  <li>
                    <strong className="text-[#1A1816]">۳. مدیریت امن فایل‌های WinOLS و ECU:</strong>{' '}
                    فایل‌های <span className="font-mono">.ols / .kp</span> با متادیتای خودرو و ECU در پوشه‌های دسته‌بندی‌شده Google Drive آرشیو می‌شوند و باینری‌های خام{' '}
                    <span className="font-mono">.bin / .ori / .mod</span> صرفاً در حافظه تحلیل و پاک‌سازی می‌گردند.
                  </li>
                </ul>
              </div>

              <p className="text-[11px] text-center text-[#78716C] leading-5">
                در حالت مهمان نیز می‌توانید فایل تخصصی ارسال کنید، کتابخانه مرجع و فایل‌های PDF/Drive را مرور نمایید و امتیاز مشارکت بگیرید.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto border-t border-[#E5E2DC] pt-4 text-center text-xs text-[#78716C]">
        پلتفرم مشارکتی دانش و دیتابیس مرجع خودرو · ۶ جلد مرجع · WinOLS 2.24 (.ols/.kp) · یکپارچه با Google Drive، Docs و Sheets
      </footer>
    </div>
  );
};
