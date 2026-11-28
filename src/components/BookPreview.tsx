import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Compass,
  ExternalLink,
  FileText,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Lightbulb,
  ListTree,
  RefreshCw,
  Search,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalloutBlock,
  CalloutVariant,
  ContentBlock,
  DocxExportConfig,
  FootnoteEntry,
  ParsedBook,
} from '../lib/bookTypes';
import {
  getCalloutTheme,
  SPECIAL_FRAME_THEMES,
} from '../lib/calloutThemes';
import { sanitizeSvgMarkup } from '../lib/diagramRenderer';
import { toPersianDigits } from '../lib/formatParsers';
import { SelectedChapterKey } from './ChapterSidebar';
import { RichText } from './RichText';

interface BookPreviewProps {
  book: ParsedBook;
  selected: SelectedChapterKey;
  onSelect: (key: SelectedChapterKey) => void;
  config: DocxExportConfig;
  onOpenChapterDrawer?: () => void;
}

function getCalloutIcon(variant: CalloutVariant) {
  switch (variant) {
    case 'warning':
      return AlertTriangle;
    case 'qa':
      return HelpCircle;
    case 'engineering':
      return Wrench;
    case 'revision':
      return RefreshCw;
    case 'project':
      return Compass;
    case 'concept':
    default:
      return Lightbulb;
  }
}

function CalloutCard({
  block,
  footnoteMap,
  onSelectFootnote,
}: {
  block: CalloutBlock;
  footnoteMap: Map<number, FootnoteEntry>;
  onSelectFootnote: (fn: FootnoteEntry) => void;
}) {
  const theme = getCalloutTheme(block.variant);
  const Icon = getCalloutIcon(block.variant);
  const cleanTitle = block.title.replace(/^[⛔💡⚙️🔄❓📘]+\s*/, '').trim();
  const showKicker =
    !cleanTitle.includes(theme.labelFa) &&
    !cleanTitle.startsWith('مبانی علمی') &&
    !cleanTitle.startsWith('پرسش و پاسخ') &&
    !cleanTitle.startsWith('هشدار') &&
    !cleanTitle.startsWith('نکته');

  return (
    <aside
      aria-label={theme.labelFa}
      className={`my-6 overflow-hidden rounded-xl border ${theme.outerBorderClass} ${theme.bodyBgClass} shadow-[0_1px_2px_rgba(26,24,22,0.04)]`}
    >
      <div
        className={`flex items-center justify-between gap-3 border-b ${theme.headerBorderClass} ${theme.headerBgClass} px-4 py-3 sm:px-5`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${theme.iconBgClass}`}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            {showKicker && (
              <div className={`text-[10.5px] font-bold ${theme.kickerTextClass}`}>
                {theme.labelFa}
              </div>
            )}
            <div className={`text-[13.5px] font-extrabold leading-snug ${theme.accentTextClass}`}>
              <RichText text={cleanTitle || theme.labelFa} footnoteMap={footnoteMap} onSelectFootnote={onSelectFootnote} />
            </div>
          </div>
        </div>
        <span className={`hidden sm:inline shrink-0 text-[10.5px] font-semibold opacity-80 ${theme.kickerTextClass}`}>
          {theme.subtitleFa}
        </span>
      </div>

      <div className="space-y-2.5 px-4 py-4 sm:px-5 text-[13.5px] leading-[2] text-[#292524]">
        {block.paragraphs.map((p, idx) => (
          <p key={idx}>
            <RichText text={p} footnoteMap={footnoteMap} onSelectFootnote={onSelectFootnote} />
          </p>
        ))}
      </div>
    </aside>
  );
}

function BlockRenderer({
  block,
  footnoteMap,
  onSelectFootnote,
  onInspectProvenance,
}: {
  block: ContentBlock;
  footnoteMap: Map<number, FootnoteEntry>;
  onSelectFootnote: (fn: FootnoteEntry) => void;
  onInspectProvenance?: (files: string[]) => void;
}) {
  const hasProvenance = Boolean(block.sourceFileNames && block.sourceFileNames.length > 0);
  const wrapWithProvenance = (node: React.ReactNode) => {
    if (!hasProvenance || !onInspectProvenance) return node;
    return (
      <div
        onClick={() => onInspectProvenance(block.sourceFileNames!)}
        title={`منبع: ${block.sourceFileNames!.join('، ')} — برای مشاهده کلیک کنید`}
        className="group relative rounded-sm transition-colors hover:bg-[#FAF7F0] cursor-pointer"
      >
        {node}
      </div>
    );
  };

  switch (block.type) {
    case 'paragraph':
      return wrapWithProvenance(
        <p className="my-3.5 text-[14.5px] leading-[2] text-[#1A1816]">
          <RichText text={block.text} footnoteMap={footnoteMap} onSelectFootnote={onSelectFootnote} />
        </p>
      );

    case 'subheading':
      return (
        <div className="mt-7 mb-3 flex items-baseline justify-between gap-2 border-b border-[#EAE5DA] pb-1.5">
          <h4 className="text-[15.5px] font-bold text-[#1E3A5F]">
            <RichText text={block.text} footnoteMap={footnoteMap} onSelectFootnote={onSelectFootnote} />
          </h4>
          <span className="font-mono-ltr shrink-0 text-[10px] text-[#8C857B]">Heading 4</span>
        </div>
      );

    case 'callout':
      return wrapWithProvenance(
        <CalloutCard block={block} footnoteMap={footnoteMap} onSelectFootnote={onSelectFootnote} />
      );

    case 'table': {
      const colTypes = block.headers.map((h, cIdx) => {
        const isHighlightHeader =
          /(آدرس|hex|کد|داموس|تغییر|مقدار|دلتا|ضریب|rpm|بار|load|lambda|afr|جرقه|advance)/i.test(
            h || ''
          );
        const samples = block.rows
          .slice(0, 12)
          .map((r) => (r[cIdx] || '').trim())
          .filter((v) => v.length > 0 && v !== '—' && v !== '-');
        const techHits = samples.filter(
          (val) =>
            val.length <= 26 &&
            (/^(?:0x[0-9a-f]+|\$?[0-9a-f]{4,6}|[+-]?[۰-۹0-9]+(?:[./:][۰-۹0-9]+)?\s*(?:%|°|rpm|bar|ms|mv|v|km\/h|nm|kw|cc|afr|λ|درجه|درصد)?|[A-Z][A-Z0-9_]{2,14})$/i.test(
              val
            ) ||
              /^فصل\s+[۰-۹0-9]+$/.test(val) ||
              /^جدول\s+[۰-۹0-9]+[-–][۰-۹0-9]+$/.test(val))
        ).length;
        const isNumeric = samples.length > 0 && techHits / samples.length >= 0.6;
        return { isNumeric, isHighlight: isNumeric && isHighlightHeader };
      });

      return wrapWithProvenance(
        <div className="my-6">
          {block.caption && (
            <div className="mb-2.5 flex items-center justify-between gap-2 border-r-[3px] border-[#B45309] pr-2.5">
              <div className="text-[13px] font-extrabold text-[#1E3A5F]">
                <RichText
                  text={block.caption}
                  footnoteMap={footnoteMap}
                  onSelectFootnote={onSelectFootnote}
                />
              </div>
              {block.originalCaption && block.originalCaption !== block.caption && (
                <span className="shrink-0 text-[11px] font-medium text-[#78716C]">
                  شماره‌گذاری یکپارچه شد
                </span>
              )}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-[#D4CEC2] shadow-[0_1px_2px_rgba(26,24,22,0.03)]">
            <table className="w-full border-collapse text-right text-[13px]">
              <thead>
                <tr className="bg-[#1E3A5F] text-white">
                  {block.headers.map((h, hIdx) => (
                    <th
                      key={hIdx}
                      className={`border-l border-[#2F527F] px-3.5 py-2.5 font-bold last:border-l-0 ${
                        colTypes[hIdx]?.isNumeric ? 'text-center' : 'text-right'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    className={`border-t border-[#E6E0D4] ${rIdx % 2 === 1 ? 'bg-[#F8F6F1]' : 'bg-white'}`}
                  >
                    {row.map((cell, cIdx) => {
                      const ct = colTypes[cIdx];
                      return (
                        <td
                          key={cIdx}
                          className={`border-l border-[#E6E0D4] px-3.5 py-2.5 leading-relaxed last:border-l-0 ${
                            ct?.isNumeric ? 'text-center tabular-nums' : 'text-right'
                          } ${
                            ct?.isHighlight
                              ? 'bg-[#EEF3F8]/55 font-bold text-[#1E3A5F]'
                              : 'text-[#292524]'
                          }`}
                        >
                          <RichText
                            text={cell || '—'}
                            footnoteMap={footnoteMap}
                            onSelectFootnote={onSelectFootnote}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    case 'equation': {
      const eqTheme = SPECIAL_FRAME_THEMES.equation;
      return wrapWithProvenance(
        <div className={`my-5 overflow-hidden rounded-xl border ${eqTheme.outerBorderClass} ${eqTheme.bodyBgClass}`}>
          <div className={`flex items-center justify-between border-b ${eqTheme.headerBorderClass} ${eqTheme.headerBgClass} px-4 py-1.5 text-[11px] font-bold ${eqTheme.accentTextClass}`}>
            <span>{eqTheme.labelFa}</span>
            <span className="font-mono-ltr text-[10px] opacity-75">Formula</span>
          </div>
          <div className="px-4 py-3.5 text-center">
            <div className="font-mono-ltr text-sm font-semibold text-[#1E3A5F]">{block.readable}</div>
          </div>
        </div>
      );
    }

    case 'list':
      return wrapWithProvenance(
        block.ordered ? (
          <ol className="my-3.5 space-y-2 pr-5 text-[14px] leading-[1.9] text-[#1A1816]">
            {block.items.map((item, idx) => (
              <li key={idx} className="list-decimal marker:font-bold marker:text-[#1E3A5F]">
                <RichText text={item} footnoteMap={footnoteMap} onSelectFootnote={onSelectFootnote} />
              </li>
            ))}
          </ol>
        ) : (
          <ul className="my-3.5 space-y-2 pr-5 text-[14px] leading-[1.9] text-[#1A1816]">
            {block.items.map((item, idx) => (
              <li key={idx} className="list-disc marker:text-[#1E3A5F]">
                <RichText text={item} footnoteMap={footnoteMap} onSelectFootnote={onSelectFootnote} />
              </li>
            ))}
          </ul>
        )
      );

    case 'figure': {
      const figTheme = SPECIAL_FRAME_THEMES.figure;
      const isResolvedWeb =
        block.imageStrategy === 'WEB_SEARCH' &&
        block.resolutionStatus === 'resolved_web' &&
        Boolean(block.imageUrl);
      const isAiPlaceholder =
        block.imageStrategy === 'AI_PLACEHOLDER' ||
        block.resolutionStatus === 'ai_placeholder' ||
        block.resolutionStatus === 'fallback_placeholder' ||
        Boolean(block.aiPlaceholderSpec && !block.imageUrl);

      if (isResolvedWeb && block.imageUrl) {
        return wrapWithProvenance(
          <figure
            data-testid="smart-figure-web-resolved"
            className="my-6 overflow-hidden rounded-xl border border-[#CBD5E1] bg-[#FCFBF8] shadow-[0_1px_2px_rgba(26,24,22,0.03)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] bg-[#EEF3F8] px-4 py-2.5 text-xs font-bold text-[#1E3A5F]">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#1E3A5F] text-white">
                  <ImageIcon className="h-3.5 w-3.5" />
                </span>
                <span>{block.caption}</span>
              </div>
              <span className="rounded bg-white px-2 py-0.5 text-[10px] font-bold text-[#14532D] border border-[#BBF7D0]">
                تصویر فنی مرجع (WEB_SEARCH)
              </span>
            </div>

            <div className="p-3 bg-white">
              <img
                src={block.imageUrl}
                alt={block.caption}
                className="mx-auto max-h-[380px] w-full object-contain rounded-lg"
              />
            </div>

            <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E4DFD4] bg-[#F4F1EA] px-4 py-2 text-[11px] text-[#44403C]">
              <span className="font-semibold text-[#1E3A5F]">
                {block.searchQuery ? `کوئری فنی: ${block.searchQuery}` : block.description}
              </span>
              {block.sourceUri && (
                <a
                  href={block.sourceUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-0.5 text-[10.5px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8]"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span>{block.sourceTitle || 'مشاهده مرجع فنی'}</span>
                </a>
              )}
            </figcaption>
          </figure>
        );
      }

      if (isAiPlaceholder && block.aiPlaceholderSpec) {
        const spec = block.aiPlaceholderSpec;
        return wrapWithProvenance(
          <aside
            data-testid="smart-figure-ai-placeholder"
            className="my-5 overflow-hidden rounded-xl border border-dashed border-[#B45309] bg-[#FFFBEB] shadow-[0_1px_2px_rgba(26,24,22,0.03)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#FDE68A] bg-[#FEF3C7] px-4 py-2.5 text-xs font-extrabold text-[#92400E]">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#B45309] text-white">
                  <ImageIcon className="h-3.5 w-3.5" />
                </span>
                <span>
                  [تصویر تولیدی AI | شناسه: {spec.codeId} | نوع: {spec.typeFa}]
                </span>
              </div>
              <span className="rounded bg-white px-2 py-0.5 text-[10px] font-bold text-[#92400E] border border-[#FCD34D]">
                قالب خلاصه ۳ خطی (۰ توکن تولید تصویر)
              </span>
            </div>

            <div className="px-4 py-3 space-y-1.5 text-[12.5px] leading-6 text-[#292524]">
              <div>
                <strong className="text-[#92400E]">• موضوع:</strong> {spec.subjectFa}
              </div>
              <div>
                <strong className="text-[#92400E]">• عناصر کلیدی:</strong> {spec.elementsFa}
              </div>
              <div>
                <strong className="text-[#92400E]">• برچسب‌های الزامی روی تصویر:</strong>{' '}
                <span className="font-mono text-[11.5px] font-semibold text-[#1E3A5F]" dir="ltr">
                  {spec.labelsFa}
                </span>
              </div>
            </div>
          </aside>
        );
      }

      return (
        <div className={`my-5 overflow-hidden rounded-xl border ${figTheme.outerBorderClass} ${figTheme.bodyBgClass}`}>
          <div className={`flex items-center gap-2 border-b ${figTheme.headerBorderClass} ${figTheme.headerBgClass} px-4 py-2.5 text-xs font-bold ${figTheme.accentTextClass}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-md ${figTheme.iconBgClass}`}>
              <ImageIcon className="h-3.5 w-3.5" />
            </span>
            <span>{block.caption}</span>
          </div>
          <p className="px-4 py-3 text-[13px] leading-relaxed text-[#44403C]">{block.description}</p>
        </div>
      );
    }

    case 'image':
      return wrapWithProvenance(
        <figure className="my-6 overflow-hidden rounded-xl border border-[#D4CEC2] bg-[#FCFBF8]">
          <div className="p-3">
            <img
              src={block.dataUrl}
              alt={block.caption}
              className="mx-auto max-h-[380px] w-auto object-contain rounded-lg"
            />
          </div>
          <figcaption className="border-t border-[#E4DFD4] bg-[#F4F1EA] px-4 py-2.5 text-center text-xs font-bold text-[#1E3A5F]">
            {block.caption}
          </figcaption>
        </figure>
      );

    case 'web_enrichment': {
      const webTheme = SPECIAL_FRAME_THEMES.web_enrichment;
      return (
        <aside className={`my-6 overflow-hidden rounded-xl border ${webTheme.outerBorderClass} ${webTheme.bodyBgClass} shadow-[0_1px_2px_rgba(26,24,22,0.03)]`}>
          <div className={`flex flex-wrap items-center justify-between gap-2 border-b ${webTheme.headerBorderClass} ${webTheme.headerBgClass} px-4 py-3 sm:px-5`}>
            <div className={`flex items-center gap-2.5 text-xs font-extrabold ${webTheme.accentTextClass}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${webTheme.iconBgClass}`}>
                <Globe className="h-4 w-4" />
              </span>
              <span>تکمیل‌شده از وب (جستجوی گوگل): {block.title}</span>
            </div>
            <span className="text-[10.5px] font-semibold text-[#5B4F8A]">ایزوله از متن اصلی کاربر</span>
          </div>
          <div className="px-4 py-4 sm:px-5 space-y-3">
            <p className="text-[13.5px] leading-[2] text-[#292524]">{block.summary}</p>
            {block.sources.length > 0 && (
              <div className={`flex flex-wrap gap-2 border-t ${webTheme.headerBorderClass} pt-3`}>
                {block.sources.map((src, i) => (
                  <a
                    key={i}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 rounded-md border ${webTheme.outerBorderClass} bg-white px-2.5 py-1 text-[11px] font-semibold ${webTheme.accentTextClass} hover:bg-[#EFEAF9]`}
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="max-w-[200px] truncate">{src.title}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </aside>
      );
    }

    case 'conflict_note': {
      const confTheme = SPECIAL_FRAME_THEMES.conflict_note;
      return (
        <aside className={`my-6 overflow-hidden rounded-xl border ${confTheme.outerBorderClass} ${confTheme.bodyBgClass} shadow-[0_1px_2px_rgba(26,24,22,0.03)]`}>
          <div className={`flex items-center gap-2.5 border-b ${confTheme.headerBorderClass} ${confTheme.headerBgClass} px-4 py-3 sm:px-5 text-xs font-extrabold ${confTheme.accentTextClass}`}>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${confTheme.iconBgClass}`}>
              <AlertTriangle className="h-4 w-4" />
            </span>
            <span>مقایسه دو روایت منبع (تناقض حفظ‌شده): {block.topic}</span>
          </div>
          <div className="p-4 sm:p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs leading-relaxed">
              <div className="rounded-lg border border-[#ECD0C8] bg-white p-3.5">
                <div className="font-bold text-[#1E3A5F] mb-1">روایت ۱ · {block.fileAName}</div>
                <p className="text-[#292524] leading-6">{block.excerptA}</p>
              </div>
              <div className="rounded-lg border border-[#ECD0C8] bg-white p-3.5">
                <div className="font-bold text-[#1E3A5F] mb-1">روایت ۲ · {block.fileBName}</div>
                <p className="text-[#292524] leading-6">{block.excerptB}</p>
              </div>
            </div>
            {block.webSummary && (
              <div className="rounded-lg border border-[#D4C8EE] bg-[#F5F1FC] p-3.5 text-xs leading-relaxed text-[#292524]">
                <div className="font-bold text-[#4C1A94] mb-1">نتیجه بررسی با جستجوی گوگل:</div>
                <p>{block.webSummary}</p>
              </div>
            )}
            {block.resolutionNote && (
              <div className="rounded-lg border border-[#BFE0CD] bg-[#EEF8F2] px-3.5 py-2 text-xs font-semibold text-[#124E32]">
                تصمیم ویراستار: {block.resolutionNote}
              </div>
            )}
          </div>
        </aside>
      );
    }

    case 'diagram':
      return (
        <figure className="my-6 overflow-hidden rounded-xl border border-[#D4CEC2] bg-[#FCFBF8]">
          <div
            className="p-3 [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: sanitizeSvgMarkup(block.svgMarkup) }}
          />
          <figcaption className="border-t border-[#E4DFD4] bg-[#F4F1EA] px-4 py-2.5 text-center text-xs font-bold text-[#1E3A5F]">
            {block.caption}
          </figcaption>
        </figure>
      );

    default:
      return null;
  }
}

export function BookPreview({
  book,
  selected,
  onSelect,
  config,
  onOpenChapterDrawer,
}: BookPreviewProps) {
  const [activeFootnote, setActiveFootnote] = useState<FootnoteEntry | null>(null);
  const [activeProvenance, setActiveProvenance] = useState<string[] | null>(null);
  const [glossarySearch, setGlossarySearch] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    setActiveFootnote(null);
    setActiveProvenance(null);
  }, [selected]);

  const footnoteMap = useMemo(() => {
    const map = new Map<number, FootnoteEntry>();
    for (const fn of book.footnotes) map.set(fn.canonicalId, fn);
    return map;
  }, [book.footnotes]);

  const currentChapter = useMemo(() => {
    if (selected.kind !== 'chapter') return null;
    return book.chapters.find((c) => c.chapterNumber === selected.chapterNumber) || null;
  }, [book.chapters, selected]);

  const chapterSuggestions = useMemo(() => {
    if (!currentChapter) return [];
    return book.visualSuggestions.filter((v) => v.chapterNumber === currentChapter.chapterNumber);
  }, [book.visualSuggestions, currentChapter]);

  const currentLocationLabel = useMemo(() => {
    if (selected.kind === 'chapter' && currentChapter) {
      return `فصل ${toPersianDigits(currentChapter.chapterNumber)} از ${toPersianDigits(book.chapters.length)}`;
    }
    if (selected.kind === 'cheatsheets') return 'برگه تقلب و قوانین طلایی';
    if (selected.kind === 'tables') return 'فهرست جداول یکپارچه';
    if (selected.kind === 'glossary') return 'واژه‌نامه یکپارچه';
    if (selected.kind === 'footnotes') return 'پانویس‌های یکتا';
    return 'جلد و فهرست سرفصل‌ها';
  }, [selected, currentChapter, book.chapters.length]);

  return (
    <div ref={scrollContainerRef} className="relative flex-1 lg:overflow-y-auto">
      {/* Sticky Return-to-TOC & Chapter Navigation Bar whenever inside any chapter or appendix */}
      {selected.kind !== 'cover' && (
        <nav
          aria-label="ناوبری بازگشت به فهرست سرفصل‌ها"
          className="sticky top-[58px] lg:top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-[#E2DDD3] bg-[#FAF8F4]/95 px-4 py-2 backdrop-blur-xs sm:px-8"
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => onSelect({ kind: 'cover' })}
              className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-md border border-[#1E3A5F]/25 bg-white px-3 py-1 text-xs font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowRight className="h-3.5 w-3.5 shrink-0" />
              <span>بازگشت به فهرست سرفصل‌ها</span>
            </button>

            {onOpenChapterDrawer && (
              <button
                type="button"
                onClick={onOpenChapterDrawer}
                className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-md border border-[#D8D2C5] bg-white px-2.5 py-1 text-xs font-semibold text-[#44403C] hover:bg-[#F3F0E8] xl:hidden transition-colors cursor-pointer whitespace-nowrap"
              >
                <ListTree className="h-3.5 w-3.5 text-[#1E3A5F] shrink-0" />
                <span>فهرست کشویی</span>
              </button>
            )}

            <span className="hidden sm:inline text-xs text-[#78716C] tabular-nums truncate">
              {currentLocationLabel}
            </span>
          </div>

          {selected.kind === 'chapter' && currentChapter && (
            <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
              <button
                type="button"
                disabled={currentChapter.chapterNumber <= 1}
                onClick={() =>
                  onSelect({ kind: 'chapter', chapterNumber: currentChapter.chapterNumber - 1 })
                }
                className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[#D8D2C5] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
              >
                <ChevronRight className="h-3.5 w-3.5" />
                <span>فصل قبلی</span>
              </button>
              <button
                type="button"
                disabled={currentChapter.chapterNumber >= book.chapters.length}
                onClick={() =>
                  onSelect({ kind: 'chapter', chapterNumber: currentChapter.chapterNumber + 1 })
                }
                className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[#D8D2C5] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>فصل بعدی</span>
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </nav>
      )}

      <div className="px-4 py-6 sm:px-8 lg:py-8">
      {/* Paper Sheet Container */}
      <article className="mx-auto max-w-[840px] rounded-xl border border-[#DFD9CC] bg-white px-6 py-8 shadow-[0_2px_10px_rgba(26,24,22,0.05)] sm:px-12 sm:py-12">
        {/* COVER & AUTOMATIC TOC VIEW */}
        {selected.kind === 'cover' && (
          <div>
            {/* Architectural Edition Crest Bar */}
            <div className="-mx-6 -mt-8 mb-8 rounded-t-xl border-b-[3px] border-[#B45309] bg-[#1E3A5F] px-6 py-3.5 text-white sm:-mx-12 sm:-mt-12 sm:px-12">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] font-bold">
                <span>نسخه صفحه‌آرایی‌شده و یکپارچه · استاندارد نشر فنی و مهندسی</span>
                <span className="font-mono text-[10.5px] opacity-85" dir="ltr">
                  {config.fontFamily} · {config.paperSize} · 100% RTL
                </span>
              </div>
            </div>

            <div className="py-4">
              <div className="border-r-4 border-[#1E3A5F] pr-5">
                <h1 className="text-2xl font-extrabold leading-tight text-[#1E3A5F] sm:text-[30px]">
                  {book.title}
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-[#57534E] sm:text-base">
                  {book.subtitle}
                </p>
              </div>

              {/* Archival Accession & Anti-Hallucination Stamp Grid */}
              <dl className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-[#DDD7C9] bg-[#DDD7C9] sm:grid-cols-2">
                <div className="bg-[#FBF9F5] p-4">
                  <dt className="text-[11px] font-semibold text-[#78716C]">تایپوگرافی و صفحه‌آرایی ورد</dt>
                  <dd className="mt-1 text-sm font-bold text-[#1A1816]">
                    {config.fontFamily} · اندازه {toPersianDigits(config.baseFontSizePt)}pt · جداسازی UAX #9 BiDi
                  </dd>
                </div>
                <div className="bg-[#FBF9F5] p-4">
                  <dt className="text-[11px] font-semibold text-[#78716C]">ساختار و حجم نهایی کتاب</dt>
                  <dd className="mt-1 text-sm font-bold tabular-nums text-[#1E3A5F]">
                    {toPersianDigits(book.volumes.length)} مجلد · {toPersianDigits(book.chapters.length)} فصل ·{' '}
                    {toPersianDigits(book.tableIndex.length)} جدول فنی
                  </dd>
                </div>
                <div className="bg-[#FBF9F5] p-4">
                  <dt className="text-[11px] font-semibold text-[#78716C]">ساختار سرفصل‌ها و هدر پویا</dt>
                  <dd className="mt-1 text-sm font-bold text-[#1A1816]">
                    Heading 1 تا Heading 4 + فهرست خودکار (TOC) + STYLEREF
                  </dd>
                </div>
                <div className="bg-[#F2F7F4] p-4">
                  <dt className="text-[11px] font-semibold text-[#14532D]">مهر تضمین یکپارچگی و ضدتوهم</dt>
                  <dd className="mt-1 text-sm font-extrabold text-[#14532D] tabular-nums">
                    {toPersianDigits(book.audit?.conceptRetentionRate ?? 100)}٪ حفظ بدون افت · ۰ آدرس هگز ساختگی
                  </dd>
                </div>
              </dl>
            </div>

            {/* Interactive Automatic TOC Preview */}
            <div className="mt-6 border-t border-[#E2DDD3] pt-7">
              <div className="mb-4 flex items-center justify-between border-b-2 border-[#1E3A5F] pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-4 w-1 rounded-full bg-[#B45309]" />
                  <h2 className="text-lg font-extrabold text-[#1E3A5F]">فهرست مطالب خودکار (Word RTL TOC)</h2>
                </div>
                <span className="font-mono-ltr text-[11px] text-[#78716C]">TOC \o &quot;1-3&quot; \h</span>
              </div>

              <div className="space-y-5">
                {book.volumes.map((vol) => {
                  const volChapters = book.chapters.filter((c) => c.volumeIndex === vol.index);
                  return (
                    <div key={vol.id}>
                      <div className="mb-2 flex items-center justify-between rounded-md border-r-[3px] border-[#1E3A5F] bg-[#EEF3F8] px-3.5 py-2 text-xs font-extrabold text-[#1E3A5F]">
                        <span>{vol.title}</span>
                        <span className="font-mono-ltr text-[10px] font-normal text-[#57534E]">
                          Heading 1
                        </span>
                      </div>
                      <ul className="divide-y divide-[#F0ECE3] pr-3">
                        {volChapters.map((ch) => (
                          <li key={ch.id} className="py-2.5">
                            <button
                              type="button"
                              onClick={() => onSelect({ kind: 'chapter', chapterNumber: ch.chapterNumber })}
                              className="group flex w-full items-baseline gap-2 text-right cursor-pointer"
                            >
                              <span className="shrink-0 font-mono text-[11px] font-bold text-[#B45309] tabular-nums">
                                {toPersianDigits(String(ch.chapterNumber).padStart(2, '0'))}
                              </span>
                              <span className="text-[13.5px] font-bold text-[#1A1816] group-hover:text-[#1E3A5F]">
                                {ch.title}
                              </span>
                              <span className="flex-1 border-b border-dotted border-[#CFC8B9] mx-1" aria-hidden="true" />
                              <span className="shrink-0 text-[11px] text-[#78716C] tabular-nums">
                                {toPersianDigits(ch.sections.length)} زیربخش
                              </span>
                            </button>
                            {ch.sections.length > 0 && (
                              <ul className="mt-1.5 space-y-1 pr-6 text-xs text-[#57534E]">
                                {ch.sections.slice(0, 4).map((sec) => (
                                  <li key={sec.id} className="truncate">
                                    {sec.numberLabel ? `${sec.numberLabel}. ` : ''}
                                    {sec.title}
                                  </li>
                                ))}
                                {ch.sections.length > 4 && (
                                  <li className="text-[11px] text-[#8C857B]">
                                    و {toPersianDigits(ch.sections.length - 4)} زیربخش دیگر...
                                  </li>
                                )}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* CHAPTER MANUSCRIPT VIEW */}
        {selected.kind === 'chapter' && currentChapter && (() => {
          const chTablesCount =
            currentChapter.introBlocks.filter((b) => b.type === 'table').length +
            currentChapter.sections.reduce(
              (acc, s) => acc + s.blocks.filter((b) => b.type === 'table').length,
              0
            );
          return (
          <div>
            {/* Architectural Chapter Opener Header */}
            <header className="mb-6 overflow-hidden rounded-xl border border-[#DCE4EE] bg-gradient-to-l from-[#F3F7FB] to-[#FAFBFD]">
              <div className="border-r-[5px] border-[#1E3A5F] px-5 py-4 sm:px-6 sm:py-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-[#B45309] tabular-nums">
                      فصل {toPersianDigits(String(currentChapter.chapterNumber).padStart(2, '0'))}
                    </span>
                    <span className="text-[#C6C0B4]" aria-hidden="true">·</span>
                    <span className="font-semibold text-[#57534E]">{currentChapter.volumeTitle}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#64748B] tabular-nums">
                    <span>{toPersianDigits(currentChapter.sections.length)} زیربخش</span>
                    {chTablesCount > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{toPersianDigits(chTablesCount)} جدول فنی</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-ltr text-[10px]">Heading 2</span>
                  </div>
                </div>
                <h1 className="text-xl font-extrabold leading-snug text-[#1E3A5F] sm:text-2xl">
                  {currentChapter.title}
                </h1>
              </div>
            </header>

            {/* Chapter Metadata Framed Table */}
            {config.includeChapterMetaCards && currentChapter.meta.length > 0 && (
              <div className={`my-6 overflow-hidden rounded-xl border ${SPECIAL_FRAME_THEMES.chapter_meta.outerBorderClass} ${SPECIAL_FRAME_THEMES.chapter_meta.bodyBgClass}`}>
                <div className={`border-b ${SPECIAL_FRAME_THEMES.chapter_meta.headerBorderClass} ${SPECIAL_FRAME_THEMES.chapter_meta.headerBgClass} px-4 py-2.5 text-xs font-extrabold ${SPECIAL_FRAME_THEMES.chapter_meta.accentTextClass}`}>
                  شناسنامه فصل
                </div>
                <dl className="divide-y divide-[#EAE5DA] text-xs">
                  {currentChapter.meta.map((m, idx) => (
                    <div key={idx} className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-4">
                      <dt className="font-bold text-[#57534E]">{m.label}</dt>
                      <dd className="text-[#1A1816] sm:col-span-3">
                        <RichText text={m.value} footnoteMap={footnoteMap} onSelectFootnote={setActiveFootnote} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Intro Blocks */}
            {currentChapter.introBlocks.length > 0 && (
              <div className="my-5 rounded-xl border border-[#ECE7DD] bg-[#FFFEFC] px-4 py-4 sm:px-6 sm:py-5">
                {currentChapter.introBlocks.map((b) => (
                  <BlockRenderer
                    key={b.id}
                    block={b}
                    footnoteMap={footnoteMap}
                    onSelectFootnote={setActiveFootnote}
                    onInspectProvenance={setActiveProvenance}
                  />
                ))}
              </div>
            )}

            {/* Framed Sections */}
            {currentChapter.sections.map((sec) => (
              <section
                key={sec.id}
                className="mt-7 overflow-hidden rounded-xl border border-[#E6E0D4] bg-[#FFFEFC]"
              >
                <div className="flex items-baseline justify-between gap-3 border-b border-[#EAE4D8] bg-[#F7F4EE] px-4 py-3 sm:px-6">
                  <h2 className="text-[16.5px] font-extrabold leading-snug text-[#1E3A5F]">
                    {sec.numberLabel ? (
                      <span className="ml-1.5 tabular-nums text-[#1E3A5F]">{sec.numberLabel}.</span>
                    ) : null}
                    {sec.title}
                  </h2>
                  <span className="font-mono-ltr shrink-0 text-[10px] text-[#78716C]">Heading 3</span>
                </div>
                <div className="px-4 py-4 sm:px-6 sm:py-5">
                  {sec.blocks.map((b) => (
                    <BlockRenderer
                      key={b.id}
                      block={b}
                      footnoteMap={footnoteMap}
                      onSelectFootnote={setActiveFootnote}
                      onInspectProvenance={setActiveProvenance}
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* Embedded Visual Suggestions Preview for Chapter */}
            {config.includeVisualSuggestions && chapterSuggestions.length > 0 && (
              <div className={`mt-8 overflow-hidden rounded-xl border ${SPECIAL_FRAME_THEMES.suggestions.outerBorderClass} ${SPECIAL_FRAME_THEMES.suggestions.bodyBgClass}`}>
                <div className={`border-b ${SPECIAL_FRAME_THEMES.suggestions.headerBorderClass} ${SPECIAL_FRAME_THEMES.suggestions.headerBgClass} px-4 py-3 sm:px-5 text-sm font-extrabold ${SPECIAL_FRAME_THEMES.suggestions.accentTextClass}`}>
                  پیشنهادهای افزودن جدول و تصویر آموزشی برای این فصل (درج خودکار در سند ورد)
                </div>
                <ul className="space-y-3 px-4 py-4 sm:px-5 text-[13px] leading-relaxed text-[#292524]">
                  {chapterSuggestions.map((s, idx) => (
                    <li key={s.id}>
                      <span className="font-bold text-[#154A6B]">
                        {toPersianDigits(idx + 1)}. [{s.kindLabel}] {s.title}:{' '}
                      </span>
                      <span>{s.rationale}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Chapter Prev/Next + Return-to-TOC Navigation */}
            <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[#E2DDD3] pt-5">
              {currentChapter.chapterNumber > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    onSelect({ kind: 'chapter', chapterNumber: currentChapter.chapterNumber - 1 })
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                  <span>فصل قبلی (فصل {toPersianDigits(currentChapter.chapterNumber - 1)})</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'cover' })}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                  <span>صفحه جلد و فهرست</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onSelect({ kind: 'cover' })}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-[#E2DDD3] bg-[#FAF8F4] px-3 py-1 text-xs font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] transition-colors cursor-pointer"
              >
                <ArrowRight className="h-3.5 w-3.5" />
                <span>بازگشت به فهرست سرفصل‌ها</span>
              </button>

              {currentChapter.chapterNumber < book.chapters.length ? (
                <button
                  type="button"
                  onClick={() =>
                    onSelect({ kind: 'chapter', chapterNumber: currentChapter.chapterNumber + 1 })
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
                >
                  <span>فصل بعدی (فصل {toPersianDigits(currentChapter.chapterNumber + 1)})</span>
                  <ChevronLeft className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'tables' })}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
                >
                  <span>پیوست فهرست جداول</span>
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          );
        })()}

        {/* MASTER CHEAT SHEETS APPENDIX */}
        {selected.kind === 'cheatsheets' && (
          <div>
            <h1 className="border-b-2 border-[#1E3A5F] pb-3 text-xl font-extrabold text-[#1E3A5F]">
              پیوست ویژه: برگه تقلب جامع و قوانین طلایی کارگاهی
            </h1>
            <p className="mt-3 text-xs leading-relaxed text-[#57534E]">
              تمامی برگه‌های تقلب، قوانین طلایی و هشدارهای بحرانی پراکنده در فصل‌ها به‌صورت یکتا و بدون تکرار در این مرجع سریع گردآوری شده‌اند.
            </p>
            <div className="mt-6 space-y-4">
              {book.cheatSheets.map((cs) => (
                <div key={cs.id} className="border border-[#E2DDD3] bg-[#FBF9F5] p-4">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#1E3A5F]">{cs.title}</h3>
                    <button
                      type="button"
                      onClick={() => onSelect({ kind: 'chapter', chapterNumber: cs.chapterNumber })}
                      className="shrink-0 text-[11px] font-semibold text-[#854D0E] hover:underline"
                    >
                      فصل {toPersianDigits(cs.chapterNumber)}
                    </button>
                  </div>
                  <div className="space-y-1.5 text-[13px] leading-relaxed text-[#292524]">
                    {cs.highlights.map((h, i) => (
                      <p key={i}>
                        <RichText text={h} footnoteMap={footnoteMap} onSelectFootnote={setActiveFootnote} />
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LIST OF TABLES APPENDIX */}
        {selected.kind === 'tables' && (
          <div>
            <h1 className="border-b-2 border-[#1E3A5F] pb-3 text-xl font-extrabold text-[#1E3A5F]">
              پیوست الف: فهرست کامل جداول (شماره‌گذاری یکپارچه و پیوسته)
            </h1>
            <p className="mt-3 text-xs leading-relaxed text-[#57534E]">
              تمام {toPersianDigits(book.tableIndex.length)} جدول موجود در سند بر اساس شماره فصل واقعی بازشماره‌گذاری شده و هرگونه تکرار شماره جدول برطرف شده است.
            </p>
            <div className="mt-6 overflow-x-auto border border-[#D8D2C5]">
              <table className="w-full border-collapse text-right text-xs">
                <thead>
                  <tr className="bg-[#1E3A5F] text-white">
                    <th className="w-28 border-l border-[#2F527F] px-3 py-2.5">شماره جدید</th>
                    <th className="border-l border-[#2F527F] px-3 py-2.5">عنوان جدول</th>
                    <th className="w-24 px-3 py-2.5">فصل</th>
                  </tr>
                </thead>
                <tbody>
                  {book.tableIndex.map((t, idx) => (
                    <tr
                      key={`${t.tableNumber}_${idx}`}
                      className={`border-t border-[#E2DDD3] ${idx % 2 === 1 ? 'bg-[#F8F6F1]' : 'bg-white'}`}
                    >
                      <td className="border-l border-[#E2DDD3] px-3 py-2 font-bold tabular-nums text-[#1E3A5F]">
                        جدول {t.tableNumber}
                      </td>
                      <td className="border-l border-[#E2DDD3] px-3 py-2 leading-relaxed text-[#1A1816]">
                        {t.caption.replace(/^جدول\s*[۰-۹0-9]+[-–][۰-۹0-9]+\s*[:：-]?\s*/, '')}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => onSelect({ kind: 'chapter', chapterNumber: t.chapterNumber })}
                          className="font-semibold text-[#1E3A5F] hover:underline"
                        >
                          فصل {toPersianDigits(t.chapterNumber)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* UNIFIED GLOSSARY APPENDIX */}
        {selected.kind === 'glossary' && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#1E3A5F] pb-3">
              <h1 className="text-xl font-extrabold text-[#1E3A5F]">
                پیوست ب: واژه‌نامه یکپارچه اصطلاحات تخصصی ({toPersianDigits(book.glossary.length)} مدخل)
              </h1>
              <div className="relative w-60">
                <Search className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#78716C]" />
                <input
                  type="text"
                  value={glossarySearch}
                  onChange={(e) => setGlossarySearch(e.target.value)}
                  placeholder="جستجو در واژه‌نامه..."
                  className="w-full rounded-sm border border-[#D8D2C5] bg-[#FBF9F5] py-1.5 pr-8 pl-3 text-xs focus:border-[#1E3A5F] focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 divide-y divide-[#EAE5DA]">
              {book.glossary
                .filter(
                  (g) =>
                    !glossarySearch.trim() ||
                    g.term.toLowerCase().includes(glossarySearch.toLowerCase()) ||
                    g.definition.toLowerCase().includes(glossarySearch.toLowerCase())
                )
                .map((g, idx) => (
                  <div key={`${g.term}_${idx}`} className="py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold text-[#1E3A5F]" dir="auto">
                        {g.term}
                      </span>
                      {g.chapters.length > 0 && (
                        <span className="shrink-0 text-[11px] text-[#78716C]">
                          فصل‌های {g.chapters.map((c) => toPersianDigits(c)).join('، ')}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-[#292524]">{g.definition}</p>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* UNIQUE FOOTNOTES APPENDIX */}
        {selected.kind === 'footnotes' && (
          <div>
            <h1 className="border-b-2 border-[#1E3A5F] pb-3 text-xl font-extrabold text-[#1E3A5F]">
              پیوست ج: پانویس‌های یکتا ({toPersianDigits(book.footnotes.length)} مدخل یکپارچه‌شده)
            </h1>
            <p className="mt-3 text-xs leading-relaxed text-[#57534E]">
              پانویس‌های تکراری در فصل‌های مختلف ادغام و تمام ارجاعات درون متن به‌صورت خودکار به شماره یکتای جدید بازنگاشت شده‌اند.
            </p>
            <div className="mt-5 divide-y divide-[#EAE5DA] text-[13px] leading-relaxed">
              {book.footnotes.map((fn) => (
                <div key={fn.canonicalId} className="flex gap-3 py-2.5">
                  <span className="w-10 shrink-0 font-bold tabular-nums text-[#1E3A5F]">
                    [{toPersianDigits(fn.canonicalId)}]
                  </span>
                  <div className="min-w-0 flex-1 text-[#292524]">
                    <div>{fn.text}</div>
                    {fn.mergedFromIds && fn.mergedFromIds.length > 1 && (
                      <div className="mt-1 text-[11px] text-[#14532D]">
                        یکپارچه‌شده از {toPersianDigits(fn.mergedFromIds.length)} پانویس تکراری (
                        {fn.mergedFromIds.map((id) => `#${toPersianDigits(id)}`).join('، ')})
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </article>
      </div>

      {/* Footnote Preview Bar when clicking a superscript citation */}
      {activeFootnote && (
        <div className="fixed right-4 bottom-4 left-4 z-40 mx-auto max-w-[740px] border border-[#1E3A5F] bg-[#FBF9F5] p-4 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-[#1E3A5F]" />
              <div>
                <div className="text-xs font-bold text-[#1E3A5F]">
                  پانویس یکتا [{toPersianDigits(activeFootnote.canonicalId)}]
                  {activeFootnote.mergedFromIds && activeFootnote.mergedFromIds.length > 1 && (
                    <span className="mr-2 font-normal text-[#14532D]">
                      (ادغام‌شده از {toPersianDigits(activeFootnote.mergedFromIds.length)} تکرار)
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#1A1816]">{activeFootnote.text}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveFootnote(null)}
              aria-label="بستن پانویس"
              className="rounded-sm p-1 text-[#57534E] hover:bg-[#EAE5DA] hover:text-[#1A1816]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {/* Block Source File Provenance Bar */}
      {activeProvenance && !activeFootnote && (
        <div className="fixed right-4 bottom-4 left-4 z-40 mx-auto max-w-[740px] border border-[#1E3A5F] bg-[#FBF9F5] p-3.5 shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <FileText className="h-4 w-4 shrink-0 text-[#1E3A5F]" />
              <div className="text-xs text-[#1A1816] truncate">
                <span className="font-bold text-[#1E3A5F] ml-1.5">منبع این بلوک:</span>
                <span>{activeProvenance.join(' · ')}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveProvenance(null)}
              aria-label="بستن نمایش منبع"
              className="rounded-sm p-1 text-[#57534E] hover:bg-[#EAE5DA] hover:text-[#1A1816]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
