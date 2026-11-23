import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Eye,
  FileText,
  Globe,
  ListTree,
} from 'lucide-react';
import type {
  ContentUnitDto,
  OutlineNodeDto,
  SourceFileDto,
} from '../lib/bookTypes';
import type { OutlineReassignment } from '../lib/outlineAutoSave';
import { toPersianDigits } from '../lib/formatParsers';
import { buildLiveOutlineTextPreview } from '../lib/workspaceInsights';
import type { HarnessState, SemanticBlock, SemanticSectionIR } from '../lib/harness/types';

interface Stage3LiveTextPreviewPanelProps {
  projectTitle: string;
  draftNodes: OutlineNodeDto[];
  contentUnits: ContentUnitDto[];
  sourceFiles: SourceFileDto[];
  pendingReassignments: OutlineReassignment[];
  highlightedNodeId?: string | null;
  harnessState?: HarnessState | null;
}

type PreviewFormat = 'formatted' | 'markdown';

const SemanticBlockPreview: React.FC<{ block: SemanticBlock }> = ({ block }) => {
  if (block.kind === 'heading') {
    return (
      <h6 className="text-xs font-extrabold text-[#1E3A5F] pt-1">
        {block.text || block.title}
      </h6>
    );
  }
  if (block.kind === 'callout_warning' || block.kind === 'source_gap_flag') {
    const isGap = block.kind === 'source_gap_flag';
    return (
      <div className="rounded-lg border border-[#E5C6BD] bg-[#FFF8F6] px-3 py-2 text-[11.5px] space-y-1">
        <div className="font-bold text-[#9A3412]">
          {isGap
            ? `[نقص در منبع ورودی] ${block.title || 'اطلاعات تکمیلی در منبع موجود نیست'}`
            : block.title || 'هشدار فنی'}
        </div>
        {block.gapReason && <p className="text-[#57534E] leading-6">{block.gapReason}</p>}
        {block.missingInfo && (
          <p className="text-[#7C2D12] font-semibold">داده مفقود: {block.missingInfo}</p>
        )}
        {block.text && <p className="text-[#44403C] leading-6">{block.text}</p>}
      </div>
    );
  }
  if (block.kind === 'source_conflict_flag') {
    return (
      <div className="rounded-lg border border-[#E2CFA8] bg-[#FFFBF2] px-3 py-2 text-[11.5px] space-y-1">
        <div className="font-bold text-[#8C6226]">
          [تناقض میان منابع ورودی] {block.conflictTopic || block.title || 'اختلاف مقدار فنی'}
        </div>
        {block.conflictSourceA && (
          <p className="text-[#44403C] leading-6">منبع اول: {block.conflictSourceA}</p>
        )}
        {block.conflictSourceB && (
          <p className="text-[#44403C] leading-6">منبع دوم: {block.conflictSourceB}</p>
        )}
        {block.text && <p className="text-[#57534E] leading-6">{block.text}</p>}
      </div>
    );
  }
  if (block.kind === 'figure_ref') {
    return (
      <div className="rounded-lg border border-[#D8E2EC] bg-[#F7FAFD] px-3 py-2 text-[11.5px] space-y-0.5">
        <div className="font-bold text-[#1E3A5F]">
          [ارجاع تصویر / نمودار] {block.caption || block.title || block.assetId || 'تصویر فنی'}
        </div>
        {block.assetId && (
          <div className="text-[10.5px] font-mono text-[#57534E]" dir="ltr">
            assetId: {block.assetId}
          </div>
        )}
      </div>
    );
  }
  if (block.kind === 'callout_tip') {
    return (
      <div className="rounded-lg border border-[#CBE0D1] bg-[#F4FAF6] px-3 py-2 text-[11.5px] space-y-1">
        <div className="font-bold text-[#14532D]">{block.title || 'نکته کارگاهی'}</div>
        {block.text && <p className="text-[#292524] leading-6">{block.text}</p>}
      </div>
    );
  }
  if (block.kind === 'step_list' && block.items?.length) {
    return (
      <ol className="list-decimal pr-5 space-y-1 text-[12px] leading-6 text-[#292524]">
        {block.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>
    );
  }
  if (block.kind === 'table' && block.headers?.length) {
    return (
      <div className="overflow-x-auto rounded-lg border border-[#E2DDD3]">
        <table className="w-full text-[11px] border-collapse">
          <thead className="bg-[#EEF3F8] text-[#1E3A5F]">
            <tr>
              {block.headers.map((h, i) => (
                <th key={i} className="px-2.5 py-1.5 text-right font-bold border-b border-[#E2DDD3]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EFECE4] bg-white">
            {(block.rows || []).map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="px-2.5 py-1.5 text-[#292524]">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.kind === 'formula') {
    return (
      <div className="rounded-md bg-[#F5F3EE] px-3 py-2 text-[11.5px] font-mono text-[#1E3A5F]" dir="ltr">
        {block.readable || block.latex || block.text}
      </div>
    );
  }
  return (
    <p className="text-[12.5px] leading-7 text-[#292524] text-justify whitespace-pre-line">
      {block.text}
    </p>
  );
};

export const Stage3LiveTextPreviewPanel: React.FC<Stage3LiveTextPreviewPanelProps> = ({
  projectTitle,
  draftNodes,
  contentUnits,
  sourceFiles,
  pendingReassignments,
  highlightedNodeId = null,
  harnessState = null,
}) => {
  const [format, setFormat] = useState<PreviewFormat>('formatted');
  const [copied, setCopied] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const preview = useMemo(
    () =>
      buildLiveOutlineTextPreview({
        projectTitle,
        draftNodes,
        contentUnits,
        sourceFiles,
        pendingReassignments,
      }),
    [projectTitle, draftNodes, contentUnits, sourceFiles, pendingReassignments]
  );

  const handleCopyPreview = async () => {
    try {
      await navigator.clipboard.writeText(preview.plainMarkdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API may be unavailable in restricted contexts
    }
  };

  const scrollToChapter = (nodeId: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-preview-chapter="${CSS.escape(nodeId)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <aside
      aria-label="پانل پیش‌نمایش آنی متن سند"
      data-testid="stage3-live-preview-panel"
      className="rounded-xl border border-[#E2DDD3] bg-white flex flex-col overflow-hidden xl:sticky xl:top-4 xl:max-h-[calc(100vh-140px)]"
    >
      {/* Panel Header */}
      <div className="border-b border-[#EFECE4] bg-[#FCFBF8] px-4 py-3 space-y-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Eye className="h-4 w-4 text-[#1E3A5F] shrink-0" />
            <h3 className="text-xs sm:text-sm font-extrabold text-[#1A1816] truncate">
              پیش‌نمایش آنی خروجی سند
            </h3>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div
              role="group"
              aria-label="حالت نمایش پیش‌نمایش آنی"
              className="inline-flex items-center gap-0.5 rounded-lg bg-[#EFECE4] p-0.5"
            >
              <button
                type="button"
                onClick={() => setFormat('formatted')}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  format === 'formatted'
                    ? 'bg-white text-[#1E3A5F] shadow-xs'
                    : 'text-[#57534E] hover:text-[#1A1816]'
                }`}
              >
                <FileText className="h-3 w-3" />
                <span>نمای سند</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('markdown')}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  format === 'markdown'
                    ? 'bg-white text-[#1E3A5F] shadow-xs'
                    : 'text-[#57534E] hover:text-[#1A1816]'
                }`}
              >
                <Code2 className="h-3 w-3" />
                <span>متن خام</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyPreview()}
              disabled={preview.totalChapters === 0}
              aria-label="کپی متن پیش‌نمایش"
              title="کپی کل متن پیش‌نمایش در حافظه"
              className="inline-flex min-h-[30px] items-center gap-1 rounded-md border border-[#D6D0C4] bg-white px-2 py-1 text-[11px] font-semibold text-[#44403C] hover:bg-[#F5F3EE] disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-[#14532D]" />
                  <span className="text-[#14532D]">کپی شد</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span className="hidden sm:inline">کپی</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Unboxed Live Metadata Line */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#57534E] tabular-nums">
          <span>{toPersianDigits(preview.totalChapters)} فصل</span>
          <span aria-hidden="true">·</span>
          <span>{toPersianDigits(preview.totalUnits)} واحد محتوایی</span>
          <span aria-hidden="true">·</span>
          <span>
            {toPersianDigits(preview.totalWords.toLocaleString('en-US'))} کلمه
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-[#1E3A5F] font-semibold">همگام‌سازی لحظه‌ای با سرفصل‌ها</span>
        </div>

        {/* Quick Live TOC Jump Bar */}
        {format === 'formatted' && preview.chapters.length > 0 && (
          <div className="pt-1 border-t border-[#EFECE4]">
            <div className="flex items-center gap-1 text-[10.5px] font-bold text-[#78716C] mb-1.5">
              <ListTree className="h-3 w-3 text-[#1E3A5F]" />
              <span>فهرست زنده فصل‌ها (کلیک برای پرش):</span>
            </div>
            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
              {preview.chapters.map((ch) => (
                <button
                  key={ch.nodeId}
                  type="button"
                  onClick={() => scrollToChapter(ch.nodeId)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] transition-colors cursor-pointer max-w-[200px] ${
                    highlightedNodeId === ch.nodeId
                      ? 'border-[#1E3A5F] bg-[#EEF3F8] font-bold text-[#1E3A5F]'
                      : 'border-[#E2DDD3] bg-white text-[#44403C] hover:border-[#1E3A5F]/50'
                  }`}
                >
                  <span className="font-bold tabular-nums text-[#1E3A5F] shrink-0">
                    {toPersianDigits(ch.order)}.
                  </span>
                  <span className="truncate">{ch.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Scrollable Live Document Body */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 sm:p-5 bg-[#FDFCF9] min-h-[320px]"
      >
        {preview.chapters.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#78716C] space-y-1">
            <p className="font-bold text-[#44403C]">فصلی برای پیش‌نمایش وجود ندارد</p>
            <p>با افزودن یا بازیابی فصل‌ها در ستون کناری، متن سند بلافاصله اینجا ساخته می‌شود.</p>
          </div>
        ) : format === 'markdown' ? (
          <pre
            dir="rtl"
            className="whitespace-pre-wrap break-words font-sans text-[12px] leading-7 text-[#1A1816] bg-white rounded-lg border border-[#EAE5DA] p-4"
          >
            {preview.plainMarkdown}
          </pre>
        ) : (
          <article className="space-y-6 text-[#1A1816]">
            {/* Document Title Block */}
            <header className="border-b border-[#E2DDD3] pb-3 space-y-1">
              <div className="text-[11px] font-semibold text-[#78716C]">
                سند یکپارچه (پیش‌نویس زنده پیش از صفحه‌آرایی A4)
              </div>
              <h4 className="text-base font-extrabold text-[#1E3A5F] leading-snug">
                {preview.projectTitle}
              </h4>
            </header>

            {/* Chapters */}
            {preview.chapters.map((ch) => {
              let lastSubheading = '';
              const isHighlighted = highlightedNodeId === ch.nodeId;

              return (
                <section
                  key={ch.nodeId}
                  data-preview-chapter={ch.nodeId}
                  className={`space-y-3 pb-5 border-b border-[#EFECE4] last:border-b-0 transition-colors rounded-lg ${
                    isHighlighted ? 'bg-[#F5F8FC] p-3 -mx-3' : ''
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h5 className="text-sm font-extrabold text-[#1E3A5F] leading-6">
                        فصل {toPersianDigits(ch.order)}: {ch.title}
                      </h5>
                      <span className="text-[10.5px] text-[#78716C] tabular-nums shrink-0">
                        {toPersianDigits(ch.wordCount.toLocaleString('en-US'))} کلمه ·{' '}
                        {toPersianDigits(ch.sharePercent)}٪
                      </span>
                    </div>
                    {ch.summary && (
                      <p className="text-[11.5px] text-[#57534E] leading-5">{ch.summary}</p>
                    )}
                  </div>

                  {(() => {
                    const irSections: SemanticSectionIR[] = harnessState
                      ? Object.values(harnessState.sectionsIR).filter(
                          (sec) => sec.chapterId === ch.nodeId && sec.blocks.length > 0
                        )
                      : [];
                    if (irSections.length > 0) {
                      return (
                        <div className="space-y-3">
                          <div className="text-[10.5px] font-bold text-[#14532D]">
                            خروجی تدوین‌شده توسط هارنس (Semantic IR تأییدشده):
                          </div>
                          {irSections.map((ir) => (
                            <div key={ir.sectionId} className="space-y-2">
                              {irSections.length > 1 && (
                                <h6 className="text-xs font-extrabold text-[#1E3A5F]">
                                  {ir.title}
                                </h6>
                              )}
                              {ir.blocks.map((blk) => (
                                <SemanticBlockPreview key={blk.id} block={blk} />
                              ))}
                            </div>
                          ))}
                        </div>
                      );
                    }
                    if (ch.blocks.length === 0) {
                      return (
                        <p className="text-[11.5px] text-[#78716C] italic leading-6">
                          این فصل در حال حاضر بدون پاراگراف است؛ با ادغام فصل دیگر یا استفاده از دستیار می‌توانید محتوای آن را تکمیل کنید.
                        </p>
                      );
                    }
                    return (
                      <div className="space-y-2.5">
                        {ch.blocks.map((block) => {
                          const sub =
                            block.headingPath
                              ?.split(/\s*>\s*/)
                              .slice(1)
                              .join(' / ')
                              .trim() || '';
                          const showSub = Boolean(sub && sub !== lastSubheading);
                          if (showSub) lastSubheading = sub;

                          return (
                            <div key={block.id} className="space-y-1">
                              {showSub && (
                                <h6 className="text-xs font-bold text-[#292524] pt-1">
                                  {sub}
                                </h6>
                              )}
                              <p className="text-[12.5px] leading-7 text-[#292524] text-justify whitespace-pre-line">
                                {block.text}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {ch.hasWebEnrichment && ch.webEnrichmentSummary && (
                    <div className="rounded-lg border border-[#D7CBE6] bg-[#F7F4FA] p-3 space-y-1 text-[11.5px]">
                      <div className="flex items-center gap-1.5 font-bold text-[#5B21B6]">
                        <Globe className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          تکمیل‌شده با جستجوی گوگل: {ch.webEnrichmentTitle || ch.title}
                        </span>
                      </div>
                      <p className="text-[#44403C] leading-6 whitespace-pre-line">
                        {ch.webEnrichmentSummary}
                      </p>
                    </div>
                  )}
                </section>
              );
            })}
          </article>
        )}
      </div>
    </aside>
  );
};
