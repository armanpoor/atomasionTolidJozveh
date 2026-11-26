import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  Download,
  FolderOpen,
  Globe,
  Grid2x2,
  History,
  ListTree,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Menu,
  Printer,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { AuthGate } from './components/AuthGate';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { PipelineStepper } from './components/PipelineStepper';
import { OutlineEditorView } from './components/OutlineEditorView';
import { AuditConflictsView } from './components/AuditConflictsView';
import { StageExportView, StageIngestView } from './components/WorkflowStageViews';
import { ProjectsDashboardWidget } from './components/ProjectsDashboardWidget';
import { AssistantDrawer } from './components/AssistantDrawer';
import { BookPreview } from './components/BookPreview';
import {
  DeepReviewPanel,
  DeepReviewProgressState,
} from './components/DeepReviewPanel';
import { WinolsMapWorkbench } from './components/WinolsMapWorkbench';
import { AiProviderModal } from './components/AiProviderModal';
import { ProjectChangeLogModal } from './components/ProjectChangeLogModal';
import { GoogleWorkspaceModal } from './components/GoogleWorkspaceModal';
import { PrintPreviewModal } from './components/PrintPreviewModal';
import { ChapterSidebar, SelectedChapterKey } from './components/ChapterSidebar';
import { QueuedUploadFile } from './components/FileDropzone';
import { useHarnessRunner } from './hooks/useHarnessRunner';
import { ApiClient } from './lib/apiClient';
import {
  extractWinolsMapGuides,
  WinolsExtractionReport,
} from './lib/winolsMapGuide';
import type { ProjectRevisionDto } from './lib/changeLogUtils';
import {
  AiModelId,
  ChatProposal,
  DEFAULT_DOCX_CONFIG,
  DeepReviewReportDto,
  DocxExportConfig,
  FileRole,
  OutlineNodeDto,
  ProjectBundleDto,
  ProjectSummaryDto,
  ValidationDomain,
  WorkflowMode,
} from './lib/bookTypes';
import {
  AiProviderConfig,
  AiQuotaProbeResponse,
  DEFAULT_AI_PROVIDER_CONFIG,
  getProviderDisplaySummary,
  resolveCapabilityRoutingPlan,
} from './lib/aiProviderConfig';
import {
  BOOK_WORKFLOW_STAGES,
  BookWorkflowStageId,
  computeWorkflowProgress,
} from './lib/bookWorkflow';
import { generateDocxBlob } from './lib/docxGenerator';
import { extractAiUsageFromCheckpoint } from './lib/aiUsageMetrics';
import { normalizeDeepReviewReport } from './lib/deepReviewStream';
import {
  detectFileFormat,
  exportBookToMarkdown,
  toPersianDigits,
} from './lib/formatParsers';
import {
  FirestoreProjectLiveState,
  subscribeProjectLiveState,
  upsertProjectLiveState,
} from './lib/firebase';

function makeSafeFileName(title: string, ext: 'docx' | 'md'): string {
  const safeBase = title
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 64);
  return `${safeBase || 'Persian_Unified_Document'}_VazirMedium_RTL.${ext}`;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function App() {
  const {
    user,
    isGuest,
    loading: authLoading,
    signingIn,
    workspaceAccessToken,
    hasWorkspaceAccess,
    signInWithGoogle,
    connectGoogleWorkspace,
    signOut,
    getIdToken,
  } = useAuth();

  // Keep user's optional personal / custom API keys strictly in session memory (never persisted)
  const [providerConfig, setProviderConfig] = useState<AiProviderConfig>(
    DEFAULT_AI_PROVIDER_CONFIG
  );
  const providerConfigRef = useRef<AiProviderConfig>(providerConfig);
  providerConfigRef.current = providerConfig;

  const api = useMemo(
    () => new ApiClient(getIdToken, () => providerConfigRef.current),
    [getIdToken]
  );

  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ProjectBundleDto | null>(null);
  const [liveState, setLiveState] = useState<FirestoreProjectLiveState | null>(null);

  const [activeStage, setActiveStage] = useState<BookWorkflowStageId>(1);
  const [selectedView, setSelectedView] = useState<SelectedChapterKey>({ kind: 'cover' });
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [winolsWorkbenchOpen, setWinolsWorkbenchOpen] = useState(false);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  const [revisions, setRevisions] = useState<ProjectRevisionDto[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [revisionsError, setRevisionsError] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [savingCheckpoint, setSavingCheckpoint] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [googleWorkspaceModalOpen, setGoogleWorkspaceModalOpen] = useState(false);
  const [googleWorkspaceInitialTab, setGoogleWorkspaceInitialTab] = useState<'import' | 'export'>('import');
  const [showDashboardOverview, setShowDashboardOverview] = useState(false);
  const [highlightedOutlineNodeId, setHighlightedOutlineNodeId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileChaptersOpen, setMobileChaptersOpen] = useState(false);

  const [queuedFiles, setQueuedFiles] = useState<QueuedUploadFile[]>([]);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('multi_merge');
  const [config, setConfig] = useState<DocxExportConfig>(DEFAULT_DOCX_CONFIG);

  const handleHarnessBundleUpdated = useCallback(
    (nextBundle: ProjectBundleDto, nextRevisions?: ProjectRevisionDto[]) => {
      setBundle(nextBundle);
      if (Array.isArray(nextRevisions)) {
        setRevisions(nextRevisions);
      }
    },
    []
  );

  const harnessRunner = useHarnessRunner({
    api,
    bundle,
    ownerUid: user?.uid || null,
    onBundleUpdated: handleHarnessBundleUpdated,
    onSyncCompleteNavigateStage4: () => setActiveStage(4),
  });

  const [quotaProbe, setQuotaProbe] = useState<AiQuotaProbeResponse | null>(null);
  const [probingQuota, setProbingQuota] = useState(false);
  const lastAutoProbedProjectRef = useRef<string | null>(null);

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcribingAudio, setTranscribingAudio] = useState(false);
  const [savingOutline, setSavingOutline] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [groundingNodeId, setGroundingNodeId] = useState<string | null>(null);
  const [enrichingFullGoogle, setEnrichingFullGoogle] = useState(false);
  const [runningDeepReview, setRunningDeepReview] = useState(false);
  const [deepReviewProgress, setDeepReviewProgress] = useState<DeepReviewProgressState | null>(null);
  const [deepReviewReport, setDeepReviewReport] = useState<DeepReviewReportDto | null>(null);
  const [groundingConflictId, setGroundingConflictId] = useState<string | null>(null);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(null);
  const [rescanningConflicts, setRescanningConflicts] = useState(false);

  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerToast, setBannerToast] = useState<string | null>(null);
  const pauseRequestedRef = useRef(false);

  // Sync Firestore real-time state for active project (skipped in Guest Mode — no Firebase Auth session)
  useEffect(() => {
    if (!user?.uid || !activeProjectId || isGuest) {
      setLiveState(null);
      return;
    }
    const unsub = subscribeProjectLiveState(user.uid, activeProjectId, (st) => {
      setLiveState(st);
    });
    return () => unsub();
  }, [user?.uid, activeProjectId, isGuest]);

  const syncFirestoreJobState = useCallback(
    async (
      projectId: string,
      patch: {
        stage: number;
        status: 'draft' | 'ingesting' | 'deduping' | 'awaiting_outline' | 'structuring' | 'completed' | 'paused' | 'error';
        progressPercent: number;
        message: string;
        workflowMode: WorkflowMode;
      }
    ) => {
      if (!user?.uid || isGuest) return;
      const mappedStatus: FirestoreProjectLiveState['status'] =
        patch.status === 'ingesting' || patch.status === 'deduping' || patch.status === 'structuring'
          ? 'running'
          : patch.status === 'error'
            ? 'failed'
            : patch.status;
      try {
        await upsertProjectLiveState(user.uid, projectId, {
          title: bundle?.project.title || 'پروژه تدوین',
          workflowMode: patch.workflowMode,
          stage: patch.stage,
          percent: patch.progressPercent,
          status: mappedStatus,
          stageMessage: patch.message,
          activeFileName: '',
          processedCount: 0,
          totalCount: queuedFiles.length || bundle?.sourceFiles.length || 0,
          paused: patch.status === 'paused',
        });
      } catch (err) {
        console.error('Firestore live state sync warning:', err);
      }
    },
    [user?.uid, isGuest, bundle?.project.title, bundle?.sourceFiles.length, queuedFiles.length]
  );

  const loadProjectBundle = useCallback(
    async (projectId: string) => {
      try {
        const b = await api.getProject(projectId);
        setBundle(b);
        setActiveProjectId(b.project.id);
        setWorkflowMode(b.project.workflowMode);
        const savedSettings = (b.project.settingsJson || {}) as Partial<DocxExportConfig>;
        setConfig({
          ...DEFAULT_DOCX_CONFIG,
          ...savedSettings,
          aiModel:
            typeof savedSettings.aiModel === 'string' && savedSettings.aiModel.trim()
              ? savedSettings.aiModel.trim()
              : DEFAULT_DOCX_CONFIG.aiModel,
          optimization: {
            ...DEFAULT_DOCX_CONFIG.optimization,
            ...(savedSettings.optimization || {}),
          },
        });
        const savedReview = normalizeDeepReviewReport(
          (b.project.checkpointJson as { lastDeepReview?: unknown } | null)?.lastDeepReview
        );
        setDeepReviewReport(savedReview);
        const progress = computeWorkflowProgress({ bundle: b, queuedFilesCount: 0 });
        setActiveStage(progress.recommendedStage);
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'خطا در بارگذاری پروژه.');
      }
    },
    [api]
  );

  const handleRunLiveProbe = useCallback(
    async (overrideConfig?: AiProviderConfig, overrideModel?: AiModelId) => {
      if (!user) return;
      setProbingQuota(true);
      try {
        const targetModel = overrideModel || config.aiModel;
        const result = await api.probeAiQuota(
          {
            projectId: activeProjectId || undefined,
            model: targetModel,
          },
          overrideConfig
        );
        setQuotaProbe(result);
      } catch (err) {
        setBannerError(
          err instanceof Error ? err.message : 'خطا در استعلام زنده سهمیه هوش مصنوعی.'
        );
      } finally {
        setProbingQuota(false);
      }
    },
    [user, api, activeProjectId, config.aiModel]
  );

  const handleLogProjectActivity = useCallback(
    (payload: {
      actionType: ProjectRevisionDto['actionType'];
      title: string;
      summary: string;
      captureSnapshot?: boolean;
      extraDetails?: Record<string, unknown>;
    }) => {
      if (!activeProjectId) return;
      void api
        .logProjectActivity(activeProjectId, payload)
        .then((res) => {
          if (res.revisions) {
            setRevisions(res.revisions);
          }
        })
        .catch(() => {
          // Non-blocking audit trail write
        });
    },
    [activeProjectId, api]
  );

  const handleCreateManualCheckpoint = useCallback(
    async (note: string) => {
      if (!activeProjectId) return;
      const trimmed = note.trim();
      setSavingCheckpoint(true);
      setRevisionsError(null);
      try {
        const res = await api.logProjectActivity(activeProjectId, {
          actionType: 'manual_checkpoint',
          title: trimmed
            ? `نقطه بازیابی دستی: ${trimmed}`
            : 'نقطه بازیابی دستی کاربر',
          summary:
            trimmed ||
            'ذخیره دستی اسنپ‌شات کامل سرفصل‌ها، واحدهای محتوا و خروجی سند برای بازگشت سریع در آینده.',
          captureSnapshot: true,
          extraDetails: {
            note: trimmed || null,
          },
        });
        if (res.revisions) {
          setRevisions(res.revisions);
        }
        setBannerToast('نقطه بازیابی دستی (اسنپ‌شات کامل پروژه) در تاریخچه ثبت شد.');
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'خطا در ثبت نقطه بازیابی دستی.';
        setRevisionsError(msg);
      } finally {
        setSavingCheckpoint(false);
      }
    },
    [activeProjectId, api]
  );

  const handleSaveProviderConfig = useCallback(
    (nextConfig: AiProviderConfig, nextGoogleModel?: AiModelId) => {
      providerConfigRef.current = nextConfig;
      setProviderConfig(nextConfig);
      if (nextGoogleModel) {
        const normalized = nextGoogleModel.trim() || DEFAULT_DOCX_CONFIG.aiModel;
        setConfig((prev) => {
          const updated = { ...prev, aiModel: normalized };
          if (activeProjectId) {
            void api
              .updateProject(activeProjectId, {
                settingsJson: updated as unknown as Record<string, unknown>,
              })
              .catch(() => {
                // ignore transient save warning
              });
          }
          return updated;
        });
      }
      const providerSummary = getProviderDisplaySummary(
        nextConfig,
        nextGoogleModel || config.aiModel
      );
      setBannerToast(
        `${providerSummary.providerLabel} (${providerSummary.modelLabel} · ${providerSummary.keySourceLabel}) برای این نشست فعال شد.`
      );
      handleLogProjectActivity({
        actionType: 'ai_provider_changed',
        title: `تغییر ارائه‌دهنده هوش مصنوعی به ${providerSummary.providerLabel}`,
        summary: `مدل فعال: ${providerSummary.modelLabel} · منبع کلید: ${providerSummary.keySourceLabel}`,
        extraDetails: {
          provider: nextConfig.provider,
          model: providerSummary.modelLabel,
          keySource: providerSummary.keySourceLabel,
        },
      });
      void handleRunLiveProbe(nextConfig, nextGoogleModel);
    },
    [activeProjectId, api, config.aiModel, handleLogProjectActivity, handleRunLiveProbe]
  );

  // Automatic live quota probe once per active project
  useEffect(() => {
    if (!user || !activeProjectId) return;
    if (lastAutoProbedProjectRef.current === activeProjectId) return;
    lastAutoProbedProjectRef.current = activeProjectId;
    void handleRunLiveProbe();
  }, [user, activeProjectId, handleRunLiveProbe]);

  // Initial Cloud SQL projects load on sign-in or Guest entry
  useEffect(() => {
    if (!user) {
      setProjects([]);
      setActiveProjectId(null);
      setBundle(null);
      setRevisions([]);
      setChangeLogOpen(false);
      setPrintPreviewOpen(false);
      return;
    }
    let cancelled = false;
    setLoadingProjects(true);
    setBannerError(null);

    api
      .listProjects()
      .then(async ({ projects: list }) => {
        if (cancelled) return;
        if (list.length === 0) {
          if (isGuest) {
            const seeded = await api.seedGuestDemoProject();
            if (cancelled) return;
            setProjects([seeded.project]);
            setBundle(seeded);
            setActiveProjectId(seeded.project.id);
            setWorkflowMode(seeded.project.workflowMode);
            setSelectedView({ kind: 'cover' });
            const progress = computeWorkflowProgress({ bundle: seeded, queuedFilesCount: 0 });
            setActiveStage(progress.recommendedStage);
            setBannerToast(
              'حالت مهمان فعال شد — یک پروژه نمونه آماده با تاریخچه تغییرات و پیش‌نمایش چاپ A4 برای بررسی شما ایجاد شد.'
            );
          } else {
            const created = await api.createProject({
              title: 'پروژه تدوین و یکپارچه‌سازی جدید',
              workflowMode: 'multi_merge',
              settingsJson: DEFAULT_DOCX_CONFIG as unknown as Record<string, unknown>,
            });
            if (cancelled) return;
            setProjects([created.project]);
            setBundle(created);
            setActiveProjectId(created.project.id);
          }
        } else {
          setProjects(list);
          await loadProjectBundle(list[0].id);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setBannerError(err instanceof Error ? err.message : 'خطا در دریافت پروژه‌ها.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, isGuest, api, loadProjectBundle]);

  const refreshProjectsList = useCallback(async () => {
    try {
      const { projects: list } = await api.listProjects();
      setProjects(list);
    } catch {
      // ignore transient list refresh error
    }
  }, [api]);

  const refreshProjectRevisions = useCallback(
    async (projectId?: string | null) => {
      const pid = projectId ?? activeProjectId;
      if (!pid) {
        setRevisions([]);
        return;
      }
      setLoadingRevisions(true);
      setRevisionsError(null);
      try {
        const res = await api.listProjectRevisions(pid);
        setRevisions(res.revisions || []);
      } catch (err) {
        setRevisionsError(
          err instanceof Error ? err.message : 'خطا در دریافت تاریخچه تغییرات پروژه.'
        );
      } finally {
        setLoadingRevisions(false);
      }
    },
    [activeProjectId, api]
  );

  const handleOpenChangeLog = useCallback(() => {
    setChangeLogOpen(true);
    void refreshProjectRevisions(activeProjectId);
  }, [activeProjectId, refreshProjectRevisions]);

  const handleRollbackRevision = useCallback(
    async (revision: ProjectRevisionDto) => {
      if (!activeProjectId) return;
      setRollingBackId(revision.id);
      setRevisionsError(null);
      setBannerError(null);
      try {
        const res = await api.rollbackProjectRevision(activeProjectId, revision.id);
        setBundle(res.bundle);
        setRevisions(res.revisions || []);
        setWorkflowMode(res.bundle.project.workflowMode);
        const savedSettings = (res.bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
        setConfig({
          ...DEFAULT_DOCX_CONFIG,
          ...savedSettings,
          aiModel:
            typeof savedSettings.aiModel === 'string' && savedSettings.aiModel.trim()
              ? savedSettings.aiModel.trim()
              : DEFAULT_DOCX_CONFIG.aiModel,
          optimization: {
            ...DEFAULT_DOCX_CONFIG.optimization,
            ...(savedSettings.optimization || {}),
          },
        });
        setSelectedView({ kind: 'cover' });
        const progress = computeWorkflowProgress({
          bundle: res.bundle,
          queuedFilesCount: 0,
        });
        setActiveStage(progress.recommendedStage);
        await refreshProjectsList();
        setBannerToast(
          `پروژه با موفقیت به نسخه «${revision.title}» بازگردانده شد و این بازگشت در تاریخچه ثبت گردید.`
        );
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'بازگشت به نسخه قبلی با خطا مواجه شد.';
        setRevisionsError(msg);
        setBannerError(msg);
      } finally {
        setRollingBackId(null);
      }
    },
    [activeProjectId, api, refreshProjectsList]
  );

  const handleCreateProject = useCallback(
    async (mode: WorkflowMode) => {
      setBannerError(null);
      try {
        const created = await api.createProject({
          title: 'پروژه تدوین و یکپارچه‌سازی جدید',
          workflowMode: mode,
          settingsJson: config as unknown as Record<string, unknown>,
        });
        setQueuedFiles([]);
        setBundle(created);
        setActiveProjectId(created.project.id);
        setWorkflowMode(mode);
        setActiveStage(1);
        await refreshProjectsList();
        setBannerToast('پروژه جدید ایجاد شد. فایل‌های خود را برای شروع بارگذاری کنید.');
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'ایجاد پروژه جدید با خطا مواجه شد.');
      }
    },
    [api, config, refreshProjectsList]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      try {
        await api.deleteProject(projectId);
        const { projects: list } = await api.listProjects();
        setProjects(list);
        if (activeProjectId === projectId) {
          if (list.length > 0) {
            await loadProjectBundle(list[0].id);
          } else {
            await handleCreateProject('multi_merge');
          }
        }
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'خطا در حذف پروژه.');
      }
    },
    [api, activeProjectId, loadProjectBundle, handleCreateProject]
  );

  const handleChangeWorkflowMode = useCallback(
    (mode: WorkflowMode) => {
      setWorkflowMode(mode);
      if (mode === 'master_update') {
        setQueuedFiles((prev) =>
          prev.map((f, idx) => ({
            ...f,
            role: f.role || (idx === 0 ? 'master' : 'supplement'),
          }))
        );
      }
      if (activeProjectId) {
        void api.updateProject(activeProjectId, { workflowMode: mode }).then((b) => {
          setBundle(b);
          void refreshProjectsList();
        });
      }
    },
    [activeProjectId, api, refreshProjectsList]
  );

  const handleAddFiles = useCallback(
    (files: File[]) => {
      setQueuedFiles((prev) => {
        const hasMaster = prev.some((p) => p.role === 'master');
        const additions: QueuedUploadFile[] = files.map((f, idx) => ({
          id: `qf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: f.name,
          format: detectFileFormat(f.name),
          sizeBytes: f.size,
          role:
            workflowMode === 'master_update'
              ? !hasMaster && idx === 0
                ? 'master'
                : 'supplement'
              : 'standard',
          file: f,
        }));
        return [...prev, ...additions];
      });
      setBannerError(null);
    },
    [workflowMode]
  );

  const handleImportWorkspaceFiles = useCallback(
    (items: QueuedUploadFile[]) => {
      if (items.length === 0) return;
      setQueuedFiles((prev) => {
        const hasMaster = prev.some((p) => p.role === 'master');
        const normalized = items.map((item, idx) => ({
          ...item,
          role:
            workflowMode === 'master_update'
              ? !hasMaster && idx === 0
                ? ('master' as FileRole)
                : ('supplement' as FileRole)
              : ('standard' as FileRole),
        }));
        return [...prev, ...normalized];
      });
      setActiveStage(1);
      setBannerError(null);
      setBannerToast(
        `${toPersianDigits(items.length)} فایل از Google Drive / Sheets به صف مرحله ۱ اضافه شد. برای استخراج دکمه «اجرای مرحله ۱» را بزنید.`
      );
    },
    [workflowMode]
  );

  const handleSetFileRole = useCallback((id: string, role: FileRole) => {
    setQueuedFiles((prev) =>
      prev.map((f) => {
        if (f.id === id) return { ...f, role };
        if (role === 'master' && f.role === 'master') return { ...f, role: 'supplement' };
        return f;
      })
    );
  }, []);

  const handleLoadQuickDemoFiles = useCallback(() => {
    const file1Text = [
      '# فصل ۱: استانداردهای نگهداری سیستم سوخت',
      '## ۱-۱. فشار ریل و فیلتر',
      'نسبت هوا به سوخت استوکیومتری در موتورهای بنزینی برابر ۱۴.۷ به ۱ است.',
      'حداکثر فشار ایمن ریل سوخت در حالت بار کامل برابر ۴ بار اندازه‌گیری شده است.',
      'فیلتر بنزین باید هر ۲۰۰۰۰ کیلومتر تعویض شود تا انژکتورها آسیب نبینند.',
      '# فصل ۲: عیب‌یابی سنسور اکسیژن',
      'سنسور اکسیژن بالادست وظیفه تنظیم حلقه بسته پاشش سوخت را بر عهده دارد.',
    ].join('\n\n');

    const file2Text = [
      '# فصل ۱: استانداردهای نگهداری سیستم سوخت',
      '## ۱-۱. فشار ریل و فیلتر',
      'نسبت هوا به سوخت استوکیومتری در موتورهای بنزینی برابر ۱۴.۷ به ۱ است.',
      'حداکثر فشار ایمن ریل سوخت در حالت بار کامل برابر ۶ بار توصیه شده است.',
      'فیلتر بنزین باید هر ۲۰۰۰۰ کیلومتر تعویض شود. استفاده از سوخت با اکتان استاندارد عمر پمپ را دو برابر می‌کند.',
      '# فصل ۲: عیب‌یابی سنسور اکسیژن',
      'در صورت خرابی هیتر سنسور اکسیژن، خطای P0135 در حافظه ECU ثبت می‌شود و مصرف سوخت بالا می‌رود.',
    ].join('\n\n');

    setQueuedFiles([
      {
        id: `demo_1_${Date.now()}`,
        name: 'راهنمای_فنی_نسخه_۱.md',
        format: 'md',
        sizeBytes: new Blob([file1Text]).size,
        role: workflowMode === 'master_update' ? 'master' : 'standard',
        presetText: file1Text,
      },
      {
        id: `demo_2_${Date.now()}`,
        name: 'جزوه_تکمیلی_کارگاه_۲.md',
        format: 'md',
        sizeBytes: new Blob([file2Text]).size,
        role: workflowMode === 'master_update' ? 'supplement' : 'standard',
        presetText: file2Text,
      },
    ]);
    setBannerToast('۲ فایل نمونه (دارای هم‌پوشانی و یک تناقض عددی ۴ بار در برابر ۶ بار) آماده پردازش شد.');
  }, [workflowMode]);

  // Stage 1 ONLY: Chunked Batch File Ingestion & Atomic Extraction (no dedup/formatting yet)
  const handleRunStage1Ingest = useCallback(async () => {
    if (!activeProjectId) return;

    if (queuedFiles.length === 0) {
      if (bundle && bundle.sourceFiles.length > 0) {
        const progress = computeWorkflowProgress({ bundle, queuedFilesCount: 0 });
        setActiveStage(progress.recommendedStage);
        setBannerToast('فایل‌های این پروژه قبلاً استخراج شده‌اند. می‌توانید مرحله بعدی را اجرا کنید.');
      } else {
        setBannerError('لطفاً ابتدا حداقل یک فایل را به صف بارگذاری اضافه کنید.');
      }
      return;
    }

    setProcessing(true);
    pauseRequestedRef.current = false;
    setBannerError(null);
    setBannerToast(null);
    setMobileSidebarOpen(false);

    try {
      await api.updateProject(activeProjectId, {
        workflowMode,
        settingsJson: config as unknown as Record<string, unknown>,
      });

      const batchSize = 5;
      let processedCount = 0;
      let latestBundle: ProjectBundleDto | null = null;

      for (let i = 0; i < queuedFiles.length; i += batchSize) {
        if (pauseRequestedRef.current) {
          await api.updateProject(activeProjectId, { status: 'paused', pipelineStage: 1 });
          await syncFirestoreJobState(activeProjectId, {
            stage: 1,
            status: 'paused',
            progressPercent: Math.round((processedCount / queuedFiles.length) * 100),
            message: `توقف موقت پس از استخراج ${toPersianDigits(processedCount)} از ${toPersianDigits(queuedFiles.length)} فایل`,
            workflowMode,
          });
          setBannerToast('استخراج فایل‌ها به‌صورت موقت متوقف شد. هر زمان خواستید ادامه دهید.');
          setProcessing(false);
          return;
        }

        const slice = queuedFiles.slice(i, i + batchSize);
        await syncFirestoreJobState(activeProjectId, {
          stage: 1,
          status: 'ingesting',
          progressPercent: Math.round((processedCount / queuedFiles.length) * 90) + 5,
          message: `مرحله ۱: استخراج اتمی فایل‌های ${toPersianDigits(i + 1)} تا ${toPersianDigits(Math.min(queuedFiles.length, i + batchSize))}...`,
          workflowMode,
        });

        const prepared = await Promise.all(
          slice.map(async (item) => {
            if (item.presetText !== undefined) {
              return {
                name: item.name,
                format: item.format,
                role: item.role || 'standard',
                sizeBytes: item.sizeBytes,
                text: item.presetText,
              };
            }
            if (item.file) {
              if (item.format === 'docx' || item.format === 'pdf') {
                return {
                  name: item.name,
                  format: item.format,
                  role: item.role || 'standard',
                  sizeBytes: item.sizeBytes,
                  base64: await fileToBase64(item.file),
                };
              }
              return {
                name: item.name,
                format: item.format,
                role: item.role || 'standard',
                sizeBytes: item.sizeBytes,
                text: await item.file.text(),
              };
            }
            return {
              name: item.name,
              format: item.format,
              role: item.role || 'standard',
              sizeBytes: item.sizeBytes,
              text: '',
            };
          })
        );

        const shouldReplaceFirstBatch = !(bundle && bundle.sourceFiles.length > 0);
        const res = await api.ingestFilesBatch(activeProjectId, {
          replaceExisting: i === 0 && shouldReplaceFirstBatch,
          files: prepared,
        });
        latestBundle = res.bundle;
        setBundle(res.bundle);
        processedCount += slice.length;
      }

      setQueuedFiles([]);
      await refreshProjectsList();
      await syncFirestoreJobState(activeProjectId, {
        stage: 1,
        status: 'draft',
        progressPercent: 100,
        message: 'مرحله ۱ (استخراج فایل‌ها) تکمیل شد. آماده اجرای مرحله ۲.',
        workflowMode,
      });

      setActiveStage(1);
      setBannerToast(
        `مرحله ۱ تکمیل شد: ${toPersianDigits(latestBundle?.sourceFiles.length ?? processedCount)} فایل و ${toPersianDigits(latestBundle?.contentUnits.length ?? 0)} واحد متنی استخراج شد. پس از بررسی، دکمه اجرای مرحله ۲ را بزنید.`
      );
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'خطا هنگام اجرای مرحله ۱ (استخراج فایل‌ها).');
      if (activeProjectId) {
        await syncFirestoreJobState(activeProjectId, {
          stage: 1,
          status: 'error',
          progressPercent: 0,
          message: 'خطا در مرحله ۱ (استخراج فایل‌ها)',
          workflowMode,
        });
      }
    } finally {
      setProcessing(false);
    }
  }, [
    activeProjectId,
    api,
    bundle,
    workflowMode,
    config,
    queuedFiles,
    syncFirestoreJobState,
    refreshProjectsList,
  ]);

  const handleTranscribeAudioToSourceFile = useCallback(
    async (file: File) => {
      if (file.size > 20 * 1024 * 1024) {
        setBannerError('حجم فایل صوتی باید حداکثر ۲۰ مگابایت باشد.');
        return;
      }
      setTranscribingAudio(true);
      setBannerError(null);
      setBannerToast(null);
      try {
        let targetProjectId = activeProjectId;
        if (!targetProjectId) {
          const created = await api.createProject({
            title: 'پروژه تدوین از فایل صوتی',
            workflowMode,
            settingsJson: config as unknown as Record<string, unknown>,
          });
          targetProjectId = created.project.id;
          setBundle(created);
          setActiveProjectId(created.project.id);
        }

        const audioBase64 = await fileToBase64(file);
        const res = await api.transcribeAudio(targetProjectId, {
          audioBase64,
          mimeType: file.type || 'audio/mpeg',
          fileName: file.name,
          addAsSourceFile: true,
          role: workflowMode === 'master_update' ? 'supplement' : 'standard',
        });

        if (res.bundle) {
          setBundle(res.bundle);
        }
        await refreshProjectsList();
        const words = res.sourceFileAdded?.wordCount ?? 0;
        const units = res.sourceFileAdded?.unitCount ?? 0;
        setBannerToast(
          `فایل صوتی «${file.name}» با موتور ${res.providerLabelFa} به متن تبدیل شد (${toPersianDigits(words)} کلمه · ${toPersianDigits(units)} واحد متنی) و مستقیماً به منابع پروژه اضافه گردید.`
        );
      } catch (err) {
        setBannerError(
          err instanceof Error
            ? err.message
            : 'خطا در تبدیل فایل صوتی به متن. لطفاً تنظیمات اسلات صوتی را بررسی کنید.'
        );
      } finally {
        setTranscribingAudio(false);
      }
    },
    [activeProjectId, api, config, refreshProjectsList, workflowMode]
  );

  const handleTranscribeAudioToText = useCallback(
    async (file: File): Promise<{ transcript: string; providerLabelFa: string }> => {
      if (!activeProjectId) {
        throw new Error('ابتدا یک پروژه فعال انتخاب کنید.');
      }
      if (file.size > 20 * 1024 * 1024) {
        throw new Error('حجم فایل صوتی باید حداکثر ۲۰ مگابایت باشد.');
      }
      const audioBase64 = await fileToBase64(file);
      const res = await api.transcribeAudio(activeProjectId, {
        audioBase64,
        mimeType: file.type || 'audio/mpeg',
        fileName: file.name,
        addAsSourceFile: false,
      });
      return {
        transcript: res.transcript,
        providerLabelFa: res.providerLabelFa,
      };
    },
    [activeProjectId, api]
  );

  // Stage 2 ONLY: Two-Pass Lossless Dedup & Real Conflict Detection -> lands on Stage 2 Audit
  const handleRunStage2Dedup = useCallback(async () => {
    if (!activeProjectId) return;
    setProcessing(true);
    setBannerError(null);
    setBannerToast(null);
    setMobileSidebarOpen(false);

    try {
      await api.updateProject(activeProjectId, {
        workflowMode,
        settingsJson: config as unknown as Record<string, unknown>,
      });

      await syncFirestoreJobState(activeProjectId, {
        stage: 2,
        status: 'deduping',
        progressPercent: 45,
        message: 'مرحله ۲: در حال حذف تکراری‌های بدون افت و کشف تناقض‌های واقعی...',
        workflowMode,
      });

      const afterDedup = await api.runDedupStage(activeProjectId);
      setBundle(afterDedup);
      await refreshProjectsList();

      await syncFirestoreJobState(activeProjectId, {
        stage: 2,
        status: 'awaiting_outline',
        progressPercent: 100,
        message: 'مرحله ۲ (ممیزی و ادغام) تکمیل شد. تناقض‌ها را بررسی و سپس به مرحله ۳ بروید.',
        workflowMode,
      });

      setActiveStage(2);
      setBannerToast(
        `مرحله ۲ تکمیل شد: ${toPersianDigits(afterDedup.dedupClusters.length)} خوشه ادغام و ${toPersianDigits(afterDedup.conflicts.length)} تناقض واقعی شناسایی شد. پس از بررسی به مرحله ۳ (فصل‌بندی) بروید.`
      );
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'خطا هنگام اجرای مرحله ۲ (ادغام و ممیزی).');
      if (activeProjectId) {
        await syncFirestoreJobState(activeProjectId, {
          stage: 2,
          status: 'error',
          progressPercent: 0,
          message: 'خطا در مرحله ۲ (ادغام و کشف تناقض)',
          workflowMode,
        });
      }
    } finally {
      setProcessing(false);
    }
  }, [
    activeProjectId,
    api,
    workflowMode,
    config,
    syncFirestoreJobState,
    refreshProjectsList,
  ]);

  const handleSaveOutline = useCallback(
    async (
      nextNodes: OutlineNodeDto[],
      reassignments?: Array<{ fromNodeId: string; toNodeId: string }>,
      options?: { silent?: boolean }
    ): Promise<boolean> => {
      if (!activeProjectId) return false;
      const silent = Boolean(options?.silent);
      if (!silent) {
        setSavingOutline(true);
        setBannerError(null);
      }
      try {
        const updated = await api.saveOutline(activeProjectId, {
          nodes: nextNodes,
          reassignments,
          validationDomain: config.validationDomain || 'ecu_winols',
        });
        setBundle(updated);
        if (!silent) {
          setBannerToast('چیدمان جدید فصل‌ها ذخیره شد.');
        }
        return true;
      } catch (err) {
        if (!silent) {
          setBannerError(err instanceof Error ? err.message : 'ذخیره فصل‌بندی ناموفق بود.');
        }
        return false;
      } finally {
        if (!silent) {
          setSavingOutline(false);
        }
      }
    },
    [activeProjectId, api, config.validationDomain]
  );

  const handleChangeValidationDomain = useCallback(
    (nextDomain: ValidationDomain) => {
      setConfig((prev) => {
        const updated = { ...prev, validationDomain: nextDomain };
        if (activeProjectId) {
          void api
            .updateProject(activeProjectId, {
              settingsJson: updated as unknown as Record<string, unknown>,
            })
            .catch(() => {
              // ignore transient save warning
            });
        }
        return updated;
      });
    },
    [activeProjectId, api]
  );

  const handleChangeConfig = useCallback(
    (patch: Partial<DocxExportConfig>) => {
      setConfig((prev) => {
        const updated = { ...prev, ...patch };
        if (activeProjectId) {
          void api
            .updateProject(activeProjectId, {
              settingsJson: updated as unknown as Record<string, unknown>,
            })
            .catch(() => {
              // ignore transient save warning
            });
        }
        return updated;
      });
    },
    [activeProjectId, api]
  );

  const handleChangeOptimization = useCallback(
    (patch: Partial<DocxExportConfig['optimization']>) => {
      setConfig((prev) => {
        const updated: DocxExportConfig = {
          ...prev,
          optimization: { ...prev.optimization, ...patch },
        };
        if (activeProjectId) {
          void api
            .updateProject(activeProjectId, {
              settingsJson: updated as unknown as Record<string, unknown>,
            })
            .catch(() => {
              // ignore transient save warning
            });
        }
        return updated;
      });
    },
    [activeProjectId, api]
  );

  const handleApproveAndFinalize = useCallback(
    async (
      approvedNodes: OutlineNodeDto[],
      reassignments?: Array<{ fromNodeId: string; toNodeId: string }>
    ) => {
      if (!activeProjectId) return;
      setFinalizing(true);
      setBannerError(null);
      try {
        await syncFirestoreJobState(activeProjectId, {
          stage: 4,
          status: 'structuring',
          progressPercent: 85,
          message: 'در حال صفحه‌آرایی، تولید نمودارها و ممیزی ۱۰۰٪ پوشش...',
          workflowMode,
        });
        await api.saveOutline(activeProjectId, {
          nodes: approvedNodes,
          reassignments,
          validationDomain: config.validationDomain || 'ecu_winols',
        });
        const finished = await api.finalizeProject(activeProjectId);
        setBundle(finished);
        setSelectedView({ kind: 'cover' });
        setActiveStage(4);
        await refreshProjectsList();
        await syncFirestoreJobState(activeProjectId, {
          stage: 4,
          status: 'completed',
          progressPercent: 100,
          message: 'مرحله ۴ (صفحه‌آرایی و کادربندی) آماده بازبینی و غنی‌سازی اختیاری است.',
          workflowMode,
        });
        setBannerToast('مرحله ۴ انجام شد: پیش‌نمایش کادربندی‌شده آماده بازبینی، غنی‌سازی اختیاری و انتقال به مرحله ۵ (خروجی) است.');
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'خطا در تدوین نهایی سند.');
      } finally {
        setFinalizing(false);
      }
    },
    [activeProjectId, api, workflowMode, config.validationDomain, refreshProjectsList, syncFirestoreJobState]
  );

  const handleEnrichNodeWithGoogle = useCallback(
    async (nodeId: string) => {
      if (!activeProjectId) return;
      setGroundingNodeId(nodeId);
      setBannerError(null);
      try {
        const res = await api.runGrounding(activeProjectId, {
          targetType: 'outline_node',
          targetId: nodeId,
        });
        if (res.bundle) setBundle(res.bundle);
        setBannerToast('باکس اطلاعات تکمیلی از جستجوی گوگل (همراه با لینک منابع) به فصل اضافه شد.');
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'خطا در دریافت اطلاعات از جستجوی گوگل.');
      } finally {
        setGroundingNodeId(null);
      }
    },
    [activeProjectId, api]
  );

  const handleEnrichFullDocumentWithGoogle = useCallback(async () => {
    if (!activeProjectId) return;
    setEnrichingFullGoogle(true);
    setBannerError(null);
    setBannerToast(null);
    try {
      const res = await api.runGrounding(activeProjectId, {
        targetType: 'full_document',
      });
      if (res.bundle) setBundle(res.bundle);
      const done = res.enrichedChaptersCount ?? 0;
      const total = res.totalChapters ?? done;
      if (res.failedChaptersCount && res.failedChaptersCount > 0) {
        setBannerToast(
          `تکمیل با جستجوی گوگل برای ${toPersianDigits(done)} از ${toPersianDigits(total)} فصل انجام شد (بخشی از فصل‌ها به دلیل محدودیت سهمیه متوقف شد).`
        );
      } else {
        setBannerToast(
          `کل متن خروجی (${toPersianDigits(done)} فصل) با جستجوی گوگل و لینک منابع معتبر در باکس‌های مجزا تکمیل شد.`
        );
      }
    } catch (err) {
      setBannerError(
        err instanceof Error ? err.message : 'خطا در تکمیل کل متن خروجی با جستجوی گوگل.'
      );
    } finally {
      setEnrichingFullGoogle(false);
    }
  }, [activeProjectId, api]);

  const handleRunDeepAiReview = useCallback(async () => {
    if (!activeProjectId) return;
    const startedAt = Date.now();
    setRunningDeepReview(true);
    setDeepReviewProgress({
      percent: 4,
      stage: 'شروع بازبینی عمیق و ارسال درخواست به سرور...',
      startedAt,
    });
    setBannerError(null);
    setBannerToast(null);
    try {
      const res = await api.runDeepAiReview(activeProjectId, {}, (ev) => {
        setDeepReviewProgress((prev) => ({
          percent: ev.percent,
          stage: ev.stage,
          model: ev.model ?? prev?.model,
          thinkingLevel: ev.thinkingLevel ?? prev?.thinkingLevel,
          attempt: ev.attempt ?? prev?.attempt,
          totalAttempts: ev.totalAttempts ?? prev?.totalAttempts,
          startedAt: prev?.startedAt ?? startedAt,
        }));
      });

      if (res.bundle) {
        setBundle(res.bundle);
      }
      const normalizedReview = normalizeDeepReviewReport(res.review);
      if (!normalizedReview) {
        throw new Error('گزارش بازبینی عمیق به‌صورت کامل از سرور دریافت نشد. لطفاً مجدداً تلاش کنید.');
      }

      setDeepReviewReport(normalizedReview);
      if (res.bundle?.project.bookSnapshotJson) {
        setActiveStage(4);
      }
      const counts = normalizedReview.appliedCounts || {
        titlesRefined: 0,
        calloutsAdded: 0,
        tablesAdded: 0,
        paragraphsAdded: 0,
      };
      const totalFixes =
        (counts.titlesRefined || 0) +
        (counts.calloutsAdded || 0) +
        (counts.tablesAdded || 0) +
        (counts.paragraphsAdded || 0);
      setBannerToast(
        `بازبینی عمیق هوش مصنوعی (${normalizedReview.thinkingLevel}) انجام شد — امتیاز کیفیت ${toPersianDigits(normalizedReview.overallScore)} از ۱۰۰ و ${toPersianDigits(totalFixes)} بهبود بدون افت روی سند اعمال گردید.`
      );
    } catch (err) {
      setBannerError(
        err instanceof Error ? err.message : 'خطا در اجرای بازبینی با قدرت بیشتر هوش مصنوعی.'
      );
    } finally {
      setRunningDeepReview(false);
      setDeepReviewProgress(null);
    }
  }, [activeProjectId, api]);

  const handleRescanConflicts = useCallback(async () => {
    if (!activeProjectId) return;
    setRescanningConflicts(true);
    setBannerError(null);
    setBannerToast(null);
    try {
      const res = await api.rescanConflicts(activeProjectId);
      if (res.bundle) setBundle(res.bundle);
      if (res.removedCount > 0) {
        setBannerToast(
          `پالایش دقیق انجام شد: ${toPersianDigits(res.removedCount)} مورد مکمل/غیرمتناقض حذف شد و ${toPersianDigits(res.currentCount)} تناقض واقعی باقی ماند (تمام متون مکمل بدون افت در سند حفظ شده‌اند).`
        );
      } else {
        setBannerToast(
          `پالایش دقیق انجام شد: ${toPersianDigits(res.currentCount)} تناقض واقعی در سند ثبت شده است.`
        );
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'خطا در پالایش مجدد تناقض‌ها.');
    } finally {
      setRescanningConflicts(false);
    }
  }, [activeProjectId, api]);

  const handleCheckConflictWithGoogle = useCallback(
    async (conflictId: string) => {
      if (!activeProjectId) return;
      setGroundingConflictId(conflictId);
      setBannerError(null);
      try {
        const res = await api.runGrounding(activeProjectId, {
          targetType: 'conflict',
          targetId: conflictId,
        });
        if (res.bundle) setBundle(res.bundle);
        setBannerToast('راستی‌آزمایی تناقض با جستجوی گوگل انجام و لینک منابع ثبت شد.');
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'خطا در بررسی تناقض با جستجوی گوگل.');
      } finally {
        setGroundingConflictId(null);
      }
    },
    [activeProjectId, api]
  );

  const handleResolveConflict = useCallback(
    async (
      conflictId: string,
      status: 'keep_both' | 'choose_a' | 'choose_b' | 'resolved_web',
      resolutionNote: string
    ) => {
      if (!activeProjectId) return;
      setResolvingConflictId(conflictId);
      setBannerError(null);
      try {
        const res = await api.resolveConflict(activeProjectId, conflictId, {
          status,
          resolutionNote,
        });
        if (res.bundle) setBundle(res.bundle);
        setBannerToast('تصمیم شما درباره تناقض در پایگاه داده و سند ثبت شد.');
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'خطا در ثبت تصمیم تناقض.');
      } finally {
        setResolvingConflictId(null);
      }
    },
    [activeProjectId, api]
  );

  const handleApplyProposal = useCallback(
    async (proposal: ChatProposal) => {
      if (!activeProjectId) return;
      const res = await api.applyProposal(activeProjectId, proposal);
      if (res.bundle) {
        setBundle(res.bundle);
        setBannerToast(`تغییر «${proposal.title}» با موفقیت روی سند و پایگاه داده اعمال شد.`);
      }
    },
    [activeProjectId, api]
  );

  const handleDownloadDocx = useCallback(async () => {
    const book = bundle?.project.bookSnapshotJson;
    if (!book) return;
    setExportingDocx(true);
    setBannerError(null);
    try {
      const blob = await generateDocxBlob(book, config);
      const fileName = makeSafeFileName(book.title, 'docx');
      triggerBlobDownload(blob, fileName);
      setBannerToast(`فایل ورد با فونت ${config.fontFamily} و راست‌چین کامل دانلود شد.`);
      handleLogProjectActivity({
        actionType: 'docx_exported',
        title: `خروجی فایل ورد (.docx) — ${fileName}`,
        summary: `فایل ورد راست‌چین با فونت ${config.fontFamily} (${book.chapters.length} فصل) ساخته و دانلود شد.`,
        extraDetails: {
          format: 'docx',
          fileName,
          fontFamily: config.fontFamily,
          chaptersCount: book.chapters.length,
        },
      });
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'خطا در ساخت فایل ورد (.docx).');
    } finally {
      setExportingDocx(false);
    }
  }, [bundle?.project.bookSnapshotJson, config, handleLogProjectActivity]);

  const handleDownloadMarkdown = useCallback(() => {
    const book = bundle?.project.bookSnapshotJson;
    if (!book) return;
    const md = exportBookToMarkdown(book);
    const fileName = makeSafeFileName(book.title, 'md');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    triggerBlobDownload(blob, fileName);
    setBannerToast('نسخه Markdown تمیز سند دانلود شد.');
    handleLogProjectActivity({
      actionType: 'markdown_exported',
      title: `خروجی Markdown تمیز — ${fileName}`,
      summary: `نسخه Markdown کامل شامل ${book.chapters.length} فصل ذخیره شد.`,
      extraDetails: {
        format: 'markdown',
        fileName,
        chaptersCount: book.chapters.length,
      },
    });
  }, [bundle?.project.bookSnapshotJson, handleLogProjectActivity]);

  const handleOpenPrintPreview = useCallback(() => {
    setPrintPreviewOpen(true);
    handleLogProjectActivity({
      actionType: 'print_preview_opened',
      title: 'باز کردن پیش‌نمایش چاپ A4 / خروجی PDF',
      summary: 'کاربر پیش‌نمایش صفحه‌بندی استاندارد A4 برای چاپ یا ذخیره PDF را باز کرد.',
      extraDetails: {
        format: 'pdf_print_preview',
      },
    });
  }, [handleLogProjectActivity]);

  const unitCountsByNode = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!bundle) return counts;
    for (const u of bundle.contentUnits) {
      if (u.status === 'merged' || !u.outlineNodeId) continue;
      counts[u.outlineNodeId] = (counts[u.outlineNodeId] || 0) + 1;
    }
    return counts;
  }, [bundle]);

  const winolsGuideReport: WinolsExtractionReport = useMemo(() => {
    const saved = (
      bundle?.auditReport?.detailsJson as Record<string, unknown> | undefined
    )?.winolsGuideReport as WinolsExtractionReport | undefined;
    if (saved && Array.isArray(saved.entries)) {
      return saved;
    }
    if (!bundle) {
      return {
        mapsDetected: 0,
        entries: [],
        summaryTable: null,
        generatedAt: '',
      };
    }
    return extractWinolsMapGuides({
      sourceFiles: bundle.sourceFiles,
      units: bundle.contentUnits,
    });
  }, [bundle]);

  const projectAiUsage = useMemo(
    () => extractAiUsageFromCheckpoint(bundle?.project.checkpointJson),
    [bundle?.project.checkpointJson]
  );

  const ingestedWordCount = useMemo(
    () =>
      (bundle?.sourceFiles || []).reduce((sum, f) => sum + (f.wordCount || 0), 0),
    [bundle?.sourceFiles]
  );

  const workflowProgress = useMemo(
    () =>
      computeWorkflowProgress({
        bundle,
        queuedFilesCount: queuedFiles.length,
      }),
    [bundle, queuedFiles.length]
  );

  const capabilityPlan = useMemo(
    () => resolveCapabilityRoutingPlan(providerConfig, config.aiModel),
    [providerConfig, config.aiModel]
  );

  const handleJumpToSearchResult = useCallback(
    (params: { unitId: string; outlineNodeId: string | null; sourceFileId: string }) => {
      setMobileSidebarOpen(false);
      if (params.outlineNodeId && workflowProgress.unlockedStages[3]) {
        setHighlightedOutlineNodeId(params.outlineNodeId);
        setActiveStage(3);
        setShowDashboardOverview(false);
      } else {
        setActiveStage(1);
        setShowDashboardOverview(false);
      }
    },
    [workflowProgress.unlockedStages]
  );

  if (authLoading) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-[#FAF9F6] flex flex-col items-center justify-center gap-3 text-[#1E3A5F]"
      >
        <Loader2 className="h-7 w-7 animate-spin" />
        <span className="text-sm font-semibold">در حال بررسی حساب کاربری...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  const activeBook = bundle?.project.bookSnapshotJson ?? null;
  const openConflictsCount =
    bundle?.conflicts.filter((c) => c.status === 'open').length ?? 0;
  const completedStagesCount = BOOK_WORKFLOW_STAGES.filter(
    (st) => workflowProgress.completedStages[st.stage]
  ).length;
  const completedStagesPercent = Math.round(
    (completedStagesCount / BOOK_WORKFLOW_STAGES.length) * 100
  );

  const handleNavigateStage = (stage: BookWorkflowStageId) => {
    if (!workflowProgress.unlockedStages[stage]) return;
    setActiveStage(stage);
    setShowDashboardOverview(false);
  };

  const activeChapterNumber =
    selectedView.kind === 'chapter' ? selectedView.chapterNumber : null;

  return (
    <>
      <div
        dir="rtl"
        className="studio-app-shell min-h-screen bg-[#F8F6F1] text-[#1A1816] flex flex-col"
      >
        {/* Top Studio Header with Interactive Workflow Status Bar */}
        <header className="no-print sticky top-0 z-30 h-[58px] border-b border-[#E2DDD3] bg-white px-3 sm:px-5 flex items-center justify-between gap-2 relative">
        <div
          className="absolute bottom-0 right-0 h-[2px] bg-[#14532D] transition-all duration-300"
          style={{ width: `${completedStagesPercent}%` }}
          aria-hidden="true"
        />
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="باز کردن منوی پروژه‌ها و فایل‌ها"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2DDD3] text-[#1E3A5F] lg:hidden shrink-0 cursor-pointer"
          >
            <Menu className="h-4 w-4" />
          </button>

          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E3A5F] text-white">
            <BookOpen className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <div className="truncate text-xs sm:text-sm font-extrabold text-[#1A1816]">
              {bundle?.project.title || 'استودیو صفحه‌آرایی و ادغام بدون افت'}
            </div>
            <div className="hidden sm:block text-[10.5px] text-[#78716C] tabular-nums">
              پیشرفت مراحل: {toPersianDigits(completedStagesCount)} از ۵ تکمیل‌شده ({toPersianDigits(completedStagesPercent)}٪)
            </div>
          </div>
        </div>

        {/* Center Interactive 5-Stage Status & Navigation Bar */}
        <nav
          className="hidden md:flex items-center gap-1 rounded-lg border border-[#E6E1D6] bg-[#F7F5EF] p-1"
          aria-label="نوار وضعیت تعاملی مراحل"
        >
          {BOOK_WORKFLOW_STAGES.map((st) => {
            const done = workflowProgress.completedStages[st.stage];
            const unlocked = workflowProgress.unlockedStages[st.stage];
            const isActive = activeStage === st.stage;
            return (
              <button
                key={st.stage}
                type="button"
                disabled={!unlocked}
                aria-current={isActive ? 'step' : undefined}
                title={
                  unlocked
                    ? `${st.titleFa}${done ? ' (تکمیل‌شده — کلیک برای هدایت)' : ' — کلیک برای مشاهده'}`
                    : `ابتدا پیش‌نیاز مرحله قبل را تکمیل کنید`
                }
                onClick={() => handleNavigateStage(st.stage)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                  isActive
                    ? 'bg-[#1E3A5F] text-white shadow-xs'
                    : done
                      ? 'bg-[#EEF6F0] text-[#14532D] hover:bg-[#E1F0E5]'
                      : unlocked
                        ? 'text-[#1E3A5F] hover:bg-white'
                        : 'text-[#A8A29E]'
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : !unlocked ? (
                  <Lock className="h-3 w-3 shrink-0 opacity-70" />
                ) : null}
                <span>{st.shortTitleFa}</span>
                {st.stage === 2 && openConflictsCount > 0 && (
                  <span
                    className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                      isActive ? 'bg-white text-[#9A3412]' : 'bg-[#9A3412] text-white'
                    }`}
                  >
                    {toPersianDigits(openConflictsCount)}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Trailing Controls: Drive/Sheets + Change Log + Assistant Drawer Toggle + User / Guest */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setGoogleWorkspaceInitialTab(activeStage === 5 && activeBook ? 'export' : 'import');
              setGoogleWorkspaceModalOpen(true);
            }}
            aria-label="اتصال به Google Drive و Google Sheets"
            title="ایمپورت از Google Drive / Sheets یا ذخیره خروجی"
            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 sm:px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              hasWorkspaceAccess
                ? 'border-[#C7DDD0] bg-[#F2F7F4] text-[#14532D] hover:bg-[#E1F0E5]'
                : 'border-[#D6D0C4] bg-white text-[#1E3A5F] hover:bg-[#FAF9F6] hover:border-[#1E3A5F]/40'
            }`}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden lg:inline">Drive / Sheets</span>
          </button>

          <button
            type="button"
            onClick={handleOpenChangeLog}
            disabled={!activeProjectId}
            aria-label="تاریخچه تغییرات پروژه"
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white px-3 py-1.5 text-xs font-bold text-[#1A1816] hover:bg-[#FAF9F6] hover:border-[#1E3A5F]/40 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <History className="h-3.5 w-3.5 text-[#1E3A5F]" />
            <span className="hidden lg:inline">تاریخچه تغییرات</span>
          </button>

          <button
            type="button"
            onClick={() => setAssistantOpen((v) => !v)}
            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              assistantOpen
                ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                : 'border-[#C6D5E6] bg-[#EEF3F8] text-[#1E3A5F] hover:bg-[#DFEAF5]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">دستیار و ویرایش صوتی</span>
          </button>

          <div className="flex items-center gap-1.5 border-r border-[#E2DDD3] pr-2">
            {isGuest ? (
              <>
                <span className="hidden xl:inline-flex items-center gap-1 text-[11px] font-bold text-[#44403C]">
                  <UserRound className="h-3.5 w-3.5 text-[#1E3A5F]" />
                  حالت مهمان
                </span>
                <button
                  type="button"
                  onClick={() => void signInWithGoogle()}
                  title="ورود با حساب گوگل برای همگام‌سازی دائمی"
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[#1E3A5F]/30 bg-[#EEF3F8] px-2.5 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#DFEAF5] cursor-pointer"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">ورود با گوگل</span>
                </button>
              </>
            ) : user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'کاربر'}
                className="h-7 w-7 rounded-full border border-[#D6D0C4]"
              />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1E3A5F] text-[11px] font-bold text-white">
                {(user.displayName || user.email || 'U').slice(0, 1)}
              </div>
            )}
            <button
              type="button"
              onClick={signOut}
              title={isGuest ? 'خروج از حالت مهمان' : 'خروج از حساب کاربری'}
              aria-label={isGuest ? 'خروج از حالت مهمان' : 'خروج از حساب کاربری'}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#57534E] hover:bg-[#FDF2F0] hover:text-[#9A3412] cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Interactive 5-Stage Status & Navigation Bar */}
      <div className="flex md:hidden items-center gap-1.5 overflow-x-auto border-b border-[#E2DDD3] bg-white px-2 py-1.5 text-[11px]">
        {BOOK_WORKFLOW_STAGES.map((st) => {
          const done = workflowProgress.completedStages[st.stage];
          const unlocked = workflowProgress.unlockedStages[st.stage];
          const isActive = activeStage === st.stage;
          return (
            <button
              key={st.stage}
              type="button"
              disabled={!unlocked}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => handleNavigateStage(st.stage)}
              className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md font-bold whitespace-nowrap disabled:opacity-45 cursor-pointer ${
                isActive
                  ? 'bg-[#1E3A5F] text-white'
                  : done
                    ? 'bg-[#EEF6F0] text-[#14532D]'
                    : 'text-[#57534E]'
              }`}
            >
              {done ? (
                <CheckCircle2 className="h-3 w-3 shrink-0" />
              ) : !unlocked ? (
                <Lock className="h-3 w-3 shrink-0 opacity-70" />
              ) : null}
              <span>{st.shortTitleFa}</span>
            </button>
          );
        })}
      </div>

      {/* Notifications */}
      {bannerError && (
        <div className="border-b border-[#E6BFB7] bg-[#FDF2F0] px-4 py-2.5 text-xs text-[#9A3412] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{bannerError}</span>
          </div>
          <button type="button" onClick={() => setBannerError(null)} className="p-1 cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {bannerToast && (
        <div className="border-b border-[#C7DDD0] bg-[#F2F7F4] px-4 py-2.5 text-xs text-[#14532D] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{bannerToast}</span>
          </div>
          <button type="button" onClick={() => setBannerToast(null)} className="p-1 cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 3-Column RTL Workspace Shell */}
      <div className="flex-1 flex min-w-0 relative">
        {/* Desktop Right Sidebar (Projects, 4 Modes, FileDropzone, Settings) */}
        <div className="hidden lg:block">
          <WorkspaceSidebar
            projects={projects}
            activeProjectId={activeProjectId}
            activeWorkflowMode={workflowMode}
            queuedFiles={queuedFiles}
            sourceFiles={bundle?.sourceFiles ?? []}
            contentUnits={bundle?.contentUnits ?? []}
            outlineNodes={bundle?.outlineNodes ?? []}
            ingestedFilesCount={bundle?.sourceFiles.length ?? 0}
            ingestedWordCount={ingestedWordCount}
            chapterCount={bundle?.outlineNodes.length ?? 0}
            aiUsage={projectAiUsage}
            config={config}
            providerConfig={providerConfig}
            probeData={quotaProbe}
            probingQuota={probingQuota}
            processing={processing}
            onRunLiveProbe={() => handleRunLiveProbe()}
            onOpenProviderSettings={() => setProviderModalOpen(true)}
            onSelectProject={loadProjectBundle}
            onCreateProject={handleCreateProject}
            onDeleteProject={handleDeleteProject}
            onChangeWorkflowMode={handleChangeWorkflowMode}
            onAddFiles={handleAddFiles}
            onRemoveFile={(id) => setQueuedFiles((prev) => prev.filter((f) => f.id !== id))}
            onMoveFile={(id, dir) =>
              setQueuedFiles((prev) => {
                const idx = prev.findIndex((f) => f.id === id);
                if (idx === -1) return prev;
                const t = dir === 'up' ? idx - 1 : idx + 1;
                if (t < 0 || t >= prev.length) return prev;
                const copy = [...prev];
                const [moved] = copy.splice(idx, 1);
                copy.splice(t, 0, moved);
                return copy;
              })
            }
            onClearFiles={() => setQueuedFiles([])}
            onSetFileRole={handleSetFileRole}
            onChangeConfig={handleChangeConfig}
            onChangeOptimization={handleChangeOptimization}
            onStartPipeline={handleRunStage1Ingest}
            onJumpToSearchResult={handleJumpToSearchResult}
          />
        </div>

        {/* Mobile Right Sidebar Drawer */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div className="relative z-10 w-[88vw] max-w-[360px] h-full overflow-y-auto bg-[#FCFBF8] shadow-xl">
              <div className="flex items-center justify-between border-b border-[#E2DDD3] px-4 py-3 bg-white">
                <span className="text-xs font-bold text-[#1E3A5F]">پروژه‌ها و فایل‌های ورودی</span>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="p-1.5 text-[#57534E]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <WorkspaceSidebar
                projects={projects}
                activeProjectId={activeProjectId}
                activeWorkflowMode={workflowMode}
                queuedFiles={queuedFiles}
                sourceFiles={bundle?.sourceFiles ?? []}
                contentUnits={bundle?.contentUnits ?? []}
                outlineNodes={bundle?.outlineNodes ?? []}
                ingestedFilesCount={bundle?.sourceFiles.length ?? 0}
                ingestedWordCount={ingestedWordCount}
                chapterCount={bundle?.outlineNodes.length ?? 0}
                aiUsage={projectAiUsage}
                config={config}
                providerConfig={providerConfig}
                probeData={quotaProbe}
                probingQuota={probingQuota}
                processing={processing}
                onRunLiveProbe={() => handleRunLiveProbe()}
                onOpenProviderSettings={() => {
                  setMobileSidebarOpen(false);
                  setProviderModalOpen(true);
                }}
                onSelectProject={(pid) => {
                  void loadProjectBundle(pid);
                  setMobileSidebarOpen(false);
                }}
                onCreateProject={handleCreateProject}
                onDeleteProject={handleDeleteProject}
                onChangeWorkflowMode={handleChangeWorkflowMode}
                onAddFiles={handleAddFiles}
                onRemoveFile={(id) => setQueuedFiles((prev) => prev.filter((f) => f.id !== id))}
                onMoveFile={(id, dir) =>
                  setQueuedFiles((prev) => {
                    const idx = prev.findIndex((f) => f.id === id);
                    if (idx === -1) return prev;
                    const t = dir === 'up' ? idx - 1 : idx + 1;
                    if (t < 0 || t >= prev.length) return prev;
                    const copy = [...prev];
                    const [moved] = copy.splice(idx, 1);
                    copy.splice(t, 0, moved);
                    return copy;
                  })
                }
                onClearFiles={() => setQueuedFiles([])}
                onSetFileRole={handleSetFileRole}
                onChangeConfig={handleChangeConfig}
                onChangeOptimization={handleChangeOptimization}
                onStartPipeline={handleRunStage1Ingest}
                onJumpToSearchResult={handleJumpToSearchResult}
              />
            </div>
            <div
              className="flex-1 bg-black/40"
              onClick={() => setMobileSidebarOpen(false)}
            />
          </div>
        )}

        {/* Center Main Workspace Column */}
        <main className="flex-1 min-w-0 flex flex-col lg:h-[calc(100vh-58px)] lg:overflow-hidden">
          <PipelineStepper
            activeStage={activeStage}
            progress={workflowProgress}
            status={
              (liveState?.status === 'running'
                ? bundle?.project.status && bundle.project.status !== 'draft'
                  ? bundle.project.status
                  : 'ingesting'
                : liveState?.status === 'failed'
                  ? 'error'
                  : (liveState?.status ?? bundle?.project.status ?? 'draft')) as ProjectBundleDto['project']['status']
            }
            progressPercent={liveState?.percent}
            statusMessage={liveState?.stageMessage}
            busy={processing || finalizing}
            openConflictsCount={openConflictsCount}
            showDashboardOverview={showDashboardOverview}
            onToggleDashboardOverview={() => setShowDashboardOverview((v) => !v)}
            onPauseToggle={() => {
              if (bundle?.project.status === 'paused' || liveState?.status === 'paused') {
                void handleRunStage1Ingest();
              } else {
                pauseRequestedRef.current = true;
              }
            }}
            onSelectStageView={(st) => {
              handleNavigateStage(st);
            }}
          />

          <div className="flex-1 lg:overflow-y-auto">
            {showDashboardOverview && activeStage !== 1 && !loadingProjects && (
              <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-8">
                <ProjectsDashboardWidget
                  projects={projects}
                  activeProjectId={activeProjectId}
                  activeBundle={bundle}
                  activeAiModel={config.aiModel}
                  probeData={quotaProbe}
                  onSelectProject={(pid) => {
                    void loadProjectBundle(pid);
                    setShowDashboardOverview(false);
                  }}
                  onCreateProject={(mode) => {
                    void handleCreateProject(mode);
                    setShowDashboardOverview(false);
                  }}
                  onOpenProviderSettings={() => setProviderModalOpen(true)}
                />
              </div>
            )}
            {loadingProjects ? (
              <div className="h-full flex items-center justify-center gap-2 text-sm text-[#57534E] py-16">
                <Loader2 className="h-5 w-5 animate-spin text-[#1E3A5F]" />
                <span>در حال بارگذاری پروژه‌های ذخیره‌شده...</span>
              </div>
            ) : activeStage === 1 ? (
              <StageIngestView
                projects={projects}
                activeProjectId={activeProjectId}
                activeBundle={bundle}
                activeAiModel={config.aiModel}
                audioEngineLabel={capabilityPlan.audioLabelFa}
                probeData={quotaProbe}
                sourceFiles={bundle?.sourceFiles ?? []}
                contentUnitsCount={bundle?.contentUnits.length ?? 0}
                queuedFilesCount={queuedFiles.length}
                processing={processing}
                transcribingAudio={transcribingAudio}
                progress={workflowProgress}
                onSelectProject={loadProjectBundle}
                onCreateProject={handleCreateProject}
                onOpenProviderSettings={() => setProviderModalOpen(true)}
                onRunStage1Ingest={handleRunStage1Ingest}
                onTranscribeAudioFile={handleTranscribeAudioToSourceFile}
                onRunStage2Dedup={handleRunStage2Dedup}
                onGoToStage2={() => setActiveStage(2)}
                onLoadDemoFiles={handleLoadQuickDemoFiles}
                onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
                onOpenGoogleDriveImport={() => {
                  setGoogleWorkspaceInitialTab('import');
                  setGoogleWorkspaceModalOpen(true);
                }}
              />
            ) : activeStage === 2 && bundle ? (
              <AuditConflictsView
                auditReport={bundle.auditReport}
                clusters={bundle.dedupClusters}
                conflicts={bundle.conflicts}
                groundingConflictId={groundingConflictId}
                resolvingConflictId={resolvingConflictId}
                rescanningConflicts={rescanningConflicts}
                hasIngestedFiles={workflowProgress.hasIngestedFiles}
                hasDedupResults={workflowProgress.hasDedupResults}
                hasOutline={workflowProgress.hasOutline}
                runningDedup={processing}
                onRunDedup={handleRunStage2Dedup}
                onProceedToOutline={() => setActiveStage(3)}
                onRescanConflicts={handleRescanConflicts}
                onCheckConflictWithGoogle={handleCheckConflictWithGoogle}
                onResolveConflict={handleResolveConflict}
              />
            ) : activeStage === 3 && bundle ? (
              <OutlineEditorView
                projectId={bundle.project.id}
                projectTitle={bundle.project.title}
                nodes={bundle.outlineNodes}
                contentUnits={bundle.contentUnits}
                sourceFiles={bundle.sourceFiles}
                unitCountsByNode={unitCountsByNode}
                highlightedNodeId={highlightedOutlineNodeId}
                saving={savingOutline}
                finalizing={finalizing}
                groundingNodeId={groundingNodeId}
                enrichingAllGoogle={enrichingFullGoogle}
                runningDeepReview={runningDeepReview}
                deepReviewProgress={deepReviewProgress}
                onSaveOutline={handleSaveOutline}
                onApproveAndFinalize={handleApproveAndFinalize}
                onEnrichNodeWithGoogle={handleEnrichNodeWithGoogle}
                onEnrichAllWithGoogle={handleEnrichFullDocumentWithGoogle}
                onRunDeepReview={handleRunDeepAiReview}
                harness={harnessRunner}
                validationDomain={config.validationDomain || 'ecu_winols'}
                onChangeValidationDomain={handleChangeValidationDomain}
                onOpenProviderSettings={() => setProviderModalOpen(true)}
              />
            ) : activeStage === 5 && activeBook ? (
              <StageExportView
                book={activeBook}
                projectId={bundle?.project.id || activeProjectId}
                auditReport={bundle?.auditReport ?? null}
                conflicts={bundle?.conflicts ?? []}
                outlineNodes={bundle?.outlineNodes ?? []}
                winolsGuideReport={winolsGuideReport}
                harnessState={harnessRunner.harnessState}
                deepReviewReport={deepReviewReport}
                validationDomain={config.validationDomain || 'ecu_winols'}
                config={config}
                exportingDocx={exportingDocx}
                onFetchServerMetrics={(pid) => api.getProjectQualityMetrics(pid)}
                onDownloadDocx={handleDownloadDocx}
                onDownloadMarkdown={handleDownloadMarkdown}
                onPrintPdf={handleOpenPrintPreview}
                onGoToStage4Preview={() => setActiveStage(4)}
                onGoToStage2Audit={() => setActiveStage(2)}
                onGoToStage3Outline={() => setActiveStage(3)}
                onGoToStage4Winols={() => {
                  setWinolsWorkbenchOpen(true);
                  setActiveStage(4);
                }}
                onOpenGoogleWorkspaceExport={() => {
                  setGoogleWorkspaceInitialTab('export');
                  setGoogleWorkspaceModalOpen(true);
                }}
              />
            ) : activeBook ? (
              <div className="flex flex-col h-full">
                {/* Stage 4 Preview & Optional Single-Step Enrichment Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2DDD3] bg-[#F3F0E8] px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMobileChaptersOpen(true)}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#C8C1B4] bg-white px-3 py-1 text-xs font-bold text-[#1E3A5F] xl:hidden cursor-pointer"
                    >
                      <ListTree className="h-3.5 w-3.5" />
                      فصل‌ها ({toPersianDigits(activeBook.chapters.length)})
                    </button>
                    {selectedView.kind !== 'cover' && (
                      <button
                        type="button"
                        onClick={() => setSelectedView({ kind: 'cover' })}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#1E3A5F]/30 bg-white px-3 py-1 text-xs font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        فهرست سرفصل‌ها
                      </button>
                    )}
                    <span className="text-xs font-semibold text-[#44403C]">
                      {toPersianDigits(activeBook.chapters.length)} فصل · پوشش{' '}
                      <strong className="text-[#14532D]">
                        {toPersianDigits(bundle?.auditReport?.coveragePercent ?? 100)}٪
                      </strong>
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleEnrichFullDocumentWithGoogle}
                      disabled={enrichingFullGoogle || runningDeepReview}
                      title="اقدام اختیاری جداگانه: تکمیل فصل‌ها با جستجوی گوگل و لینک منابع"
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#D7CBE6] bg-[#F7F4FA] px-3 py-1.5 text-xs font-bold text-[#5B21B6] hover:bg-[#ECE5F5] disabled:opacity-50 cursor-pointer"
                    >
                      {enrichingFullGoogle ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Globe className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {enrichingFullGoogle ? 'در حال تکمیل کل متن با گوگل...' : 'تکمیل اختیاری با گوگل'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleRunDeepAiReview}
                      disabled={runningDeepReview || enrichingFullGoogle}
                      title="اقدام اختیاری جداگانه: بازبینی عمیق سند برای کشف و رفع نقص‌ها بدون حذف محتوا"
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#1E3A5F] bg-[#EEF3F8] px-3 py-1.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#DFE9F4] disabled:opacity-50 cursor-pointer tabular-nums"
                    >
                      {runningDeepReview ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Brain className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {runningDeepReview
                          ? `در حال بازبینی عمیق (${toPersianDigits(deepReviewProgress?.percent ?? 5)}٪)...`
                          : 'بازبینی عمیق اختیاری'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setWinolsWorkbenchOpen((prev) => !prev)}
                      aria-expanded={winolsWorkbenchOpen}
                      title="مشاهده جدول تولیدشده تغییرات WinOLS و ماتریس ۲بعدی انتخاب سلول‌ها (RPM × بار)"
                      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold cursor-pointer tabular-nums ${
                        winolsWorkbenchOpen
                          ? 'border-[#14532D] bg-[#14532D] text-white'
                          : 'border-[#14532D]/40 bg-[#ECFDF5] text-[#14532D] hover:bg-[#DCFCE7]'
                      }`}
                    >
                      <Grid2x2 className="h-3.5 w-3.5" />
                      <span>
                        میز کار WinOLS ({toPersianDigits(winolsGuideReport.mapsDetected)} نقشه)
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenPrintPreview}
                      title="نمایش صفحه‌بندی دقیق A4 با حاشیه‌های استاندارد و ذخیره PDF"
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#C8C1B4] bg-white px-3 py-1.5 text-xs font-bold text-[#1A1816] hover:bg-[#FAF9F6] cursor-pointer"
                    >
                      <Printer className="h-3.5 w-3.5 text-[#1E3A5F]" />
                      <span>پیش‌نمایش چاپ A4</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveStage(5)}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-[#1E3A5F] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#162C49] cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>مرحله ۵: تأیید و خروجی نهایی</span>
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {winolsWorkbenchOpen && (
                  <WinolsMapWorkbench
                    projectTitle={bundle?.project.title || activeBook.title}
                    report={winolsGuideReport}
                    auditReport={bundle?.auditReport ?? null}
                    book={activeBook}
                    outlineNodes={bundle?.outlineNodes ?? []}
                    enrichingGoogle={enrichingFullGoogle}
                    onEnrichAllWithGoogle={handleEnrichFullDocumentWithGoogle}
                    onLogActivity={handleLogProjectActivity}
                    onClose={() => setWinolsWorkbenchOpen(false)}
                    hasWinolsAppendixChapter={activeBook.chapters.some(
                      (c) => c.id === 'ch_winols_quick_guide'
                    )}
                    onJumpToWinolsAppendix={() => {
                      const chapter = activeBook.chapters.find(
                        (c) => c.id === 'ch_winols_quick_guide'
                      );
                      if (chapter) {
                        setSelectedView({ kind: 'chapter', chapterNumber: chapter.chapterNumber });
                        setWinolsWorkbenchOpen(false);
                      }
                    }}
                  />
                )}

                <DeepReviewPanel
                  report={deepReviewReport}
                  running={runningDeepReview}
                  progress={deepReviewProgress}
                  onRerun={handleRunDeepAiReview}
                />

                <div className="flex flex-1 min-h-0">
                  <div className="hidden xl:block h-full overflow-y-auto">
                    <ChapterSidebar
                      book={activeBook}
                      selected={selectedView}
                      onSelect={setSelectedView}
                    />
                  </div>

                  {mobileChaptersOpen && (
                    <div className="fixed inset-0 z-50 flex xl:hidden">
                      <div className="relative z-10 w-[82vw] max-w-[300px] h-full bg-[#F4F1EA] shadow-xl flex flex-col">
                        <div className="flex items-center justify-between border-b border-[#E2DDD3] px-4 py-3">
                          <span className="text-xs font-bold text-[#1E3A5F]">فهرست فصل‌ها</span>
                          <button
                            type="button"
                            onClick={() => setMobileChaptersOpen(false)}
                            className="p-1 text-[#57534E]"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          <ChapterSidebar
                            book={activeBook}
                            selected={selectedView}
                            onSelect={(k) => {
                              setSelectedView(k);
                              setMobileChaptersOpen(false);
                            }}
                          />
                        </div>
                      </div>
                      <div
                        className="flex-1 bg-black/40"
                        onClick={() => setMobileChaptersOpen(false)}
                      />
                    </div>
                  )}

                  <BookPreview
                    book={activeBook}
                    selected={selectedView}
                    onSelect={setSelectedView}
                    config={config}
                    onOpenChapterDrawer={() => setMobileChaptersOpen(true)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </main>

        {/* Collapsible Left Drawer: Context-Aware Gemini Chatbot + Gemini Live Voice */}
        <AssistantDrawer
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          uid={user.uid}
          isGuest={isGuest}
          projectId={activeProjectId}
          outlineNodes={bundle?.outlineNodes ?? []}
          aiModel={config.aiModel}
          getIdToken={getIdToken}
          webSearchEngineLabel={capabilityPlan.webSearchLabelFa}
          onTranscribeAudio={handleTranscribeAudioToText}
          onSendChat={async (payload) => {
            if (!activeProjectId) throw new Error('پروژه‌ای انتخاب نشده است.');
            const res = await api.sendChatMessage(activeProjectId, payload);
            if (res.aiUsage) {
              setBundle((prev) =>
                prev
                  ? {
                      ...prev,
                      project: {
                        ...prev.project,
                        checkpointJson: {
                          ...(prev.project.checkpointJson || {}),
                          aiUsage: res.aiUsage,
                        },
                      },
                    }
                  : prev
              );
            }
            return res;
          }}
          onApplyProposal={handleApplyProposal}
        />
      </div>

      <AiProviderModal
        open={providerModalOpen}
        onClose={() => setProviderModalOpen(false)}
        providerConfig={providerConfig}
        aiModel={config.aiModel}
        probeData={quotaProbe}
        probing={probingQuota}
        onSaveProviderConfig={handleSaveProviderConfig}
        onRunLiveProbe={handleRunLiveProbe}
        onProbeModels={(payload) => api.probeProviderModels(payload)}
      />

      <ProjectChangeLogModal
        open={changeLogOpen}
        projectTitle={bundle?.project.title || 'پروژه فعال'}
        revisions={revisions}
        loading={loadingRevisions}
        error={revisionsError}
        rollingBackId={rollingBackId}
        savingCheckpoint={savingCheckpoint}
        onClose={() => setChangeLogOpen(false)}
        onRefresh={() => void refreshProjectRevisions(activeProjectId)}
        onRollback={handleRollbackRevision}
        onCreateCheckpoint={handleCreateManualCheckpoint}
      />

      <GoogleWorkspaceModal
        open={googleWorkspaceModalOpen}
        initialTab={googleWorkspaceInitialTab}
        workspaceAccessToken={workspaceAccessToken}
        connectingWorkspace={signingIn}
        workflowMode={workflowMode}
        book={activeBook}
        auditReport={bundle?.auditReport ?? null}
        conflicts={bundle?.conflicts ?? []}
        winolsReport={winolsGuideReport}
        config={config}
        onConnectWorkspace={connectGoogleWorkspace}
        onImportFiles={handleImportWorkspaceFiles}
        onClose={() => setGoogleWorkspaceModalOpen(false)}
      />
      </div>

      {activeBook && (
        <PrintPreviewModal
          open={printPreviewOpen}
          book={activeBook}
          config={config}
          activeChapterNumber={activeChapterNumber}
          onClose={() => setPrintPreviewOpen(false)}
        />
      )}
    </>
  );
}
