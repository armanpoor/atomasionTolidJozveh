import React, { useEffect, useMemo, useState } from 'react';
import {
  BookCopy,
  Clock,
  FileDiff,
  FilePlus2,
  FileText,
  FolderOpen,
  Globe,
  History,
  KeyRound,
  Layers,
  Loader2,
  Play,
  Scissors,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {
  AiModelId,
  AiRewriteLevel,
  AiThinkingLevel,
  ContentUnitDto,
  DocxExportConfig,
  FileRole,
  GoogleSearchMode,
  OutlineNodeDto,
  OutputTonePreset,
  ProjectAiUsageLedger,
  ProjectSummaryDto,
  SourceFileDto,
  WorkflowMode,
} from '../lib/bookTypes';
import {
  AI_PROVIDER_LIST,
  AI_PROVIDER_METADATA,
  AiProviderConfig,
  AiProviderType,
  AiQuotaProbeResponse,
  getProviderDisplaySummary,
  GOOGLE_MODEL_OPTIONS,
} from '../lib/aiProviderConfig';
import {
  AI_REWRITE_LEVEL_OPTIONS,
  OUTPUT_TONE_OPTIONS,
  QUICK_CUSTOM_PROMPT_PRESETS,
} from '../lib/winolsMapGuide';
import { UNIVERSAL_SYSTEM_PROMPT_RULES } from '../lib/universalSystemPrompt';
import { formatCompactFileSize } from '../lib/dropzoneUtils';
import { filterSourceFilesByName } from '../lib/fileDiffUtils';
import {
  appendPersistentUploadHistoryEntries,
  loadPersistentUploadHistory,
  PersistentUploadHistoryEntry,
  savePersistentUploadHistory,
} from '../lib/filePreprocessEngine';
import { toPersianDigits } from '../lib/formatParsers';
import { AiQuotaGauge } from './AiQuotaGauge';
import {
  AUTOMOTIVE_CONSENT_SESSION_KEY,
  AutomotiveConsentBanner,
} from './AutomotiveConsentBanner';
import { FileDropzone, QueuedUploadFile } from './FileDropzone';
import { SidebarContentSearch } from './SidebarContentSearch';

const WORKFLOW_MODES: Array<{
  id: WorkflowMode;
  title: string;
  desc: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'single_polish',
    title: 'پالایش تک‌فایل',
    desc: 'مرتب‌سازی، فهرست خودکار، جدول و نمودار برای ۱ سند',
    Icon: Sparkles,
  },
  {
    id: 'multi_merge',
    title: 'ادغام بدون افت چندفایلی',
    desc: 'ترکیب ۲ تا ۱۰۰+ سند با حفظ ۱۰۰٪ نکات و کشف تناقض',
    Icon: Layers,
  },
  {
    id: 'master_update',
    title: 'به‌روزرسانی سند مرجع',
    desc: 'تزریق مطالب جدید فایل‌های تکمیلی به سند مرجع',
    Icon: BookCopy,
  },
  {
    id: 'raw_synthesis',
    title: 'تبدیل یادداشت خام',
    desc: 'فصل‌بندی و تبدیل متن‌های پراکنده به سند رسمی ورد',
    Icon: Wand2,
  },
];

interface WorkspaceSidebarProps {
  projects: ProjectSummaryDto[];
  activeProjectId: string | null;
  activeWorkflowMode: WorkflowMode;
  queuedFiles: QueuedUploadFile[];
  sourceFiles?: SourceFileDto[];
  contentUnits?: ContentUnitDto[];
  outlineNodes?: OutlineNodeDto[];
  ingestedFilesCount: number;
  ingestedWordCount: number;
  chapterCount: number;
  aiUsage: ProjectAiUsageLedger;
  config: DocxExportConfig;
  providerConfig: AiProviderConfig;
  probeData: AiQuotaProbeResponse | null;
  probingQuota: boolean;
  processing: boolean;
  onRunLiveProbe: () => Promise<void>;
  onOpenProviderSettings: () => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (mode: WorkflowMode) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onChangeWorkflowMode: (mode: WorkflowMode) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onMoveFile: (id: string, dir: 'up' | 'down') => void;
  onClearFiles: () => void;
  onSetFileRole: (id: string, role: FileRole) => void;
  onBulkSetFileRole?: (ids: string[], role: FileRole) => void;
  onChangeConfig: (patch: Partial<DocxExportConfig>) => void;
  onChangeProviderConfig?: (next: AiProviderConfig) => void;
  onChangeOptimization: (patch: Partial<DocxExportConfig['optimization']>) => void;
  onStartPipeline: () => Promise<void>;
  onJumpToSearchResult?: (params: {
    unitId: string;
    outlineNodeId: string | null;
    sourceFileId: string;
  }) => void;
  uploadHistory?: PersistentUploadHistoryEntry[];
  onClearUploadHistory?: () => void;
}

export const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
  projects,
  activeProjectId,
  activeWorkflowMode,
  queuedFiles,
  sourceFiles = [],
  contentUnits = [],
  outlineNodes = [],
  ingestedFilesCount,
  ingestedWordCount,
  chapterCount,
  aiUsage,
  config,
  providerConfig,
  probeData,
  probingQuota,
  processing,
  onRunLiveProbe,
  onOpenProviderSettings,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onChangeWorkflowMode,
  onAddFiles,
  onRemoveFile,
  onMoveFile,
  onClearFiles,
  onSetFileRole,
  onBulkSetFileRole,
  onChangeConfig,
  onChangeProviderConfig,
  onChangeOptimization,
  onStartPipeline,
  onJumpToSearchResult,
  uploadHistory,
  onClearUploadHistory,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sourceFileFilter, setSourceFileFilter] = useState('');
  const [requestedDiffFileId, setRequestedDiffFileId] = useState<string | null>(null);
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [bulkTargetRole, setBulkTargetRole] = useState<FileRole>('supplement');
  const [filesSectionTab, setFilesSectionTab] = useState<'active_queue' | 'upload_history'>('active_queue');
  const [uploadHistoryFilter, setUploadHistoryFilter] = useState('');
  const [internalUploadHistory, setInternalUploadHistory] = useState<PersistentUploadHistoryEntry[]>(() =>
    loadPersistentUploadHistory()
  );
  const [automotiveConsentAccepted, setAutomotiveConsentAccepted] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' &&
        window.sessionStorage.getItem(AUTOMOTIVE_CONSENT_SESSION_KEY) === 'accepted';
    } catch {
      return false;
    }
  });

  const handleToggleAutomotiveConsent = (accepted: boolean) => {
    setAutomotiveConsentAccepted(accepted);
    try {
      if (typeof window !== 'undefined') {
        if (accepted) {
          window.sessionStorage.setItem(AUTOMOTIVE_CONSENT_SESSION_KEY, 'accepted');
        } else {
          window.sessionStorage.removeItem(AUTOMOTIVE_CONSENT_SESSION_KEY);
        }
      }
    } catch {
      // Ignore storage errors in sandboxed iframes
    }
  };

  useEffect(() => {
    setSourceFileFilter('');
    setRequestedDiffFileId(null);
    setSelectedQueueIds([]);
  }, [activeProjectId]);

  // Keep selectedQueueIds synced with current queuedFiles
  useEffect(() => {
    setSelectedQueueIds((prev) => {
      const validIds = new Set(queuedFiles.map((q) => q.id));
      const filtered = prev.filter((id) => validIds.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [queuedFiles]);

  const handleToggleSelectQueuedFile = (id: string) => {
    setSelectedQueueIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllQueuedFiles = () => {
    if (selectedQueueIds.length === queuedFiles.length) {
      setSelectedQueueIds([]);
    } else {
      setSelectedQueueIds(queuedFiles.map((q) => q.id));
    }
  };

  const handleApplyBulkFileRole = (roleToAssign: FileRole) => {
    const targetIds =
      selectedQueueIds.length > 0 ? selectedQueueIds : queuedFiles.map((q) => q.id);
    if (targetIds.length === 0) return;

    if (onBulkSetFileRole) {
      onBulkSetFileRole(targetIds, roleToAssign);
    } else {
      targetIds.forEach((id, idx) => {
        // When assigning 'master' to multiple files without bulk handler, first gets master, rest supplement
        const effectiveRole: FileRole =
          roleToAssign === 'master' && idx > 0 ? 'supplement' : roleToAssign;
        onSetFileRole(id, effectiveRole);
      });
    }
  };

  const filteredSourceFiles = useMemo(
    () => filterSourceFilesByName(sourceFiles, sourceFileFilter),
    [sourceFiles, sourceFileFilter]
  );

  // Sync currently loaded project's sourceFiles into persistent cross-session upload history
  useEffect(() => {
    if (sourceFiles.length === 0) return;
    const activeProjectTitle =
      projects.find((p) => p.id === activeProjectId)?.title || 'پروژه فعال';
    const syncedEntries: PersistentUploadHistoryEntry[] = sourceFiles.map((sf) => {
      const meta = (sf.metadataJson || {}) as Record<string, unknown>;
      const classificationRaw = String(meta.preprocessClassification || 'pure_automotive');
      const classification: PersistentUploadHistoryEntry['classification'] =
        classificationRaw === 'mixed_hybrid_pruned' ||
        classificationRaw === 'rejected_non_automotive'
          ? classificationRaw
          : 'pure_automotive';
      return {
        id: `hist_${sf.id}`,
        fileName: sf.fileName,
        format: sf.format,
        fileRole: sf.fileRole || 'standard',
        sizeBytes: sf.sizeBytes || 0,
        wordCount: sf.wordCount || 0,
        unitCount: sf.unitCount || 0,
        projectId: sf.projectId || activeProjectId,
        projectTitle: activeProjectTitle,
        ingestedAt: sf.uploadedAt || new Date().toISOString(),
        classification,
        prunedOffTopicSegmentsCount: Number(meta.prunedOffTopicSegmentsCount || 0),
        keptAutomotiveSegmentsCount: Number(meta.keptAutomotiveSegmentsCount || sf.unitCount || 1),
        estimatedTokensSaved: Number(meta.estimatedTokensSaved || 0),
        tokenSavingsPercent: Number(meta.tokenSavingsPercent || 0),
        summaryFa:
          typeof meta.preprocessSummaryFa === 'string' && meta.preprocessSummaryFa.trim().length > 0
            ? meta.preprocessSummaryFa
            : `استخراج موفق ${toPersianDigits(sf.unitCount)} واحد متنی (${toPersianDigits(sf.wordCount)} کلمه)`,
      };
    });
    const next = appendPersistentUploadHistoryEntries(syncedEntries);
    setInternalUploadHistory(next);
  }, [sourceFiles, activeProjectId, projects]);

  const effectiveUploadHistory = useMemo(() => {
    const base = uploadHistory && uploadHistory.length > 0 ? uploadHistory : internalUploadHistory;
    // Merge base with any extra entries in internalUploadHistory
    const byKey = new Map<string, PersistentUploadHistoryEntry>();
    for (const item of [...base, ...internalUploadHistory]) {
      const key = `${item.projectId || 'global'}:${item.fileName}:${item.classification}`;
      if (!byKey.has(key)) {
        byKey.set(key, item);
      }
    }
    return Array.from(byKey.values()).sort(
      (a, b) => new Date(b.ingestedAt).getTime() - new Date(a.ingestedAt).getTime()
    );
  }, [uploadHistory, internalUploadHistory]);

  const filteredUploadHistory = useMemo(() => {
    const q = uploadHistoryFilter.trim().toLowerCase();
    if (!q) return effectiveUploadHistory;
    return effectiveUploadHistory.filter(
      (item) =>
        item.fileName.toLowerCase().includes(q) ||
        item.projectTitle.toLowerCase().includes(q) ||
        item.format.toLowerCase().includes(q)
    );
  }, [effectiveUploadHistory, uploadHistoryFilter]);

  const totalTokensSavedInHistory = useMemo(
    () =>
      effectiveUploadHistory.reduce(
        (sum, item) => sum + (item.estimatedTokensSaved || 0),
        0
      ),
    [effectiveUploadHistory]
  );

  const queuedPreprocessSummary = useMemo(() => {
    let hybridCount = 0;
    let rejectedCount = 0;
    let totalPrunedBlocks = 0;
    let totalSavedTokens = 0;
    for (const qf of queuedFiles) {
      if (!qf.preprocessReport) continue;
      if (qf.preprocessReport.classification === 'mixed_hybrid_pruned') {
        hybridCount++;
      } else if (qf.preprocessReport.classification === 'rejected_non_automotive') {
        rejectedCount++;
      }
      totalPrunedBlocks += qf.preprocessReport.prunedOffTopicSegmentsCount || 0;
      totalSavedTokens += qf.preprocessReport.estimatedTokensSaved || 0;
    }
    return {
      hybridCount,
      rejectedCount,
      totalPrunedBlocks,
      totalSavedTokens,
    };
  }, [queuedFiles]);

  const handleClearUploadHistoryInternal = () => {
    savePersistentUploadHistory([]);
    setInternalUploadHistory([]);
    if (onClearUploadHistory) {
      onClearUploadHistory();
    }
  };

  const canRun = !processing && (queuedFiles.length > 0 || ingestedFilesCount > 0);
  const queuedBytesCount = queuedFiles.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);

  return (
    <aside className="w-full lg:w-[350px] xl:w-[375px] shrink-0 border-l border-[#E2DDD3] bg-[#FCFBF8] flex flex-col lg:h-[calc(100vh-58px)] lg:overflow-y-auto">
      <div className="p-4 space-y-5">
        {/* 0. Compact AI Token & Live Quota Gauge */}
        <AiQuotaGauge
          usage={aiUsage}
          ingestedFilesCount={ingestedFilesCount}
          queuedFilesCount={queuedFiles.length}
          ingestedWordCount={ingestedWordCount}
          queuedBytesCount={queuedBytesCount}
          chapterCount={chapterCount}
          aiModel={config.aiModel}
          googleSearchMode={config.googleSearchMode}
          useAiBackend={config.useAiBackend}
          providerConfig={providerConfig}
          probeData={probeData}
          probing={probingQuota}
          onRunLiveProbe={onRunLiveProbe}
          onOpenProviderSettings={onOpenProviderSettings}
        />

        {/* 1. Saved Projects */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#1A1816]">
              <FolderOpen className="h-4 w-4 text-[#1E3A5F]" />
              <span>پروژه‌های من ({toPersianDigits(projects.length)})</span>
            </div>
            <button
              type="button"
              onClick={() => onCreateProject(activeWorkflowMode)}
              disabled={processing}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-md bg-[#EEF3F8] px-2.5 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#DFE9F4] cursor-pointer"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              پروژه جدید
            </button>
          </div>

          {projects.length > 0 && (
            <div className="max-h-36 overflow-y-auto space-y-1.5 pl-0.5">
              {projects.map((p) => {
                const selected = p.id === activeProjectId;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                      selected
                        ? 'border-[#1E3A5F] bg-[#EEF3F8] text-[#1E3A5F]'
                        : 'border-[#E5E0D6] bg-white text-[#1A1816] hover:border-[#CFC8B9]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectProject(p.id)}
                      className="flex-1 min-w-0 text-right cursor-pointer"
                    >
                      <div className="truncate font-bold">{p.title}</div>
                      <div className="text-[10.5px] text-[#78716C] mt-0.5">
                        مرحله {toPersianDigits(p.pipelineStage)} از ۵
                      </div>
                    </button>
                    {projects.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteProject(p.id)}
                        aria-label={`حذف پروژه ${p.title}`}
                        className="p-1.5 rounded-md text-[#9A3412] hover:bg-[#FDF2F0] cursor-pointer shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 1.5 Full-Text Search in Stage 1 Extracted Files */}
        <SidebarContentSearch
          sourceFiles={sourceFiles}
          contentUnits={contentUnits}
          outlineNodes={outlineNodes}
          onJumpToResult={onJumpToSearchResult}
        />

        {/* 2. 4 Workflow Modes */}
        <section className="space-y-2 border-t border-[#EAE5DA] pt-4">
          <div className="text-xs font-bold text-[#1A1816]">۱. انتخاب سناریوی پردازش</div>
          <div className="grid grid-cols-2 gap-2">
            {WORKFLOW_MODES.map((m) => {
              const Icon = m.Icon;
              const active = activeWorkflowMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onChangeWorkflowMode(m.id)}
                  disabled={processing}
                  className={`rounded-lg border p-2.5 text-right transition-colors cursor-pointer ${
                    active
                      ? 'border-[#1E3A5F] bg-[#EEF3F8] text-[#1E3A5F]'
                      : 'border-[#E5E0D6] bg-white text-[#1A1816] hover:border-[#C9C1B2]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-[11.5px]">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{m.title}</span>
                  </div>
                  <p className="mt-1 text-[10.5px] leading-4 text-[#57534E] line-clamp-2">
                    {m.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        {/* 3. Multi-file Dropzone + Upload History Tab + Source Files Search & Diff View */}
        <section className="border-t border-[#EAE5DA] pt-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-[#1A1816]">
              ۲. فایل‌های ورودی ({activeWorkflowMode === 'master_update' ? 'مرجع + تکمیلی' : 'چندفایلی'})
            </div>
            {ingestedFilesCount > 0 && (
              <span className="text-[11px] font-semibold text-[#14532D] tabular-nums">
                {sourceFileFilter.trim()
                  ? `${toPersianDigits(filteredSourceFiles.length)} از ${toPersianDigits(sourceFiles.length)} فایل`
                  : `${toPersianDigits(ingestedFilesCount)} فایل ثبت‌شده`}
              </span>
            )}
          </div>

          {/* Segmented Tab Switcher: Active Queue & Files vs. Upload History across all sessions */}
          <div
            role="tablist"
            aria-label="تب‌های مدیریت فایل‌های ورودی و تاریخچه آپلود"
            data-testid="sidebar-files-tab-switcher"
            className="grid grid-cols-2 gap-1 rounded-lg border border-[#D8D2C5] bg-[#EFECE4] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={filesSectionTab === 'active_queue'}
              data-testid="sidebar-tab-active-files"
              onClick={() => setFilesSectionTab('active_queue')}
              className={`flex min-h-[34px] items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                filesSectionTab === 'active_queue'
                  ? 'bg-white text-[#1E3A5F] shadow-xs'
                  : 'text-[#57534E] hover:text-[#1A1816]'
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">صف و فایل‌ها ({toPersianDigits(queuedFiles.length + sourceFiles.length)})</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={filesSectionTab === 'upload_history'}
              data-testid="sidebar-upload-history-tab"
              title="Upload History — تاریخچه آپلود فایل‌ها در تمام نشست‌ها"
              onClick={() => setFilesSectionTab('upload_history')}
              className={`flex min-h-[34px] items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                filesSectionTab === 'upload_history'
                  ? 'bg-white text-[#1E3A5F] shadow-xs'
                  : 'text-[#57534E] hover:text-[#1A1816]'
              }`}
            >
              <History className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                تاریخچه آپلود ({toPersianDigits(effectiveUploadHistory.length)})
              </span>
            </button>
          </div>

          {filesSectionTab === 'upload_history' ? (
            /* Upload History Panel Across All Sessions */
            <div
              data-testid="sidebar-upload-history-panel"
              className="space-y-2.5 rounded-xl border border-[#D6D0C4] bg-white p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#1E3A5F]">
                    <History className="h-3.5 w-3.5 shrink-0" />
                    <span>تاریخچه فایل‌های ثبت‌شده (Upload History)</span>
                  </div>
                  <p className="mt-0.5 text-[10.5px] text-[#57534E] leading-4">
                    لاگ ماندگار تمام فایل‌های ورودی در همه نشست‌ها همراه با گزارش پیش‌پردازش فرمت و هرس بخش‌های غیرخودرویی.
                  </p>
                </div>
                {effectiveUploadHistory.length > 0 && (
                  <button
                    type="button"
                    data-testid="sidebar-upload-history-clear-btn"
                    onClick={handleClearUploadHistoryInternal}
                    className="shrink-0 rounded-md border border-[#E5E0D6] bg-[#FAF9F5] px-2 py-1 text-[10px] font-bold text-[#9A3412] hover:bg-[#FDF2F0] cursor-pointer"
                  >
                    پاک کردن تاریخچه
                  </button>
                )}
              </div>

              {totalTokensSavedInHistory > 0 && (
                <div
                  data-testid="sidebar-upload-history-token-savings"
                  className="flex items-center justify-between gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-2.5 py-1.5 text-[10.5px] font-semibold text-[#14532D]"
                >
                  <span className="flex items-center gap-1">
                    <Scissors className="h-3.5 w-3.5 shrink-0" />
                    <span>صرفه‌جویی پیش‌پردازش و هرس بخش‌های غیرمرتبط:</span>
                  </span>
                  <span className="font-mono font-bold">
                    {toPersianDigits(totalTokensSavedInHistory)} توکن
                  </span>
                </div>
              )}

              {effectiveUploadHistory.length > 0 && (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#78716C]"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    data-testid="sidebar-upload-history-search"
                    value={uploadHistoryFilter}
                    onChange={(e) => setUploadHistoryFilter(e.target.value)}
                    placeholder="جستجو در تاریخچه آپلود (نام فایل، پروژه، فرمت)..."
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] py-1.5 pr-8 pl-7 text-[11px] text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1E3A5F] focus:outline-none"
                  />
                  {uploadHistoryFilter.trim().length > 0 && (
                    <button
                      type="button"
                      onClick={() => setUploadHistoryFilter('')}
                      aria-label="پاک کردن جستجوی تاریخچه"
                      className="absolute left-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-[#78716C] hover:bg-[#EFECE4] cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}

              {filteredUploadHistory.length === 0 ? (
                <div
                  data-testid="sidebar-upload-history-empty"
                  className="rounded-lg border border-dashed border-[#D6D0C4] bg-[#FAF9F6] px-3 py-5 text-center text-[11px] text-[#57534E]"
                >
                  {effectiveUploadHistory.length === 0
                    ? 'هنوز فایلی در تاریخچه آپلودها ثبت نشده است. به‌محض استخراج فایل در مرحله ۱، گزارش کامل آن در اینجا ذخیره می‌شود.'
                    : `موردی با عبارت «${uploadHistoryFilter.trim()}» در تاریخچه یافت نشد.`}
                </div>
              ) : (
                <ul
                  data-testid="sidebar-upload-history-list"
                  className="max-h-72 overflow-y-auto space-y-2 pl-0.5"
                >
                  {filteredUploadHistory.map((entry) => {
                    const roleLabel =
                      entry.fileRole === 'master'
                        ? 'مرجع (Master)'
                        : entry.fileRole === 'supplement'
                          ? 'تکمیلی (Supplement)'
                          : 'استاندارد (Standard)';
                    const formattedDate = (() => {
                      try {
                        const d = new Date(entry.ingestedAt);
                        return d.toLocaleTimeString('fa-IR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                      } catch {
                        return '';
                      }
                    })();

                    return (
                      <li
                        key={entry.id}
                        data-testid="sidebar-upload-history-item"
                        data-history-classification={entry.classification}
                        className="rounded-lg border border-[#E5E0D6] bg-[#FCFBF8] p-2.5 text-xs space-y-1.5 hover:border-[#C9C1B2]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate font-bold text-[#1A1816]"
                              dir="auto"
                              title={entry.fileName}
                            >
                              {entry.fileName}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[#78716C] tabular-nums">
                              <span className="rounded bg-[#E9F0F8] px-1.5 py-0.5 font-mono font-bold text-[#1E3A5F]">
                                {String(entry.format).toUpperCase()}
                              </span>
                              <span className="rounded bg-[#EAE5DA] px-1.5 py-0.5 font-semibold text-[#44403C]">
                                {roleLabel}
                              </span>
                              {formattedDate && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Clock className="h-2.5 w-2.5" />
                                  {formattedDate}
                                </span>
                              )}
                            </div>
                          </div>

                          <span
                            className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                              entry.classification === 'rejected_non_automotive'
                                ? 'bg-[#FEF2F2] text-[#991B1B] border border-[#FCA5A5]'
                                : entry.classification === 'mixed_hybrid_pruned'
                                  ? 'bg-[#FFFBEB] text-[#92400E] border border-[#FCD34D]'
                                  : 'bg-[#F0FDF4] text-[#14532D] border border-[#BBF7D0]'
                            }`}
                          >
                            {entry.classification === 'rejected_non_automotive'
                              ? 'رد شده (غیرخودرویی)'
                              : entry.classification === 'mixed_hybrid_pruned'
                                ? 'هرس ترکیبی (Hybrid)'
                                : 'تأیید کامل خودرویی'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-1 text-[10.5px] text-[#57534E] tabular-nums">
                          <span className="truncate max-w-[180px]" title={entry.projectTitle}>
                            پروژه: <strong className="text-[#1A1816]">{entry.projectTitle}</strong>
                          </span>
                          <span>
                            {toPersianDigits(entry.unitCount)} واحد · {toPersianDigits(entry.wordCount)} کلمه
                            {entry.sizeBytes > 0 ? ` · ${formatCompactFileSize(entry.sizeBytes)}` : ''}
                          </span>
                        </div>

                        {(entry.classification === 'mixed_hybrid_pruned' ||
                          entry.estimatedTokensSaved > 0 ||
                          entry.summaryFa) && (
                          <div className="rounded border border-[#EAE5DA] bg-white px-2 py-1 text-[10px] leading-4 text-[#44403C]">
                            {entry.summaryFa}
                            {entry.estimatedTokensSaved > 0 && (
                              <span className="mr-1 font-bold text-[#14532D]">
                                (صرفه‌جویی {toPersianDigits(entry.estimatedTokensSaved)} توکن ·{' '}
                                {toPersianDigits(entry.tokenSavingsPercent)}٪)
                              </span>
                            )}
                          </div>
                        )}

                        {entry.projectId &&
                          entry.projectId !== activeProjectId &&
                          projects.some((p) => p.id === entry.projectId) && (
                            <div className="pt-0.5 flex justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectProject(entry.projectId!);
                                  setFilesSectionTab('active_queue');
                                }}
                                className="text-[10.5px] font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                              >
                                باز کردن این پروژه ←
                              </button>
                            </div>
                          )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <>
              {/* Live Pre-Ingest Format-Specific Preprocessing & Hybrid Pruning Summary Banner */}
              {(queuedPreprocessSummary.hybridCount > 0 ||
                queuedPreprocessSummary.rejectedCount > 0 ||
                queuedPreprocessSummary.totalSavedTokens > 0) && (
                <div
                  data-testid="sidebar-preprocess-summary-card"
                  className={`rounded-lg border p-2.5 text-[11px] leading-5 space-y-1 ${
                    queuedPreprocessSummary.rejectedCount > 0
                      ? 'border-[#FCA5A5] bg-[#FEF2F2] text-[#991B1B]'
                      : 'border-[#FCD34D] bg-[#FFFBEB] text-[#92400E]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-bold">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                      <span>گزارش پیش‌پردازش هوشمند فایل‌های ورودی (۰ توکن)</span>
                    </span>
                    {queuedPreprocessSummary.totalSavedTokens > 0 && (
                      <span className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-[10px] text-[#14532D]">
                        صرفه‌جویی {toPersianDigits(queuedPreprocessSummary.totalSavedTokens)} توکن
                      </span>
                    )}
                  </div>
                  {queuedPreprocessSummary.hybridCount > 0 && (
                    <p>
                      • <strong>{toPersianDigits(queuedPreprocessSummary.hybridCount)} فایل ترکیبی (Hybrid):</strong>{' '}
                      {toPersianDigits(queuedPreprocessSummary.totalPrunedBlocks)} بخش غیرخودرویی به‌صورت جراحی حذف شد و ۱۰۰٪ بخش‌های خودرویی، جداول، کدهای هگز و DTC حفظ گردید.
                    </p>
                  )}
                  {queuedPreprocessSummary.rejectedCount > 0 && (
                    <p>
                      • <strong>{toPersianDigits(queuedPreprocessSummary.rejectedCount)} فایل غیرمرتبط با خودرو:</strong>{' '}
                      فاقد هرگونه کلیدواژه فنی خودرو/ECU است و در لایه ۰ بدون مصرف توکن رد می‌شود.
                    </p>
                  )}
                </div>
              )}

              {/* Source Files Name Filter Search Bar */}
              {(sourceFiles.length > 0 || queuedFiles.length > 0) && (
            <div className="relative" data-testid="sidebar-source-file-search-wrapper">
              <label htmlFor="sidebar-source-file-filter-input" className="sr-only">
                جستجو و فیلتر فایل‌های منبع پروژه بر اساس نام
              </label>
              <Search
                className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#78716C]"
                aria-hidden="true"
              />
              <input
                id="sidebar-source-file-filter-input"
                data-testid="sidebar-source-file-search"
                type="text"
                value={sourceFileFilter}
                onChange={(e) => setSourceFileFilter(e.target.value)}
                placeholder="جستجوی نام فایل منبع در این پروژه..."
                className="w-full rounded-lg border border-[#D6D0C4] bg-white py-1.5 pr-8 pl-8 text-xs text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1E3A5F] focus:outline-none"
              />
              {sourceFileFilter.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setSourceFileFilter('')}
                  aria-label="پاک کردن فیلتر نام فایل"
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-[#78716C] hover:bg-[#EFECE4] hover:text-[#1A1816] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Filtered Project Source Files List */}
          {sourceFiles.length > 0 && (
            filteredSourceFiles.length === 0 ? (
              <div
                data-testid="sidebar-source-files-empty"
                className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E0D6] bg-white px-3 py-2 text-[11px] text-[#57534E]"
              >
                <span className="truncate">
                  فایلی با نام «{sourceFileFilter.trim()}» یافت نشد.
                </span>
                <button
                  type="button"
                  onClick={() => setSourceFileFilter('')}
                  className="shrink-0 font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                >
                  پاک کردن
                </button>
              </div>
            ) : (
              <ul
                data-testid="sidebar-source-files-list"
                className="max-h-40 overflow-y-auto space-y-1.5 pl-0.5"
              >
                {filteredSourceFiles.map(({ item: sf, nameSegments }) => (
                  <li
                    key={sf.id}
                    data-testid="sidebar-source-file-item"
                    className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E0D6] bg-white px-2.5 py-2 text-xs transition-colors hover:border-[#CFC8B9]"
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate font-bold text-[#1A1816]"
                        dir="auto"
                        title={sf.fileName}
                      >
                        {nameSegments.map((seg, idx) =>
                          seg.matched ? (
                            <mark
                              key={idx}
                              className="rounded-xs bg-[#FEF3C7] px-0.5 text-[#1A1816]"
                            >
                              {seg.text}
                            </mark>
                          ) : (
                            <React.Fragment key={idx}>{seg.text}</React.Fragment>
                          )
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-[#78716C] tabular-nums">
                        <span className="font-mono font-semibold text-[#1E3A5F]">
                          {sf.format.toUpperCase()}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{toPersianDigits(sf.wordCount)} کلمه</span>
                        <span aria-hidden="true">·</span>
                        <span>{toPersianDigits(sf.unitCount)} واحد</span>
                        {sf.sizeBytes > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{formatCompactFileSize(sf.sizeBytes)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setRequestedDiffFileId(sf.id)}
                      aria-label={`مقایسه فایل ${sf.fileName}`}
                      title="مشاهده مقایسه نسخه منبع و نسخه ثبت‌شده (Diff View)"
                      className="inline-flex min-h-[30px] shrink-0 items-center gap-1 rounded-md border border-[#DDE6F0] bg-[#F5F8FC] px-2 py-1 text-[10.5px] font-bold text-[#1E3A5F] hover:border-[#1E3A5F] hover:bg-[#E9F0F8] cursor-pointer whitespace-nowrap"
                    >
                      <FileDiff className="h-3 w-3 shrink-0" />
                      <span>مقایسه</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {activeWorkflowMode === 'master_update' && (
            <p className="mt-1 text-[11px] text-[#57534E] leading-5">
              روی برچسب هر فایل بزنید یا از پنل عملیات گروهی زیر، «نقش فایل (File Role)» را برای چند فایل انتخاب‌شده یک‌جا تعیین کنید.
            </p>
          )}
          <AutomotiveConsentBanner
            accepted={automotiveConsentAccepted}
            onChangeAccepted={handleToggleAutomotiveConsent}
            compact
          />

          {/* Bulk-Action Panel for Assigning File Role + Queue Progress Summary */}
          {queuedFiles.length > 0 && (
            <div
              data-testid="sidebar-bulk-role-panel"
              className="rounded-lg border border-[#D6D0C4] bg-[#FAF9F5] p-2.5 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#1A1816] cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="sidebar-bulk-select-all"
                    checked={
                      queuedFiles.length > 0 &&
                      selectedQueueIds.length === queuedFiles.length
                    }
                    onChange={handleSelectAllQueuedFiles}
                    className="h-3.5 w-3.5 accent-[#1E3A5F] cursor-pointer"
                  />
                  <span>
                    عملیات گروهی نقش فایل (File Role) ·{' '}
                    <span className="text-[#1E3A5F]">
                      {toPersianDigits(selectedQueueIds.length)} از{' '}
                      {toPersianDigits(queuedFiles.length)} انتخاب‌شده
                    </span>
                  </span>
                </label>

                {selectedQueueIds.length > 0 && (
                  <button
                    type="button"
                    data-testid="sidebar-bulk-clear-selection"
                    onClick={() => setSelectedQueueIds([])}
                    className="text-[10.5px] font-semibold text-[#78716C] hover:text-[#1A1816] cursor-pointer"
                  >
                    لغو انتخاب
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  data-testid="sidebar-bulk-role-select"
                  aria-label="انتخاب نقش فایل برای اعمال گروهی"
                  value={bulkTargetRole}
                  onChange={(e) => setBulkTargetRole(e.target.value as FileRole)}
                  className="flex-1 min-w-[130px] rounded-md border border-[#D6D0C4] bg-white px-2 py-1.5 text-[11px] font-semibold text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
                >
                  <option value="supplement">فایل تکمیلی (Supplement)</option>
                  <option value="standard">استاندارد (Standard)</option>
                  <option value="master">سند مرجع (Master)</option>
                </select>

                <button
                  type="button"
                  data-testid="sidebar-bulk-apply-role-btn"
                  disabled={selectedQueueIds.length === 0}
                  onClick={() => handleApplyBulkFileRole(bulkTargetRole)}
                  className="inline-flex min-h-[30px] items-center justify-center rounded-md bg-[#1E3A5F] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#162C49] disabled:opacity-45 cursor-pointer whitespace-nowrap"
                >
                  اعمال نقش به انتخاب‌شده‌ها ({toPersianDigits(selectedQueueIds.length)})
                </button>
              </div>

              {/* Quick 1-click preset role buttons for selected files */}
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                <button
                  type="button"
                  data-testid="sidebar-bulk-quick-supplement"
                  disabled={selectedQueueIds.length === 0}
                  onClick={() => handleApplyBulkFileRole('supplement')}
                  className="rounded border border-[#D6D0C4] bg-white px-2 py-0.5 text-[10px] font-bold text-[#44403C] hover:bg-[#EFECE4] disabled:opacity-45 cursor-pointer"
                >
                  تبدیل به تکمیلی
                </button>
                <button
                  type="button"
                  data-testid="sidebar-bulk-quick-standard"
                  disabled={selectedQueueIds.length === 0}
                  onClick={() => handleApplyBulkFileRole('standard')}
                  className="rounded border border-[#D6D0C4] bg-white px-2 py-0.5 text-[10px] font-bold text-[#44403C] hover:bg-[#EFECE4] disabled:opacity-45 cursor-pointer"
                >
                  تبدیل به استاندارد
                </button>
                <button
                  type="button"
                  data-testid="sidebar-bulk-quick-master"
                  disabled={selectedQueueIds.length === 0}
                  onClick={() => handleApplyBulkFileRole('master')}
                  className="rounded border border-[#1E3A5F] bg-[#EEF3F8] px-2 py-0.5 text-[10px] font-bold text-[#1E3A5F] hover:bg-[#DFE9F4] disabled:opacity-45 cursor-pointer"
                >
                  تعیین به‌عنوان مرجع (Master)
                </button>
              </div>
            </div>
          )}

          <FileDropzone
            queuedFiles={queuedFiles}
            onAddFiles={onAddFiles}
            onRemoveFile={onRemoveFile}
            onMoveFile={onMoveFile}
            onClearFiles={onClearFiles}
            showRoleSelector={activeWorkflowMode === 'master_update'}
            onSetFileRole={onSetFileRole}
            selectedFileIds={selectedQueueIds}
            onToggleSelectFile={handleToggleSelectQueuedFile}
            disabled={processing || !automotiveConsentAccepted}
            sourceFiles={sourceFiles}
            contentUnits={contentUnits}
            fileNameFilter={sourceFileFilter}
            requestedDiffFileId={requestedDiffFileId}
            onClearDiffRequest={() => setRequestedDiffFileId(null)}
          />
            </>
          )}
        </section>

        {/* 4. Primary Stage-1 CTA (Single Responsibility: Ingest & Extract Only) */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onStartPipeline}
            disabled={!canRun}
            className="w-full min-h-[46px] flex items-center justify-center gap-2 rounded-xl bg-[#1E3A5F] hover:bg-[#162C49] text-white font-bold text-sm transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                در حال استخراج فایل‌ها (مرحله ۱)...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                {queuedFiles.length > 0
                  ? `مرحله ۱: استخراج و ثبت فایل‌ها (${toPersianDigits(queuedFiles.length)})`
                  : 'باز کردن گام بعدی ورک‌فلو'}
              </>
            )}
          </button>
          <p className="text-[10.5px] leading-4 text-[#78716C] text-center">
            هر مرحله جداگانه اجرا می‌شود: ابتدا استخراج فایل‌ها، سپس ممیزی و ادغام، سپس فصل‌بندی و صفحه‌آرایی.
          </p>
        </div>

        {/* 5. AI Model, Modular Visuals & Isolated Google Search Settings */}
        <section className="border-t border-[#EAE5DA] pt-3 space-y-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-bold text-[#1A1816] py-1 cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#1E3A5F]" />
              تنظیمات مدل هوش مصنوعی، صفحه‌آرایی و جستجوی گوگل
            </span>
            <span className="text-[11px] text-[#1E3A5F]">
              {showAdvanced ? 'بستن' : 'نمایش'}
            </span>
          </button>

          {showAdvanced && (
            <div className="space-y-3.5 rounded-xl border border-[#E5E0D6] bg-white p-3.5 text-xs">
              {/* Provider & Custom Base URL / API Key Button */}
              {(() => {
                const summary = getProviderDisplaySummary(providerConfig, config.aiModel);
                const activeProviderMeta = AI_PROVIDER_METADATA[providerConfig.provider];
                const activeProviderEntry = providerConfig.providers[providerConfig.provider];
                const currentModelId =
                  providerConfig.provider === 'google_aistudio'
                    ? config.aiModel || activeProviderEntry?.modelId || 'gemini-4-neon'
                    : activeProviderEntry?.modelId || activeProviderMeta.defaultModelId;
                const isBuiltInNeonQuota =
                  providerConfig.provider === 'google_aistudio' &&
                  providerConfig.googleKeyMode !== 'personal' &&
                  !activeProviderEntry?.apiKey?.trim();

                return (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-[#DDE6F0] bg-[#F5F8FC] px-2.5 py-2">
                      <div className="min-w-0">
                        <div className="font-bold text-[#1E3A5F] truncate">
                          {summary.providerLabel} · {summary.keySourceLabel}
                        </div>
                        <div className="text-[10.5px] text-[#57534E] truncate">
                          مدل فعال: <strong className="font-mono text-[#1E3A5F]" dir="ltr">{currentModelId}</strong>
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="sidebar-open-provider-modal-btn"
                        onClick={onOpenProviderSettings}
                        className="inline-flex min-h-[30px] shrink-0 items-center gap-1 rounded-md border border-[#1E3A5F] bg-white px-2.5 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                      >
                        <KeyRound className="h-3 w-3" />
                        <span>کلید و API</span>
                      </button>
                    </div>

                    {isBuiltInNeonQuota && (
                      <div
                        data-testid="sidebar-builtin-neon-quota-badge"
                        className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-2.5 py-1.5 text-[10.5px] leading-5 text-[#14532D]"
                      >
                        <strong>سهمیه داخلی پلتفرم فعال است (Gemini 4 Neon):</strong> تا پایان آپلود و پایداری فایل‌های شما، هیچ کلید API خارجی مصرف نمی‌شود. در هر زمان می‌توانید هر مدل، پرووایدر یا API دلخواه را از منوی زیر انتخاب کنید.
                      </div>
                    )}

                    {/* Quick Provider Switcher (Any Provider / Gateway) */}
                    {onChangeProviderConfig && (
                      <div className="space-y-1">
                        <label
                          htmlFor="sidebar-ai-provider-select"
                          className="block font-bold text-[#1A1816]"
                        >
                          ارائه‌دهنده هوش مصنوعی (Provider / API)
                        </label>
                        <select
                          id="sidebar-ai-provider-select"
                          data-testid="sidebar-ai-provider-select"
                          value={providerConfig.provider}
                          onChange={(e) => {
                            const nextProvider = e.target.value as AiProviderType;
                            const nextMeta = AI_PROVIDER_METADATA[nextProvider];
                            const existingCreds = providerConfig.providers[nextProvider];
                            const nextModel =
                              existingCreds?.modelId?.trim() || nextMeta.defaultModelId;
                            onChangeProviderConfig({
                              ...providerConfig,
                              provider: nextProvider,
                              providers: {
                                ...providerConfig.providers,
                                [nextProvider]: {
                                  baseUrl: existingCreds?.baseUrl || nextMeta.defaultBaseUrl,
                                  apiKey: existingCreds?.apiKey || '',
                                  modelId: nextModel,
                                },
                              },
                            });
                            if (nextProvider === 'google_aistudio') {
                              onChangeConfig({ aiModel: nextModel as AiModelId });
                            }
                          }}
                          className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-xs text-[#1A1816]"
                        >
                          {AI_PROVIDER_LIST.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nameFa}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Preset Model Selector + Universal Custom Model ID Input */}
                    <div className="space-y-1.5">
                      <label
                        htmlFor="sidebar-ai-model-preset-select"
                        className="block font-bold text-[#1A1816]"
                      >
                        انتخاب مدل آماده یا ورود آزاد هر شناسه مدل (Model ID)
                      </label>
                      {providerConfig.provider === 'google_aistudio' ? (
                        <select
                          id="sidebar-ai-model-preset-select"
                          data-testid="sidebar-ai-model-preset-select"
                          value={
                            GOOGLE_MODEL_OPTIONS.some((m) => m.id === config.aiModel)
                              ? config.aiModel
                              : 'gemini-4-neon'
                          }
                          onChange={(e) => {
                            const nextModel = e.target.value as AiModelId;
                            onChangeConfig({ aiModel: nextModel });
                            if (onChangeProviderConfig) {
                              onChangeProviderConfig({
                                ...providerConfig,
                                providers: {
                                  ...providerConfig.providers,
                                  google_aistudio: {
                                    ...providerConfig.providers.google_aistudio,
                                    modelId: nextModel,
                                  },
                                },
                              });
                            }
                          }}
                          className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-xs text-[#1A1816]"
                        >
                          {GOOGLE_MODEL_OPTIONS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.labelFa}
                            </option>
                          ))}
                        </select>
                      ) : (
                        activeProviderMeta.presets &&
                        activeProviderMeta.presets.length > 0 && (
                          <select
                            id="sidebar-ai-model-preset-select"
                            data-testid="sidebar-ai-model-preset-select"
                            value={currentModelId}
                            onChange={(e) => {
                              const nextModel = e.target.value;
                              if (onChangeProviderConfig) {
                                onChangeProviderConfig({
                                  ...providerConfig,
                                  customModelId: nextModel,
                                  providers: {
                                    ...providerConfig.providers,
                                    [providerConfig.provider]: {
                                      ...providerConfig.providers[providerConfig.provider],
                                      modelId: nextModel,
                                    },
                                  },
                                });
                              }
                            }}
                            className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-xs text-[#1A1816]"
                          >
                            {activeProviderMeta.presets.map((preset) => (
                              <option key={preset.modelId} value={preset.modelId}>
                                {preset.label} ({preset.modelId})
                              </option>
                            ))}
                          </select>
                        )
                      )}

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          dir="ltr"
                          data-testid="sidebar-custom-model-id-input"
                          value={currentModelId}
                          onChange={(e) => {
                            const nextId = e.target.value.trim();
                            if (providerConfig.provider === 'google_aistudio') {
                              onChangeConfig({ aiModel: (nextId || 'gemini-4-neon') as AiModelId });
                            }
                            if (onChangeProviderConfig) {
                              onChangeProviderConfig({
                                ...providerConfig,
                                customModelId: nextId,
                                providers: {
                                  ...providerConfig.providers,
                                  [providerConfig.provider]: {
                                    ...providerConfig.providers[providerConfig.provider],
                                    modelId: nextId,
                                  },
                                },
                              });
                            }
                          }}
                          placeholder="شناسه هر مدل دلخواه (مثلاً gemini-4-neon، claude-opus-5-5، gpt-6.2-sol...)"
                          className="w-full rounded-lg border border-[#D6D0C4] bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Thinking level */}
              {providerConfig.provider === 'google_aistudio' && (
                <div className="space-y-1.5">
                  <label className="block font-bold text-[#1A1816]">سطح دقت و استدلال</label>
                  <select
                    value={config.aiThinkingLevel}
                    onChange={(e) =>
                      onChangeConfig({ aiThinkingLevel: e.target.value as AiThinkingLevel })
                    }
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-xs text-[#1A1816]"
                  >
                    <option value="HIGH">بالا (HIGH — پیش‌فرض)</option>
                    <option value="MEDIUM">متوسط (MEDIUM)</option>
                    <option value="LOW">پایین (LOW)</option>
                    {(config.aiModel === 'gemini-4-neon' ||
                      config.aiModel === 'gemini-4-carbon' ||
                      config.aiModel === 'gemini-4-argon' ||
                      config.aiModel === 'gemini-4-hydrogen') && (
                      <option value="XHIGH">بسیار عمیق (XHIGH)</option>
                    )}
                  </select>
                </div>
              )}

              {/* Isolated Google Search Mode */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 font-bold text-[#5B21B6]">
                  <Globe className="h-3.5 w-3.5" />
                  جستجوی گوگل (ایزوله با لینک منبع)
                </label>
                <select
                  value={config.googleSearchMode}
                  onChange={(e) =>
                    onChangeConfig({ googleSearchMode: e.target.value as GoogleSearchMode })
                  }
                  className="w-full rounded-lg border border-[#D7CBE6] bg-[#F7F4FA] px-2.5 py-2 text-xs text-[#1A1816]"
                >
                  <option value="off">خاموش (فقط متن فایل‌های کاربر)</option>
                  <option value="conflicts_only">فقط برای راستی‌آزمایی تناقض‌ها (پیش‌فرض)</option>
                  <option value="conflicts_and_enrichment">
                    تناقض‌ها + باکس تکمیلی وب برای فصل‌های کلیدی
                  </option>
                  <option value="full_document_enrichment">
                    تکمیل جامع کل متن خروجی با گوگل (تمام فصل‌ها)
                  </option>
                </select>
                {config.googleSearchMode === 'full_document_enrichment' && (
                  <p className="text-[10.5px] leading-5 text-[#5B21B6]">
                    در زمان ساخت نهایی، همه فصل‌ها با جستجوی گوگل و لینک منابع معتبر در باکس‌های مجزا تکمیل می‌شوند (بدون تغییر یا حذف متن فایل‌های اصلی شما).
                  </p>
                )}
              </div>

              {/* Bounded AI Editorial Control: Rewrite Intensity, Output Tone & Custom Prompt */}
              <div className="space-y-2.5 border-t border-[#EFECE4] pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-bold text-[#1A1816]">
                    <Wand2 className="h-3.5 w-3.5 text-[#1E3A5F]" />
                    میزان بازنویسی هوش مصنوعی و لحن خروجی
                  </span>
                </div>

                {/* 3-Tier Rewrite Level Segmented Control */}
                <div className="space-y-1">
                  <span className="block text-[11px] font-semibold text-[#44403C]">
                    حد مجاز تغییر متن توسط AI
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    {AI_REWRITE_LEVEL_OPTIONS.map((opt) => {
                      const active = (config.aiRewriteLevel || 'light_polish') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            onChangeConfig({ aiRewriteLevel: opt.id as AiRewriteLevel })
                          }
                          className={`rounded-md border px-1.5 py-1.5 text-[10.5px] font-bold transition-colors cursor-pointer ${
                            active
                              ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                              : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#44403C] hover:bg-[#EFECE4]'
                          }`}
                        >
                          {opt.shortLabelFa}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10.5px] leading-5 text-[#57534E]">
                    {
                      (
                        AI_REWRITE_LEVEL_OPTIONS.find(
                          (o) => o.id === (config.aiRewriteLevel || 'light_polish')
                        ) || AI_REWRITE_LEVEL_OPTIONS[1]
                      ).descriptionFa
                    }
                  </p>
                </div>

                {/* Output Tone Selector */}
                <div className="space-y-1">
                  <label
                    htmlFor="sidebar-output-tone"
                    className="block text-[11px] font-semibold text-[#44403C]"
                  >
                    لحن و سبک نگارش سند نهایی
                  </label>
                  <select
                    id="sidebar-output-tone"
                    value={config.outputTone || 'workshop_practical'}
                    onChange={(e) =>
                      onChangeConfig({ outputTone: e.target.value as OutputTonePreset })
                    }
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-[11.5px] text-[#1A1816]"
                  >
                    {OUTPUT_TONE_OPTIONS.map((tone) => (
                      <option key={tone.id} value={tone.id}>
                        {tone.labelFa}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Custom User Style Prompt + Quick Presets */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="sidebar-custom-style-prompt"
                    className="block text-[11px] font-semibold text-[#44403C]"
                  >
                    پرامپت و دستورالعمل اختصاصی خروجی
                  </label>
                  <textarea
                    id="sidebar-custom-style-prompt"
                    rows={3}
                    value={config.customStylePrompt || ''}
                    onChange={(e) => onChangeConfig({ customStylePrompt: e.target.value })}
                    placeholder="مثلاً: با لحن استاد کارگاهی بنویس، بعد از هر مپ WinOLS نکته ایمنی ناک بگذار و اعداد را تغییر نده..."
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-[11px] leading-5 text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1E3A5F] focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-1">
                    {QUICK_CUSTOM_PROMPT_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onChangeConfig({ customStylePrompt: preset.promptText })}
                        className="rounded border border-[#D6D0C4] bg-white px-2 py-1 text-[10px] font-semibold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                      >
                        + {preset.labelFa}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Built-in Universal System Prompt Constitution (always active on every uploaded file) */}
                <details className="rounded-lg border border-[#E2DDD2] bg-[#FAF9F6] px-2.5 py-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-bold text-[#1E3A5F]">
                    <span>قوانین سیستمی پایه (همیشه فعال برای همه فایل‌ها)</span>
                    <span className="rounded bg-[#E6EDF5] px-1.5 py-0.5 text-[10px] font-semibold text-[#1E3A5F]">
                      {toPersianDigits(UNIVERSAL_SYSTEM_PROMPT_RULES.length)} قانون
                    </span>
                  </summary>
                  <ul className="mt-2 space-y-1.5 border-t border-[#EAE5DA] pt-2 text-[10.5px] leading-5 text-[#44403C]">
                    {UNIVERSAL_SYSTEM_PROMPT_RULES.map((rule) => (
                      <li key={rule.id} className="flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0 font-bold text-[#1E3A5F]">
                          {toPersianDigits(rule.order)}.
                        </span>
                        <span>
                          <strong className="text-[#1A1816]">{rule.titleFa}:</strong>{' '}
                          {rule.summaryFa}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>

              {/* Modular Visual & Word Toggles */}
              <div className="space-y-2 border-t border-[#EFECE4] pt-2.5">
                <div className="flex items-center gap-1.5 font-bold text-[#1A1816]">
                  <FileText className="h-3.5 w-3.5 text-[#1E3A5F]" />
                  خروجی ورد و غنی‌سازی بصری
                </div>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>تولید خودکار جدول راهنمای تغییرات WinOLS</span>
                  <input
                    type="checkbox"
                    checked={config.includeWinolsActionTables !== false}
                    onChange={(e) =>
                      onChangeConfig({ includeWinolsActionTables: e.target.checked })
                    }
                    className="h-4 w-4 accent-[#1E3A5F]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>فهرست مطالب خودکار (Word TOC)</span>
                  <input
                    type="checkbox"
                    checked={config.includeAutoToc}
                    onChange={(e) => onChangeConfig({ includeAutoToc: e.target.checked })}
                    className="h-4 w-4 accent-[#1E3A5F]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>تولید خودکار نمودارهای SVG/PNG داخلی</span>
                  <input
                    type="checkbox"
                    checked={config.optimization.embedGeneratedTablesAndDiagrams}
                    onChange={(e) =>
                      onChangeOptimization({
                        embedGeneratedTablesAndDiagrams: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-[#1E3A5F]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>پیشنهادهای تصویر و جدول آموزشی</span>
                  <input
                    type="checkbox"
                    checked={config.includeVisualSuggestions}
                    onChange={(e) =>
                      onChangeConfig({ includeVisualSuggestions: e.target.checked })
                    }
                    className="h-4 w-4 accent-[#1E3A5F]"
                  />
                </label>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span>فونت ورد</span>
                  <select
                    value={config.fontFamily}
                    onChange={(e) =>
                      onChangeConfig({
                        fontFamily: e.target.value as DocxExportConfig['fontFamily'],
                      })
                    }
                    className="rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2 py-1 text-[11px]"
                  >
                    <option value="Vazir Medium">Vazir Medium (پیش‌فرض)</option>
                    <option value="Vazirmatn Medium">Vazirmatn Medium</option>
                    <option value="B Nazanin">B Nazanin</option>
                  </select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>تراز متن بدنه ورد</span>
                  <select
                    value={config.bodyAlignment ?? 'both'}
                    onChange={(e) =>
                      onChangeConfig({
                        bodyAlignment: e.target.value as 'both' | 'right',
                      })
                    }
                    className="rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2 py-1 text-[11px]"
                  >
                    <option value="both">تراز دوطرفه کتابی (پیشنهادی)</option>
                    <option value="right">راست‌چین ساده</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
