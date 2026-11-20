import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  Download,
  FileCode,
  FileText,
  Globe,
  Layers,
  ListTree,
  Loader2,
  LogOut,
  Menu,
  Printer,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { AuthGate } from './components/AuthGate';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { PipelineStepper } from './components/PipelineStepper';
import { OutlineEditorView } from './components/OutlineEditorView';
import { AuditConflictsView } from './components/AuditConflictsView';
import { AssistantDrawer } from './components/AssistantDrawer';
import { BookPreview } from './components/BookPreview';
import {
  DeepReviewPanel,
  DeepReviewProgressBanner,
  DeepReviewProgressState,
} from './components/DeepReviewPanel';
import { ChapterSidebar, SelectedChapterKey } from './components/ChapterSidebar';
import { QueuedUploadFile } from './components/FileDropzone';
import { ApiClient } from './lib/apiClient';
import {
  ChatProposal,
  DEFAULT_DOCX_CONFIG,
  DeepReviewReportDto,
  DocxExportConfig,
  FileRole,
  OutlineNodeDto,
  ProjectBundleDto,
  ProjectSummaryDto,
  WorkflowMode,
} from './lib/bookTypes';
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

type CenterTab = 'outline' | 'preview' | 'audit';

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
  const { user, loading: authLoading, signOut, getIdToken } = useAuth();
  const api = useMemo(() => new ApiClient(getIdToken), [getIdToken]);

  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ProjectBundleDto | null>(null);
  const [liveState, setLiveState] = useState<FirestoreProjectLiveState | null>(null);

  const [centerTab, setCenterTab] = useState<CenterTab>('outline');
  const [selectedView, setSelectedView] = useState<SelectedChapterKey>({ kind: 'cover' });
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileChaptersOpen, setMobileChaptersOpen] = useState(false);

  const [queuedFiles, setQueuedFiles] = useState<QueuedUploadFile[]>([]);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('multi_merge');
  const [config, setConfig] = useState<DocxExportConfig>(DEFAULT_DOCX_CONFIG);

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [processing, setProcessing] = useState(false);
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

  // Sync Firestore real-time state for active project
  useEffect(() => {
    if (!user?.uid || !activeProjectId) {
      setLiveState(null);
      return;
    }
    const unsub = subscribeProjectLiveState(user.uid, activeProjectId, (st) => {
      setLiveState(st);
    });
    return () => unsub();
  }, [user?.uid, activeProjectId]);

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
      if (!user?.uid) return;
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
    [user?.uid, bundle?.project.title, bundle?.sourceFiles.length, queuedFiles.length]
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
          optimization: {
            ...DEFAULT_DOCX_CONFIG.optimization,
            ...(savedSettings.optimization || {}),
          },
        });
        const savedReview = normalizeDeepReviewReport(
          (b.project.checkpointJson as { lastDeepReview?: unknown } | null)?.lastDeepReview
        );
        setDeepReviewReport(savedReview);
        if (b.project.bookSnapshotJson) {
          setCenterTab('preview');
        } else if (b.outlineNodes.length > 0) {
          setCenterTab('outline');
        }
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'خطا در بارگذاری پروژه.');
      }
    },
    [api]
  );

  // Initial Cloud SQL projects load on sign-in
  useEffect(() => {
    if (!user) {
      setProjects([]);
      setActiveProjectId(null);
      setBundle(null);
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
          const created = await api.createProject({
            title: 'پروژه تدوین و یکپارچه‌سازی جدید',
            workflowMode: 'multi_merge',
            settingsJson: DEFAULT_DOCX_CONFIG as unknown as Record<string, unknown>,
          });
          if (cancelled) return;
          setProjects([created.project]);
          setBundle(created);
          setActiveProjectId(created.project.id);
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
  }, [user, api, loadProjectBundle]);

  const refreshProjectsList = useCallback(async () => {
    try {
      const { projects: list } = await api.listProjects();
      setProjects(list);
    } catch {
      // ignore transient list refresh error
    }
  }, [api]);

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
        setCenterTab('outline');
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

  // Stages 1 -> 2 -> 3 (Batch Ingestion with Pause/Resume + Two-Pass Lossless Dedup + Proposed Outline)
  const handleStartPipeline = useCallback(async () => {
    if (!activeProjectId) return;
    setProcessing(true);
    pauseRequestedRef.current = false;
    setBannerError(null);
    setBannerToast(null);
    setMobileSidebarOpen(false);

    try {
      // Save latest settings & mode first
      await api.updateProject(activeProjectId, {
        workflowMode,
        settingsJson: config as unknown as Record<string, unknown>,
      });

      // Stage 1: Chunked Batch Ingestion (supports 100+ files cleanly)
      if (queuedFiles.length > 0) {
        const batchSize = 5;
        let processedCount = 0;

        for (let i = 0; i < queuedFiles.length; i += batchSize) {
          if (pauseRequestedRef.current) {
            await api.updateProject(activeProjectId, { status: 'paused', pipelineStage: 1 });
            await syncFirestoreJobState(activeProjectId, {
              stage: 1,
              status: 'paused',
              progressPercent: Math.round((processedCount / queuedFiles.length) * 45),
              message: `توقف موقت پس از استخراج ${toPersianDigits(processedCount)} از ${toPersianDigits(queuedFiles.length)} فایل`,
              workflowMode,
            });
            setBannerToast('پردازش به‌صورت موقت متوقف شد. هر زمان خواستید ادامه دهید.');
            setProcessing(false);
            return;
          }

          const slice = queuedFiles.slice(i, i + batchSize);
          await syncFirestoreJobState(activeProjectId, {
            stage: 1,
            status: 'ingesting',
            progressPercent: Math.round((processedCount / queuedFiles.length) * 45) + 5,
            message: `در حال استخراج اتمی فایل‌های ${toPersianDigits(i + 1)} تا ${toPersianDigits(Math.min(queuedFiles.length, i + batchSize))}...`,
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

          const res = await api.ingestFilesBatch(activeProjectId, {
            replaceExisting: i === 0,
            files: prepared,
          });
          setBundle(res.bundle);
          processedCount += slice.length;
        }
        setQueuedFiles([]);
      }

      // Stage 2: Two-Pass Lossless Union & Conflict Detection
      await syncFirestoreJobState(activeProjectId, {
        stage: 2,
        status: 'deduping',
        progressPercent: 62,
        message: 'در حال حذف تکراری‌های بدون افت، کشف تناقض‌ها و چیدمان اولیه فصل‌ها...',
        workflowMode,
      });

      const afterDedup = await api.runDedupStage(activeProjectId);
      setBundle(afterDedup);
      await refreshProjectsList();

      await syncFirestoreJobState(activeProjectId, {
        stage: 3,
        status: 'awaiting_outline',
        progressPercent: 75,
        message: 'فصل‌بندی پیشنهادی آماده بررسی و تأیید شماست.',
        workflowMode,
      });

      setCenterTab('outline');
      setBannerToast(
        `تحلیل بدون افت انجام شد: ${toPersianDigits(afterDedup.outlineNodes.length)} فصل پیشنهادی، ${toPersianDigits(afterDedup.dedupClusters.length)} خوشه ادغام و ${toPersianDigits(afterDedup.conflicts.length)} تناقض شناسایی شد.`
      );
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'خطا هنگام اجرای مراحل پردازش.');
      if (activeProjectId) {
        await syncFirestoreJobState(activeProjectId, {
          stage: bundle?.project.pipelineStage ?? 1,
          status: 'error',
          progressPercent: 0,
          message: 'خطا در پردازش پروژه',
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
    queuedFiles,
    syncFirestoreJobState,
    refreshProjectsList,
    bundle?.project.pipelineStage,
  ]);

  const handleSaveOutline = useCallback(
    async (
      nextNodes: OutlineNodeDto[],
      reassignments?: Array<{ fromNodeId: string; toNodeId: string }>
    ) => {
      if (!activeProjectId) return;
      setSavingOutline(true);
      setBannerError(null);
      try {
        const updated = await api.saveOutline(activeProjectId, {
          nodes: nextNodes,
          reassignments,
        });
        setBundle(updated);
        setBannerToast('چیدمان جدید فصل‌ها ذخیره شد.');
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'ذخیره فصل‌بندی ناموفق بود.');
      } finally {
        setSavingOutline(false);
      }
    },
    [activeProjectId, api]
  );

  const handleApproveAndFinalize = useCallback(
    async (approvedNodes: OutlineNodeDto[]) => {
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
        await api.saveOutline(activeProjectId, { nodes: approvedNodes });
        const finished = await api.finalizeProject(activeProjectId);
        setBundle(finished);
        setSelectedView({ kind: 'cover' });
        setCenterTab('preview');
        await refreshProjectsList();
        await syncFirestoreJobState(activeProjectId, {
          stage: 5,
          status: 'completed',
          progressPercent: 100,
          message: 'سند یکپارچه و گزارش ممیزی ۱۰۰٪ آماده است.',
          workflowMode,
        });
        setBannerToast('سند نهایی با پوشش ۱۰۰٪ آماده پیش‌نمایش و دانلود فایل ورد است.');
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'خطا در تدوین نهایی سند.');
      } finally {
        setFinalizing(false);
      }
    },
    [activeProjectId, api, workflowMode, refreshProjectsList, syncFirestoreJobState]
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
        setCenterTab('preview');
      }
      const counts = normalizedReview.appliedCounts;
      const totalFixes =
        counts.titlesRefined +
        counts.calloutsAdded +
        counts.tablesAdded +
        counts.paragraphsAdded;
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
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'خطا در ساخت فایل ورد (.docx).');
    } finally {
      setExportingDocx(false);
    }
  }, [bundle?.project.bookSnapshotJson, config]);

  const handleDownloadMarkdown = useCallback(() => {
    const book = bundle?.project.bookSnapshotJson;
    if (!book) return;
    const md = exportBookToMarkdown(book);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    triggerBlobDownload(blob, makeSafeFileName(book.title, 'md'));
    setBannerToast('نسخه Markdown تمیز سند دانلود شد.');
  }, [bundle?.project.bookSnapshotJson]);

  const unitCountsByNode = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!bundle) return counts;
    for (const u of bundle.contentUnits) {
      if (u.status === 'merged' || !u.outlineNodeId) continue;
      counts[u.outlineNodeId] = (counts[u.outlineNodeId] || 0) + 1;
    }
    return counts;
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

  return (
    <div dir="rtl" className="min-h-screen bg-[#F8F6F1] text-[#1A1816] flex flex-col">
      {/* Top Studio Header */}
      <header className="sticky top-0 z-30 h-[58px] border-b border-[#E2DDD3] bg-white px-3 sm:px-5 flex items-center justify-between gap-2">
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
            <div className="hidden sm:block text-[10.5px] text-[#78716C]">
              فونت وزیر مدیوم · راست‌چین کامل · تضمین پوشش ۱۰۰٪
            </div>
          </div>
        </div>

        {/* Center Workspace Tabs */}
        <nav className="hidden md:flex items-center gap-1 rounded-lg bg-[#F5F3EE] p-1">
          <button
            type="button"
            onClick={() => setCenterTab('outline')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              centerTab === 'outline'
                ? 'bg-white text-[#1E3A5F] shadow-xs'
                : 'text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <ListTree className="h-3.5 w-3.5" />
            فصل‌بندی ({toPersianDigits(bundle?.outlineNodes.length || 0)})
          </button>

          <button
            type="button"
            onClick={() => setCenterTab('preview')}
            disabled={!activeBook}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 ${
              centerTab === 'preview'
                ? 'bg-white text-[#1E3A5F] shadow-xs'
                : 'text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            پیش‌نمایش سند
          </button>

          <button
            type="button"
            onClick={() => setCenterTab('audit')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              centerTab === 'audit'
                ? 'bg-white text-[#1E3A5F] shadow-xs'
                : 'text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            ممیزی و تناقض‌ها
            {openConflictsCount > 0 && (
              <span className="rounded-sm bg-[#9A3412] px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                {toPersianDigits(openConflictsCount)}
              </span>
            )}
          </button>
        </nav>

        {/* Trailing Controls: Assistant Drawer Toggle + User */}
        <div className="flex items-center gap-2 shrink-0">
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
            {user.photoURL ? (
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
              title="خروج از حساب کاربری"
              aria-label="خروج از حساب کاربری"
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#57534E] hover:bg-[#FDF2F0] hover:text-[#9A3412] cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Center Tabs Bar */}
      <div className="flex md:hidden items-center justify-around border-b border-[#E2DDD3] bg-white px-2 py-1.5 text-xs">
        <button
          type="button"
          onClick={() => setCenterTab('outline')}
          className={`flex-1 py-1.5 rounded-md font-bold ${
            centerTab === 'outline' ? 'bg-[#EEF3F8] text-[#1E3A5F]' : 'text-[#57534E]'
          }`}
        >
          فصل‌بندی
        </button>
        <button
          type="button"
          onClick={() => setCenterTab('preview')}
          disabled={!activeBook}
          className={`flex-1 py-1.5 rounded-md font-bold disabled:opacity-40 ${
            centerTab === 'preview' ? 'bg-[#EEF3F8] text-[#1E3A5F]' : 'text-[#57534E]'
          }`}
        >
          پیش‌نمایش
        </button>
        <button
          type="button"
          onClick={() => setCenterTab('audit')}
          className={`flex-1 py-1.5 rounded-md font-bold ${
            centerTab === 'audit' ? 'bg-[#EEF3F8] text-[#1E3A5F]' : 'text-[#57534E]'
          }`}
        >
          ممیزی ({toPersianDigits(bundle?.conflicts.length || 0)})
        </button>
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
            ingestedFilesCount={bundle?.sourceFiles.length ?? 0}
            ingestedWordCount={ingestedWordCount}
            chapterCount={bundle?.outlineNodes.length ?? 0}
            aiUsage={projectAiUsage}
            config={config}
            processing={processing}
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
            onChangeConfig={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
            onChangeOptimization={(patch) =>
              setConfig((prev) => ({
                ...prev,
                optimization: { ...prev.optimization, ...patch },
              }))
            }
            onStartPipeline={handleStartPipeline}
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
                ingestedFilesCount={bundle?.sourceFiles.length ?? 0}
                ingestedWordCount={ingestedWordCount}
                chapterCount={bundle?.outlineNodes.length ?? 0}
                aiUsage={projectAiUsage}
                config={config}
                processing={processing}
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
                onChangeConfig={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
                onChangeOptimization={(patch) =>
                  setConfig((prev) => ({
                    ...prev,
                    optimization: { ...prev.optimization, ...patch },
                  }))
                }
                onStartPipeline={handleStartPipeline}
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
            currentStage={liveState?.stage ?? bundle?.project.pipelineStage ?? 1}
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
            onPauseToggle={() => {
              if (bundle?.project.status === 'paused' || liveState?.status === 'paused') {
                void handleStartPipeline();
              } else {
                pauseRequestedRef.current = true;
              }
            }}
            onSelectStageView={(st) => {
              if (st === 3) setCenterTab('outline');
              else if (st === 4 || st === 5) {
                if (activeBook) setCenterTab('preview');
                else setCenterTab('audit');
              }
            }}
          />

          <div className="flex-1 lg:overflow-y-auto">
            {loadingProjects ? (
              <div className="h-full flex items-center justify-center gap-2 text-sm text-[#57534E] py-16">
                <Loader2 className="h-5 w-5 animate-spin text-[#1E3A5F]" />
                <span>در حال بارگذاری پروژه‌های ذخیره‌شده...</span>
              </div>
            ) : centerTab === 'outline' && (!bundle || bundle.outlineNodes.length === 0) ? (
              <div className="mx-auto max-w-2xl px-4 py-12 text-center space-y-5">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EEF3F8] text-[#1E3A5F]">
                  <Layers className="h-7 w-7" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-extrabold text-[#1A1816]">
                    آماده شروع تدوین و ادغام بدون افت اسناد
                  </h2>
                  <p className="text-sm text-[#57534E] leading-7">
                    از ستون سمت راست، حالت پردازش دلخواه خود را انتخاب کنید، یک یا چند فایل (.docx، .pdf، .md، .txt، .json) را رها کنید و دکمه «استخراج و ادغام بدون افت» را بزنید.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleLoadQuickDemoFiles}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#1E3A5F] bg-white px-5 py-2.5 text-xs sm:text-sm font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                  >
                    <Sparkles className="h-4 w-4" />
                    بارگذاری ۲ فایل نمونه برای تست ادغام و کشف تناقض
                  </button>

                  <button
                    type="button"
                    onClick={() => setMobileSidebarOpen(true)}
                    className="lg:hidden inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1E3A5F] px-5 py-2.5 text-xs font-bold text-white cursor-pointer"
                  >
                    انتخاب فایل از دستگاه
                  </button>
                </div>
              </div>
            ) : centerTab === 'outline' && bundle ? (
              <OutlineEditorView
                nodes={bundle.outlineNodes}
                unitCountsByNode={unitCountsByNode}
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
              />
            ) : centerTab === 'audit' && bundle ? (
              <AuditConflictsView
                auditReport={bundle.auditReport}
                clusters={bundle.dedupClusters}
                conflicts={bundle.conflicts}
                groundingConflictId={groundingConflictId}
                resolvingConflictId={resolvingConflictId}
                rescanningConflicts={rescanningConflicts}
                onRescanConflicts={handleRescanConflicts}
                onCheckConflictWithGoogle={handleCheckConflictWithGoogle}
                onResolveConflict={handleResolveConflict}
              />
            ) : activeBook ? (
              <div className="flex flex-col h-full">
                {/* Export & Deep Enhancement Action Bar */}
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
                      <span className="hidden sm:inline text-[#78716C] mr-2">
                        (برای دیدن فایل منبع روی هر پاراگراف کلیک کنید)
                      </span>
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleEnrichFullDocumentWithGoogle}
                      disabled={enrichingFullGoogle || runningDeepReview}
                      title="تکمیل تمام فصل‌های متن خروجی با جستجوی گوگل و لینک منابع"
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#D7CBE6] bg-[#F7F4FA] px-3 py-1.5 text-xs font-bold text-[#5B21B6] hover:bg-[#ECE5F5] disabled:opacity-50 cursor-pointer"
                    >
                      {enrichingFullGoogle ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Globe className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {enrichingFullGoogle ? 'در حال تکمیل کل متن با گوگل...' : 'تکمیل کل متن با گوگل'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleRunDeepAiReview}
                      disabled={runningDeepReview || enrichingFullGoogle}
                      title="بازبینی عمیق سند با بالاترین سطح استدلال (XHIGH) برای کشف و رفع نقص‌ها بدون حذف محتوا"
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
                          : 'بازبینی با قدرت بیشتر هوش مصنوعی'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadMarkdown}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#C8C1B4] bg-white px-3 py-1.5 text-xs font-semibold text-[#1A1816] hover:bg-[#FAF9F6] cursor-pointer"
                    >
                      <FileCode className="h-3.5 w-3.5 text-[#1E3A5F]" />
                      <span>Markdown</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#C8C1B4] bg-white px-3 py-1.5 text-xs font-semibold text-[#1A1816] hover:bg-[#FAF9F6] cursor-pointer"
                    >
                      <Printer className="h-3.5 w-3.5 text-[#1E3A5F]" />
                      <span>چاپ / PDF</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadDocx}
                      disabled={exportingDocx}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-[#1E3A5F] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-60 cursor-pointer"
                    >
                      {exportingDocx ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      <span>دانلود فایل ورد (.docx)</span>
                    </button>
                  </div>
                </div>

                {runningDeepReview && deepReviewProgress && (
                  <DeepReviewProgressBanner progress={deepReviewProgress} variant="bar" />
                )}

                {deepReviewReport && (
                  <DeepReviewPanel
                    report={deepReviewReport}
                    running={runningDeepReview}
                    onRerun={handleRunDeepAiReview}
                  />
                )}

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
          projectId={activeProjectId}
          outlineNodes={bundle?.outlineNodes ?? []}
          aiModel={config.aiModel}
          getIdToken={getIdToken}
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
    </div>
  );
}
