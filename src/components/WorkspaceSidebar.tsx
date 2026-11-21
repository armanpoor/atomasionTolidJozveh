import React, { useState } from 'react';
import {
  BookCopy,
  FilePlus2,
  FileText,
  FolderOpen,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  Play,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  AiModelId,
  AiRewriteLevel,
  AiThinkingLevel,
  DocxExportConfig,
  FileRole,
  GoogleSearchMode,
  OutputTonePreset,
  ProjectAiUsageLedger,
  ProjectSummaryDto,
  WorkflowMode,
} from '../lib/bookTypes';
import {
  AiProviderConfig,
  AiQuotaProbeResponse,
  getProviderDisplaySummary,
  GOOGLE_MODEL_OPTIONS,
} from '../lib/aiProviderConfig';
import {
  AI_REWRITE_LEVEL_OPTIONS,
  OUTPUT_TONE_OPTIONS,
  QUICK_CUSTOM_PROMPT_PRESETS,
} from '../lib/winolsMapGuide';
import { toPersianDigits } from '../lib/formatParsers';
import { AiQuotaGauge } from './AiQuotaGauge';
import { FileDropzone, QueuedUploadFile } from './FileDropzone';

const WORKFLOW_MODES: Array<{
  id: WorkflowMode;
  title: string;
  desc: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'single_polish',
    title: 'پالایش تک‌فایل',
    desc: 'مرتب‌سازی، فهرست خودکار، جدول و نمودار برای ۱ سند',
    Icon: Sparkles,
  },
  {
    id: 'multi_merge',
    title: 'ادغام بدون افت چندفایلی',
    desc: 'ترکیب ۲ تا ۱۰۰+ سند با حفظ ۱۰۰٪ نکات و کشف تناقض',
    Icon: Layers,
  },
  {
    id: 'master_update',
    title: 'به‌روزرسانی سند مرجع',
    desc: 'تزریق مطالب جدید فایل‌های تکمیلی به سند مرجع',
    Icon: BookCopy,
  },
  {
    id: 'raw_synthesis',
    title: 'تبدیل یادداشت خام',
    desc: 'فصل‌بندی و تبدیل متن‌های پراکنده به سند رسمی ورد',
    Icon: Wand2,
  },
];

interface WorkspaceSidebarProps {
  projects: ProjectSummaryDto[];
  activeProjectId: string | null;
  activeWorkflowMode: WorkflowMode;
  queuedFiles: QueuedUploadFile[];
  ingestedFilesCount: number;
  ingestedWordCount: number;
  chapterCount: number;
  aiUsage: ProjectAiUsageLedger;
  config: DocxExportConfig;
  providerConfig: AiProviderConfig;
  probeData: AiQuotaProbeResponse | null;
  probingQuota: boolean;
  processing: boolean;
  onRunLiveProbe: () => Promise<void>;
  onOpenProviderSettings: () => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (mode: WorkflowMode) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onChangeWorkflowMode: (mode: WorkflowMode) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onMoveFile: (id: string, dir: 'up' | 'down') => void;
  onClearFiles: () => void;
  onSetFileRole: (id: string, role: FileRole) => void;
  onChangeConfig: (patch: Partial<DocxExportConfig>) => void;
  onChangeOptimization: (patch: Partial<DocxExportConfig['optimization']>) => void;
  onStartPipeline: () => Promise<void>;
}

export const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
  projects,
  activeProjectId,
  activeWorkflowMode,
  queuedFiles,
  ingestedFilesCount,
  ingestedWordCount,
  chapterCount,
  aiUsage,
  config,
  providerConfig,
  probeData,
  probingQuota,
  processing,
  onRunLiveProbe,
  onOpenProviderSettings,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onChangeWorkflowMode,
  onAddFiles,
  onRemoveFile,
  onMoveFile,
  onClearFiles,
  onSetFileRole,
  onChangeConfig,
  onChangeOptimization,
  onStartPipeline,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canRun = !processing && (queuedFiles.length > 0 || ingestedFilesCount > 0);
  const queuedBytesCount = queuedFiles.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);

  return (
    <aside className="w-full lg:w-[350px] xl:w-[375px] shrink-0 border-l border-[#E2DDD3] bg-[#FCFBF8] flex flex-col lg:h-[calc(100vh-58px)] lg:overflow-y-auto">
      <div className="p-4 space-y-5">
        {/* 0. Compact AI Token & Live Quota Gauge */}
        <AiQuotaGauge
          usage={aiUsage}
          ingestedFilesCount={ingestedFilesCount}
          queuedFilesCount={queuedFiles.length}
          ingestedWordCount={ingestedWordCount}
          queuedBytesCount={queuedBytesCount}
          chapterCount={chapterCount}
          aiModel={config.aiModel}
          googleSearchMode={config.googleSearchMode}
          useAiBackend={config.useAiBackend}
          providerConfig={providerConfig}
          probeData={probeData}
          probing={probingQuota}
          onRunLiveProbe={onRunLiveProbe}
          onOpenProviderSettings={onOpenProviderSettings}
        />

        {/* 1. Saved Projects */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#1A1816]">
              <FolderOpen className="h-4 w-4 text-[#1E3A5F]" />
              <span>پروژه‌های من ({toPersianDigits(projects.length)})</span>
            </div>
            <button
              type="button"
              onClick={() => onCreateProject(activeWorkflowMode)}
              disabled={processing}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-md bg-[#EEF3F8] px-2.5 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#DFE9F4] cursor-pointer"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              پروژه جدید
            </button>
          </div>

          {projects.length > 0 && (
            <div className="max-h-36 overflow-y-auto space-y-1.5 pl-0.5">
              {projects.map((p) => {
                const selected = p.id === activeProjectId;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                      selected
                        ? 'border-[#1E3A5F] bg-[#EEF3F8] text-[#1E3A5F]'
                        : 'border-[#E5E0D6] bg-white text-[#1A1816] hover:border-[#CFC8B9]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectProject(p.id)}
                      className="flex-1 min-w-0 text-right cursor-pointer"
                    >
                      <div className="truncate font-bold">{p.title}</div>
                      <div className="text-[10.5px] text-[#78716C] mt-0.5">
                        مرحله {toPersianDigits(p.pipelineStage)} از ۵
                      </div>
                    </button>
                    {projects.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteProject(p.id)}
                        aria-label={`حذف پروژه ${p.title}`}
                        className="p-1.5 rounded-md text-[#9A3412] hover:bg-[#FDF2F0] cursor-pointer shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 2. 4 Workflow Modes */}
        <section className="space-y-2 border-t border-[#EAE5DA] pt-4">
          <div className="text-xs font-bold text-[#1A1816]">۱. انتخاب سناریوی پردازش</div>
          <div className="grid grid-cols-2 gap-2">
            {WORKFLOW_MODES.map((m) => {
              const Icon = m.Icon;
              const active = activeWorkflowMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onChangeWorkflowMode(m.id)}
                  disabled={processing}
                  className={`rounded-lg border p-2.5 text-right transition-colors cursor-pointer ${
                    active
                      ? 'border-[#1E3A5F] bg-[#EEF3F8] text-[#1E3A5F]'
                      : 'border-[#E5E0D6] bg-white text-[#1A1816] hover:border-[#C9C1B2]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-[11.5px]">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{m.title}</span>
                  </div>
                  <p className="mt-1 text-[10.5px] leading-4 text-[#57534E] line-clamp-2">
                    {m.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        {/* 3. Multi-file Dropzone */}
        <section className="border-t border-[#EAE5DA] pt-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-[#1A1816]">
              ۲. فایل‌های ورودی ({activeWorkflowMode === 'master_update' ? 'مرجع + تکمیلی' : 'چندفایلی'})
            </div>
            {ingestedFilesCount > 0 && queuedFiles.length === 0 && (
              <span className="text-[11px] font-semibold text-[#14532D]">
                {toPersianDigits(ingestedFilesCount)} فایل ثبت‌شده
              </span>
            )}
          </div>
          {activeWorkflowMode === 'master_update' && (
            <p className="mt-1 text-[11px] text-[#57534E] leading-5">
              روی برچسب هر فایل بزنید تا «سند مرجع (Master)» و فایل‌های تکمیلی مشخص شوند.
            </p>
          )}
          <FileDropzone
            queuedFiles={queuedFiles}
            onAddFiles={onAddFiles}
            onRemoveFile={onRemoveFile}
            onMoveFile={onMoveFile}
            onClearFiles={onClearFiles}
            showRoleSelector={activeWorkflowMode === 'master_update'}
            onSetFileRole={onSetFileRole}
            disabled={processing}
          />
        </section>

        {/* 4. Primary Stage-1 CTA (Single Responsibility: Ingest & Extract Only) */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onStartPipeline}
            disabled={!canRun}
            className="w-full min-h-[46px] flex items-center justify-center gap-2 rounded-xl bg-[#1E3A5F] hover:bg-[#162C49] text-white font-bold text-sm transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                در حال استخراج فایل‌ها (مرحله ۱)...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                {queuedFiles.length > 0
                  ? `مرحله ۱: استخراج و ثبت فایل‌ها (${toPersianDigits(queuedFiles.length)})`
                  : 'باز کردن گام بعدی ورک‌فلو'}
              </>
            )}
          </button>
          <p className="text-[10.5px] leading-4 text-[#78716C] text-center">
            هر مرحله جداگانه اجرا می‌شود: ابتدا استخراج فایل‌ها، سپس ممیزی و ادغام، سپس فصل‌بندی و صفحه‌آرایی.
          </p>
        </div>

        {/* 5. AI Model, Modular Visuals & Isolated Google Search Settings */}
        <section className="border-t border-[#EAE5DA] pt-3 space-y-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-bold text-[#1A1816] py-1 cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#1E3A5F]" />
              تنظیمات مدل هوش مصنوعی، صفحه‌آرایی و جستجوی گوگل
            </span>
            <span className="text-[11px] text-[#1E3A5F]">
              {showAdvanced ? 'بستن' : 'نمایش'}
            </span>
          </button>

          {showAdvanced && (
            <div className="space-y-3.5 rounded-xl border border-[#E5E0D6] bg-white p-3.5 text-xs">
              {/* Provider & Custom Base URL / API Key Button */}
              {(() => {
                const summary = getProviderDisplaySummary(providerConfig, config.aiModel);
                return (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-[#DDE6F0] bg-[#F5F8FC] px-2.5 py-2">
                    <div className="min-w-0">
                      <div className="font-bold text-[#1E3A5F] truncate">
                        {summary.providerLabel} · {summary.keySourceLabel}
                      </div>
                      <div className="text-[10.5px] text-[#57534E] truncate">
                        {summary.modelLabel}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenProviderSettings}
                      className="inline-flex min-h-[30px] shrink-0 items-center gap-1 rounded-md border border-[#1E3A5F] bg-white px-2.5 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                    >
                      <KeyRound className="h-3 w-3" />
                      <span>تغییر</span>
                    </button>
                  </div>
                );
              })()}

              {/* Model (Strictly Gemini 4 Hydrogen & Gemini 3.8 Flash) */}
              {providerConfig.provider === 'google_aistudio' && (
                <div className="space-y-1.5">
                  <label className="block font-bold text-[#1A1816]">مدل هوش مصنوعی Google AI Studio</label>
                  <select
                    value={config.aiModel}
                    onChange={(e) =>
                      onChangeConfig({ aiModel: e.target.value as AiModelId })
                    }
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-xs text-[#1A1816]"
                  >
                    {GOOGLE_MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.labelFa}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Thinking level */}
              {providerConfig.provider === 'google_aistudio' && (
                <div className="space-y-1.5">
                  <label className="block font-bold text-[#1A1816]">سطح دقت و استدلال</label>
                  <select
                    value={config.aiThinkingLevel}
                    onChange={(e) =>
                      onChangeConfig({ aiThinkingLevel: e.target.value as AiThinkingLevel })
                    }
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-xs text-[#1A1816]"
                  >
                    <option value="HIGH">بالا (HIGH — پیش‌فرض)</option>
                    <option value="MEDIUM">متوسط (MEDIUM)</option>
                    <option value="LOW">پایین (LOW)</option>
                    {config.aiModel === 'gemini-4-hydrogen' && (
                      <option value="XHIGH">بسیار عمیق (XHIGH)</option>
                    )}
                  </select>
                </div>
              )}

              {/* Isolated Google Search Mode */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 font-bold text-[#5B21B6]">
                  <Globe className="h-3.5 w-3.5" />
                  جستجوی گوگل (ایزوله با لینک منبع)
                </label>
                <select
                  value={config.googleSearchMode}
                  onChange={(e) =>
                    onChangeConfig({ googleSearchMode: e.target.value as GoogleSearchMode })
                  }
                  className="w-full rounded-lg border border-[#D7CBE6] bg-[#F7F4FA] px-2.5 py-2 text-xs text-[#1A1816]"
                >
                  <option value="off">خاموش (فقط متن فایل‌های کاربر)</option>
                  <option value="conflicts_only">فقط برای راستی‌آزمایی تناقض‌ها (پیش‌فرض)</option>
                  <option value="conflicts_and_enrichment">
                    تناقض‌ها + باکس تکمیلی وب برای فصل‌های کلیدی
                  </option>
                  <option value="full_document_enrichment">
                    تکمیل جامع کل متن خروجی با گوگل (تمام فصل‌ها)
                  </option>
                </select>
                {config.googleSearchMode === 'full_document_enrichment' && (
                  <p className="text-[10.5px] leading-5 text-[#5B21B6]">
                    در زمان ساخت نهایی، همه فصل‌ها با جستجوی گوگل و لینک منابع معتبر در باکس‌های مجزا تکمیل می‌شوند (بدون تغییر یا حذف متن فایل‌های اصلی شما).
                  </p>
                )}
              </div>

              {/* Bounded AI Editorial Control: Rewrite Intensity, Output Tone & Custom Prompt */}
              <div className="space-y-2.5 border-t border-[#EFECE4] pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-bold text-[#1A1816]">
                    <Wand2 className="h-3.5 w-3.5 text-[#1E3A5F]" />
                    میزان بازنویسی هوش مصنوعی و لحن خروجی
                  </span>
                </div>

                {/* 3-Tier Rewrite Level Segmented Control */}
                <div className="space-y-1">
                  <span className="block text-[11px] font-semibold text-[#44403C]">
                    حد مجاز تغییر متن توسط AI
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    {AI_REWRITE_LEVEL_OPTIONS.map((opt) => {
                      const active = (config.aiRewriteLevel || 'light_polish') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            onChangeConfig({ aiRewriteLevel: opt.id as AiRewriteLevel })
                          }
                          className={`rounded-md border px-1.5 py-1.5 text-[10.5px] font-bold transition-colors cursor-pointer ${
                            active
                              ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                              : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#44403C] hover:bg-[#EFECE4]'
                          }`}
                        >
                          {opt.shortLabelFa}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10.5px] leading-5 text-[#57534E]">
                    {
                      (
                        AI_REWRITE_LEVEL_OPTIONS.find(
                          (o) => o.id === (config.aiRewriteLevel || 'light_polish')
                        ) || AI_REWRITE_LEVEL_OPTIONS[1]
                      ).descriptionFa
                    }
                  </p>
                </div>

                {/* Output Tone Selector */}
                <div className="space-y-1">
                  <label
                    htmlFor="sidebar-output-tone"
                    className="block text-[11px] font-semibold text-[#44403C]"
                  >
                    لحن و سبک نگارش سند نهایی
                  </label>
                  <select
                    id="sidebar-output-tone"
                    value={config.outputTone || 'workshop_practical'}
                    onChange={(e) =>
                      onChangeConfig({ outputTone: e.target.value as OutputTonePreset })
                    }
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-[11.5px] text-[#1A1816]"
                  >
                    {OUTPUT_TONE_OPTIONS.map((tone) => (
                      <option key={tone.id} value={tone.id}>
                        {tone.labelFa}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Custom User Style Prompt + Quick Presets */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="sidebar-custom-style-prompt"
                    className="block text-[11px] font-semibold text-[#44403C]"
                  >
                    پرامپت و دستورالعمل اختصاصی خروجی
                  </label>
                  <textarea
                    id="sidebar-custom-style-prompt"
                    rows={3}
                    value={config.customStylePrompt || ''}
                    onChange={(e) => onChangeConfig({ customStylePrompt: e.target.value })}
                    placeholder="مثلاً: با لحن استاد کارگاهی بنویس، بعد از هر مپ WinOLS نکته ایمنی ناک بگذار و اعداد را تغییر نده..."
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-[11px] leading-5 text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1E3A5F] focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-1">
                    {QUICK_CUSTOM_PROMPT_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onChangeConfig({ customStylePrompt: preset.promptText })}
                        className="rounded border border-[#D6D0C4] bg-white px-2 py-1 text-[10px] font-semibold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                      >
                        + {preset.labelFa}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Modular Visual & Word Toggles */}
              <div className="space-y-2 border-t border-[#EFECE4] pt-2.5">
                <div className="flex items-center gap-1.5 font-bold text-[#1A1816]">
                  <FileText className="h-3.5 w-3.5 text-[#1E3A5F]" />
                  خروجی ورد و غنی‌سازی بصری
                </div>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>تولید خودکار جدول راهنمای تغییرات WinOLS</span>
                  <input
                    type="checkbox"
                    checked={config.includeWinolsActionTables !== false}
                    onChange={(e) =>
                      onChangeConfig({ includeWinolsActionTables: e.target.checked })
                    }
                    className="h-4 w-4 accent-[#1E3A5F]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>فهرست مطالب خودکار (Word TOC)</span>
                  <input
                    type="checkbox"
                    checked={config.includeAutoToc}
                    onChange={(e) => onChangeConfig({ includeAutoToc: e.target.checked })}
                    className="h-4 w-4 accent-[#1E3A5F]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>تولید خودکار نمودارهای SVG/PNG داخلی</span>
                  <input
                    type="checkbox"
                    checked={config.optimization.embedGeneratedTablesAndDiagrams}
                    onChange={(e) =>
                      onChangeOptimization({
                        embedGeneratedTablesAndDiagrams: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-[#1E3A5F]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>پیشنهادهای تصویر و جدول آموزشی</span>
                  <input
                    type="checkbox"
                    checked={config.includeVisualSuggestions}
                    onChange={(e) =>
                      onChangeConfig({ includeVisualSuggestions: e.target.checked })
                    }
                    className="h-4 w-4 accent-[#1E3A5F]"
                  />
                </label>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span>فونت ورد</span>
                  <select
                    value={config.fontFamily}
                    onChange={(e) =>
                      onChangeConfig({
                        fontFamily: e.target.value as DocxExportConfig['fontFamily'],
                      })
                    }
                    className="rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2 py-1 text-[11px]"
                  >
                    <option value="Vazir Medium">Vazir Medium (پیش‌فرض)</option>
                    <option value="Vazirmatn Medium">Vazirmatn Medium</option>
                    <option value="B Nazanin">B Nazanin</option>
                  </select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>تراز متن بدنه ورد</span>
                  <select
                    value={config.bodyAlignment ?? 'both'}
                    onChange={(e) =>
                      onChangeConfig({
                        bodyAlignment: e.target.value as 'both' | 'right',
                      })
                    }
                    className="rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2 py-1 text-[11px]"
                  >
                    <option value="both">تراز دوطرفه کتابی (پیشنهادی)</option>
                    <option value="right">راست‌چین ساده</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
