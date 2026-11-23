import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileSearch,
  Search,
  X,
} from 'lucide-react';
import type {
  ContentUnitDto,
  OutlineNodeDto,
  SourceFileDto,
} from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';
import { searchExtractedContentUnits } from '../lib/workspaceInsights';

interface SidebarContentSearchProps {
  sourceFiles: SourceFileDto[];
  contentUnits: ContentUnitDto[];
  outlineNodes: OutlineNodeDto[];
  onJumpToResult?: (params: {
    unitId: string;
    outlineNodeId: string | null;
    sourceFileId: string;
  }) => void;
}

export const SidebarContentSearch: React.FC<SidebarContentSearchProps> = ({
  sourceFiles,
  contentUnits,
  outlineNodes,
  onJumpToResult,
}) => {
  const [query, setQuery] = useState('');
  const [fileFilterId, setFileFilterId] = useState<string>('');
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);

  const hasExtractedContent = contentUnits.length > 0;

  const searchResult = useMemo(
    () =>
      searchExtractedContentUnits({
        query,
        contentUnits,
        sourceFiles,
        outlineNodes,
        fileFilterId: fileFilterId || null,
        maxResults: 30,
      }),
    [query, contentUnits, sourceFiles, outlineNodes, fileFilterId]
  );

  const hasQuery = query.trim().length > 0;

  return (
    <section
      aria-label="جستجوی متنی در فایل‌های استخراج‌شده مرحله ۱"
      data-testid="sidebar-content-search"
      className="space-y-2.5 border-t border-[#EAE5DA] pt-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-[#1A1816]">
          <FileSearch className="h-3.5 w-3.5 text-[#1E3A5F]" />
          <span>جستجو در محتوای فایل‌های مرحله ۱</span>
        </div>
        {hasExtractedContent && (
          <span className="text-[10.5px] text-[#78716C] tabular-nums">
            {toPersianDigits(contentUnits.length)} واحد
          </span>
        )}
      </div>

      {/* Search Input */}
      <div className="relative">
        <label htmlFor="sidebar-extracted-search-input" className="sr-only">
          جستجوی متنی در محتوای فایل‌های استخراج‌شده مرحله ۱
        </label>
        <Search
          className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#78716C]"
          aria-hidden="true"
        />
        <input
          id="sidebar-extracted-search-input"
          type="text"
          value={query}
          disabled={!hasExtractedContent}
          onChange={(e) => {
            setQuery(e.target.value);
            setExpandedUnitId(null);
          }}
          placeholder={
            hasExtractedContent
              ? 'جستجوی عبارت، عدد، کد خطا یا پاراگراف...'
              : 'ابتدا فایل‌ها را در مرحله ۱ استخراج کنید'
          }
          className="w-full rounded-lg border border-[#D6D0C4] bg-white py-2 pr-8 pl-8 text-xs text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1E3A5F] focus:outline-none disabled:bg-[#F5F3EE] disabled:text-[#8C857B]"
        />
        {hasQuery && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setExpandedUnitId(null);
            }}
            aria-label="پاک کردن عبارت جستجو"
            className="absolute left-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-[#78716C] hover:bg-[#EFECE4] hover:text-[#1A1816] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Optional File Filter when multiple source files exist */}
      {hasExtractedContent && sourceFiles.length > 1 && hasQuery && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="sidebar-search-file-filter"
            className="text-[10.5px] font-semibold text-[#57534E] shrink-0"
          >
            فیلتر فایل:
          </label>
          <select
            id="sidebar-search-file-filter"
            value={fileFilterId}
            onChange={(e) => setFileFilterId(e.target.value)}
            className="flex-1 min-w-0 rounded-md border border-[#D6D0C4] bg-white px-2 py-1 text-[11px] text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
          >
            <option value="">همه فایل‌ها ({toPersianDigits(sourceFiles.length)})</option>
            {sourceFiles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.fileName}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Search Results */}
      {!hasExtractedContent ? (
        <p className="text-[10.5px] leading-5 text-[#78716C]">
          پس از استخراج فایل‌ها در مرحله ۱، تمام پاراگراف‌ها، جداول و نکات استخراج‌شده از همین بخش قابل جستجو هستند.
        </p>
      ) : hasQuery ? (
        <div className="space-y-2" aria-live="polite">
          <div className="flex items-center justify-between text-[11px] text-[#57534E] tabular-nums">
            {searchResult.totalMatches > 0 ? (
              <span>
                <strong className="text-[#1E3A5F]">
                  {toPersianDigits(searchResult.totalMatches)} نتیجه
                </strong>{' '}
                در {toPersianDigits(searchResult.matchedFilesCount)} فایل
              </span>
            ) : (
              <span className="text-[#9A3412] font-semibold">
                نتیجه‌ای برای «{searchResult.query}» پیدا نشد
              </span>
            )}

            {searchResult.totalMatches > searchResult.hits.length && (
              <span className="text-[10px] text-[#78716C]">
                نمایش {toPersianDigits(searchResult.hits.length)} مورد اول
              </span>
            )}
          </div>

          {searchResult.hits.length === 0 ? (
            <div className="rounded-lg border border-[#E5E0D6] bg-white p-3 text-[11px] text-[#57534E] space-y-2">
              <p className="leading-5">
                عبارت مورد نظر در متن فایل‌های استخراج‌شده یافت نشد. املای کلمه یا فیلتر فایل را بررسی کنید.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setFileFilterId('');
                }}
                className="text-[11px] font-bold text-[#1E3A5F] hover:underline cursor-pointer"
              >
                پاک کردن جستجو
              </button>
            </div>
          ) : (
            <ul
              data-testid="sidebar-search-results"
              className="max-h-72 overflow-y-auto space-y-1.5 pl-0.5"
            >
              {searchResult.hits.map((hit) => {
                const isExpanded = expandedUnitId === hit.unitId;
                return (
                  <li
                    key={hit.unitId}
                    className="rounded-lg border border-[#E5E0D6] bg-white transition-colors hover:border-[#C5BEB0]"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedUnitId(isExpanded ? null : hit.unitId)
                      }
                      aria-expanded={isExpanded}
                      className="w-full p-2.5 text-right space-y-1.5 cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 text-[10.5px] text-[#57534E] leading-4">
                          <span className="font-bold text-[#1E3A5F] truncate inline-block max-w-[190px] align-bottom">
                            {hit.sourceFileName}
                          </span>
                          <span aria-hidden="true"> · </span>
                          <span className="tabular-nums">
                            واحد {toPersianDigits(hit.unitOrder)}
                          </span>
                          {hit.status === 'merged' && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span className="text-[#8C6226] font-semibold">ادغام‌شده</span>
                            </>
                          )}
                        </div>
                        <span className="text-[#78716C] shrink-0 mt-0.5">
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </span>
                      </div>

                      {hit.headingPath && (
                        <div className="text-[10px] text-[#78716C] truncate">
                          {hit.headingPath}
                        </div>
                      )}

                      <p className="text-[11.5px] leading-5 text-[#292524]">
                        {hit.snippetSegments.map((seg, i) =>
                          seg.matched ? (
                            <mark
                              key={i}
                              className="rounded-xs bg-[#FEF3C7] px-0.5 font-bold text-[#1A1816]"
                            >
                              {seg.text}
                            </mark>
                          ) : (
                            <React.Fragment key={i}>{seg.text}</React.Fragment>
                          )
                        )}
                      </p>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-[#EFECE4] bg-[#FCFBF8] px-2.5 py-2 space-y-2 text-[11px]">
                        <div className="whitespace-pre-line leading-6 text-[#1A1816]">
                          {hit.rawText}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#EFECE4] text-[10.5px] text-[#57534E] tabular-nums">
                          <span>
                            {toPersianDigits(hit.wordCount)} کلمه
                            {hit.outlineNodeTitle ? ` · فصل: ${hit.outlineNodeTitle}` : ''}
                          </span>
                          {onJumpToResult && (
                            <button
                              type="button"
                              onClick={() =>
                                onJumpToResult({
                                  unitId: hit.unitId,
                                  outlineNodeId: hit.outlineNodeId,
                                  sourceFileId: hit.sourceFileId,
                                })
                              }
                              className="font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                            >
                              {hit.outlineNodeId ? 'مشاهده در فصل‌بندی' : 'مشاهده در مرحله ۱'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
};
