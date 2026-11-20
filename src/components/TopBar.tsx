import { BookOpen, Download, History, Loader2, Sparkles, UploadCloud } from 'lucide-react';
import { toPersianDigits } from '../lib/formatParsers';

export type StudioTab = 'builder' | 'preview' | 'history';

interface TopBarProps {
  activeTab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  onDownloadDocx: () => void;
  isExporting: boolean;
  hasBook: boolean;
  historyCount: number;
  activeModelLabel: string;
}

const NAV_ITEMS: Array<{ id: StudioTab; label: string; mobileLabel: string; icon: typeof UploadCloud }> = [
  { id: 'builder', label: 'ساخت سند جدید', mobileLabel: 'ساخت سند', icon: UploadCloud },
  { id: 'preview', label: 'پیش‌نمایش و خروجی', mobileLabel: 'پیش‌نمایش', icon: BookOpen },
  { id: 'history', label: 'تاریخچه و تحلیل AI', mobileLabel: 'تاریخچه', icon: History },
];

export function TopBar({
  activeTab,
  onTabChange,
  onDownloadDocx,
  isExporting,
  hasBook,
  historyCount,
  activeModelLabel,
}: TopBarProps) {
  return (
    <>
      <header className="sticky top-0 z-30 h-14 border-b border-[#E2DDD3] bg-[#FBF9F5]/95 backdrop-blur-sm">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-3 px-4 lg:px-6">
          {/* Zone 1: Clean Wordmark */}
          <button
            type="button"
            onClick={() => onTabChange('builder')}
            className="flex min-w-0 items-center gap-2.5 text-right"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[#1E3A5F] text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-[#1A1816]">
                یکپارچه‌ساز هوشمند ورد
              </div>
              <div className="hidden truncate text-[11px] text-[#57534E] sm:block">
                وزیر مدیوم · راست‌چین · {activeModelLabel}
              </div>
            </div>
          </button>

          {/* Zone 2: Desktop Navigation (3 clean tabs) */}
          <nav className="hidden h-full items-center gap-2 md:flex" aria-label="ناوبری اصلی">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              const disabled = item.id === 'preview' && !hasBook;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onTabChange(item.id)}
                  className={`relative flex h-full items-center gap-2 px-3.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? 'font-bold text-[#1E3A5F]'
                      : 'font-medium text-[#57534E] hover:text-[#1A1816]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                  {item.id === 'history' && historyCount > 0 && (
                    <span className="text-[11px] font-bold tabular-nums text-[#78716C]">
                      ({toPersianDigits(historyCount)})
                    </span>
                  )}
                  {active && (
                    <span className="absolute right-0 bottom-0 left-0 h-[2px] bg-[#1E3A5F]" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0">
            {hasBook ? (
              <button
                type="button"
                onClick={onDownloadDocx}
                disabled={isExporting}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-sm bg-[#1E3A5F] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#162C49] disabled:opacity-50 sm:px-4 sm:text-[13px]"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="hidden sm:inline">در حال ساخت...</span>
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    <span>دانلود ورد</span>
                  </>
                )}
              </button>
            ) : (
              <span className="hidden text-xs font-medium text-[#78716C] sm:inline">
                پشتیبانی: DOCX · MD · TXT · JSON
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Bottom Tab Bar (Thumb-Zone Ergonomics, 44px+ hitboxes) */}
      <nav
        aria-label="ناوبری موبایل"
        className="fixed right-0 bottom-0 left-0 z-40 grid h-16 grid-cols-3 border-t border-[#E2DDD3] bg-[#FBF9F5]/95 backdrop-blur-md md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          const disabled = item.id === 'preview' && !hasBook;
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onTabChange(item.id)}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-1 text-[11px] transition-colors disabled:opacity-35 ${
                active ? 'font-bold text-[#1E3A5F]' : 'font-medium text-[#57534E]'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>
                {item.mobileLabel}
                {item.id === 'history' && historyCount > 0 ? ` (${toPersianDigits(historyCount)})` : ''}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
