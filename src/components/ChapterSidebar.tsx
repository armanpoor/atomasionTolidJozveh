import { BookMarked, Bookmark, FileSpreadsheet, ListTree, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ParsedBook } from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';

export type SelectedChapterKey =
  | { kind: 'cover' }
  | { kind: 'chapter'; chapterNumber: number }
  | { kind: 'tables' }
  | { kind: 'glossary' }
  | { kind: 'cheatsheets' }
  | { kind: 'footnotes' };

interface ChapterSidebarProps {
  book: ParsedBook;
  selected: SelectedChapterKey;
  onSelect: (key: SelectedChapterKey) => void;
}

export function ChapterSidebar({ book, selected, onSelect }: ChapterSidebarProps) {
  const [query, setQuery] = useState('');

  const filteredChapters = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return book.chapters;
    return book.chapters.filter(
      (ch) =>
        ch.title.toLowerCase().includes(q) ||
        ch.sections.some((s) => s.title.toLowerCase().includes(q))
    );
  }, [book.chapters, query]);

  const volumesWithChapters = useMemo(() => {
    const map = new Map<number, typeof filteredChapters>();
    for (const ch of filteredChapters) {
      const list = map.get(ch.volumeIndex) || [];
      list.push(ch);
      map.set(ch.volumeIndex, list);
    }
    return Array.from(map.entries()).map(([volIdx, chs]) => {
      const vol = book.volumes.find((v) => v.index === volIdx);
      return {
        index: volIdx,
        title: vol?.title || `مجلد ${toPersianDigits(volIdx)}`,
        chapters: chs,
      };
    });
  }, [book.volumes, filteredChapters]);

  return (
    <aside className="flex h-full w-full flex-col border-l border-[#E2DDD3] bg-[#F4F1EA] lg:w-[310px] lg:shrink-0">
      {/* Search Box */}
      <div className="border-b border-[#E2DDD3] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#78716C]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجوی فصل یا سرفصل..."
            className="w-full rounded-sm border border-[#D8D2C5] bg-white py-1.5 pr-8 pl-3 text-xs text-[#1A1816] placeholder-[#8C857B] focus:border-[#1E3A5F] focus:outline-none"
          />
        </div>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {/* Front Matter / Cover */}
        <button
          type="button"
          onClick={() => onSelect({ kind: 'cover' })}
          className={`mb-2 flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-right text-xs transition-colors ${
            selected.kind === 'cover'
              ? 'bg-[#1E3A5F] font-semibold text-white'
              : 'text-[#1A1816] hover:bg-[#EAE5DA]'
          }`}
        >
          <BookMarked className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">صفحه جلد و فهرست خودکار</span>
        </button>

        {/* Volumes & Chapters */}
        <div className="space-y-4">
          {volumesWithChapters.map((vol) => (
            <div key={vol.index}>
              <div className="mb-1.5 border-b border-[#DED8CC] px-2 pb-1 text-[11px] font-bold text-[#57534E]">
                {vol.title}
              </div>
              <ul className="space-y-0.5">
                {vol.chapters.map((ch) => {
                  const isActive = selected.kind === 'chapter' && selected.chapterNumber === ch.chapterNumber;
                  const shortTitle = ch.title.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, '');
                  return (
                    <li key={ch.id}>
                      <button
                        type="button"
                        onClick={() => onSelect({ kind: 'chapter', chapterNumber: ch.chapterNumber })}
                        className={`flex w-full items-start justify-between gap-2 rounded-sm px-2.5 py-2 text-right text-xs transition-colors ${
                          isActive
                            ? 'bg-[#1E3A5F] font-semibold text-white'
                            : 'text-[#292524] hover:bg-[#EAE5DA]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <span
                            className={`ml-1.5 font-bold tabular-nums ${
                              isActive ? 'text-[#CBD9EA]' : 'text-[#1E3A5F]'
                            }`}
                          >
                            {toPersianDigits(ch.chapterNumber)}.
                          </span>
                          <span className="leading-snug">{shortTitle}</span>
                        </div>
                        <span
                          className={`shrink-0 pt-0.5 text-[10px] tabular-nums ${
                            isActive ? 'text-[#CBD9EA]' : 'text-[#78716C]'
                          }`}
                        >
                          {toPersianDigits(ch.sections.length)} بخش
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* Appendices */}
        <div className="mt-5 border-t border-[#DED8CC] pt-3">
          <div className="mb-1.5 px-2 text-[11px] font-bold text-[#57534E]">پیوست‌های یکپارچه‌شده</div>
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => onSelect({ kind: 'cheatsheets' })}
              className={`flex w-full items-center justify-between rounded-sm px-2.5 py-2 text-right text-xs transition-colors ${
                selected.kind === 'cheatsheets'
                  ? 'bg-[#1E3A5F] font-semibold text-white'
                  : 'text-[#292524] hover:bg-[#EAE5DA]'
              }`}
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span>برگه تقلب و قوانین طلایی</span>
              </span>
              <span className="text-[10px] tabular-nums opacity-80">
                {toPersianDigits(book.cheatSheets.length)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onSelect({ kind: 'tables' })}
              className={`flex w-full items-center justify-between rounded-sm px-2.5 py-2 text-right text-xs transition-colors ${
                selected.kind === 'tables'
                  ? 'bg-[#1E3A5F] font-semibold text-white'
                  : 'text-[#292524] hover:bg-[#EAE5DA]'
              }`}
            >
              <span className="flex items-center gap-2">
                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                <span>فهرست جداول یکپارچه</span>
              </span>
              <span className="text-[10px] tabular-nums opacity-80">
                {toPersianDigits(book.tableIndex.length)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onSelect({ kind: 'glossary' })}
              className={`flex w-full items-center justify-between rounded-sm px-2.5 py-2 text-right text-xs transition-colors ${
                selected.kind === 'glossary'
                  ? 'bg-[#1E3A5F] font-semibold text-white'
                  : 'text-[#292524] hover:bg-[#EAE5DA]'
              }`}
            >
              <span className="flex items-center gap-2">
                <ListTree className="h-3.5 w-3.5 shrink-0" />
                <span>واژه‌نامه یکپارچه</span>
              </span>
              <span className="text-[10px] tabular-nums opacity-80">
                {toPersianDigits(book.glossary.length)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onSelect({ kind: 'footnotes' })}
              className={`flex w-full items-center justify-between rounded-sm px-2.5 py-2 text-right text-xs transition-colors ${
                selected.kind === 'footnotes'
                  ? 'bg-[#1E3A5F] font-semibold text-white'
                  : 'text-[#292524] hover:bg-[#EAE5DA]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Bookmark className="h-3.5 w-3.5 shrink-0" />
                <span>پانویس‌های یکتا</span>
              </span>
              <span className="text-[10px] tabular-nums opacity-80">
                {toPersianDigits(book.footnotes.length)}
              </span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
