import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cloud,
  CloudOff,
  Eye,
  EyeOff,
  Globe,
  GripVertical,
  History,
  Loader2,
  Merge,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  ContentUnitDto,
  OutlineNodeDto,
  SourceFileDto,
  ValidationDomain,
} from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';
import {
  clearOutlineDraft,
  formatTimeFa,
  hasMeaningfulDraftDiff,
  loadOutlineDraft,
  OutlineDraftPayload,
  OutlineReassignment,
  saveOutlineDraft,
} from '../lib/outlineAutoSave';
import { DeepReviewProgressBanner, DeepReviewProgressState } from './DeepReviewPanel';
import { Stage3LiveTextPreviewPanel } from './Stage3LiveTextPreviewPanel';
import { HarnessControlPanel } from './HarnessControlPanel';
import type { UseHarnessRunnerResult } from '../hooks/useHarnessRunner';

type AutoSaveStatus =
  | 'idle'
  | 'saved_local_pending'
  | 'syncing_cloud'
  | 'saved_cloud'
  | 'offline_local';

interface OutlineEditorViewProps {
  projectId: string;
  projectTitle: string;
  nodes: OutlineNodeDto[];
  contentUnits: ContentUnitDto[];
  sourceFiles: SourceFileDto[];
  unitCountsByNode: Record<string, number>;
  highlightedNodeId?: string | null;
  saving: boolean;
  finalizing: boolean;
  groundingNodeId: string | null;
  enrichingAllGoogle: boolean;
  runningDeepReview: boolean;
  deepReviewProgress?: DeepReviewProgressState | null;
  onSaveOutline: (
    nextNodes: OutlineNodeDto[],
    reassignments?: OutlineReassignment[],
    options?: { silent?: boolean }
  ) => Promise<boolean>;
  onApproveAndFinalize: (nextNodes: OutlineNodeDto[]) => Promise<void>;
  onEnrichNodeWithGoogle: (nodeId: string) => Promise<void>;
  onEnrichAllWithGoogle: () => Promise<void>;
  onRunDeepReview: () => Promise<void>;
  harness?: UseHarnessRunnerResult;
  validationDomain?: ValidationDomain;
  onChangeValidationDomain?: (domain: ValidationDomain) => void;
  onOpenProviderSettings?: () => void;
}

export const OutlineEditorView: React.FC<OutlineEditorViewProps> = ({
  projectId,
  projectTitle,
  nodes,
  contentUnits,
  sourceFiles,
  unitCountsByNode,
  highlightedNodeId = null,
  saving,
  finalizing,
  groundingNodeId,
  enrichingAllGoogle: _enrichingAllGoogle,
  runningDeepReview,
  deepReviewProgress,
  onSaveOutline,
  onApproveAndFinalize,
  onEnrichNodeWithGoogle,
  onEnrichAllWithGoogle: _onEnrichAllWithGoogle,
  onRunDeepReview: _onRunDeepReview,
  harness,
  validationDomain = 'ecu_winols',
  onChangeValidationDomain,
  onOpenProviderSettings,
}) => {
  const [draft, setDraft] = useState<OutlineNodeDto[]>(() =>
    [...nodes].sort((a, b) => a.nodeOrder - b.nodeOrder)
  );
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [pendingReassignments, setPendingReassignments] = useState<OutlineReassignment[]>([]);
  const [dirty, setDirty] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(true);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(highlightedNodeId);

  useEffect(() => {
    if (highlightedNodeId) {
      setFocusedNodeId(highlightedNodeId);
    }
  }, [highlightedNodeId]);

  // Auto-Save & Crash/Offline Recovery state
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [recoverableDraft, setRecoverableDraft] = useState<OutlineDraftPayload | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const reassignmentsRef = useRef(pendingReassignments);
  reassignmentsRef.current = pendingReassignments;
  const serverNodesRef = useRef(nodes);
  serverNodesRef.current = nodes;
  const syncInFlightRef = useRef(false);
  const lastProjectIdRef = useRef(projectId);

  // Sync draft when server nodes change externally (or when switching projects),
  // and check for any unsynced local recovery draft from a prior crash/disconnect.
  useEffect(() => {
    const projectSwitched = lastProjectIdRef.current !== projectId;
    lastProjectIdRef.current = projectId;

    // If user is not actively holding unsaved local edits (or switched project), sync from server
    if (projectSwitched || !dirtyRef.current) {
      const sorted = [...nodes].sort((a, b) => a.nodeOrder - b.nodeOrder);
      setDraft(sorted);
      setDirty(false);
      setPendingReassignments([]);
      if (projectSwitched) {
        setAutoSaveStatus('idle');
        setLastSavedAt(null);
      }

      const stored = loadOutlineDraft(projectId);
      if (hasMeaningfulDraftDiff(stored, sorted)) {
        setRecoverableDraft(stored);
      } else {
        setRecoverableDraft(null);
      }
    }
  }, [projectId, nodes]);

  // Perform cloud sync of the current draft
  const flushCloudAutoSave = useCallback(
    async (silent = true): Promise<boolean> => {
      if (!dirtyRef.current || syncInFlightRef.current || finalizing) return true;
      const currentDraft = draftRef.current;
      const currentReassignments = reassignmentsRef.current;

      // Always persist a local backup before attempting network sync
      const localRes = saveOutlineDraft({
        projectId,
        serverNodes: serverNodesRef.current,
        draftNodes: currentDraft,
        reassignments: currentReassignments,
      });

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setAutoSaveStatus('offline_local');
        setLastSavedAt(localRes.savedAt);
        return false;
      }

      syncInFlightRef.current = true;
      setAutoSaveStatus('syncing_cloud');
      try {
        const ok = await onSaveOutline(currentDraft, currentReassignments, { silent });
        if (ok) {
          clearOutlineDraft(projectId);
          setDirty(false);
          setPendingReassignments([]);
          setRecoverableDraft(null);
          setAutoSaveStatus('saved_cloud');
          setLastSavedAt(new Date().toISOString());
          return true;
        }
        setAutoSaveStatus('offline_local');
        setLastSavedAt(localRes.savedAt);
        return false;
      } catch {
        setAutoSaveStatus('offline_local');
        setLastSavedAt(localRes.savedAt);
        return false;
      } finally {
        syncInFlightRef.current = false;
      }
    },
    [projectId, finalizing, onSaveOutline]
  );

  // Layer 1: Instant debounced localStorage auto-save (350ms) so sudden browser close never loses edits
  useEffect(() => {
    if (!dirty || !projectId) return;
    const timer = window.setTimeout(() => {
      const res = saveOutlineDraft({
        projectId,
        serverNodes: serverNodesRef.current,
        draftNodes: draft,
        reassignments: pendingReassignments,
      });
      if (res.ok) {
        setLastSavedAt(res.savedAt);
        setAutoSaveStatus(isOnline ? 'saved_local_pending' : 'offline_local');
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [dirty, projectId, draft, pendingReassignments, isOnline]);

  // Layer 2: Automatic debounced cloud sync (1800ms) when online
  useEffect(() => {
    if (!dirty || !projectId || !isOnline || finalizing) return;
    const timer = window.setTimeout(() => {
      void flushCloudAutoSave(true);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [dirty, projectId, draft, pendingReassignments, isOnline, finalizing, flushCloudAutoSave]);

  // Browser online/offline listeners + immediate localStorage flush on tab close/unload
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (dirtyRef.current) {
        void flushCloudAutoSave(true);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      if (dirtyRef.current) {
        const res = saveOutlineDraft({
          projectId,
          serverNodes: serverNodesRef.current,
          draftNodes: draftRef.current,
          reassignments: reassignmentsRef.current,
        });
        setLastSavedAt(res.savedAt);
        setAutoSaveStatus('offline_local');
      }
    };
    const handleBeforeUnload = () => {
      if (dirtyRef.current && projectId) {
        saveOutlineDraft({
          projectId,
          serverNodes: serverNodesRef.current,
          draftNodes: draftRef.current,
          reassignments: reassignmentsRef.current,
        });
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [projectId, flushCloudAutoSave]);

  const handleRestoreDraft = () => {
    if (!recoverableDraft) return;
    setDraft(recoverableDraft.nodes);
    setPendingReassignments(recoverableDraft.reassignments);
    setDirty(true);
    setLastSavedAt(recoverableDraft.savedAt);
    setAutoSaveStatus(isOnline ? 'saved_local_pending' : 'offline_local');
    setRecoverableDraft(null);
  };

  const handleDiscardDraft = () => {
    clearOutlineDraft(projectId);
    setRecoverableDraft(null);
  };

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
      projectId: draft[0]?.projectId || projectId,
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

  const handleDeleteChapter = (idx: number) => {
    if (draft.length <= 1) return;
    const removed = draft[idx];
    const remaining = draft
      .filter((_, i) => i !== idx)
      .map((n, i) => ({ ...n, nodeOrder: i + 1 }));
    const fallbackTarget = remaining[0];
    setDraft(remaining);
    if (removed && fallbackTarget) {
      setPendingReassignments((prev) => [
        ...prev,
        { fromNodeId: removed.id, toNodeId: fallbackTarget.id },
      ]);
    }
    setDirty(true);
  };

  const handleManualSave = async () => {
    await flushCloudAutoSave(false);
  };

  const handleApprove = async () => {
    const approved = draft.map((n) => ({ ...n, isApproved: true }));
    if (dirty || pendingReassignments.length > 0) {
      const ok = await onSaveOutline(approved, pendingReassignments, { silent: true });
      if (ok) {
        clearOutlineDraft(projectId);
        setDirty(false);
        setPendingReassignments([]);
      }
    }
    clearOutlineDraft(projectId);
    await onApproveAndFinalize(approved);
  };

  const formattedTime = lastSavedAt ? formatTimeFa(lastSavedAt) : '';

  return (
    <div
      className={`mx-auto px-4 py-6 sm:px-8 space-y-6 ${
        showLivePreview ? 'max-w-7xl' : 'max-w-4xl'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E2DDD3] pb-4">
        <div className="space-y-1">
          <p className="text-xs font-bold text-[#1E3A5F]">
            مرحله ۳ از ۵ · تأیید و ویرایش ساختار فصل‌بندی
          </p>
          <h2 className="text-lg sm:text-xl font-extrabold text-[#1A1816]">
            چیدمان فصل‌ها پیش از صفحه‌آرایی و کادربندی کتاب
          </h2>
          <p className="text-xs sm:text-sm text-[#57534E] leading-6">
            در این مرحله فقط روی نظم، نام‌گذاری و ادغام فصل‌ها تمرکز کنید. تغییرات شما به‌طور خودکار در حافظه مرورگر و سرور ذخیره موقت می‌شوند.
          </p>

          {/* Subtle Auto-Save Status Line (Unboxed Text, Zero-Pill Discipline) */}
          <div className="pt-1 flex flex-wrap items-center gap-2 text-[11.5px]" aria-live="polite">
            {autoSaveStatus === 'syncing_cloud' || saving ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#1E3A5F]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>در حال همگام‌سازی خودکار تغییرات با سرور...</span>
              </span>
            ) : autoSaveStatus === 'offline_local' ? (
              <span className="inline-flex items-center gap-1.5 font-bold text-[#9A3412]">
                <CloudOff className="h-3.5 w-3.5" />
                <span>
                  حالت آفلاین / قطعی ارتباط — تغییرات در مرورگر ذخیره موقت شد
                  {formattedTime ? ` (${toPersianDigits(formattedTime)})` : ''} و با وصل شدن اینترنت ارسال می‌شود.
                </span>
              </span>
            ) : autoSaveStatus === 'saved_local_pending' ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#7C4706]">
                <History className="h-3.5 w-3.5" />
                <span>
                  ذخیره موقت در مرورگر ثبت شد
                  {formattedTime ? ` (${toPersianDigits(formattedTime)})` : ''} · آماده همگام‌سازی با سرور...
                </span>
              </span>
            ) : autoSaveStatus === 'saved_cloud' ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#14532D]">
                <Cloud className="h-3.5 w-3.5" />
                <span>
                  ذخیره خودکار در سرور انجام شد
                  {formattedTime ? ` · ساعت ${toPersianDigits(formattedTime)}` : ''}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[#78716C]">
                <Cloud className="h-3.5 w-3.5" />
                <span>ذخیره خودکار (Auto-Save) برای این مرحله فعال است</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowLivePreview((v) => !v)}
            aria-pressed={showLivePreview}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              showLivePreview
                ? 'border-[#1E3A5F] bg-[#EEF3F8] text-[#1E3A5F]'
                : 'border-[#D6D0C4] bg-white text-[#44403C] hover:bg-[#F5F3EE]'
            }`}
          >
            {showLivePreview ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4 text-[#1E3A5F]" />
            )}
            <span>{showLivePreview ? 'بستن پیش‌نمایش آنی' : 'نمایش پیش‌نمایش آنی'}</span>
          </button>

          <button
            type="button"
            onClick={handleAddChapter}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white px-3.5 py-2 text-xs font-semibold text-[#1A1816] hover:bg-[#F5F3EE] cursor-pointer whitespace-nowrap"
          >
            <Plus className="h-4 w-4 text-[#1E3A5F]" />
            افزودن فصل جدید
          </button>

          {dirty && (
            <button
              type="button"
              onClick={handleManualSave}
              disabled={saving || autoSaveStatus === 'syncing_cloud'}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-[#EEF3F8] px-3.5 py-2 text-xs font-semibold text-[#1E3A5F] hover:bg-[#E1EBF5] disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              {saving || autoSaveStatus === 'syncing_cloud' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              ذخیره فوری در سرور
            </button>
          )}
        </div>
      </div>

      {/* Unsynced Crash / Disconnect Recovery Banner */}
      {recoverableDraft && (
        <div className="rounded-xl border border-[#DFC690] bg-[#FFFDF6] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-[#744005]">
            <History className="h-4 w-4 shrink-0 mt-0.5 text-[#92580E]" />
            <div className="space-y-0.5 leading-5">
              <div className="font-extrabold">
                پیش‌نویس ذخیره موقت‌شده از نشست قبلی پیدا شد
              </div>
              <p className="text-[#7C4706]">
                آخرین تغییرات شما روی {toPersianDigits(recoverableDraft.nodes.length)} فصل در ساعت{' '}
                <strong className="tabular-nums">
                  {toPersianDigits(formatTimeFa(recoverableDraft.savedAt))}
                </strong>{' '}
                پیش از قطع ارتباط یا بستن مرورگر در حافظه محلی ذخیره شده است.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRestoreDraft}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#744005] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#5E3204] cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>بازیابی تغییرات</span>
            </button>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#DFC690] bg-white px-3 py-1.5 text-xs font-semibold text-[#744005] hover:bg-[#FAF0D4] cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>حذف پیش‌نویس</span>
            </button>
          </div>
        </div>
      )}

      {runningDeepReview && deepReviewProgress && (
        <DeepReviewProgressBanner progress={deepReviewProgress} variant="card" />
      )}

      {/* Dual-Mode Validation Domain Bar (Gate 1 Configuration) */}
      {onChangeValidationDomain && (
        <div className="rounded-xl border border-[#DCE5F0] bg-[#F4F7FB] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-extrabold text-[#1E3A5F]">
              دروازه ۱ · پروفایل تخصصی اعتبارسنجی و ویراستاری کتاب
            </div>
            <p className="text-[11px] text-[#475569]">
              {validationDomain === 'ecu_winols'
                ? 'حالت تخصصی ECU / WinOLS: کنترل دقیق آدرس‌های هگز، کدهای DTC، جداول محور RPM×Load، واحدها و هشدارهای ایمنی'
                : 'حالت متون فنی و آموزشی عمومی فارسی: ممیزی کامل اعداد، واحدها، فرمول‌ها، جداول و اصطلاحات بدون اعمال قیدهای ECU/WinOLS'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onChangeValidationDomain('ecu_winols')}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold cursor-pointer transition-colors ${
                validationDomain === 'ecu_winols'
                  ? 'border-[#14532D] bg-[#14532D] text-white'
                  : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]'
              }`}
            >
              تخصصی ECU / WinOLS
            </button>
            <button
              type="button"
              onClick={() => onChangeValidationDomain('general_persian_technical')}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold cursor-pointer transition-colors ${
                validationDomain === 'general_persian_technical'
                  ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                  : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]'
              }`}
            >
              عمومی فارسی و فنی
            </button>
          </div>
        </div>
      )}

      {/* Domain-Specific AI Harness: Stage 3 HITL Gate, Cost Preview, Live Stepper & Quarantine Queue */}
      {harness && (
        <HarnessControlPanel
          harness={harness}
          validationDomain={validationDomain}
          onChangeValidationDomain={onChangeValidationDomain}
          onOpenProviderSettings={onOpenProviderSettings}
        />
      )}

      {/* Main 2-Column Split: Chapter Organizer + Instant Live Text Preview */}
      <div
        className={
          showLivePreview
            ? 'grid grid-cols-1 xl:grid-cols-12 gap-6 items-start'
            : 'space-y-6'
        }
      >
        <div className={showLivePreview ? 'xl:col-span-7 space-y-6 min-w-0' : 'space-y-6'}>
          {/* Draggable Outline List */}
          <ul className="space-y-2.5">
            {draft.map((node, idx) => {
              const unitCount = unitCountsByNode[node.id] ?? 0;
              const isGrounding = groundingNodeId === node.id;
              const isFocused = focusedNodeId === node.id;

              return (
                <li
                  key={node.id}
                  draggable
                  onDragStart={() => {
                    setDragIdx(idx);
                    setFocusedNodeId(node.id);
                  }}
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
                      : isFocused
                        ? 'border-[#1E3A5F] bg-[#FCFDFE]'
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
                      onFocus={() => setFocusedNodeId(node.id)}
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
                  <button
                    type="button"
                    disabled={draft.length <= 1}
                    onClick={() => handleDeleteChapter(idx)}
                    aria-label="حذف فصل"
                    title={
                      draft.length <= 1
                        ? 'حداقل یک فصل باید در ساختار کتاب باقی بماند'
                        : 'حذف این فصل و انتقال خودکار تمام مطالب آن به فصل اول (بدون اتلاف)'
                    }
                    className="flex h-9 w-8 items-center justify-center rounded-md text-[#9A3412] hover:bg-[#FFF5F2] disabled:opacity-30 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
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
            <div className="font-bold">گام بعدی: مرحله ۴ — صفحه‌آرایی، کادربندی رنگی و پیش‌نمایش</div>
            <div className="text-xs text-[#3B5578] mt-0.5">
              پس از تأیید چیدمان فصل‌ها، پیش‌نویس کامل کتاب با کادرهای موضوعی رنگی و سرفصل‌های استاندارد ساخته می‌شود تا پیش از خروجی نهایی آن را بررسی و در صورت نیاز غنی‌سازی کنید.
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
              در حال ساخت پیش‌نمایش و کادربندی...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              تأیید فصل‌بندی و رفتن به مرحله ۴
            </>
          )}
        </button>
      </div>
        </div>

        {showLivePreview && (
          <div className="xl:col-span-5 min-w-0">
            <Stage3LiveTextPreviewPanel
              projectTitle={projectTitle}
              draftNodes={draft}
              contentUnits={contentUnits}
              sourceFiles={sourceFiles}
              pendingReassignments={pendingReassignments}
              highlightedNodeId={focusedNodeId}
              harnessState={harness?.harnessState ?? null}
            />
          </div>
        )}
      </div>
    </div>
  );
};
