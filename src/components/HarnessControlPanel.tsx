import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookCheck,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  DollarSign,
  FileOutput,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  StepForward,
  Trash2,
} from 'lucide-react';
import type { UseHarnessRunnerResult } from '../hooks/useHarnessRunner';
import type { ValidationDomain } from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';
import { computeCoverageLedgerStats } from '../lib/harness/harnessStore';
import type { QuarantineItem, SemanticBlock } from '../lib/harness/types';

interface HarnessControlPanelProps {
  harness: UseHarnessRunnerResult;
  validationDomain?: ValidationDomain;
  onChangeValidationDomain?: (domain: ValidationDomain) => void;
  onOpenProviderSettings?: () => void;
}

type HarnessPanelTab = 'gate_and_run' | 'quarantine' | 'glossary';

function formatEtaFa(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds <= 0) return 'کمتر از ۱ ثانیه';
  if (seconds < 60) return `${toPersianDigits(seconds)} ثانیه`;
  const mins = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return remSec > 0
    ? `${toPersianDigits(mins)} دقیقه و ${toPersianDigits(remSec)} ثانیه`
    : `${toPersianDigits(mins)} دقیقه`;
}

const BLOCK_KIND_LABELS: Record<SemanticBlock['kind'], string> = {
  heading: 'سربرگ بخش',
  paragraph: 'پاراگراف متنی',
  callout_warning: 'باکس هشدار ایمنی',
  callout_tip: 'باکس نکته مهندسی',
  table: 'جدول ساختاریافته',
  formula: 'فرمول ریاضی',
  step_list: 'فهرست مراحل اجرا',
  source_gap_flag: 'پرچم نقص منبع (Gap)',
  source_conflict_flag: 'پرچم تناقض منابع',
  figure_ref: 'ارجاع شکل / نمودار',
};

const QuarantineCard: React.FC<{
  item: QuarantineItem;
  resolving: boolean;
  retrying: boolean;
  running: boolean;
  onResolve: (
    sectionId: string,
    payload: { editedBlocks: SemanticBlock[]; resolutionNote: string }
  ) => Promise<void>;
  onRetryFlagship: (sectionId: string) => Promise<void>;
}> = ({ item, resolving, retrying, running, onResolve, onRetryFlagship }) => {
  const [blocks, setBlocks] = useState<SemanticBlock[]>(item.draftIR.blocks);
  const [note, setNote] = useState(item.resolutionNote || '');

  useEffect(() => {
    setBlocks(item.draftIR.blocks);
  }, [item.draftIR.blocks]);

  const updateBlock = (idx: number, updater: (prev: SemanticBlock) => SemanticBlock) => {
    setBlocks((prev) => prev.map((b, i) => (i === idx ? updater(b) : b)));
  };

  const removeBlock = (idx: number) => {
    setBlocks((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
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
        ) : (
          <button
            type="button"
            disabled={retrying || resolving || running}
            onClick={() => void onRetryFlagship(item.sectionId)}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-white px-2.5 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>بازنویسی مجدد با مدل پرچمدار</span>
          </button>
        )}
      </div>

      {/* Layer 1 & Layer 2 Audit Errors */}
      <div className="space-y-1.5 text-[11.5px]">
        {item.layer1Issues.length > 0 && (
          <div className="rounded-md bg-white border border-[#EFE3DF] p-2.5 space-y-1">
            <div className="font-bold text-[#9A3412]">یافته‌های گارد قطعی لایه ۱ (۰ توکن):</div>
            <ul className="list-disc pr-4 space-y-0.5 text-[#57534E]">
              {item.layer1Issues.slice(0, 6).map((iss) => (
                <li key={iss.id}>{iss.messageFa}</li>
              ))}
            </ul>
          </div>
        )}
        {item.layer2Issues.length > 0 && (
          <div className="rounded-md bg-white border border-[#EFE3DF] p-2.5 space-y-1">
            <div className="font-bold text-[#7C4706]">یافته‌های ممیز معنایی لایه ۲:</div>
            <ul className="list-disc pr-4 space-y-0.5 text-[#57534E]">
              {item.layer2Issues.slice(0, 6).map((iss) => (
                <li key={iss.id}>{iss.messageFa}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Bug #11 Fix: Structured AST Block Editor */}
      {!item.resolved && (
        <div className="space-y-3">
          <div className="text-[11px] font-bold text-[#44403C]">
            ویرایشگر ساختاریافته بلوک‌های Semantic IR پیش از تأیید دستی:
          </div>
          {blocks.map((blk, idx) => (
            <div
              key={blk.id}
              className="rounded-lg border border-[#E2DDD3] bg-white p-3 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-[#78716C] border-b border-[#F2EFE8] pb-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#1E3A5F]">
                    {BLOCK_KIND_LABELS[blk.kind] || blk.kind}
                  </span>
                  <span className="font-mono text-[10px]" dir="ltr">
                    {blk.id}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px]">
                    منابع: {blk.sourceChunkIds.join(', ') || 'نامشخص'}
                  </span>
                  {blocks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeBlock(idx)}
                      title="حذف این بلوک"
                      className="inline-flex items-center gap-0.5 text-[#9A3412] hover:underline cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>حذف</span>
                    </button>
                  )}
                </div>
              </div>

              {(blk.kind === 'heading' ||
                blk.kind === 'callout_warning' ||
                blk.kind === 'callout_tip' ||
                blk.kind === 'step_list') && (
                <input
                  type="text"
                  value={blk.title ?? ''}
                  onChange={(e) =>
                    updateBlock(idx, (prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="عنوان بلوک / تیتر..."
                  dir="rtl"
                  className="w-full rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 text-xs font-bold text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                />
              )}

              {(blk.kind === 'paragraph' ||
                blk.kind === 'heading' ||
                blk.kind === 'callout_warning' ||
                blk.kind === 'callout_tip' ||
                blk.kind === 'figure_ref') && (
                <textarea
                  value={blk.text ?? blk.caption ?? ''}
                  onChange={(e) =>
                    updateBlock(idx, (prev) =>
                      prev.kind === 'figure_ref'
                        ? { ...prev, caption: e.target.value }
                        : { ...prev, text: e.target.value }
                    )
                  }
                  rows={3}
                  dir="rtl"
                  className="w-full rounded-md border border-[#D6D0C4] bg-white px-3 py-2 text-xs leading-6 text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
                />
              )}

              {blk.kind === 'step_list' && (
                <div className="space-y-1.5">
                  {(blk.items || []).map((stepText, sIdx) => (
                    <div key={sIdx} className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-[#78716C] tabular-nums w-5 text-center shrink-0">
                        {toPersianDigits(sIdx + 1)}.
                      </span>
                      <input
                        type="text"
                        value={stepText}
                        onChange={(e) =>
                          updateBlock(idx, (prev) => {
                            const nextItems = [...(prev.items || [])];
                            nextItems[sIdx] = e.target.value;
                            return { ...prev, items: nextItems };
                          })
                        }
                        dir="rtl"
                        className="flex-1 rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateBlock(idx, (prev) => ({
                            ...prev,
                            items: (prev.items || []).filter((_, i) => i !== sIdx),
                          }))
                        }
                        aria-label="حذف گام"
                        className="p-1 text-[#9A3412] hover:bg-[#FFF5F2] rounded cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      updateBlock(idx, (prev) => ({
                        ...prev,
                        items: [...(prev.items || []), ''],
                      }))
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>افزودن مورد به فهرست</span>
                  </button>
                </div>
              )}

              {blk.kind === 'table' && (
                <div className="space-y-2 overflow-x-auto">
                  <div className="flex flex-wrap gap-1.5">
                    {(blk.headers || []).map((hdr, hIdx) => (
                      <input
                        key={hIdx}
                        type="text"
                        value={hdr}
                        onChange={(e) =>
                          updateBlock(idx, (prev) => {
                            const nextHeaders = [...(prev.headers || [])];
                            nextHeaders[hIdx] = e.target.value;
                            return { ...prev, headers: nextHeaders };
                          })
                        }
                        placeholder={`ستون ${hIdx + 1}`}
                        className="min-w-[110px] flex-1 rounded border border-[#CBD5E1] bg-[#EEF3F8] px-2 py-1 text-[11px] font-bold text-[#1E3A5F]"
                      />
                    ))}
                  </div>
                  <div className="space-y-1">
                    {(blk.rows || []).map((row, rIdx) => (
                      <div key={rIdx} className="flex items-center gap-1.5">
                        {row.map((cell, cIdx) => (
                          <input
                            key={cIdx}
                            type="text"
                            value={cell}
                            onChange={(e) =>
                              updateBlock(idx, (prev) => {
                                const nextRows = (prev.rows || []).map((r, ri) =>
                                  ri === rIdx
                                    ? r.map((v, ci) => (ci === cIdx ? e.target.value : v))
                                    : r
                                );
                                return { ...prev, rows: nextRows };
                              })
                            }
                            className="min-w-[110px] flex-1 rounded border border-[#D6D0C4] bg-white px-2 py-1 text-[11px] text-[#1A1816]"
                          />
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            updateBlock(idx, (prev) => ({
                              ...prev,
                              rows: (prev.rows || []).filter((_, ri) => ri !== rIdx),
                            }))
                          }
                          aria-label="حذف ردیف جدول"
                          className="p-1 text-[#9A3412] hover:bg-[#FFF5F2] rounded cursor-pointer shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateBlock(idx, (prev) => {
                        const colCount = Math.max(1, (prev.headers || prev.rows?.[0] || ['']).length);
                        return {
                          ...prev,
                          rows: [...(prev.rows || []), Array.from({ length: colCount }, () => '')],
                        };
                      })
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>افزودن ردیف به جدول</span>
                  </button>
                </div>
              )}

              {blk.kind === 'formula' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-[10px] text-[#78716C]">عبارت LaTeX / فرمول:</span>
                    <input
                      type="text"
                      dir="ltr"
                      value={blk.latex ?? ''}
                      onChange={(e) =>
                        updateBlock(idx, (prev) => ({ ...prev, latex: e.target.value }))
                      }
                      className="w-full rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 font-mono text-xs text-[#1A1816]"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] text-[#78716C]">توضیح فارسی خوانا:</span>
                    <input
                      type="text"
                      dir="rtl"
                      value={blk.readable ?? ''}
                      onChange={(e) =>
                        updateBlock(idx, (prev) => ({ ...prev, readable: e.target.value }))
                      }
                      className="w-full rounded-md border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-xs text-[#1A1816]"
                    />
                  </div>
                </div>
              )}

              {blk.kind === 'source_gap_flag' && (
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={blk.gapReason ?? ''}
                    onChange={(e) =>
                      updateBlock(idx, (prev) => ({ ...prev, gapReason: e.target.value }))
                    }
                    placeholder="دلیل نقص منبع..."
                    className="w-full rounded-md border border-[#D6D0C4] bg-[#FFFBEB] px-2.5 py-1.5 text-xs text-[#78350F]"
                  />
                  <input
                    type="text"
                    value={blk.missingInfo ?? ''}
                    onChange={(e) =>
                      updateBlock(idx, (prev) => ({ ...prev, missingInfo: e.target.value }))
                    }
                    placeholder="اطلاعات ناموجود یا نیازمند تکمیل..."
                    className="w-full rounded-md border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-xs text-[#1A1816]"
                  />
                </div>
              )}

              {blk.kind === 'source_conflict_flag' && (
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={blk.conflictTopic ?? ''}
                    onChange={(e) =>
                      updateBlock(idx, (prev) => ({ ...prev, conflictTopic: e.target.value }))
                    }
                    placeholder="موضوع تناقض بین منابع..."
                    className="w-full rounded-md border border-[#D6D0C4] bg-[#FFF5F2] px-2.5 py-1.5 text-xs font-bold text-[#9A3412]"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      value={blk.conflictSourceA ?? ''}
                      onChange={(e) =>
                        updateBlock(idx, (prev) => ({ ...prev, conflictSourceA: e.target.value }))
                      }
                      placeholder="روایت فایل اول..."
                      className="rounded-md border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-xs text-[#1A1816]"
                    />
                    <input
                      type="text"
                      value={blk.conflictSourceB ?? ''}
                      onChange={(e) =>
                        updateBlock(idx, (prev) => ({ ...prev, conflictSourceB: e.target.value }))
                      }
                      placeholder="روایت فایل دوم..."
                      className="rounded-md border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-xs text-[#1A1816]"
                    />
                  </div>
                </div>
              )}
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
              disabled={resolving || retrying}
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
  validationDomain: propDomain,
  onChangeValidationDomain,
  onOpenProviderSettings,
}) => {
  const {
    harnessState,
    routingInfo,
    initializing,
    approving,
    running,
    resolvingSectionId,
    retryingSectionId,
    syncingBook,
    error,
    lastStepMessage,
    avgStepLatencyMs,
    etaSeconds,
    initBlueprint,
    approveAndOptionallyStart,
    startRun,
    pauseRun,
    runSingleStep,
    resolveQuarantine,
    retryQuarantineFlagship,
    syncBookFromHarness,
    clearError,
  } = harness;

  const [activeTab, setActiveTab] = useState<HarnessPanelTab>('gate_and_run');
  const [budgetCapInput, setBudgetCapInput] = useState<string>(
    String(harnessState?.blueprint.budgetCapUsd ?? 2.0)
  );

  const effectiveDomain: ValidationDomain =
    propDomain || harnessState?.blueprint.validationDomain || 'ecu_winols';

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
  const progressPct =
    stats && stats.totalSections > 0
      ? Math.round(((stats.verifiedSections + stats.quarantinedSections) / stats.totalSections) * 100)
      : 0;

  return (
    <section
      data-testid="harness-control-panel"
      aria-label="موتور هارنس تولید و ممیزی کتاب"
      className="rounded-xl border border-[#D8D1C4] bg-white overflow-hidden"
    >
      {/* Top Bar */}
      <div className="border-b border-[#EFECE4] bg-[#FCFBF8] px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-extrabold text-[#1A1816]">
            <Cpu className="h-4 w-4 text-[#1E3A5F] shrink-0" />
            <span>موتور هارنس مرحله‌محور و ممیزی دولایه (بدون افت و بدون توهم)</span>
            <span
              className={`rounded border px-2 py-0.5 text-[10.5px] font-bold ${
                effectiveDomain === 'ecu_winols'
                  ? 'border-[#D4E5D9] bg-[#F4FAF6] text-[#14532D]'
                  : 'border-[#DCE5F0] bg-[#EEF3F8] text-[#1E3A5F]'
              }`}
            >
              {effectiveDomain === 'ecu_winols'
                ? 'حالت تخصصی ECU / WinOLS'
                : 'حالت عمومی فنی فارسی'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#57534E]">
            <span className="inline-flex items-center gap-1">
              <Database className="h-3 w-3 text-[#14532D]" />
              ذخیره ترکیبی Cloud SQL + IndexedDB
            </span>
            <span aria-hidden="true">·</span>
            <span>فراخوانی بی‌حافظه (Stateless) با Prompt Caching</span>
            <span aria-hidden="true">·</span>
            <span>دروازه ۱ (سرفصل) ← اجرا ← دروازه ۲ (قرنطینه)</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onOpenProviderSettings && (
            <button
              type="button"
              onClick={onOpenProviderSettings}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#44403C] hover:bg-[#F5F3EE] cursor-pointer whitespace-nowrap"
            >
              تنظیم مدل‌ها / درگاه ایرانی / ۳لایه
            </button>
          )}

          <button
            type="button"
            disabled={initializing || running}
            onClick={() =>
              void initBlueprint({
                budgetCapUsd: parsedBudgetCap,
                forceReset: Boolean(harnessState && !harnessState.blueprint.approved),
                validationDomain: effectiveDomain,
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
            <span>
              {harnessState
                ? 'به‌روزرسانی نقشه راه (۰ توکن)'
                : 'ساخت نقشه راه و برآورد هزینه (۰ توکن)'}
            </span>
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
            دروازه ۱ (تأیید نقشه راه) و اجرا
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('quarantine')}
            data-testid="harness-quarantine-tab"
            className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
              activeTab === 'quarantine'
                ? 'border-[#9A3412] text-[#9A3412]'
                : unresolvedQuarantines.length > 0
                  ? 'border-transparent text-[#9A3412] hover:text-[#7C2D12]'
                  : 'border-transparent text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <span>دروازه ۲: صف قرنطینه</span>
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
            واژه‌نامه زنده ({toPersianDigits(harnessState.glossary.entries.length)})
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

        {/* Dual-Mode Validation Domain Quick Switcher when Blueprint isn't frozen yet */}
        {onChangeValidationDomain && (!harnessState || !harnessState.blueprint.approved) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#EAE5DA] bg-[#FCFBF8] px-3 py-2 text-xs">
            <span className="font-bold text-[#44403C]">
              حوزه اعتبارسنجی و ممیزی هارنس:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={running}
                onClick={() => onChangeValidationDomain('ecu_winols')}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                  effectiveDomain === 'ecu_winols'
                    ? 'border-[#14532D] bg-[#14532D] text-white'
                    : 'border-[#D6D0C4] bg-white text-[#44403C] hover:bg-[#F5F3EE]'
                }`}
              >
                تخصصی ECU / WinOLS
              </button>
              <button
                type="button"
                disabled={running}
                onClick={() => onChangeValidationDomain('general_persian_technical')}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                  effectiveDomain === 'general_persian_technical'
                    ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                    : 'border-[#D6D0C4] bg-white text-[#44403C] hover:bg-[#F5F3EE]'
                }`}
              >
                متون فنی و آموزشی عمومی فارسی
              </button>
            </div>
          </div>
        )}

        {!harnessState ? (
          <div className="rounded-lg border border-dashed border-[#D6D0C4] bg-[#FCFBF8] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 text-xs text-[#57534E] leading-6">
              <div className="font-extrabold text-[#1A1816]">
                آماده ساخت نقشه راه (MasterBlueprint) و برآورد شفاف هزینه پیش از اولین فراخوانی مدل
              </div>
              <p>
                هارنس ابتدا بدون مصرف حتی ۱ توکن، درخت زیربخش‌ها، نگاشت دقیق شناسه‌های منبع (sourceChunkIds) و واژه‌نامه را می‌سازد و پس از تأیید شما در دروازه ۱، زیربخش‌به‌زیربخش تولید و ممیزی می‌کند.
              </p>
            </div>
            <button
              type="button"
              disabled={initializing}
              onClick={() =>
                void initBlueprint({
                  budgetCapUsd: parsedBudgetCap,
                  validationDomain: effectiveDomain,
                })
              }
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
            {/* Gate 2 Warning Banner if unresolved quarantined sections exist */}
            {unresolvedQuarantines.length > 0 && (
              <div className="rounded-lg border border-[#E5C6BD] bg-[#FFF5F2] p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-[#9A3412] font-bold">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>
                    دروازه ۲ (بازبینی قرنطینه): {toPersianDigits(unresolvedQuarantines.length)} زیربخش نیازمند تأیید یا بازنویسی پرچمدار است.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('quarantine')}
                  className="rounded-md bg-[#9A3412] px-3 py-1 text-[11px] font-bold text-white hover:bg-[#7C2D12] cursor-pointer"
                >
                  مشاهده و ویرایش صف قرنطینه
                </button>
              </div>
            )}

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
                <dt className="text-[11px] text-[#78716C]">آمار کش پیشوند / زمان‌بندی</dt>
                <dd className="font-extrabold text-[#8C6226]">
                  {harnessState.telemetry.totalCalls > 0 &&
                  (harnessState.telemetry.cacheTelemetryReportedCalls || 0) === 0 ? (
                    <span className="text-[11px] font-bold text-[#78716C]">
                      گزارش‌نشده توسط درگاه
                    </span>
                  ) : (
                    <>
                      {toPersianDigits(cacheHitPercent)}٪
                      <span className="text-[10.5px] font-normal text-[#78716C] mr-1">
                        ({toPersianDigits(harnessState.telemetry.cachedInputTokens.toLocaleString('en-US'))} توکن)
                      </span>
                    </>
                  )}
                  {(avgStepLatencyMs !== null || etaSeconds !== null) && (
                    <span className="flex items-center gap-1 text-[10px] font-normal text-[#1E3A5F] mt-0.5">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>
                        گام: {avgStepLatencyMs ? `${toPersianDigits((avgStepLatencyMs / 1000).toFixed(1))}ث` : '—'} · باقیمانده: {formatEtaFa(etaSeconds)}
                      </span>
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            {/* Pre-HITL Blueprint Audit Strip */}
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
                  <span>سقف بودجه ($):</span>
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
                        validationDomain: effectiveDomain,
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
                    <span>تأیید نقشه راه و فریز واژه‌نامه (دروازه ۱)</span>
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
                  هر زیربخشی که پس از ۲ بار ترمیم جراحی همچنان خطای لایه ۱ یا لایه ۲ داشته باشد، اینجا برای ویرایش ساختاریافته یا بازنویسی با مدل پرچمدار ثبت می‌شود.
                </p>
              </div>
            ) : (
              harnessState.quarantineQueue.map((item) => (
                <QuarantineCard
                  key={item.sectionId}
                  item={item}
                  resolving={resolvingSectionId === item.sectionId}
                  retrying={retryingSectionId === item.sectionId}
                  running={running}
                  onResolve={resolveQuarantine}
                  onRetryFlagship={(sectionId) => retryQuarantineFlagship(sectionId)}
                />
              ))
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#57534E]">
              <span>
                واژه‌نامه زنده (LivingGlossary) در پیشوند ثابت کش‌شده تزریق می‌شود تا نام‌گذاری در تمام فصل‌ها یکدست بماند.
              </span>
              <span className="font-bold text-[#14532D]">
                وضعیت: {harnessState.glossary.frozen ? 'فریز شده برای کش' : 'در حال تکمیل'}
              </span>
            </div>
            {harnessState.glossary.entries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#D6D0C4] bg-[#FCFBF8] p-4 text-center text-xs text-[#78716C]">
                هنوز اصطلاح تخصصی یا کلیدواژه‌ای در متن منابع ثبت نشده است.
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

