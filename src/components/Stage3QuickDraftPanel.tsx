import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  FileText,
  FolderTree,
  Layers,
  Loader2,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { ContentUnitDto, SourceFileDto } from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';
import {
  buildQuickDraftStructure,
  type QuickDraftBlockCounts,
  type QuickDraftHeadingNode,
  type QuickDraftStrategy,
} from '../lib/quickDraftBuilder';

interface Stage3QuickDraftPanelProps {
  projectId: string;
  projectTitle: string;
  sourceFiles: SourceFileDto[];
  contentUnits: ContentUnitDto[];
  applying: boolean;
  onApplyToStage3: (strategy: QuickDraftStrategy) => Promise<void>;
  onApplyAndPreviewStage4: (strategy: QuickDraftStrategy) => Promise<void>;
  onClose: () => void;
}

function formatBlockMixFa(counts: QuickDraftBlockCounts): string {
  const items: string[] = [];
  if (counts.paragraphs > 0) items.push(`${toPersianDigits(counts.paragraphs)} پاراگراف`);
  if (counts.tables > 0) items.push(`${toPersianDigits(counts.tables)} جدول`);
  if (counts.callouts > 0) items.push(`${toPersianDigits(counts.callouts)} کادر نکته`);
  if (counts.lists > 0) items.push(`${toPersianDigits(counts.lists)} فهرست`);
  if (counts.equations > 0) items.push(`${toPersianDigits(counts.equations)} فرمول`);
  if (counts.other > 0) items.push(`${toPersianDigits(counts.other)} بلوک فنی`);
  return items.join(' · ') || 'بدون واحد متنی';
}

const HeadingTreeBranch: React.FC<{
  nodes: QuickDraftHeadingNode[];
  level?: number;
}> = ({ nodes, level = 0 }) => {
  if (nodes.length === 0) return null;

  return (
    <ul
      className={
        level === 0
          ? 'space-y-2 pr-3 border-r-2 border-[#D6D0C4]'
          : 'mt-2 space-y-2 pr-3 border-r border-dashed border-[#D6D0C4]'
      }
    >
      {nodes.map((node) => (
        <li key={node.id} className="space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="h-1.5 w-1.5 rounded-full bg-[#1E3A5F] shrink-0" />
              <span className="text-xs font-bold text-[#1A1816]">{node.title}</span>
              <span className="text-[11px] text-[#78716C] tabular-nums">
                ({toPersianDigits(node.unitCount)} واحد · {toPersianDigits(node.wordCount.toLocaleString('en-US'))} کلمه)
              </span>
            </div>
            {node.sourceFileNames.length > 0 && (
              <span className="text-[10.5px] text-[#78716C] truncate max-w-[220px]">
                {node.sourceFileNames.join('، ')}
              </span>
            )}
          </div>

          {node.firstSnippet && (
            <p className="text-[11px] text-[#57534E] leading-5 pr-3 line-clamp-2">
              {node.firstSnippet}
            </p>
          )}

          {node.children.length > 0 && (
            <HeadingTreeBranch nodes={node.children} level={level + 1} />
          )}
        </li>
      ))}
    </ul>
  );
};

export const Stage3QuickDraftPanel: React.FC<Stage3QuickDraftPanelProps> = ({
  projectId,
  projectTitle,
  sourceFiles,
  contentUnits,
  applying,
  onApplyToStage3,
  onApplyAndPreviewStage4,
  onClose,
}) => {
  const [strategy, setStrategy] = useState<QuickDraftStrategy>('heading_tree');
  const [expandedChapterIds, setExpandedChapterIds] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(true);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [activeAction, setActiveAction] = useState<'stage3' | 'stage4' | null>(null);

  const quickDraft = useMemo(
    () =>
      buildQuickDraftStructure({
        projectId,
        projectTitle,
        sourceFiles,
        contentUnits,
        strategy,
      }),
    [projectId, projectTitle, sourceFiles, contentUnits, strategy]
  );

  const isChapterExpanded = (chapterId: string): boolean => {
    if (chapterId in expandedChapterIds) {
      return expandedChapterIds[chapterId];
    }
    return allExpanded;
  };

  const toggleChapter = (chapterId: string) => {
    const current = isChapterExpanded(chapterId);
    setExpandedChapterIds((prev) => ({ ...prev, [chapterId]: !current }));
  };

  const handleToggleAll = () => {
    const next = !allExpanded;
    setAllExpanded(next);
    const map: Record<string, boolean> = {};
    for (const ch of quickDraft.chapters) {
      map[ch.id] = next;
    }
    setExpandedChapterIds(map);
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(quickDraft.outlineMarkdown);
      setCopiedMarkdown(true);
      window.setTimeout(() => setCopiedMarkdown(false), 1800);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  const handleApplyStage3 = async () => {
    setActiveAction('stage3');
    try {
      await onApplyToStage3(strategy);
    } finally {
      setActiveAction(null);
    }
  };

  const handleApplyStage4 = async () => {
    setActiveAction('stage4');
    try {
      await onApplyAndPreviewStage4(strategy);
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <section
      aria-label="پیش‌نویس سریع ساختار فصل‌ها"
      className="rounded-xl border border-[#BBD3C5] bg-[#F8FBF9] overflow-hidden shadow-xs"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#D9E7DF] bg-[#EFF7F2] px-4 py-3.5 sm:px-5">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-xs font-extrabold text-[#14532D]">
            <Zap className="h-4 w-4 shrink-0" />
            <span>پیش‌نویس سریع ساختار فصل‌ها (آنی · بدون انتظار برای بازبینی کامل)</span>
          </div>
          <p className="text-xs text-[#2F523D] leading-5">
            ساختار اولیه بر اساس فایل‌های استخراج‌شده و درخت عناوین آن‌ها تولید شده است تا پیش از اجرای غنی‌سازی، هارنس یا بازبینی عمیق بتوانید چیدمان فصل‌ها و زیربخش‌ها را بررسی کنید.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="بستن پنل پیش‌نویس سریع"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#C7DCCF] bg-white text-[#2F523D] hover:bg-[#E7F2EC] cursor-pointer shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Controls & Metrics Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2ECE6] bg-white px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStrategy('heading_tree')}
            aria-pressed={strategy === 'heading_tree'}
            className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              strategy === 'heading_tree'
                ? 'border-[#14532D] bg-[#14532D] text-white'
                : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#44403C] hover:bg-[#EFECE4]'
            }`}
          >
            <FolderTree className="h-3.5 w-3.5" />
            <span>بر اساس درخت عناوین فایل‌ها</span>
          </button>

          <button
            type="button"
            onClick={() => setStrategy('by_source_file')}
            aria-pressed={strategy === 'by_source_file'}
            className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              strategy === 'by_source_file'
                ? 'border-[#14532D] bg-[#14532D] text-white'
                : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#44403C] hover:bg-[#EFECE4]'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>تفکیک بر اساس هر فایل منبع</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleToggleAll}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[#D6D0C4] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#44403C] hover:bg-[#F5F3EE] cursor-pointer"
          >
            <Layers className="h-3.5 w-3.5 text-[#1E3A5F]" />
            <span>{allExpanded ? 'بستن شاخه‌ها' : 'باز کردن همه شاخه‌ها'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[#D6D0C4] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#44403C] hover:bg-[#F5F3EE] cursor-pointer"
          >
            {copiedMarkdown ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#14532D]" />
                <span className="text-[#14532D]">ساختار کپی شد</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-[#1E3A5F]" />
                <span>کپی درخت سرفصل‌ها</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Summary Numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-[#E2ECE6] bg-[#FCFBF8] px-4 py-3 sm:px-5 text-xs">
        <div>
          <div className="text-[11px] text-[#78716C]">فایل‌های استخراج‌شده</div>
          <div className="font-extrabold text-[#1A1816] tabular-nums mt-0.5">
            {toPersianDigits(quickDraft.summary.totalSourceFiles)} فایل
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[#78716C]">ساختار پیشنهادی</div>
          <div className="font-extrabold text-[#14532D] tabular-nums mt-0.5">
            {toPersianDigits(quickDraft.summary.totalChapters)} فصل ·{' '}
            {toPersianDigits(quickDraft.summary.totalSubsections)} زیربخش
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[#78716C]">حجم محتوای حفظ‌شده</div>
          <div className="font-extrabold text-[#1A1816] tabular-nums mt-0.5">
            {toPersianDigits(quickDraft.summary.totalWords.toLocaleString('en-US'))} کلمه (
            {toPersianDigits(quickDraft.summary.totalActiveUnits)} واحد)
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[#78716C]">پوشش استخراج و زمان مطالعه</div>
          <div className="font-extrabold text-[#1E3A5F] tabular-nums mt-0.5">
            پوشش {toPersianDigits(quickDraft.summary.coveragePercent)}٪ · حدود{' '}
            {toPersianDigits(quickDraft.summary.estimatedReadingMinutes)} دقیقه
          </div>
        </div>
      </div>

      {/* Hierarchical Chapter Tree List */}
      <div className="max-h-[420px] overflow-y-auto px-4 py-3.5 sm:px-5 space-y-2.5 bg-[#FAF9F6]">
        {quickDraft.chapters.map((chapter) => {
          const expanded = isChapterExpanded(chapter.id);
          return (
            <div
              key={chapter.id}
              className="rounded-lg border border-[#E2DDD3] bg-white overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleChapter(chapter.id)}
                className="w-full text-right px-3.5 py-2.5 flex items-start justify-between gap-3 hover:bg-[#FCFBF8] transition-colors cursor-pointer"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className="mt-0.5 text-[#57534E] shrink-0">
                    {expanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronLeft className="h-4 w-4" />
                    )}
                  </span>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#EEF7F1] text-xs font-extrabold tabular-nums text-[#14532D]">
                    {toPersianDigits(chapter.order)}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-sm font-extrabold text-[#1A1816] leading-6">
                      {chapter.title}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#78716C]">
                      <span className="tabular-nums">
                        {toPersianDigits(chapter.wordCount.toLocaleString('en-US'))} کلمه (
                        {toPersianDigits(chapter.sharePercent)}٪)
                      </span>
                      <span>·</span>
                      <span>{formatBlockMixFa(chapter.blockCounts)}</span>
                      {chapter.sourceFileNames.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-[#44403C]">
                            منبع: {chapter.sourceFileNames.join('، ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {chapter.subsectionCount > 0 && (
                  <span className="shrink-0 text-[11px] font-bold text-[#1E3A5F] tabular-nums pt-0.5">
                    {toPersianDigits(chapter.subsectionCount)} زیربخش
                  </span>
                )}
              </button>

              {expanded && (
                <div className="border-t border-[#EFECE4] bg-[#FCFBF8] px-4 py-3 space-y-2.5">
                  {chapter.tree.length > 0 ? (
                    <HeadingTreeBranch nodes={chapter.tree} />
                  ) : (
                    <div className="text-xs text-[#57534E] leading-5">
                      <span className="font-semibold text-[#1A1816]">متن مستقیم زیر فصل: </span>
                      {chapter.leadExcerpt || 'محتوای این فصل آماده بررسی در پیش‌نمایش است.'}
                    </div>
                  )}

                  {chapter.tree.length > 0 && chapter.directUnitCount > 0 && chapter.leadExcerpt && (
                    <div className="pt-1.5 border-t border-[#EFECE4] text-[11px] text-[#57534E] leading-5">
                      <span className="font-semibold text-[#44403C]">
                        مقدمه مستقیم فصل ({toPersianDigits(chapter.directUnitCount)} واحد):{' '}
                      </span>
                      {chapter.leadExcerpt}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[#D9E7DF] bg-[#EFF7F2] px-4 py-3.5 sm:px-5">
        <p className="text-[11.5px] text-[#2F523D] leading-5">
          تمام واحدهای متنی استخراج‌شده بدون افت در این فصل‌بندی حفظ می‌شوند؛ پس از بررسی ساختار، هر زمان خواستید می‌توانید غنی‌سازی یا بازبینی کامل را اجرا کنید.
        </p>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={applying || quickDraft.chapters.length === 0}
            onClick={handleApplyStage3}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#14532D] bg-white px-3.5 py-2 text-xs font-bold text-[#14532D] hover:bg-[#E7F4EC] disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            {applying && activeAction === 'stage3' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderTree className="h-3.5 w-3.5" />
            )}
            <span>اعمال ساختار در ویرایشگر مرحله ۳</span>
          </button>

          <button
            type="button"
            disabled={applying || quickDraft.chapters.length === 0}
            onClick={handleApplyStage4}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#14532D] px-4 py-2 text-xs font-bold text-white hover:bg-[#104224] disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            {applying && activeAction === 'stage4' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>مشاهده فوری پیش‌نویس در مرحله ۴ (بدون غنی‌سازی)</span>
          </button>
        </div>
      </div>
    </section>
  );
};
