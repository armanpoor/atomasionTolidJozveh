import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../lib/apiClient';
import type { ProjectBundleDto, ValidationDomain } from '../lib/bookTypes';
import type { ProjectRevisionDto } from '../lib/changeLogUtils';
import {
  extractHarnessStateFromCheckpoint,
  loadHarnessStateLocal,
  reconcileHarnessStates,
  saveHarnessStateLocal,
} from '../lib/harness/harnessStore';
import type {
  GlossaryTermEntry,
  HarnessState,
  SemanticBlock,
} from '../lib/harness/types';

export interface HarnessRoutingInfo {
  authorModelId: string;
  patchModelId: string;
  utilityModelId: string;
  enablePromptCaching: boolean;
}

export interface UseHarnessRunnerResult {
  harnessState: HarnessState | null;
  routingInfo: HarnessRoutingInfo | null;
  initializing: boolean;
  approving: boolean;
  running: boolean;
  steppingSectionId: string | null;
  resolvingSectionId: string | null;
  retryingSectionId: string | null;
  syncingBook: boolean;
  error: string | null;
  lastStepMessage: string | null;
  avgStepLatencyMs: number | null;
  etaSeconds: number | null;
  initBlueprint: (options?: {
    budgetCapUsd?: number;
    forceReset?: boolean;
    validationDomain?: ValidationDomain;
  }) => Promise<void>;
  approveAndOptionallyStart: (options?: {
    budgetCapUsd?: number;
    glossaryEntries?: GlossaryTermEntry[];
    validationDomain?: ValidationDomain;
    autoRun?: boolean;
  }) => Promise<void>;
  startRun: (options?: { allowBudgetOverride?: boolean }) => Promise<void>;
  pauseRun: () => void;
  runSingleStep: (options?: { sectionId?: string; allowBudgetOverride?: boolean }) => Promise<void>;
  resolveQuarantine: (
    sectionId: string,
    payload: { editedBlocks?: SemanticBlock[]; resolutionNote?: string }
  ) => Promise<void>;
  retryQuarantineFlagship: (
    sectionId: string,
    options?: { allowBudgetOverride?: boolean }
  ) => Promise<void>;
  syncBookFromHarness: () => Promise<void>;
  clearError: () => void;
}

export function useHarnessRunner(params: {
  api: ApiClient;
  bundle: ProjectBundleDto | null;
  ownerUid?: string | null;
  onBundleUpdated: (nextBundle: ProjectBundleDto, revisions?: ProjectRevisionDto[]) => void;
  onSyncCompleteNavigateStage4?: () => void;
}): UseHarnessRunnerResult {
  const { api, bundle, ownerUid, onBundleUpdated, onSyncCompleteNavigateStage4 } = params;
  const projectId = bundle?.project?.id || null;

  const [harnessState, setHarnessState] = useState<HarnessState | null>(null);
  const [routingInfo, setRoutingInfo] = useState<HarnessRoutingInfo | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [running, setRunning] = useState(false);
  const [steppingSectionId, setSteppingSectionId] = useState<string | null>(null);
  const [resolvingSectionId, setResolvingSectionId] = useState<string | null>(null);
  const [retryingSectionId, setRetryingSectionId] = useState<string | null>(null);
  const [syncingBook, setSyncingBook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastStepMessage, setLastStepMessage] = useState<string | null>(null);
  const [avgStepLatencyMs, setAvgStepLatencyMs] = useState<number | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  const pauseRequestedRef = useRef(false);
  const activeRunRef = useRef(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const harnessStateRef = useRef<HarnessState | null>(null);
  const stepDurationsRef = useRef<number[]>([]);

  useEffect(() => {
    harnessStateRef.current = harnessState;
  }, [harnessState]);

  // Bug #1 Fix (Effect A): Abort active loops and reset transient state ONLY when projectId changes
  useEffect(() => {
    pauseRequestedRef.current = true;
    activeAbortControllerRef.current?.abort();
    activeAbortControllerRef.current = null;
    activeRunRef.current = false;
    stepDurationsRef.current = [];
    setRunning(false);
    setSteppingSectionId(null);
    setResolvingSectionId(null);
    setRetryingSectionId(null);
    setAvgStepLatencyMs(null);
    setEtaSeconds(null);
    setError(null);

    if (!projectId) {
      setHarnessState(null);
    }

    return () => {
      pauseRequestedRef.current = true;
      activeAbortControllerRef.current?.abort();
      activeAbortControllerRef.current = null;
      activeRunRef.current = false;
    };
  }, [projectId]);

  // Bug #1 + Bug #10 Fix (Effect B): Reconcile Cloud SQL with scoped IndexedDB ONLY when not actively running
  useEffect(() => {
    if (!projectId) {
      setHarnessState(null);
      return;
    }
    if (activeRunRef.current) {
      // Never clobber or abort an in-flight continuous Harness loop when onBundleUpdated updates checkpointJson
      return;
    }

    let cancelled = false;
    const cloudState = extractHarnessStateFromCheckpoint(bundle?.project?.checkpointJson);

    void (async () => {
      const localState = await loadHarnessStateLocal(projectId, ownerUid);
      const reconciled = reconcileHarnessStates(cloudState, localState);
      if (cancelled || activeRunRef.current) return;
      setHarnessState(reconciled);
      if (reconciled) {
        await saveHarnessStateLocal(reconciled, ownerUid);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, bundle?.project?.checkpointJson, ownerUid]);

  const updateEtaMetrics = useCallback((nextState: HarnessState, stepDurationMs: number) => {
    const history = [...stepDurationsRef.current, stepDurationMs].slice(-12);
    stepDurationsRef.current = history;
    const avgMs = Math.round(history.reduce((sum, v) => sum + v, 0) / history.length);
    setAvgStepLatencyMs(avgMs);

    const sections = Object.values(nextState.coverageLedger?.bySectionId || {});
    const pendingCount = sections.filter(
      (s) => s.status === 'pending' || s.status === 'drafted' || s.status === 'drafted_unverified'
    ).length;
    setEtaSeconds(pendingCount > 0 ? Math.max(1, Math.round((pendingCount * avgMs) / 1000)) : 0);
  }, []);

  const initBlueprint = useCallback(
    async (options?: {
      budgetCapUsd?: number;
      forceReset?: boolean;
      validationDomain?: ValidationDomain;
    }) => {
      if (!projectId) return;
      setInitializing(true);
      setError(null);
      try {
        const res = await api.initHarnessBlueprint(projectId, options);
        setHarnessState(res.harnessState);
        setRoutingInfo(res.routingInfo);
        await saveHarnessStateLocal(res.harnessState, ownerUid);
        onBundleUpdated(res.bundle);
        setLastStepMessage('نقشه راه هارنس (MasterBlueprint) و واژه‌نامه اولیه بدون مصرف توکن ساخته شد.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'خطا در مقداردهی نقشه راه هارنس.');
      } finally {
        setInitializing(false);
      }
    },
    [api, projectId, ownerUid, onBundleUpdated]
  );

  const runLoop = useCallback(
    async (allowBudgetOverride = false) => {
      if (!projectId || activeRunRef.current) return;
      activeRunRef.current = true;
      pauseRequestedRef.current = false;
      setRunning(true);
      setError(null);

      // Bug #2 Fix: Dynamic ceiling proportional to blueprint size (minimum 500 steps)
      const knownSections = Object.keys(
        harnessStateRef.current?.coverageLedger?.bySectionId || {}
      ).length;
      const maxSteps = Math.max(500, knownSections * 4 + 25);

      let overrideForNext = allowBudgetOverride;
      try {
        // Sequential stateless execution: 1 subsection per API call
        for (let guard = 0; guard < maxSteps; guard++) {
          if (pauseRequestedRef.current) {
            setLastStepMessage('اجرای هارنس با دستور شما متوقف (Pause) شد؛ پیشرفت در Cloud SQL و IndexedDB ذخیره است.');
            break;
          }

          const stepStartedAt = Date.now();
          const controller = new AbortController();
          activeAbortControllerRef.current = controller;
          const stepRes = await api.executeHarnessStep(
            projectId,
            {
              allowBudgetOverride: overrideForNext,
            },
            { signal: controller.signal }
          );
          activeAbortControllerRef.current = null;
          overrideForNext = false;

          updateEtaMetrics(stepRes.harnessState, Date.now() - stepStartedAt);
          setHarnessState(stepRes.harnessState);
          await saveHarnessStateLocal(stepRes.harnessState, ownerUid);
          onBundleUpdated(stepRes.bundle);

          if (stepRes.pausedByBudgetCap) {
            setLastStepMessage(
              stepRes.harnessState.telemetry.budgetCapMessage ||
                'مدار شکن بودجه فعال شد و اجرا پیش از عبور از سقف هزینه متوقف گردید.'
            );
            break;
          }

          if (stepRes.sectionId) {
            setSteppingSectionId(stepRes.sectionId);
            const outcomeLabel =
              stepRes.outcome === 'verified'
                ? 'تأیید دولایه شد'
                : stepRes.outcome === 'quarantined'
                  ? 'پس از ۲ ترمیم به صف قرنطینه منتقل شد'
                  : 'پردازش شد';
            setLastStepMessage(`زیربخش ${stepRes.sectionId} ${outcomeLabel}.`);
          }

          if (stepRes.done) {
            setLastStepMessage('اجرای کامل هارنس با موفقیت به پایان رسید و سند نهایی همگام‌سازی شد.');
            break;
          }
        }
      } catch (err) {
        const isUserAbort =
          pauseRequestedRef.current ||
          (err instanceof Error && (err.name === 'AbortError' || err.message.includes('step_aborted_by_user')));
        if (isUserAbort) {
          setLastStepMessage(
            'اجرای هارنس فوراً با دستور شما متوقف شد؛ پیش‌نویس‌های ذخیره‌شده بدون اتلاف در Cloud SQL و IndexedDB محفوظ هستند.'
          );
        } else {
          setError(err instanceof Error ? err.message : 'خطا در اجرای گام هارنس.');
        }
      } finally {
        activeAbortControllerRef.current = null;
        activeRunRef.current = false;
        setRunning(false);
        setSteppingSectionId(null);
      }
    },
    [api, projectId, ownerUid, onBundleUpdated, updateEtaMetrics]
  );

  const approveAndOptionallyStart = useCallback(
    async (options?: {
      budgetCapUsd?: number;
      glossaryEntries?: GlossaryTermEntry[];
      validationDomain?: ValidationDomain;
      autoRun?: boolean;
    }) => {
      if (!projectId) return;
      setApproving(true);
      setError(null);
      try {
        const res = await api.approveHarnessBlueprint(projectId, {
          budgetCapUsd: options?.budgetCapUsd,
          glossaryEntries: options?.glossaryEntries,
          validationDomain: options?.validationDomain,
        });
        setHarnessState(res.harnessState);
        setRoutingInfo(res.routingInfo);
        await saveHarnessStateLocal(res.harnessState, ownerUid);
        onBundleUpdated(res.bundle, res.revisions);
        setLastStepMessage('نقشه راه و واژه‌نامه زنده در دروازه HITL تایید و فریز شد.');
        if (options?.autoRun) {
          void runLoop(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'خطا در تایید دروازه HITL هارنس.');
      } finally {
        setApproving(false);
      }
    },
    [api, projectId, ownerUid, onBundleUpdated, runLoop]
  );

  const startRun = useCallback(
    async (options?: { allowBudgetOverride?: boolean }) => {
      await runLoop(Boolean(options?.allowBudgetOverride));
    },
    [runLoop]
  );

  const pauseRun = useCallback(() => {
    pauseRequestedRef.current = true;
    activeAbortControllerRef.current?.abort();
  }, []);

  const runSingleStep = useCallback(
    async (options?: { sectionId?: string; allowBudgetOverride?: boolean }) => {
      if (!projectId || activeRunRef.current) return;
      activeRunRef.current = true;
      pauseRequestedRef.current = false;
      setRunning(true);
      setSteppingSectionId(options?.sectionId || 'next');
      setError(null);
      const stepStartedAt = Date.now();
      const controller = new AbortController();
      activeAbortControllerRef.current = controller;
      try {
        const stepRes = await api.executeHarnessStep(
          projectId,
          {
            sectionId: options?.sectionId,
            allowBudgetOverride: Boolean(options?.allowBudgetOverride),
          },
          { signal: controller.signal }
        );
        updateEtaMetrics(stepRes.harnessState, Date.now() - stepStartedAt);
        setHarnessState(stepRes.harnessState);
        await saveHarnessStateLocal(stepRes.harnessState, ownerUid);
        onBundleUpdated(stepRes.bundle);
        if (stepRes.pausedByBudgetCap) {
          setLastStepMessage(
            stepRes.harnessState.telemetry.budgetCapMessage ||
              'مدار شکن بودجه مانع اجرای گام بعدی شد.'
          );
        } else if (stepRes.done) {
          setLastStepMessage('تمامی زیربخش‌های نقشه راه پردازش شدند.');
        } else {
          setLastStepMessage(
            stepRes.outcome === 'quarantined'
              ? 'زیربخش پس از ۲ تلاش ترمیم جراحی به صف قرنطینه منتقل شد.'
              : 'زیربخش با موفقیت تولید و در ممیزی دولایه تأیید شد.'
          );
        }
      } catch (err) {
        const isUserAbort =
          pauseRequestedRef.current ||
          (err instanceof Error && (err.name === 'AbortError' || err.message.includes('step_aborted_by_user')));
        if (isUserAbort) {
          setLastStepMessage('تک‌گام هارنس با دستور شما متوقف شد و وضعیت فعلی ذخیره گردید.');
        } else {
          setError(err instanceof Error ? err.message : 'خطا در اجرای تک‌گام هارنس.');
        }
      } finally {
        activeAbortControllerRef.current = null;
        activeRunRef.current = false;
        setRunning(false);
        setSteppingSectionId(null);
      }
    },
    [api, projectId, ownerUid, onBundleUpdated, updateEtaMetrics]
  );

  const resolveQuarantine = useCallback(
    async (
      sectionId: string,
      payload: { editedBlocks?: SemanticBlock[]; resolutionNote?: string }
    ) => {
      if (!projectId) return;
      setResolvingSectionId(sectionId);
      setError(null);
      try {
        const res = await api.resolveHarnessQuarantine(projectId, sectionId, payload);
        setHarnessState(res.harnessState);
        await saveHarnessStateLocal(res.harnessState, ownerUid);
        onBundleUpdated(res.bundle, res.revisions);
        setLastStepMessage('زیربخش قرنطینه‌شده با موفقیت تأیید دستی و به سند نهایی اضافه شد.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'خطا در تأیید دستی زیربخش قرنطینه‌شده.');
      } finally {
        setResolvingSectionId(null);
      }
    },
    [api, projectId, ownerUid, onBundleUpdated]
  );

  const retryQuarantineFlagship = useCallback(
    async (sectionId: string, options?: { allowBudgetOverride?: boolean }) => {
      if (!projectId || activeRunRef.current) return;
      setRetryingSectionId(sectionId);
      setError(null);
      const stepStartedAt = Date.now();
      try {
        const res = await api.retryQuarantineFlagship(projectId, sectionId, {
          allowBudgetOverride: Boolean(options?.allowBudgetOverride),
        });
        updateEtaMetrics(res.harnessState, Date.now() - stepStartedAt);
        setHarnessState(res.harnessState);
        await saveHarnessStateLocal(res.harnessState, ownerUid);
        onBundleUpdated(res.bundle);
        if (res.pausedByBudgetCap) {
          setLastStepMessage(
            res.harnessState.telemetry.budgetCapMessage ||
              'مدار شکن بودجه مانع بازنویسی پرچمدار شد.'
          );
        } else if (res.outcome === 'verified') {
          setLastStepMessage('زیربخش قرنطینه‌شده با مدل پرچمدار بازنویسی و در ممیزی دولایه تأیید شد.');
        } else {
          setLastStepMessage('بازنویسی با مدل پرچمدار انجام شد؛ هنوز برخی موارد نیاز به بررسی دستی دارند.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'خطا در بازنویسی زیربخش با مدل پرچمدار.');
      } finally {
        setRetryingSectionId(null);
      }
    },
    [api, projectId, ownerUid, onBundleUpdated, updateEtaMetrics]
  );

  const syncBookFromHarness = useCallback(async () => {
    if (!projectId) return;
    setSyncingBook(true);
    setError(null);
    try {
      const res = await api.syncHarnessBook(projectId);
      setHarnessState(res.harnessState);
      await saveHarnessStateLocal(res.harnessState, ownerUid);
      onBundleUpdated(res.bundle);
      setLastStepMessage('خروجی Semantic IR هارنس با موفقیت به سند A4 و فایل ورد منتقل شد.');
      onSyncCompleteNavigateStage4?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در همگام‌سازی سند نهایی.');
    } finally {
      setSyncingBook(false);
    }
  }, [api, projectId, ownerUid, onBundleUpdated, onSyncCompleteNavigateStage4]);

  return {
    harnessState,
    routingInfo,
    initializing,
    approving,
    running,
    steppingSectionId,
    resolvingSectionId,
    retryingSectionId,
    syncingBook,
    error,
    lastStepMessage,
    avgStepLatencyMs,
    etaSeconds,
    initBlueprint,
    approveAndOptionallyStart,
    startRun,
    pauseRun,
    runSingleStep,
    resolveQuarantine,
    retryQuarantineFlagship,
    syncBookFromHarness,
    clearError: () => setError(null),
  };
}

