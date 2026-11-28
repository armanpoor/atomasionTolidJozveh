import React from 'react';
import { ShieldCheck } from 'lucide-react';

export const AUTOMOTIVE_CONSENT_SESSION_KEY = 'automotive_upload_consent_v1';

export const AUTOMOTIVE_CONSENT_PRINCIPLES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'تخصصی صرفاً برای حوزه خودرو',
    body: 'این پلتفرم صرفاً برای اسناد و فایل‌های فنی خودرو (مکانیک، برق و مالتی‌پلکس، دیاگ، گیربکس، هیبرید/برقی، داینو و ریمپ) است و فایل‌های غیرمرتبط پذیرفته نمی‌شوند.',
  },
  {
    title: 'تدوین کتاب شما + غنی‌سازی ناشناس دانش فنی',
    body: 'علاوه بر تدوین اختصاصی پروژه شما، حقایق فنی استخراج‌شده پس از حذف کامل اطلاعات شخصی، شماره تماس، پلاک و شماره شاسی به‌صورت ناشناس برای ارتقای دانش فنی مرجع استفاده می‌شود.',
  },
  {
    title: 'تضمین عدم نگهداری فایل خام ECU',
    body: 'فایل‌های باینری و اختصاصی خودرو (.bin، .ori، .mod، .ols) هرگز ذخیره، کپی یا بازتوزیع نمی‌شوند و بلافاصله پس از استخراج مشخصات فنی از حافظه پاک می‌گردند.',
  },
];

interface AutomotiveConsentBannerProps {
  accepted: boolean;
  onChangeAccepted: (accepted: boolean) => void;
  compact?: boolean;
}

export const AutomotiveConsentBanner: React.FC<AutomotiveConsentBannerProps> = ({
  accepted,
  onChangeAccepted,
  compact = false,
}) => {
  return (
    <div
      data-testid="automotive-consent-banner"
      className={`rounded-lg border transition-colors ${
        accepted
          ? 'border-[#D4E3D8] bg-[#F6FBF7]'
          : 'border-[#D9CEBC] bg-[#FBF8F1]'
      } ${compact ? 'p-2.5' : 'p-3'}`}
    >
      <div className="flex items-start gap-2">
        <ShieldCheck
          className={`mt-0.5 h-4 w-4 shrink-0 ${
            accepted ? 'text-[#14532D]' : 'text-[#1E3A5F]'
          }`}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-[11.5px] font-bold text-[#1A1816]">
            قوانین آپلود تخصصی خودرو و حریم خصوصی
          </div>
          <ul className="space-y-1 text-[10.5px] leading-5 text-[#57534E]">
            {AUTOMOTIVE_CONSENT_PRINCIPLES.map((item) => (
              <li key={item.title}>
                <strong className="font-semibold text-[#292524]">{item.title}:</strong>{' '}
                {item.body}
              </li>
            ))}
          </ul>

          <label className="mt-2 flex cursor-pointer items-start gap-2 border-t border-[#E6DFD3] pt-2 text-[11px] font-bold text-[#1A1816]">
            <input
              type="checkbox"
              data-testid="automotive-consent-checkbox"
              checked={accepted}
              onChange={(e) => onChangeAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#1E3A5F] cursor-pointer"
            />
            <span className="leading-5">
              تأیید می‌کنم فایل‌های ارسالی صرفاً مرتبط با حوزه خودرو هستند و با شرایط حریم خصوصی و عدم ذخیره باینری خام موافقم.
            </span>
          </label>
        </div>
      </div>
    </div>
  );
};
