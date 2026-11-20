import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Brain,
  CheckCircle2,
  Globe,
  GripVertical,
  Loader2,
  Merge,
  Plus,
  Sparkles,
} from 'lucide-react';
import { OutlineNodeDto } from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';
import { DeepReviewProgressBanner, DeepReviewProgressState } from './DeepReviewPanel';

interface OutlineEditorViewProps {
  nodes: OutlineNodeDto[];
  unitCountsByNode: Record<string, number>;
  saving: boolean;
  finalizing: boolean;
  groundingNodeId: string | null;
  enrichingAllGoogle: boolean;
  runningDeepReview: boolean;
  deepReviewProgress?: DeepReviewProgressState | null;
  onSaveOutline: (
    nextNodes: OutlineNodeDto[],
    reassignments?: Array<{ fromNodeId: string; toNodeId: string }>
  ) => Promise<void>;
  onApproveAndFinalize: (nextNodes: OutlineNodeDto[]) => Promise<void>;
  onEnrichNodeWithGoogle: (nodeId: string) => Promise<void>;
  onEnrichAllWithGoogle: () => Promise<void>;
  onRunDeepReview: () => Promise<void>;
}

export const OutlineEditorView: React.FC<OutlineEditorViewProps> = ({
  nodes,
  unitCountsByNode,
  saving,
  finalizing,
  groundingNodeId,
  enrichingAllGoogle,
  runningDeepReview,
  deepReviewProgress,
  onSaveOutline,
  onApproveAndFinalize,
  onEnrichNodeWithGoogle,
  onEnrichAllWithGoogle,
  onRunDeepReview,
}) => {
  const [draft, setDraft] = useState<OutlineNodeDto[]>(() =>
    [...nodes].sort((a, b) => a.nodeOrder - b.nodeOrder)
  );
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [pendingReassignments, setPendingReassignments] = useState<
    Array<{ fromNodeId: string; toNodeId: string }>
  >([]);
  const [dirty, setDirty] = useState(false);

  // Sync draft when server nodes change externally (e.g. from AI chatbot/voice proposals)
  React.useEffect(() => {
    setDraft([...nodes].sort((a, b) => a.nodeOrder - b.nodeOrder));
    setDirty(false);
    setPendingReassignments([]);
  }, [nodes]);

  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= draft.length) return;
    const copy = [...draft];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    setDraft(copy.map((n, idx) => ({ ...n, nodeOrder: idx + 1 })));
    setDirty(true);
  };

  const handleRename = (id: string, title: string) => {
    setDraft((prev) => prev.map((n) => (n.id === id ? { ...n, title } : n)));
    setDirty(true);
  };

  const handleAddChapter = () => {
    const newNode: OutlineNodeDto = {
      id: `node_manual_${Date.now()}`,
      projectId: draft[0]?.projectId || '',
      parentId: null,
      level: 1,
      nodeOrder: draft.length + 1,
      title: `فصل جدید ${toPersianDigits(draft.length + 1)}`,
      summary: 'فصل افزوده‌شده توسط ویراستار',
      isApproved: false,
      webEnrichmentJson: null,
    };
    setDraft((prev) => [...prev, newNode]);
    setDirty(true);
  };

  const handleMergeWithPrevious = (idx: number) => {
    if (idx <= 0) return;
    const target = draft[idx - 1];
    const removed = draft[idx];
    const next = draft
      .filter((_, i) => i !== idx)
      .map((n, i) => ({ ...n, nodeOrder: i + 1 }));
    setDraft(next);
    setPendingReassignments((prev) => [
      ...prev,
      { fromNodeId: removed.id, toNodeId: target.id },
    ]);
    setDirty(true);
  };

  const handleSave = async () => {
    await onSaveOutline(draft, pendingReassignments);
    setDirty(false);
    setPendingReassignments([]);
  };

  const handleApprove = async () => {
    if (dirty || pendingReassignments.length > 0) {
      await onSaveOutline(
        draft.map((n) => ({ ...n, isApproved: true })),
        pendingReassignments
      );
    }
    await onApproveAndFinalize(draft.map((n) => ({ ...n, isApproved: true })));
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E2DDD3] pb-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[#1E3A5F]">
            مرحله ۳ · تأیید و ویرایش ساختار فصل‌بندی (Human-in-the-Loop)
          </p>
          <h2 className="text-lg sm:text-xl font-extrabold text-[#1A1816]">
            چیدمان فصل‌ها پیش از صفحه‌آرایی نهایی ورد
          </h2>
          <p className="text-xs sm:text-sm text-[#57534E] leading-6">
            فصل‌ها را با کشیدن و رها کردن (Drag &amp; Drop) مرتب کنید، نام‌شان را تغییر دهید یا فصل‌های هم‌موضوع را ادغام کنید. هیچ محتوایی هنگام ادغام فصل‌ها حذف نمی‌شود.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onEnrichAllWithGoogle}
            disabled={enrichingAllGoogle || finalizing || draft.length === 0}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#D7CBE6] bg-[#F7F4FA] px-3.5 py-2 text-xs font-bold text-[#5B21B6] hover:bg-[#ECE5F5] disabled:opacity-50 cursor-pointer"
          >
            {enrichingAllGoogle ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Globe className="h-4 w-4" />
            )}
            <span>
              {enrichingAllGoogle ? 'در حال تکمیل کل فصل‌ها با گوگل...' : 'تکمیل کل فصل‌ها با گوگل'}
            </span>
          </button>

          <button
            type="button"
            onClick={onRunDeepReview}
            disabled={runningDeepReview || finalizing || draft.length === 0}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-[#EEF3F8] px-3.5 py-2 text-xs font-bold text-[#1E3A5F] hover:bg-[#DFE9F4] disabled:opacity-50 cursor-pointer tabular-nums"
          >
            {runningDeepReview ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Brain className="h-4 w-4" />
            )}
            <span>
              {runningDeepReview
                ? `در حال بازبینی عمیق (${toPersianDigits(deepReviewProgress?.percent ?? 5)}٪)...`
                : 'بازبینی با قدرت بیشتر هوش مصنوعی'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleAddChapter}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white px-3.5 py-2 text-xs font-semibold text-[#1A1816] hover:bg-[#F5F3EE] cursor-pointer"
          >
            <Plus className="h-4 w-4 text-[#1E3A5F]" />
            افزودن فصل جدید
          </button>

          {dirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-[#EEF3F8] px-3.5 py-2 text-xs font-semibold text-[#1E3A5F] hover:bg-[#E1EBF5] cursor-pointer"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              ذخیره موقت چیدمان
            </button>
          )}
        </div>
      </div>

      {runningDeepReview && deepReviewProgress && (
        <DeepReviewProgressBanner progress={deepReviewProgress} variant="card" />
      )}

      {/* Draggable Outline List */}
      <ul className="space-y-2.5">
        {draft.map((node, idx) => {
          const unitCount = unitCountsByNode[node.id] ?? 0;
          const isGrounding = groundingNodeId === node.id;

          return (
            <li
              key={node.id}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={() => {
                if (dragIdx !== null) {
                  reorder(dragIdx, idx);
                }
                setDragIdx(null);
              }}
              className={`rounded-xl border bg-white p-3.5 sm:p-4 transition-colors ${
                dragIdx === idx
                  ? 'border-[#1E3A5F] bg-[#F2F6FA] opacity-80'
                  : 'border-[#E2DDD3] hover:border-[#C5BEB0]'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <span
                    className="cursor-grab text-[#8C857B] hover:text-[#1E3A5F] shrink-0"
                    title="برای جابه‌جایی بکشید"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>

                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#EEF3F8] text-xs font-bold tabular-nums text-[#1E3A5F]">
                    {toPersianDigits(idx + 1)}
                  </span>

                  <div className="flex-1 min-w-0 space-y-1">
                    <input
                      type="text"
                      value={node.title}
                      onChange={(e) => handleRename(node.id, e.target.value)}
                      aria-label={`عنوان فصل ${idx + 1}`}
                      className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-bold text-[#1A1816] hover:border-[#E2DDD3] focus:border-[#1E3A5F] focus:bg-[#FAF9F6] focus:outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-2 px-1.5 text-[11px] text-[#78716C]">
                      <span>{toPersianDigits(unitCount)} واحد محتوایی یکتا</span>
                      {node.summary && (
                        <>
                          <span>·</span>
                          <span className="truncate max-w-[320px]">{node.summary}</span>
                        </>
                      )}
                      {node.webEnrichmentJson && (
                        <>
                          <span>·</span>
                          <span className="font-semibold text-[#5B21B6]">
                            دارای باکس تکمیلی وب (جستجوی گوگل)
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center justify-end gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={isGrounding}
                    onClick={() => onEnrichNodeWithGoogle(node.id)}
                    title="افزودن باکس اطلاعات تکمیلی ایزوله از جستجوی گوگل"
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-[#D7CBE6] bg-[#F7F4FA] px-2.5 py-1 text-[11px] font-semibold text-[#5B21B6] hover:bg-[#ECE5F5] disabled:opacity-50 cursor-pointer"
                  >
                    {isGrounding ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Globe className="h-3.5 w-3.5" />
                    )}
                    <span className="hidden md:inline">تکمیل با گوگل</span>
                  </button>

                  {idx > 0 && (
                    <button
                      type="button"
                      onClick={() => handleMergeWithPrevious(idx)}
                      title="ادغام بدون افت در فصل بالایی"
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-[#E2DDD3] bg-[#FAF9F6] px-2 py-1 text-[11px] font-medium text-[#57534E] hover:bg-[#EFECE4] hover:text-[#1E3A5F] cursor-pointer"
                    >
                      <Merge className="h-3.5 w-3.5" />
                      <span className="hidden lg:inline">ادغام با بالا</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => reorder(idx, idx - 1)}
                    aria-label="انتقال فصل به بالا"
                    className="flex h-9 w-8 items-center justify-center rounded-md text-[#57534E] hover:bg-[#F5F3EE] disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === draft.length - 1}
                    onClick={() => reorder(idx, idx + 1)}
                    aria-label="انتقال فصل به پایین"
                    className="flex h-9 w-8 items-center justify-center rounded-md text-[#57534E] hover:bg-[#F5F3EE] disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Primary Approval CTA */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-[#C6D5E6] bg-[#EEF3F8] p-4 sm:p-5">
        <div className="flex items-start gap-2.5 text-xs sm:text-sm text-[#1E3A5F]">
          <Sparkles className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">آماده صفحه‌آرایی نهایی، رسم نمودار و ممیزی ۱۰۰٪</div>
            <div className="text-xs text-[#3B5578] mt-0.5">
              پس از تأیید، سند یکپارچه با فونت وزیر مدیوم، سرفصل‌های Heading استاندارد، فهرست خودکار و گزارش پوشش کامل تولید می‌شود.
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleApprove}
          disabled={finalizing || saving || draft.length === 0}
          className="w-full sm:w-auto min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E3A5F] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#162C49] transition-colors shadow-sm disabled:opacity-60 cursor-pointer shrink-0"
        >
          {finalizing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              در حال صفحه‌آرایی و ممیزی نهایی...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              تأیید فصل‌بندی و ساخت سند نهایی
            </>
          )}
        </button>
      </div>
    </div>
  );
};
