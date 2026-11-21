import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Compass,
  FileText,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Lightbulb,
  Printer,
  RefreshCw,
  Ruler,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CalloutBlock,
  CalloutVariant,
  ContentBlock,
  DocxExportConfig,
  FootnoteEntry,
  ParsedBook,
} from '../lib/bookTypes';
import { getCalloutTheme, SPECIAL_FRAME_THEMES } from '../lib/calloutThemes';
import { toPersianDigits } from '../lib/formatParsers';
import {
  buildPrintSheetPlan,
  computeA4Geometry,
  PRINT_MARGIN_PRESETS,
  PrintMarginPresetId,
  PrintScope,
} from '../lib/printPagination';
import { RichText } from './RichText';

interface PrintPreviewModalProps {
  open: boolean;
  book: ParsedBook;
  config: DocxExportConfig;
  activeChapterNumber?: number | null;
  onClose: () => void;
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

const noopSelectFootnote = (_fn: FootnoteEntry) => {
  // Footnotes are rendered statically in Print Preview
};

function PrintCallout({
  block,
  footnoteMap,
}: {
  block: CalloutBlock;
  footnoteMap: Map<number, FootnoteEntry>;
}) {
  const theme = getCalloutTheme(block.variant);
  const Icon = getCalloutIcon(block.variant);
  const cleanTitle = block.title.replace(/^[⛔💡⚙️🔄❓📘]+\s*/, '').trim();

  return (
    <aside
      className={`print-avoid-break my-4 overflow-hidden rounded-lg border ${theme.outerBorderClass} ${theme.bodyBgClass}`}
    >
      <div
        className={`flex items-center justify-between gap-2 border-b ${theme.headerBorderClass} ${theme.headerBgClass} px-3.5 py-2`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${theme.iconBgClass}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className={`text-[0.92em] font-extrabold ${theme.accentTextClass}`}>
            <RichText
              text={cleanTitle || theme.labelFa}
              footnoteMap={footnoteMap}
              onSelectFootnote={noopSelectFootnote}
            />
          </div>
        </div>
        <span className={`text-[0.75em] font-semibold opacity-80 ${theme.kickerTextClass}`}>
          {theme.labelFa}
        </span>
      </div>
      <div className="space-y-1.5 px-3.5 py-3 text-[0.92em] leading-[1.85] text-[#1C1917]">
        {block.paragraphs.map((p, idx) => (
          <p key={idx}>
            <RichText text={p} footnoteMap={footnoteMap} onSelectFootnote={noopSelectFootnote} />
          </p>
        ))}
      </div>
    </aside>
  );
}

function PrintBlock({
  block,
  footnoteMap,
}: {
  block: ContentBlock;
  footnoteMap: Map<number, FootnoteEntry>;
}) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className="my-2.5 text-justify leading-[1.9] text-[#111111]">
          <RichText text={block.text} footnoteMap={footnoteMap} onSelectFootnote={noopSelectFootnote} />
        </p>
      );

    case 'subheading':
      return (
        <h4 className="mt-5 mb-2 border-b border-[#D8D2C5] pb-1 text-[1.05em] font-bold text-[#1E3A5F]">
          <RichText text={block.text} footnoteMap={footnoteMap} onSelectFootnote={noopSelectFootnote} />
        </h4>
      );

    case 'callout':
      return <PrintCallout block={block} footnoteMap={footnoteMap} />;

    case 'table':
      return (
        <div className="print-avoid-break my-4">
          {block.caption && (
            <div className="mb-1.5 text-[0.88em] font-bold text-[#1E3A5F]">{block.caption}</div>
          )}
          <table className="w-full border-collapse border border-[#CFC8B9] text-right text-[0.85em]">
            <thead>
              <tr className="bg-[#1E3A5F] text-white">
                {block.headers.map((h, i) => (
                  <th
                    key={i}
                    className="border border-[#2F527F] px-2.5 py-1.5 text-right font-semibold"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rIdx) => (
                <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-[#F8F6F1]' : 'bg-white'}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="border border-[#DED8CC] px-2.5 py-1.5 leading-relaxed text-[#1C1917]"
                    >
                      <RichText
                        text={cell || '—'}
                        footnoteMap={footnoteMap}
                        onSelectFootnote={noopSelectFootnote}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'equation': {
      const eqTheme = SPECIAL_FRAME_THEMES.equation;
      return (
        <div
          className={`print-avoid-break my-3.5 overflow-hidden rounded-lg border ${eqTheme.outerBorderClass} ${eqTheme.bodyBgClass}`}
        >
          <div
            className={`border-b ${eqTheme.headerBorderClass} ${eqTheme.headerBgClass} px-3 py-1 text-[0.78em] font-bold ${eqTheme.accentTextClass}`}
          >
            {eqTheme.labelFa}
          </div>
          <div className="px-3 py-2.5 text-center font-mono-ltr text-[0.95em] font-semibold text-[#1E3A5F]">
            {block.readable}
          </div>
        </div>
      );
    }

    case 'list':
      return block.ordered ? (
        <ol className="my-2.5 space-y-1 pr-5 text-[0.95em] leading-[1.85] text-[#111111]">
          {block.items.map((item, idx) => (
            <li key={idx} className="list-decimal marker:font-bold marker:text-[#1E3A5F]">
              <RichText text={item} footnoteMap={footnoteMap} onSelectFootnote={noopSelectFootnote} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="my-2.5 space-y-1 pr-5 text-[0.95em] leading-[1.85] text-[#111111]">
          {block.items.map((item, idx) => (
            <li key={idx} className="list-disc marker:text-[#1E3A5F]">
              <RichText text={item} footnoteMap={footnoteMap} onSelectFootnote={noopSelectFootnote} />
            </li>
          ))}
        </ul>
      );

    case 'figure': {
      const figTheme = SPECIAL_FRAME_THEMES.figure;
      return (
        <div
          className={`print-avoid-break my-4 overflow-hidden rounded-lg border ${figTheme.outerBorderClass} ${figTheme.bodyBgClass}`}
        >
          <div
            className={`flex items-center gap-2 border-b ${figTheme.headerBorderClass} ${figTheme.headerBgClass} px-3 py-1.5 text-[0.82em] font-bold ${figTheme.accentTextClass}`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>{block.caption}</span>
          </div>
          <p className="px-3 py-2 text-[0.86em] text-[#333333]">{block.description}</p>
        </div>
      );
    }

    case 'image':
      return (
        <figure className="print-avoid-break my-4 overflow-hidden rounded-lg border border-[#D4CEC2] bg-[#FCFBF8]">
          <div className="p-2.5">
            <img
              src={block.dataUrl}
              alt={block.caption}
              className="mx-auto max-h-[280px] w-auto object-contain"
            />
          </div>
          <figcaption className="border-t border-[#E4DFD4] bg-[#F4F1EA] px-3 py-1.5 text-center text-[0.82em] font-bold text-[#1E3A5F]">
            {block.caption}
          </figcaption>
        </figure>
      );

    case 'web_enrichment': {
      const webTheme = SPECIAL_FRAME_THEMES.web_enrichment;
      return (
        <aside
          className={`print-avoid-break my-4 overflow-hidden rounded-lg border ${webTheme.outerBorderClass} ${webTheme.bodyBgClass}`}
        >
          <div
            className={`flex items-center gap-2 border-b ${webTheme.headerBorderClass} ${webTheme.headerBgClass} px-3.5 py-2 text-[0.85em] font-extrabold ${webTheme.accentTextClass}`}
          >
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <span>تکمیل‌شده از وب: {block.title}</span>
          </div>
          <div className="px-3.5 py-2.5 space-y-1.5">
            <p className="text-[0.9em] leading-[1.85] text-[#1C1917]">{block.summary}</p>
            {block.sources.length > 0 && (
              <div className="border-t border-[#E0D6F0] pt-1.5 text-[0.75em] text-[#5B4F8A]">
                منابع: {block.sources.map((s) => s.title).join(' · ')}
              </div>
            )}
          </div>
        </aside>
      );
    }

    case 'conflict_note': {
      const confTheme = SPECIAL_FRAME_THEMES.conflict_note;
      return (
        <aside
          className={`print-avoid-break my-4 overflow-hidden rounded-lg border ${confTheme.outerBorderClass} ${confTheme.bodyBgClass}`}
        >
          <div
            className={`flex items-center gap-2 border-b ${confTheme.headerBorderClass} ${confTheme.headerBgClass} px-3.5 py-2 text-[0.85em] font-extrabold ${confTheme.accentTextClass}`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>مقایسه دو روایت منبع: {block.topic}</span>
          </div>
          <div className="p-3 space-y-2 text-[0.84em]">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded border border-[#ECD0C8] bg-white p-2.5">
                <div className="font-bold text-[#1E3A5F] mb-1">روایت ۱ · {block.fileAName}</div>
                <p className="text-[#1C1917] leading-relaxed">{block.excerptA}</p>
              </div>
              <div className="rounded border border-[#ECD0C8] bg-white p-2.5">
                <div className="font-bold text-[#1E3A5F] mb-1">روایت ۲ · {block.fileBName}</div>
                <p className="text-[#1C1917] leading-relaxed">{block.excerptB}</p>
              </div>
            </div>
            {block.resolutionNote && (
              <div className="rounded border border-[#BFE0CD] bg-[#EEF8F2] px-2.5 py-1.5 font-semibold text-[#124E32]">
                تصمیم ویراستار: {block.resolutionNote}
              </div>
            )}
          </div>
        </aside>
      );
    }

    case 'diagram':
      return (
        <figure className="print-avoid-break my-4 overflow-hidden rounded-lg border border-[#D4CEC2] bg-[#FCFBF8]">
          <div
            className="p-2.5 [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: block.svgMarkup }}
          />
          <figcaption className="border-t border-[#E4DFD4] bg-[#F4F1EA] px-3 py-1.5 text-center text-[0.82em] font-bold text-[#1E3A5F]">
            {block.caption}
          </figcaption>
        </figure>
      );

    default:
      return null;
  }
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  open,
  book,
  config,
  activeChapterNumber,
  onClose,
}) => {
  const [scope, setScope] = useState<PrintScope>('full_book');
  const [marginPresetId, setMarginPresetId] = useState<PrintMarginPresetId>('standard');
  const [fontSizePt, setFontSizePt] = useState<10.5 | 11 | 12>(config.baseFontSizePt || 11);
  const [zoomPercent, setZoomPercent] = useState<number>(85);
  const [showMarginGuides, setShowMarginGuides] = useState<boolean>(true);
  const [includeAppendices, setIncludeAppendices] = useState<boolean>(true);

  const marginPreset = PRINT_MARGIN_PRESETS[marginPresetId];
  const geometry = useMemo(() => computeA4Geometry(marginPresetId), [marginPresetId]);

  const footnoteMap = useMemo(() => {
    const map = new Map<number, FootnoteEntry>();
    for (const fn of book.footnotes) map.set(fn.canonicalId, fn);
    return map;
  }, [book.footnotes]);

  const sheetPlan = useMemo(
    () =>
      buildPrintSheetPlan(book, {
        scope,
        activeChapterNumber: activeChapterNumber || book.chapters[0]?.chapterNumber || 1,
        includeCoverAndToc: scope === 'full_book',
        includeAppendices: scope === 'full_book' && includeAppendices,
        fontSizePt,
      }),
    [book, scope, activeChapterNumber, includeAppendices, fontSizePt]
  );

  // Sync body class and dynamic @page CSS rules while Print Preview modal is open
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('printing-a4-preview');

    const root = document.documentElement;
    root.style.setProperty('--print-margin-top', `${marginPreset.topMm}mm`);
    root.style.setProperty('--print-margin-right', `${marginPreset.rightMm}mm`);
    root.style.setProperty('--print-margin-bottom', `${marginPreset.bottomMm}mm`);
    root.style.setProperty('--print-margin-left', `${marginPreset.leftMm}mm`);
    root.style.setProperty('--print-font-size', `${fontSizePt}pt`);

    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-print-page-rules', 'true');
    styleEl.textContent = `@page { size: A4 portrait; margin: ${marginPreset.topMm}mm ${marginPreset.rightMm}mm ${marginPreset.bottomMm}mm ${marginPreset.leftMm}mm; }`;
    document.head.appendChild(styleEl);

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);

    return () => {
      document.body.classList.remove('printing-a4-preview');
      styleEl.remove();
      window.removeEventListener('keydown', handleEsc);
    };
  }, [open, marginPreset, fontSizePt, onClose]);

  if (!open) return null;

  const sheetPaddingStyle: React.CSSProperties = {
    paddingTop: `${marginPreset.topMm}mm`,
    paddingRight: `${marginPreset.rightMm}mm`,
    paddingBottom: `${marginPreset.bottomMm}mm`,
    paddingLeft: `${marginPreset.leftMm}mm`,
    fontSize: `${fontSizePt}pt`,
  };

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="پیش‌نمایش استاندارد چاپ A4"
      className="print-a4-portal fixed inset-0 z-50 flex flex-col bg-[#DDD8CE]"
    >
      {/* Top Print Studio Toolbar (Hidden during actual print via .no-print) */}
      <header className="no-print shrink-0 border-b border-[#C9C2B4] bg-white px-4 py-2.5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E3A5F] text-white">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-extrabold text-[#1A1816]">
                پیش‌نمایش چاپ استاندارد A4
              </h2>
              <p className="text-[11px] text-[#57534E] tabular-nums">
                قطع {toPersianDigits(geometry.pageWidthMm)}×{toPersianDigits(geometry.pageHeightMm)}{' '}
                میلی‌متر · ناحیه چاپ {toPersianDigits(geometry.contentWidthMm)}×
                {toPersianDigits(geometry.contentHeightMm)}mm · حدود{' '}
                {toPersianDigits(sheetPlan.estimatedTotalPages)} صفحه A4
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Scope Segmented Toggle */}
            <div className="flex items-center gap-0.5 rounded-lg bg-[#F3F0E8] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setScope('full_book')}
                className={`rounded-md px-2.5 py-1.5 font-bold cursor-pointer whitespace-nowrap ${
                  scope === 'full_book'
                    ? 'bg-white text-[#1E3A5F] shadow-xs'
                    : 'text-[#57534E] hover:text-[#1A1816]'
                }`}
              >
                کل کتاب
              </button>
              <button
                type="button"
                onClick={() => setScope('active_chapter')}
                className={`rounded-md px-2.5 py-1.5 font-bold cursor-pointer whitespace-nowrap ${
                  scope === 'active_chapter'
                    ? 'bg-white text-[#1E3A5F] shadow-xs'
                    : 'text-[#57534E] hover:text-[#1A1816]'
                }`}
              >
                فصل انتخاب‌شده
              </button>
            </div>

            {/* Margin Preset Selector */}
            <label className="inline-flex items-center gap-1.5 text-xs text-[#44403C]">
              <span className="hidden xl:inline font-semibold">حاشیه:</span>
              <select
                aria-label="انتخاب حاشیه صفحه A4"
                value={marginPresetId}
                onChange={(e) => setMarginPresetId(e.target.value as PrintMarginPresetId)}
                className="min-h-[34px] rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1 text-xs font-semibold text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none cursor-pointer"
              >
                {Object.values(PRINT_MARGIN_PRESETS).map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.shortLabelFa}
                  </option>
                ))}
              </select>
            </label>

            {/* Font Size Selector */}
            <label className="inline-flex items-center gap-1.5 text-xs text-[#44403C]">
              <span className="hidden xl:inline font-semibold">فونت:</span>
              <select
                aria-label="اندازه فونت چاپ"
                value={fontSizePt}
                onChange={(e) => setFontSizePt(Number(e.target.value) as 10.5 | 11 | 12)}
                className="min-h-[34px] rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2 py-1 text-xs font-semibold tabular-nums text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none cursor-pointer"
              >
                <option value={10.5}>۱۰.۵pt</option>
                <option value={11}>۱۱pt (استاندارد)</option>
                <option value={12}>۱۲pt (درشت‌تر)</option>
              </select>
            </label>

            {/* Margin Guide Toggle */}
            <button
              type="button"
              onClick={() => setShowMarginGuides((v) => !v)}
              aria-pressed={showMarginGuides}
              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold cursor-pointer whitespace-nowrap ${
                showMarginGuides
                  ? 'border-[#1E3A5F] bg-[#EEF3F8] text-[#1E3A5F]'
                  : 'border-[#D6D0C4] bg-white text-[#57534E] hover:bg-[#FAF9F6]'
              }`}
            >
              <Ruler className="h-3.5 w-3.5" />
              <span className="hidden md:inline">خطوط حاشیه</span>
            </button>

            {/* Appendices Toggle (Full Book Scope) */}
            {scope === 'full_book' && (
              <label className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-[#E2DDD3] bg-[#FAF9F6] px-2.5 py-1.5 text-xs font-semibold text-[#44403C] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAppendices}
                  onChange={(e) => setIncludeAppendices(e.target.checked)}
                  className="accent-[#1E3A5F]"
                />
                <span>پیوست‌ها</span>
              </label>
            )}

            {/* Zoom Controls */}
            <div className="hidden sm:flex items-center gap-1 rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-1.5 py-0.5 text-xs tabular-nums">
              <button
                type="button"
                onClick={() => setZoomPercent((z) => Math.max(60, z - 10))}
                aria-label="کوچک‌نمایی"
                className="p-1 text-[#57534E] hover:text-[#1E3A5F] cursor-pointer"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="w-10 text-center font-bold text-[#1A1816]">
                {toPersianDigits(zoomPercent)}٪
              </span>
              <button
                type="button"
                onClick={() => setZoomPercent((z) => Math.min(115, z + 10))}
                aria-label="بزرگ‌نمایی"
                className="p-1 text-[#57534E] hover:text-[#1E3A5F] cursor-pointer"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Primary Print / Save PDF Button */}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-4 py-1.5 text-xs font-extrabold text-white hover:bg-[#162C49] shadow-xs cursor-pointer whitespace-nowrap"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>چاپ / ذخیره PDF</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="بستن پیش‌نمایش چاپ A4"
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-xs font-bold text-[#57534E] hover:bg-[#FAF9F6] hover:text-[#1A1816] cursor-pointer"
            >
              <X className="h-4 w-4" />
              <span className="hidden sm:inline">بستن</span>
            </button>
          </div>
        </div>
      </header>

      {/* Scrollable A4 Sheet Desk */}
      <div className="print-a4-scroll-stage flex-1 overflow-auto px-4 py-8 sm:px-8">
        <div
          className="mx-auto flex flex-col items-center gap-8"
          style={{
            transform: zoomPercent !== 100 ? `scale(${zoomPercent / 100})` : undefined,
            transformOrigin: 'top center',
          }}
        >
          {sheetPlan.sheets.map((sheet, sheetIdx) => {
            const chapter =
              sheet.kind === 'chapter' && sheet.chapterNumber
                ? book.chapters.find((c) => c.chapterNumber === sheet.chapterNumber)
                : null;

            return (
              <section
                key={sheet.id}
                aria-label={sheet.titleFa}
                style={sheetPaddingStyle}
                className={`a4-sheet-surface border border-[#C6BFB2] shadow-[0_6px_24px_rgba(26,24,22,0.14)] flex flex-col justify-between ${
                  showMarginGuides ? 'a4-sheet-guides' : ''
                } ${sheetIdx > 0 ? 'print-page-break' : ''}`}
              >
                {/* Running Editorial Header (All pages except Cover) */}
                <div>
                  {sheet.kind !== 'cover' && (
                    <div className="mb-6 flex items-center justify-between border-b border-[#D8D2C5] pb-2 text-[9pt] text-[#57534E]">
                      <span className="truncate font-semibold">{sheet.runningHeaderFa}</span>
                      <span className="shrink-0 tabular-nums">
                        {config.fontFamily} · A4
                      </span>
                    </div>
                  )}

                  {/* COVER PAGE */}
                  {sheet.kind === 'cover' && (
                    <div className="flex min-h-[210mm] flex-col justify-between py-6">
                      <div className="border-b-2 border-[#1E3A5F] pb-3 text-[9.5pt] font-semibold text-[#57534E]">
                        نسخه چاپی استاندارد A4 · {config.fontFamily} · راست‌چین کامل (RTL)
                      </div>

                      <div className="my-auto py-12 space-y-5">
                        <h1 className="text-[24pt] font-extrabold leading-[1.45] text-[#1E3A5F]">
                          {book.title}
                        </h1>
                        {book.subtitle && (
                          <p className="text-[12pt] leading-[1.9] text-[#44403C]">
                            {book.subtitle}
                          </p>
                        )}
                        <div className="h-1 w-24 bg-[#1E3A5F]" />

                        <dl className="mt-8 grid grid-cols-2 gap-px border border-[#D8D2C5] bg-[#D8D2C5] text-[9.5pt]">
                          <div className="bg-[#FAF8F4] p-3.5">
                            <dt className="text-[#78716C] font-semibold">ساختار کتاب</dt>
                            <dd className="mt-1 font-bold text-[#111111] tabular-nums">
                              {toPersianDigits(book.volumes.length)} مجلد ·{' '}
                              {toPersianDigits(book.chapters.length)} فصل ·{' '}
                              {toPersianDigits(book.tableIndex.length)} جدول
                            </dd>
                          </div>
                          <div className="bg-[#FAF8F4] p-3.5">
                            <dt className="text-[#78716C] font-semibold">مشخصات چاپ</dt>
                            <dd className="mt-1 font-bold text-[#111111] tabular-nums">
                              قطع A4 · فونت {config.fontFamily} ({toPersianDigits(fontSizePt)}pt)
                            </dd>
                          </div>
                          <div className="bg-[#FAF8F4] p-3.5">
                            <dt className="text-[#78716C] font-semibold">حاشیه‌های استاندارد</dt>
                            <dd className="mt-1 font-bold text-[#111111] tabular-nums">
                              بالا {toPersianDigits(marginPreset.topMm)}mm · طرفین{' '}
                              {toPersianDigits(marginPreset.rightMm)}mm · پایین{' '}
                              {toPersianDigits(marginPreset.bottomMm)}mm
                            </dd>
                          </div>
                          <div className="bg-[#FAF8F4] p-3.5">
                            <dt className="text-[#78716C] font-semibold">پوشش محتوایی</dt>
                            <dd className="mt-1 font-bold text-[#14532D] tabular-nums">
                              {toPersianDigits(book.audit?.conceptRetentionRate ?? 100)}٪ حفظ بدون
                              افت مطالب
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div className="border-t border-[#D8D2C5] pt-3 text-[9pt] text-[#57534E] flex items-center justify-between">
                        <span>{book.editionNote || 'ویرایش استاندارد صفحه‌آرایی‌شده'}</span>
                        <span className="tabular-nums">
                          {toPersianDigits(book.sourceFiles.length)} سند منبع یکپارچه‌شده
                        </span>
                      </div>
                    </div>
                  )}

                  {/* TABLE OF CONTENTS (100% RTL with dotted leaders synced to Word .docx) */}
                  {sheet.kind === 'toc' && (
                    <div dir="rtl" className="text-right">
                      <h2 className="border-r-4 border-[#1E3A5F] border-b-2 border-b-[#1E3A5F] pr-3 pb-2.5 text-[16pt] font-extrabold text-[#1E3A5F]">
                        فهرست مطالب
                      </h2>
                      <div className="mt-5 space-y-4">
                        {book.volumes.map((vol) => {
                          const volChapters = book.chapters.filter(
                            (c) => c.volumeIndex === vol.index
                          );
                          return (
                            <div key={vol.id}>
                              <div className="mb-2 border-r-4 border-[#1E3A5F] bg-[#EEF3F8] px-3 py-1.5 text-[10pt] font-bold text-[#1E3A5F]">
                                {vol.title}
                              </div>
                              <ul className="space-y-2 pr-2">
                                {volChapters.map((ch) => {
                                  const matchingSheet = sheetPlan.sheets.find(
                                    (s) => s.kind === 'chapter' && s.chapterNumber === ch.chapterNumber
                                  );
                                  const chPage = toPersianDigits(
                                    matchingSheet?.pageNumber ?? ch.chapterNumber
                                  );
                                  return (
                                    <li key={ch.id} className="space-y-1">
                                      <div className="flex items-baseline gap-2 text-[10.5pt]">
                                        <span className="font-bold text-[#111111]">{ch.title}</span>
                                        <span
                                          aria-hidden="true"
                                          className="flex-1 border-b border-dotted border-[#C8C1B4] translate-y-[-2px]"
                                        />
                                        <span className="shrink-0 font-bold text-[9.5pt] text-[#1E3A5F] tabular-nums">
                                          {chPage}
                                        </span>
                                      </div>
                                      {ch.sections.length > 0 && (
                                        <ul className="space-y-0.5 pr-5">
                                          {ch.sections.slice(0, 8).map((sec) => (
                                            <li
                                              key={sec.id}
                                              className="flex items-baseline gap-2 text-[9pt] text-[#57534E]"
                                            >
                                              <span>
                                                {sec.numberLabel ? `${sec.numberLabel}. ` : ''}
                                                {sec.title}
                                              </span>
                                              <span
                                                aria-hidden="true"
                                                className="flex-1 border-b border-dotted border-[#DDD7CB] translate-y-[-2px]"
                                              />
                                              <span className="shrink-0 text-[8.5pt] text-[#78716C] tabular-nums">
                                                {chPage}
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* CHAPTER SHEET */}
                  {sheet.kind === 'chapter' && chapter && (
                    <div>
                      <div className="mb-1 text-[9pt] font-semibold text-[#57534E]">
                        {chapter.volumeTitle}
                      </div>
                      <h1 className="border-b-2 border-[#1E3A5F] pb-2.5 text-[16pt] font-extrabold leading-snug text-[#1E3A5F]">
                        {chapter.title}
                      </h1>

                      {config.includeChapterMetaCards && chapter.meta.length > 0 && (
                        <div className="print-avoid-break my-4 overflow-hidden rounded-lg border border-[#D8D2C5] bg-[#FAF8F4]">
                          <div className="border-b border-[#E2DDD3] bg-[#EFECE4] px-3.5 py-1.5 text-[9pt] font-bold text-[#1E3A5F]">
                            شناسنامه فصل
                          </div>
                          <dl className="divide-y divide-[#EAE5DA] text-[9pt]">
                            {chapter.meta.map((m, idx) => (
                              <div key={idx} className="grid grid-cols-4 gap-2 px-3.5 py-1.5">
                                <dt className="font-bold text-[#57534E]">{m.label}</dt>
                                <dd className="col-span-3 text-[#111111]">{m.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}

                      {chapter.introBlocks.length > 0 && (
                        <div className="my-3">
                          {chapter.introBlocks.map((b) => (
                            <PrintBlock key={b.id} block={b} footnoteMap={footnoteMap} />
                          ))}
                        </div>
                      )}

                      {chapter.sections.map((sec) => (
                        <div key={sec.id} className="mt-5">
                          <h2 className="border-b border-[#D8D2C5] pb-1 text-[12.5pt] font-extrabold text-[#1E3A5F]">
                            {sec.numberLabel ? (
                              <span className="ml-1.5 tabular-nums">{sec.numberLabel}.</span>
                            ) : null}
                            {sec.title}
                          </h2>
                          <div className="mt-2">
                            {sec.blocks.map((b) => (
                              <PrintBlock key={b.id} block={b} footnoteMap={footnoteMap} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* CHEAT SHEETS APPENDIX */}
                  {sheet.kind === 'cheatsheets' && (
                    <div>
                      <h2 className="border-b-2 border-[#1E3A5F] pb-2.5 text-[15pt] font-extrabold text-[#1E3A5F]">
                        پیوست ویژه: برگه تقلب جامع و قوانین طلایی
                      </h2>
                      <div className="mt-4 space-y-3">
                        {book.cheatSheets.map((cs) => (
                          <div
                            key={cs.id}
                            className="print-avoid-break rounded-lg border border-[#D8D2C5] bg-[#FAF8F4] p-3.5"
                          >
                            <h3 className="text-[10.5pt] font-bold text-[#1E3A5F]">{cs.title}</h3>
                            <div className="mt-1.5 space-y-1 text-[9.5pt]">
                              {cs.highlights.map((h, i) => (
                                <p key={i}>
                                  <RichText
                                    text={h}
                                    footnoteMap={footnoteMap}
                                    onSelectFootnote={noopSelectFootnote}
                                  />
                                </p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* TABLE INDEX APPENDIX */}
                  {sheet.kind === 'tables' && (
                    <div>
                      <h2 className="border-b-2 border-[#1E3A5F] pb-2.5 text-[15pt] font-extrabold text-[#1E3A5F]">
                        پیوست الف: فهرست جداول یکپارچه
                      </h2>
                      <table className="mt-4 w-full border-collapse border border-[#CFC8B9] text-right text-[9.5pt]">
                        <thead>
                          <tr className="bg-[#1E3A5F] text-white">
                            <th className="w-24 border border-[#2F527F] px-2.5 py-1.5">شماره</th>
                            <th className="border border-[#2F527F] px-2.5 py-1.5">عنوان جدول</th>
                            <th className="w-20 border border-[#2F527F] px-2.5 py-1.5">فصل</th>
                          </tr>
                        </thead>
                        <tbody>
                          {book.tableIndex.map((t, i) => (
                            <tr key={`${t.tableNumber}_${i}`} className={i % 2 === 1 ? 'bg-[#F8F6F1]' : 'bg-white'}>
                              <td className="border border-[#DED8CC] px-2.5 py-1.5 font-bold tabular-nums text-[#1E3A5F]">
                                جدول {t.tableNumber}
                              </td>
                              <td className="border border-[#DED8CC] px-2.5 py-1.5 text-[#111111]">
                                {t.caption}
                              </td>
                              <td className="border border-[#DED8CC] px-2.5 py-1.5 tabular-nums text-[#44403C]">
                                فصل {toPersianDigits(t.chapterNumber)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* GLOSSARY APPENDIX */}
                  {sheet.kind === 'glossary' && (
                    <div>
                      <h2 className="border-b-2 border-[#1E3A5F] pb-2.5 text-[15pt] font-extrabold text-[#1E3A5F]">
                        پیوست ب: واژه‌نامه یکپارچه اصطلاحات ({toPersianDigits(book.glossary.length)} مدخل)
                      </h2>
                      <div className="mt-4 divide-y divide-[#E6E0D4] text-[9.5pt]">
                        {book.glossary.map((g, i) => (
                          <div key={`${g.term}_${i}`} className="py-2 print-avoid-break">
                            <div className="font-bold text-[#1E3A5F]" dir="auto">
                              {g.term}
                            </div>
                            <p className="mt-0.5 text-[#1C1917]">{g.definition}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* FOOTNOTES APPENDIX */}
                  {sheet.kind === 'footnotes' && (
                    <div>
                      <h2 className="border-b-2 border-[#1E3A5F] pb-2.5 text-[15pt] font-extrabold text-[#1E3A5F]">
                        پیوست ج: پانویس‌های یکتا ({toPersianDigits(book.footnotes.length)} مدخل)
                      </h2>
                      <div className="mt-4 divide-y divide-[#E6E0D4] text-[9.5pt]">
                        {book.footnotes.map((fn) => (
                          <div key={fn.canonicalId} className="flex gap-2.5 py-1.5 print-avoid-break">
                            <span className="w-8 shrink-0 font-bold tabular-nums text-[#1E3A5F]">
                              [{toPersianDigits(fn.canonicalId)}]
                            </span>
                            <span className="text-[#1C1917]">{fn.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Running Editorial Footer with Persian Page Numbers */}
                <footer className="mt-8 flex items-center justify-between border-t border-[#E2DDD3] pt-2 text-[8.5pt] text-[#57534E] tabular-nums">
                  <span className="truncate max-w-[70%]">{book.title}</span>
                  <span>
                    صفحه {toPersianDigits(sheet.pageNumber)} از{' '}
                    {toPersianDigits(sheetPlan.estimatedTotalPages)}
                  </span>
                </footer>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
