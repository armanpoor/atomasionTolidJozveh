import {
  AlertCircle,
  BookMarked,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  Loader2,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import {
  AiModelId,
  AiThinkingLevel,
  DocxExportConfig,
  OptimizationOptions,
} from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';
import { FileDropzone, QueuedUploadFile } from './FileDropzone';

export type { QueuedUploadFile };

interface BuilderFlowViewProps {
  queuedFiles: QueuedUploadFile[];
  onAddFiles: (files: FileList | File[]) => void;
  onAddSampleBook: () => void;
  onRemoveFile: (id: string) => void;
  onMoveFile: (id: string, direction: 'up' | 'down') => void;
  onClearFiles: () => void;
  config: DocxExportConfig;
  onConfigChange: (next: DocxExportConfig) => void;
  onProcessAndBuild: (forceLocal?: boolean) => void;
  isProcessing: boolean;
  progressStage: string | null;
  aiServerConfigured: boolean | null;
  errorState: { message: string; canFallbackToLocal?: boolean } | null;
  isLoadingSample: boolean;
}

const MODELS: Array<{
  id: AiModelId;
  name: string;
  badge: string;
  desc: string;
  levels: AiThinkingLevel[];
}> = [
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen (هیدروژن)',
    badge: 'پیش‌فرض · پیشنهادی',
    desc: 'بهترین تعادل دقت و عمق تحلیل برای فصل‌بندی موضوعی چند فایل، تشخیص تکرارهای معنایی و تولید جداول و نمودارهای آموزشی فارسی.',
    levels: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH'],
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite (سریع)',
    badge: 'سرعت بالا',
    desc: 'مناسب برای فایل‌های سبک و کوتاه یا زمانی که سرعت پردازش اولویت اصلی است.',
    levels: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
  },
];

const THINKING_LABELS: Record<AiThinkingLevel, { title: string; hint: string }> = {
  MINIMAL: { title: 'Minimal', hint: 'حداقل استدلال' },
  LOW: { title: 'Low', hint: 'سریع' },
  MEDIUM: { title: 'Medium', hint: 'متعادل' },
  HIGH: { title: 'High', hint: 'پیش‌فرض دقیق' },
  XHIGH: { title: 'XHigh', hint: 'عمیق‌ترین تحلیل' },
};

export function BuilderFlowView({
  queuedFiles,
  onAddFiles,
  onAddSampleBook,
  onRemoveFile,
  onMoveFile,
  onClearFiles,
  config,
  onConfigChange,
  onProcessAndBuild,
  isProcessing,
  progressStage,
  aiServerConfigured,
  errorState,
  isLoadingSample,
}: BuilderFlowViewProps) {
  const [showAdvancedWord, setShowAdvancedWord] = useState(false);

  const selectedModelMeta = MODELS.find((m) => m.id === config.aiModel) || MODELS[0];

  const handleModelChange = (modelId: AiModelId) => {
    const meta = MODELS.find((m) => m.id === modelId) || MODELS[0];
    const nextLevel = meta.levels.includes(config.aiThinkingLevel)
      ? config.aiThinkingLevel
      : 'HIGH';
    onConfigChange({
      ...config,
      aiModel: modelId,
      aiThinkingLevel: nextLevel,
    });
  };

  const updateOpt = (key: keyof OptimizationOptions, val: boolean) => {
    onConfigChange({
      ...config,
      optimization: {
        ...config.optimization,
        [key]: val,
      },
    });
  };

  return (
    <div className="mx-auto w-full max-w-[920px] space-y-6 px-4 pt-6 pb-24 sm:px-6 md:pb-12">
      {/* Calm Hero Header */}
      <div className="space-y-2">
        <h1 className="text-xl font-extrabold leading-snug text-[#1A1816] sm:text-2xl">
          ترکیب، یکپارچه‌سازی و تبدیل فایل‌ها به سند ورد استاندارد
        </h1>
        <p className="text-sm leading-relaxed text-[#57534E]">
          هر تعداد فایل ورد یا متنی انتخاب کنید؛ سیستم تمام مباحث پراکنده را در فصل‌های موضوعی منسجم تفکیک می‌کند، تکرارها را بدون حذف هیچ مفهومی ادغام می‌کند، جداول و نمودارهای آموزشی را می‌سازد و فایل ورد نهایی را با فونت{' '}
          <strong className="font-bold text-[#1E3A5F]">{config.fontFamily}</strong> و فهرست خودکار تحویل می‌دهد.
        </p>
      </div>

      {/* STEP 1: FILE SELECTION (Completely open, multi-file, touch-friendly) */}
      <section className="rounded-md border border-[#E2DDD3] bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-[#1E3A5F] text-xs font-bold text-white">
              ۱
            </span>
            <div>
              <h2 className="text-base font-bold text-[#1A1816]">انتخاب فایل‌های ورودی</h2>
              <p className="text-xs text-[#57534E]">
                یک یا چند فایل Word، Markdown، TXT، JSON، CSV یا HTML را بکشید و رها کنید
              </p>
            </div>
          </div>
        </div>

        <FileDropzone
          queuedFiles={queuedFiles}
          onAddFiles={onAddFiles}
          onRemoveFile={onRemoveFile}
          onMoveFile={onMoveFile}
          onClearFiles={onClearFiles}
          disabled={isProcessing}
        />

        {/* Optional Quick-Load of Previously Attached Sample Book */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#EFECE4] pt-3.5 text-xs">
          <span className="text-[#78716C]">
            می‌خواهید سریع با کتاب مرجع ریمپ ایسیو تست کنید؟
          </span>
          <button
            type="button"
            disabled={isLoadingSample}
            onClick={onAddSampleBook}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-sm border border-[#D8D2C5] bg-[#FBF9F5] px-3 py-1.5 font-semibold text-[#1E3A5F] hover:border-[#1E3A5F] disabled:opacity-50"
          >
            {isLoadingSample ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BookMarked className="h-3.5 w-3.5" />
            )}
            <span>افزودن فایل نمونه (کتاب مرجع ریمپ ایسیو)</span>
          </button>
        </div>
      </section>

      {/* STEP 2: AI MODEL & THINKING LEVEL + VISUAL EMBEDDING */}
      <section className="rounded-md border border-[#E2DDD3] bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-[#1E3A5F] text-xs font-bold text-white">
              ۲
            </span>
            <div>
              <h2 className="text-base font-bold text-[#1A1816]">مدل هوش مصنوعی و سطح دقت</h2>
              <p className="text-xs text-[#57534E]">
                انتخاب مدل پردازش پس‌زمینه برای فصل‌بندی موضوعی، حذف تکرار و ساخت جداول و نمودارها
              </p>
            </div>
          </div>

          <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-xs font-semibold text-[#1A1816]">
            <input
              type="checkbox"
              checked={config.useAiBackend}
              onChange={(e) => onConfigChange({ ...config, useAiBackend: e.target.checked })}
              className="h-4 w-4 accent-[#1E3A5F]"
            />
            <span>تحلیل عمیق با هوش مصنوعی</span>
          </label>
        </div>

        {/* Model Selector Cards */}
        {config.useAiBackend && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {MODELS.map((m) => {
                const selected = config.aiModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleModelChange(m.id)}
                    className={`flex flex-col items-start rounded-sm border p-4 text-right transition-colors ${
                      selected
                        ? 'border-[#1E3A5F] bg-[#F3F7FB]'
                        : 'border-[#E2DDD3] bg-[#FBF9F5] hover:border-[#B7C7DA]'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-[#1E3A5F]" />
                        <span className="text-sm font-bold text-[#1A1816]">{m.name}</span>
                      </div>
                      {selected && <Check className="h-4 w-4 shrink-0 text-[#1E3A5F]" />}
                    </div>
                    <span className="mt-1 text-[11px] font-semibold text-[#1E3A5F]">{m.badge}</span>
                    <p className="mt-2 text-xs leading-relaxed text-[#57534E]">{m.desc}</p>
                  </button>
                );
              })}
            </div>

            {/* Thinking Level Segmented Buttons */}
            <div className="rounded-sm border border-[#E2DDD3] bg-[#FBF9F5] p-3.5">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#1A1816]">
                  سطح استدلال و عمق تحلیل (Thinking Level)
                </span>
                <span className="text-[11px] text-[#57534E]">
                  پیش‌فرض: <strong className="text-[#1E3A5F]">High</strong> روی هیدروژن
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {selectedModelMeta.levels.map((lvl) => {
                  const active = config.aiThinkingLevel === lvl;
                  const meta = THINKING_LABELS[lvl];
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => onConfigChange({ ...config, aiThinkingLevel: lvl })}
                      className={`min-h-[44px] rounded-sm border px-3 py-2 text-center transition-colors ${
                        active
                          ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                          : 'border-[#D8D2C5] bg-white text-[#292524] hover:border-[#1E3A5F]'
                      }`}
                    >
                      <div className="font-mono-ltr text-xs font-bold">{meta.title}</div>
                      <div className={`text-[10px] ${active ? 'text-[#CBD9EA]' : 'text-[#78716C]'}`}>
                        {meta.hint}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {aiServerConfigured === false && (
              <div className="flex items-start gap-2.5 rounded-sm border border-[#E2D4B7] bg-[#FAF6EC] p-3 text-xs text-[#854D0E]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="leading-relaxed">
                  در محیط فعلی سرور، کلید API هوش مصنوعی تنظیم نشده است (Settings &gt; Secrets). در صورت نیاز می‌توانید تحلیل را با موتور یکپارچه‌ساز داخلی نیز اجرا کنید یا کلید را در تنظیمات قرار دهید.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Direct Table & Diagram Embedding Toggle */}
        <div className="mt-4 rounded-sm border border-[#D2DFEE] bg-[#F4F8FC] p-3.5">
          <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={config.optimization.embedGeneratedTablesAndDiagrams}
              onChange={(e) => updateOpt('embedGeneratedTablesAndDiagrams', e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[#1E3A5F]"
            />
            <div className="text-xs leading-relaxed">
              <div className="flex items-center gap-1.5 font-bold text-[#1E3A5F]">
                <Layers className="h-3.5 w-3.5" />
                <span>تولید و درج واقعی جداول خلاصه و نمودارهای آموزشی در متن و فایل ورد</span>
              </div>
              <p className="mt-0.5 text-[#44403C]">
                به‌جای پیشنهاد متنی صرف، جداول مقایسه‌ای و فلوچارت‌ها/نمودارهای تصویری فارسی (با کیفیت بالا) ساخته شده و مستقیماً در جای مناسب داخل فایل `.docx` درج می‌شوند.
              </p>
            </div>
          </label>
        </div>

        {/* Collapsible Word Settings Accordion (keeps main UI clean & simple!) */}
        <div className="mt-4 border-t border-[#EFECE4] pt-3">
          <button
            type="button"
            onClick={() => setShowAdvancedWord((v) => !v)}
            className="flex min-h-[44px] w-full items-center justify-between text-right text-xs font-bold text-[#1E3A5F]"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              <span>
                تنظیمات خروجی ورد ({config.fontFamily} · {config.paperSize} · فهرست خودکار · راست‌چین)
              </span>
            </span>
            {showAdvancedWord ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showAdvancedWord && (
            <div className="mt-3 space-y-4 rounded-sm border border-[#E2DDD3] bg-[#FBF9F5] p-4 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="builder-font" className="mb-1 block font-bold text-[#1A1816]">
                    فونت سند ورد
                  </label>
                  <select
                    id="builder-font"
                    value={config.fontFamily}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        fontFamily: e.target.value as DocxExportConfig['fontFamily'],
                      })
                    }
                    className="min-h-[42px] w-full rounded-sm border border-[#D8D2C5] bg-white px-2.5 text-xs"
                  >
                    <option value="Vazir Medium">Vazir Medium (وزیر مدیوم)</option>
                    <option value="Vazirmatn Medium">Vazirmatn Medium</option>
                    <option value="Vazir">Vazir</option>
                    <option value="B Nazanin">B Nazanin</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="builder-paper" className="mb-1 block font-bold text-[#1A1816]">
                    قطع صفحه
                  </label>
                  <select
                    id="builder-paper"
                    value={config.paperSize}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        paperSize: e.target.value as DocxExportConfig['paperSize'],
                      })
                    }
                    className="min-h-[42px] w-full rounded-sm border border-[#D8D2C5] bg-white px-2.5 text-xs"
                  >
                    <option value="A4">A4 استاندارد</option>
                    <option value="B5">B5 قطع وزیری</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="builder-size" className="mb-1 block font-bold text-[#1A1816]">
                    اندازه متن
                  </label>
                  <select
                    id="builder-size"
                    value={config.baseFontSizePt}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        baseFontSizePt: Number(e.target.value) as DocxExportConfig['baseFontSizePt'],
                      })
                    }
                    className="min-h-[42px] w-full rounded-sm border border-[#D8D2C5] bg-white px-2.5 text-xs"
                  >
                    <option value={10.5}>۱۰.۵ پوینت</option>
                    <option value={11}>۱۱ پوینت (پیشنهادی)</option>
                    <option value={12}>۱۲ پوینت</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 border-t border-[#E2DDD3] pt-3 sm:grid-cols-2">
                {(
                  [
                    ['includeCoverPage', 'صفحه جلد رسمی و شناسنامه سند'],
                    ['includeAutoToc', 'فهرست مطالب خودکار ورد (TOC)'],
                    ['includeHeadersAndFooters', 'سرصفحه و شماره‌گذاری خودکار صفحات'],
                    ['includeGlossary', 'پیوست واژه‌نامه یکپارچه اصطلاحات'],
                    ['includeListOfTables', 'پیوست فهرست جداول یکپارچه'],
                    ['includeMasterCheatSheet', 'پیوست برگه تقلب و نکات طلایی'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex min-h-[36px] cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={config[key]}
                      onChange={(e) => onConfigChange({ ...config, [key]: e.target.checked })}
                      className="h-4 w-4 accent-[#1E3A5F]"
                    />
                    <span className="text-[#292524]">{label}</span>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-2 border-t border-[#E2DDD3] pt-3 sm:grid-cols-2">
                {(
                  [
                    ['clusterThematicallyAcrossFiles', 'فصل‌بندی موضوعی و تجمیع مطالب پراکنده'],
                    ['consolidateDuplicateBlocks', 'حذف و ادغام بندها و کادرهای تکراری'],
                    ['deduplicateFootnotes', 'یکپارچه‌سازی پانویس‌های تکراری'],
                    ['renumberTablesSequentially', 'شماره‌گذاری پیوسته جداول بر اساس فصل'],
                    ['repairTypographyArtifacts', 'اصلاح خطاهای تایپی و تبدیل ماشینی'],
                    ['normalizePersianHalfSpaces', 'استانداردسازی نیم‌فاصله فارسی'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex min-h-[36px] cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={config.optimization[key]}
                      onChange={(e) => updateOpt(key, e.target.checked)}
                      className="h-4 w-4 accent-[#1E3A5F]"
                    />
                    <span className="text-[#292524]">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Error Notice (Honest API Error Propagation + Optional Local Processing) */}
      {errorState && (
        <div className="rounded-md border border-[#E6BFB7] bg-[#FDF2F0] p-4 text-xs text-[#9A3412]">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="font-bold">خطا در مرحله پردازش:</div>
              <p className="leading-relaxed">{errorState.message}</p>
              {errorState.canFallbackToLocal && (
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => onProcessAndBuild(true)}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-sm bg-[#1E3A5F] px-4 py-2 font-semibold text-white hover:bg-[#162C49]"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>ادامه و ساخت فایل ورد با موتور یکپارچه‌ساز داخلی (بدون API)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: PRIMARY ACTION CTA */}
      <div className="space-y-3">
        <button
          type="button"
          disabled={queuedFiles.length === 0 || isProcessing}
          onClick={() => onProcessAndBuild(false)}
          className="flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-md bg-[#1E3A5F] px-6 py-3.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#162C49] disabled:cursor-not-allowed disabled:opacity-45 sm:text-base"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>{progressStage || 'در حال پردازش و یکپارچه‌سازی اسناد...'}</span>
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" />
              <span>
                {queuedFiles.length > 1
                  ? `ترکیب ${toPersianDigits(queuedFiles.length)} فایل، یکپارچه‌سازی و ساخت فایل ورد`
                  : 'تحلیل، یکپارچه‌سازی و ساخت فایل ورد نهایی'}
              </span>
            </>
          )}
        </button>

        {queuedFiles.length === 0 && (
          <p className="text-center text-xs text-[#78716C]">
            ابتدا حداقل یک فایل در گام ۱ انتخاب کنید (یا فایل نمونه را اضافه نمایید).
          </p>
        )}
      </div>
    </div>
  );
}
