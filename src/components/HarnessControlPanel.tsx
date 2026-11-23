import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookCheck,
  CheckCircle2,
  Cpu,
  Database,
  DollarSign,
  FileOutput,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  StepForward,
} from 'lucide-react';
import type { UseHarnessRunnerResult } from '../hooks/useHarnessRunner';
import { toPersianDigits } from '../lib/formatParsers';
import { computeCoverageLedgerStats } from '../lib/harness/harnessStore';
import type { QuarantineItem, SemanticBlock } from '../lib/harness/types';

interface HarnessControlPanelProps {
  harness: UseHarnessRunnerResult;
  onOpenProviderSettings?: () => void;
}

type HarnessPanelTab = 'gate_and_run' | 'quarantine' | 'glossary';

const QuarantineCard: React.FC<{
  item: QuarantineItem;
  resolving: boolean;
  onResolve: (
    sectionId: string,
    payload: { editedBlocks: SemanticBlock[]; resolutionNote: string }
  ) => Promise<void>;
}> = ({ item, resolving, onResolve }) => {
  const [blocks, setBlocks] = useState<SemanticBlock[]>(item.draftIR.blocks);
  const [note, setNote] = useState(item.resolutionNote || '');

  useEffect(() => {
    setBlocks(item.draftIR.blocks);
  }, [item.draftIR.blocks]);

  const handleTextChange = (idx: number, nextText: string) => {
    setBlocks((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, text: nextText } : b))
    );
  };

  return (
    <div className="rounded-lg border border-[#E5C6BD] bg-[#FFFBF9] p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#F2DCD6] pb-2.5">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#9A3412]">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {item.chapterTitle} — {item.sectionTitle}
            </span>
          </div>
          <div className="text-[11px] text-[#78716C] tabular-nums">
            تلاش‌های ترمیم جراحی: {toPersianDigits(item.attempts)} از {toPersianDigits(item.maxAttempts)} ·{' '}
            {toPersianDigits(item.sourceChunkIds.length)} قطعه منبع مرتبط
          </div>
        </div>
        {item.resolved ? (
          <span className="text-[11px] font-bold text-[#14532D] inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            تعیین‌تکلیف شد
          </span>
        ) : null}
      </div>

      {/* Layer 1 & Layer 2 Audit Errors */}
      <div className="space-y-1.5 text-[11.5px]">
        {item.layer1Issues.length > 0 && (
          <div className="rounded-md bg-white border border-[#EFE3DF] p-2.5 space-y-1">
            <div className="font-bold text-[#9A3412]">یافته‌های گارد قطعی لایه ۱ (۰ توکن):</div>
            <ul className="list-disc pr-4 space-y-0.5 text-[#57534E]">
              {item.layer1Issues.slice(0, 5).map((iss) => (
                <li key={iss.id}>{iss.messageFa}</li>
              ))}
            </ul>
          </div>
        )}
        {item.layer2Issues.length > 0 && (
          <div className="rounded-md bg-white border border-[#EFE3DF] p-2.5 space-y-1">
            <div className="font-bold text-[#7C4706]">یافته‌های ممیز معنایی لایه ۲:</div>
            <ul className="list-disc pr-4 space-y-0.5 text-[#57534E]">
              {item.layer2Issues.slice(0, 5).map((iss) => (
                <li key={iss.id}>{iss.messageFa}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Inline Block Editor */}
      {!item.resolved && (
        <div className="space-y-2.5">
          <div className="text-[11px] font-bold text-[#44403C]">
            ویرایش مستقیم بلوک‌های Semantic IR پیش از تأیید دستی:
          </div>
          {blocks.map((blk, idx) => (
            <div key={blk.id} className="space-y-1">
              <div className="flex items-center justify-between text-[10.5px] text-[#78716C]">
                <span className="font-mono">{blk.id} ({blk.kind})</span>
                <span>منابع: {blk.sourceChunkIds.join(', ')}</span>
              </div>
              <textarea
                value={blk.text ?? blk.gapReason ?? (blk.items || []).join('\n')}
                onChange={(e) => handleTextChange(idx, e.target.value)}
                rows={3}
                dir="rtl"
                className="w-full rounded-md border border-[#D6D0C4] bg-white px-3 py-2 text-xs leading-6 text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
              />
            </div>
          ))}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="یادداشت کوتاه تأیید (اختیاری)..."
              className="flex-1 rounded-md border border-[#D6D0C4] bg-white px-3 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
            />
            <button
              type="button"
              disabled={resolving}
              onClick={() =>
                void onResolve(item.sectionId, {
                  editedBlocks: blocks,
                  resolutionNote: note || 'تأیید و اصلاح دستی از صف قرنطینه',
                })
              }
              className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-[#14532D] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F3F22] disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              {resolving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              <span>تأیید دستی و انتقال به سند نهایی</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const HarnessControlPanel: React.FC<HarnessControlPanelProps> = ({
  harness,
  onOpenProviderSettings,
}) => {
  const {
    harnessState,
    routingInfo,
    initializing,
    approving,
    running,
    resolvingSectionId,
    syncingBook,
    error,
    lastStepMessage,
    initBlueprint,
    approveAndOptionallyStart,
    startRun,
    pauseRun,
    runSingleStep,
    resolveQuarantine,
    syncBookFromHarness,
    clearError,
  } = harness;

  const [activeTab, setActiveTab] = useState<HarnessPanelTab>('gate_and_run');
  const [budgetCapInput, setBudgetCapInput] = useState<string>(
    String(harnessState?.blueprint.budgetCapUsd ?? 2.0)
  );

  useEffect(() => {
    if (harnessState?.blueprint.budgetCapUsd) {
      setBudgetCapInput(String(harnessState.blueprint.budgetCapUsd));
    }
  }, [harnessState?.blueprint.budgetCapUsd]);

  const stats = useMemo(
    () => (harnessState ? computeCoverageLedgerStats(harnessState.coverageLedger) : null),
    [harnessState]
  );

  const unresolvedQuarantines = useMemo(
    () => (harnessState?.quarantineQueue || []).filter((q) => !q.resolved),
    [harnessState]
  );

  const cacheHitPercent = useMemo(() => {
    if (!harnessState) return 0;
    const totalIn = harnessState.telemetry.totalPromptTokens;
    if (totalIn <= 0) return 0;
    return Math.min(100, Math.round((harnessState.telemetry.cachedInputTokens / totalIn) * 100));
  }, [harnessState]);

  const parsedBudgetCap = Math.max(0.1, Number(budgetCapInput) || 2.0);
  const progressPct = stats && stats.totalSections > 0
    ? Math.round(((stats.verifiedSections + stats.quarantinedSections) / stats.totalSections) * 100)
    : 0;

  return (
    <section
      data-testid="harness-control-panel"
      aria-label="موتور هارنس تخصصی ECU و WinOLS"
      className="rounded-xl border border-[#D8D1C4] bg-white overflow-hidden"
    >
      {/* Top Bar */}
      <div className="border-b border-[#EFECE4] bg-[#FCFBF8] px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-extrabold text-[#1A1816]">
            <Cpu className="h-4 w-4 text-[#1E3A5F] shrink-0" />
            <span>هارنس مرحله‌محور تخصصی ECU و WinOLS (بدون افت و بدون توهم فنی)</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#57534E]">
            <span className="inline-flex items-center gap-1">
              <Database className="h-3 w-3 text-[#14532D]" />
              ذخیره ترکیبی Cloud SQL + IndexedDB
            </span>
            <span aria-hidden="true">·</span>
            <span>فراخوانی بی‌حافظه (Stateless) با Prompt Caching</span>
            <span aria-hidden="true">·</span>
            <span>ممیزی دولایه + مدار شکن بودجه</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onOpenProviderSettings && (
            <button
              type="button"
              onClick={onOpenProviderSettings}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#44403C] hover:bg-[#F5F3EE] cursor-pointer whitespace-nowrap"
            >
              تنظیم مدل‌های ۳لایه / 9Router
            </button>
          )}

          <button
            type="button"
            disabled={initializing || running}
            onClick={() =>
              void initBlueprint({
                budgetCapUsd: parsedBudgetCap,
                forceReset: Boolean(harnessState && !harnessState.blueprint.approved),
              })
            }
            data-testid="harness-init-blueprint-btn"
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#1E3A5F]/30 bg-[#EEF3F8] px-3 py-1.5 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#E1EBF5] disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {initializing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>{harnessState ? 'به‌روزرسانی نقشه راه (۰ توکن)' : 'ساخت نقشه راه و برآورد هزینه (۰ توکن)'}</span>
          </button>
        </div>
      </div>

      {/* Sub-Tabs when initialized */}
      {harnessState && (
        <div className="border-b border-[#EFECE4] bg-white px-4 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('gate_and_run')}
            className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'gate_and_run'
                ? 'border-[#1E3A5F] text-[#1E3A5F]'
                : 'border-transparent text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            دروازه تأیید (HITL) و اجرا
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('quarantine')}
            data-testid="harness-quarantine-tab"
            className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
              activeTab === 'quarantine'
                ? 'border-[#9A3412] text-[#9A3412]'
                : 'border-transparent text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <span>صف قرنطینه</span>
            <span className="tabular-nums font-extrabold">
              ({toPersianDigits(unresolvedQuarantines.length)})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('glossary')}
            className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'glossary'
                ? 'border-[#14532D] text-[#14532D]'
                : 'border-transparent text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            واژه‌نامه زنده ECU ({toPersianDigits(harnessState.glossary.entries.length)})
          </button>
        </div>
      )}

      {/* Body */}
      <div className="p-4 space-y-4">
        {error && (
          <div className="rounded-lg border border-[#E5C6BD] bg-[#FFF5F2] px-3.5 py-2.5 text-xs text-[#9A3412] flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="text-[11px] font-bold underline cursor-pointer shrink-0"
            >
              بستن
            </button>
          </div>
        )}

        {lastStepMessage && !error && (
          <div className="rounded-lg border border-[#D4E5D9] bg-[#F4FAF6] px-3.5 py-2 text-xs text-[#14532D]">
            {lastStepMessage}
          </div>
        )}

        {!harnessState ? (
          <div className="rounded-lg border border-dashed border-[#D6D0C4] bg-[#FCFBF8] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 text-xs text-[#57534E] leading-6">
              <div className="font-extrabold text-[#1A1816]">
                آماده ساخت نقشه راه (MasterBlueprint) و برآورد شفاف هزینه پیش از اولین فراخوانی مدل
              </div>
              <p>
                هارنس ابتدا بدون مصرف حتی ۱ توکن، درخت زیربخش‌ها، نگاشت دقیق شناسه‌های منبع (sourceChunkIds) و واژه‌نامه تخصصی ECU/WinOLS را می‌سازد و پس از تأیید شما در دروازه HITL، زیربخش‌به‌زیربخش تولید و ممیزی می‌کند.
              </p>
            </div>
            <button
              type="button"
              disabled={initializing}
              onClick={() => void initBlueprint({ budgetCapUsd: parsedBudgetCap })}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-[#1E3A5F] px-4 py-2 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-60 cursor-pointer shrink-0 whitespace-nowrap"
            >
              {initializing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              <span>مقداردهی نقشه هارنس</span>
            </button>
          </div>
        ) : activeTab === 'gate_and_run' ? (
          <div className="space-y-4">
            {/* Blueprint + Cost + Routing KPI Strip */}
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-[#EFECE4] pb-3.5 text-xs tabular-nums">
              <div className="space-y-0.5">
                <dt className="text-[11px] text-[#78716C]">زیربخش‌ها و قطعات منبع</dt>
                <dd className="font-extrabold text-[#1A1816]">
                  {toPersianDigits(harnessState.blueprint.totalSections)} زیربخش ·{' '}
                  {toPersianDigits(harnessState.blueprint.totalChunks)} قطعه
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[11px] text-[#78716C]">برآورد کل (با کش پیشوند)</dt>
                <dd className="font-extrabold text-[#1E3A5F]">
                  ${harnessState.blueprint.estimatedTotalCostUsd.toFixed(4)}
                  {harnessState.blueprint.estimatedSavingsPercent > 0 && (
                    <span className="text-[10.5px] font-semibold text-[#14532D] mr-1">
                      (-{toPersianDigits(harnessState.blueprint.estimatedSavingsPercent)}٪ کش)
                    </span>
                  )}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[11px] text-[#78716C]">هزینه مصرف‌شده تا اکنون</dt>
                <dd className="font-extrabold text-[#14532D]">
                  ${harnessState.telemetry.estimatedCostUsd.toFixed(4)}{' '}
                  <span className="text-[10.5px] font-normal text-[#78716C]">
                    / ${harnessState.blueprint.budgetCapUsd.toFixed(2)}
                  </span>
                  {(harnessState.telemetry.unreconciledCostUsd || 0) > 0 && (
                    <span className="block text-[10px] font-semibold text-[#9A3412]">
                      تسویه‌نشده (Timeout): ${(harnessState.telemetry.unreconciledCostUsd || 0).toFixed(4)}
                    </span>
                  )}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[11px] text-[#78716C]">آمار واقعی کش پیشوند</dt>
                <dd className="font-extrabold text-[#8C6226]">
                  {harnessState.telemetry.totalCalls > 0 &&
                  (harnessState.telemetry.cacheTelemetryReportedCalls || 0) === 0 ? (
                    <span className="text-[11px] font-bold text-[#78716C]">
                      گزارش‌نشده توسط ارائه‌دهنده
                    </span>
                  ) : (
                    <>
                      {toPersianDigits(cacheHitPercent)}٪
                      <span className="text-[10.5px] font-normal text-[#78716C] mr-1">
                        ({toPersianDigits(harnessState.telemetry.cachedInputTokens.toLocaleString('en-US'))} توکن)
                      </span>
                    </>
                  )}
                  {(harnessState.telemetry.totalReasoningTokens || 0) > 0 && (
                    <span className="block text-[10px] font-normal text-[#57534E]">
                      توکن استدلال (Reasoning):{' '}
                      {toPersianDigits((harnessState.telemetry.totalReasoningTokens || 0).toLocaleString('en-US'))}
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            {/* Pre-HITL Blueprint Audit Strip (Package A Red-Team) */}
            {harnessState.blueprint.blueprintAudit && (
              <div
                data-testid="harness-blueprint-audit"
                className={`rounded-lg border px-3 py-2 text-[11px] flex flex-wrap items-center justify-between gap-2 tabular-nums ${
                  harnessState.blueprint.blueprintAudit.passed
                    ? 'border-[#D4E5D9] bg-[#F7FBF8] text-[#14532D]'
                    : 'border-[#E5C6BD] bg-[#FFF8F6] text-[#9A3412]'
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-extrabold">ممیزی پیش از تأیید نقشه راه:</span>
                  <span>
                    یتیم: {toPersianDigits(harnessState.blueprint.blueprintAudit.unassignedChunkIds.length)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    تکراری: {toPersianDigits(harnessState.blueprint.blueprintAudit.duplicatedChunkIds.length)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    حجیم‌تر از سقف {toPersianDigits(harnessState.blueprint.blueprintAudit.maxSectionInputTokens)} توکن:{' '}
                    {toPersianDigits(harnessState.blueprint.blueprintAudit.oversizedSectionIds.length)}
                  </span>
                  {harnessState.blueprint.blueprintAudit.brokenContinuityChunkIds.length > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        پیوستگی شکسته: {toPersianDigits(harnessState.blueprint.blueprintAudit.brokenContinuityChunkIds.length)}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-[#57534E]" dir="ltr">
                  {harnessState.blueprint.sourceCorpusHash && (
                    <span>corpusLock:{harnessState.blueprint.sourceCorpusHash.slice(0, 10)}</span>
                  )}
                  {harnessState.telemetry.prefixHash && (
                    <span>prefixHash:{harnessState.telemetry.prefixHash.slice(0, 14)}</span>
                  )}
                </div>
              </div>
            )}

            {/* Package B Transparent Cache Threshold / TTL Notice & Model Mismatch Warnings */}
            {harnessState.telemetry.prefixCacheWarningFa && (
              <div
                data-testid="harness-prefix-cache-warning"
                className="rounded-lg border border-[#E6D6B8] bg-[#FFFBF2] px-3 py-2 text-[11px] text-[#8C6226] leading-5"
              >
                <strong className="font-extrabold">یادداشت آستانه/TTL کش پیشوند: </strong>
                {harnessState.telemetry.prefixCacheWarningFa}
              </div>
            )}

            {(harnessState.telemetry.modelMismatchWarnings?.length || 0) > 0 && (
              <div
                data-testid="harness-model-mismatch-warning"
                className="rounded-lg border border-[#E5C6BD] bg-[#FFF8F6] px-3 py-2 text-[11px] text-[#9A3412] leading-5 space-y-0.5"
              >
                <div className="font-extrabold">هشدار مغایرت مدل برگشتی از درگاه (model_mismatch):</div>
                {harnessState.telemetry.modelMismatchWarnings!.slice(-2).map((w, idx) => (
                  <div key={`${w.at}-${idx}`}>{w.messageFa}</div>
                ))}
              </div>
            )}

            {/* Active 3-Tier Models & Budget Cap Control */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-lg bg-[#FCFBF8] border border-[#EAE5DA] p-3">
              <div className="space-y-1 text-[11px] text-[#57534E]">
                <div className="font-bold text-[#1A1816]">توزیع ۳لایه مدل‌های فعال هارنس:</div>
                <div
                  dir="ltr"
                  className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 font-mono text-[10.5px] text-[#44403C]"
                >
                  <span>
                    <strong className="text-[#1E3A5F]">Author:</strong>{' '}
                    {routingInfo?.authorModelId || 'gemini-4-hydrogen'}
                  </span>
                  <span>
                    <strong className="text-[#8C6226]">Patch:</strong>{' '}
                    {routingInfo?.patchModelId || 'gemini-4-hydrogen'}
                  </span>
                  <span>
                    <strong className="text-[#14532D]">Judge &amp; Summary:</strong>{' '}
                    {routingInfo?.utilityModelId || 'gemini-3.8-flash'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#44403C]">
                  <DollarSign className="h-3.5 w-3.5 text-[#8C6226]" />
                  <span>سقف مدار شکن بودجه ($):</span>
                  <input
                    type="number"
                    min="0.1"
                    max="500"
                    step="0.25"
                    value={budgetCapInput}
                    onChange={(e) => setBudgetCapInput(e.target.value)}
                    disabled={running}
                    className="w-20 rounded-md border border-[#D6D0C4] bg-white px-2 py-1 text-xs font-mono text-center text-[#1A1816]"
                  />
                </label>

                {!harnessState.blueprint.approved ? (
                  <button
                    type="button"
                    disabled={approving || running}
                    onClick={() =>
                      void approveAndOptionallyStart({
                        budgetCapUsd: parsedBudgetCap,
                        autoRun: false,
                      })
                    }
                    data-testid="harness-hitl-approve-btn"
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#14532D] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#0F3F22] disabled:opacity-60 cursor-pointer whitespace-nowrap"
                  >
                    {approving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    <span>تأیید نقشه راه و فریز واژه‌نامه (HITL Gate)</span>
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!running ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void startRun()}
                          disabled={stats?.pendingSections === 0 && stats?.draftedSections === 0}
                          data-testid="harness-run-all-btn"
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          <Play className="h-3.5 w-3.5" />
                          <span>اجرای پیوسته هارنس</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void runSingleStep()}
                          disabled={stats?.pendingSections === 0 && stats?.draftedSections === 0}
                          data-testid="harness-single-step-btn"
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-white px-3 py-1.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          <StepForward className="h-3.5 w-3.5" />
                          <span>اجرای ۱ زیربخش</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={pauseRun}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#9A3412] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#7C2D12] cursor-pointer whitespace-nowrap"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        <span>توقف امن (Pause)</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={syncingBook || running}
                      onClick={() => void syncBookFromHarness()}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#14532D] bg-[#F4FAF6] px-3 py-1.5 text-xs font-bold text-[#14532D] hover:bg-[#E7F5EC] disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      {syncingBook ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileOutput className="h-3.5 w-3.5" />
                      )}
                      <span>انتقال به سند A4 و ورد</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Budget Circuit Breaker Override Alert */}
            {harnessState.telemetry.pausedByBudgetCap && (
              <div className="rounded-lg border border-[#DFC690] bg-[#FFFDF6] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2 text-xs text-[#744005]">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#92580E]" />
                  <div>
                    <div className="font-extrabold">مدار شکن بودجه فعال شد</div>
                    <p className="mt-0.5 leading-5">
                      {harnessState.telemetry.budgetCapMessage ||
                        'هزینه پیش‌بینی‌شده گام بعدی از سقف مجاز شما فراتر می‌رود.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => void startRun({ allowBudgetOverride: true })}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#744005] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#5E3204] cursor-pointer shrink-0 whitespace-nowrap"
                >
                  تأیید دستی و ادامه اجرا
                </button>
              </div>
            )}

            {/* Progress Bar & Subsection Ledger Table */}
            {stats && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums">
                  <div className="flex flex-wrap items-center gap-3 text-[#44403C]">
                    <span className="font-bold text-[#14532D]">
                      تأییدشده: {toPersianDigits(stats.verifiedSections)}
                    </span>
                    <span className="font-semibold text-[#1E3A5F]">
                      پیش‌نویس: {toPersianDigits(stats.draftedSections)}
                    </span>
                    <span className="text-[#78716C]">
                      در انتظار: {toPersianDigits(stats.pendingSections)}
                    </span>
                    {stats.quarantinedSections > 0 && (
                      <span className="font-bold text-[#9A3412]">
                        قرنطینه: {toPersianDigits(stats.quarantinedSections)}
                      </span>
                    )}
                  </div>
                  <div className="text-[#57534E]">
                    پیشرفت کل: <strong className="text-[#1A1816]">{toPersianDigits(progressPct)}٪</strong> ·{' '}
                    توکن ورودی: {toPersianDigits(harnessState.telemetry.totalPromptTokens.toLocaleString('en-US'))} ·{' '}
                    خروجی: {toPersianDigits(harnessState.telemetry.totalOutputTokens.toLocaleString('en-US'))}
                  </div>
                </div>

                <div className="h-2 w-full rounded-full bg-[#EFECE4] overflow-hidden">
                  <div
                    className="h-full bg-[#1E3A5F] transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                {/* Compact Subsection Ledger Preview */}
                <div className="max-h-44 overflow-y-auto rounded-lg border border-[#EFECE4] divide-y divide-[#F4F1EA]">
                  {harnessState.blueprint.sections.map((sec, idx) => {
                    const cov = harnessState.coverageLedger.bySectionId[sec.sectionId];
                    const status = cov?.status || 'pending';
                    const statusLabel =
                      status === 'verified'
                        ? 'تأیید دولایه'
                        : status === 'drafted_unverified'
                          ? 'پیش‌نویس (تأییدنشده)'
                          : status === 'drafted'
                            ? 'پیش‌نویس'
                            : status === 'quarantined'
                              ? 'قرنطینه'
                              : 'در انتظار';
                    const statusColor =
                      status === 'verified'
                        ? 'text-[#14532D]'
                        : status === 'drafted_unverified'
                          ? 'text-[#B48A4E]'
                          : status === 'drafted'
                            ? 'text-[#1E3A5F]'
                            : status === 'quarantined'
                              ? 'text-[#9A3412]'
                              : 'text-[#78716C]';

                    return (
                      <div
                        key={sec.sectionId}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-[11.5px] bg-white hover:bg-[#FCFBF8]"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="text-[10.5px] font-bold text-[#78716C] tabular-nums shrink-0">
                            {toPersianDigits(idx + 1)}.
                          </span>
                          <span className="font-semibold text-[#1A1816] truncate">
                            {sec.title}
                          </span>
                          <span className="text-[10.5px] text-[#78716C] tabular-nums shrink-0">
                            ({toPersianDigits(sec.sourceChunkIds.length)} قطعه ·{' '}
                            {toPersianDigits(sec.sourceWordCount)} کلمه)
                          </span>
                        </div>
                        <span className={`text-[11px] font-bold shrink-0 ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'quarantine' ? (
          <div className="space-y-3">
            {harnessState.quarantineQueue.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#D6D0C4] bg-[#FCFBF8] p-6 text-center space-y-1">
                <BookCheck className="h-5 w-5 text-[#14532D] mx-auto" />
                <div className="text-xs font-bold text-[#1A1816]">صف قرنطینه خالی است</div>
                <p className="text-[11px] text-[#57534E]">
                  هر زیربخشی که پس از ۲ بار ترمیم جراحی همچنان خطای لایه ۱ (آدرس هگز/کد خطا/نقص منبع) یا لایه ۲ داشته باشد اینجا برای بررسی دستی شما ثبت می‌شود.
                </p>
              </div>
            ) : (
              harnessState.quarantineQueue.map((item) => (
                <QuarantineCard
                  key={item.sectionId}
                  item={item}
                  resolving={resolvingSectionId === item.sectionId}
                  onResolve={resolveQuarantine}
                />
              ))
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#57534E]">
              <span>
                واژه‌نامه زنده (LivingGlossary) در پیشوند ثابت کش‌شده (Immutable Cached Prefix) تزریق می‌شود تا نام‌گذاری در تمام فصل‌ها یکدست بماند.
              </span>
              <span className="font-bold text-[#14532D]">
                وضعیت: {harnessState.glossary.frozen ? 'فریز شده برای کش' : 'در حال تکمیل'}
              </span>
            </div>
            {harnessState.glossary.entries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#D6D0C4] bg-[#FCFBF8] p-4 text-center text-xs text-[#78716C]">
                هنوز اصطلاح تخصصی ECU یا کد نقشه WinOLS در متن منابع شناسایی نشده است.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-[#EFECE4] divide-y divide-[#F4F1EA]">
                {harnessState.glossary.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs bg-white"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-extrabold text-[#1E3A5F]" dir="ltr">
                        {entry.canonicalTerm}
                      </span>
                      <span className="text-[11px] text-[#57534E] truncate">
                        {entry.definitionFa || entry.faEquivalents.join('، ')}
                      </span>
                    </div>
                    <span className="text-[10.5px] font-semibold text-[#78716C] uppercase">
                      {entry.category}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
