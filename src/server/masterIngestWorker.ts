import {
  claimNextQueuedMasterIngestJob,
  completeMasterIngestJob,
  createMasterIngestLog,
  failMasterIngestJob,
  type MasterIngestJobRow,
} from '../db/masterEncyclopediaRepository.ts';
import { isMasterEncyclopediaEnabled } from '../lib/masterEncyclopedia/featureFlag.ts';

export interface MasterIngestExecutionReport {
  newUnitsCount: number;
  duplicateUnitsCount: number;
  mergedUnitsCount: number;
  conflictsCount: number;
  stagingUnitsCount: number;
  createdVolumes: string[];
  createdChapters: string[];
  modelsUsed: string[];
  summaryFa: string;
}

export type MasterIngestJobProcessor = (
  job: MasterIngestJobRow
) => Promise<MasterIngestExecutionReport>;

let customProcessor: MasterIngestJobProcessor | null = null;
let workerTimer: ReturnType<typeof setInterval> | null = null;
let isDraining = false;
let drainPending = false;

export function setMasterIngestJobProcessor(processor: MasterIngestJobProcessor | null): void {
  customProcessor = processor;
}

const defaultProcessor: MasterIngestJobProcessor = async (job) => {
  return {
    newUnitsCount: 0,
    duplicateUnitsCount: 0,
    mergedUnitsCount: 0,
    conflictsCount: 0,
    stagingUnitsCount: 0,
    createdVolumes: [],
    createdChapters: [],
    modelsUsed: ['layer0-deterministic'],
    summaryFa: `فایل ${job.sourceFileName} در صف پردازش دایرةالمعارف ثبت و بررسی شد.`,
  };
};

/**
 * Claims and executes the next queued job once, recording ingest logs and
 * transitioning failed jobs to retry or DLQ safely without throwing to callers.
 */
export async function processNextMasterIngestJob(
  overrideProcessor?: MasterIngestJobProcessor,
  env: Record<string, string | undefined> = process.env
): Promise<{ processed: boolean; jobId?: string; status?: string; error?: string }> {
  if (!isMasterEncyclopediaEnabled(env)) {
    return { processed: false };
  }

  const job = await claimNextQueuedMasterIngestJob();
  if (!job) {
    return { processed: false };
  }

  const startedAt = Date.now();
  const processor = overrideProcessor ?? customProcessor ?? defaultProcessor;

  try {
    const report = await processor(job);
    const completed = await completeMasterIngestJob(job.id);
    await createMasterIngestLog({
      jobId: job.id,
      ingestBatchId: job.ingestBatchId,
      sourceUploadHash: job.sourceUploadHash,
      sourceFileName: job.sourceFileName,
      newUnitsCount: report.newUnitsCount,
      duplicateUnitsCount: report.duplicateUnitsCount,
      mergedUnitsCount: report.mergedUnitsCount,
      conflictsCount: report.conflictsCount,
      stagingUnitsCount: report.stagingUnitsCount,
      createdVolumesJson: report.createdVolumes,
      createdChaptersJson: report.createdChapters,
      modelsUsedJson: report.modelsUsed,
      durationMs: Math.max(1, Date.now() - startedAt),
      status: 'completed',
      summaryFa: report.summaryFa,
    });
    return { processed: true, jobId: job.id, status: completed?.status ?? 'completed' };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const failedJob = await failMasterIngestJob(job.id, errorMessage);
    if (failedJob?.status === 'dlq') {
      await createMasterIngestLog({
        jobId: job.id,
        ingestBatchId: job.ingestBatchId,
        sourceUploadHash: job.sourceUploadHash,
        sourceFileName: job.sourceFileName,
        newUnitsCount: 0,
        duplicateUnitsCount: 0,
        mergedUnitsCount: 0,
        conflictsCount: 0,
        stagingUnitsCount: 0,
        createdVolumesJson: [],
        createdChaptersJson: [],
        modelsUsedJson: ['layer0-deterministic'],
        durationMs: Math.max(1, Date.now() - startedAt),
        status: 'dlq',
        summaryFa: `پردازش فایل ${job.sourceFileName} پس از ${failedJob.attempts} تلاش ناموفق به صف DLQ منتقل شد: ${errorMessage}`,
      });
    }
    return {
      processed: true,
      jobId: job.id,
      status: failedJob?.status ?? 'failed',
      error: errorMessage,
    };
  }
}

export async function drainMasterIngestQueue(
  maxJobs = 10,
  overrideProcessor?: MasterIngestJobProcessor,
  env: Record<string, string | undefined> = process.env
): Promise<number> {
  if (!isMasterEncyclopediaEnabled(env)) {
    return 0;
  }
  if (isDraining) {
    drainPending = true;
    return 0;
  }
  isDraining = true;
  let processedCount = 0;
  try {
    do {
      drainPending = false;
      while (processedCount < maxJobs) {
        const result = await processNextMasterIngestJob(overrideProcessor, env);
        if (!result.processed) break;
        processedCount += 1;
      }
    } while (drainPending && processedCount < maxJobs);
  } finally {
    isDraining = false;
  }
  return processedCount;
}

export function triggerMasterIngestWorkerDrain(): void {
  if (!isMasterEncyclopediaEnabled()) return;
  queueMicrotask(() => {
    void drainMasterIngestQueue(5).catch((err) => {
      console.warn('[MasterIngestWorker] Background drain failed safely:', err);
    });
  });
}

export function startMasterIngestWorker(intervalMs = 4000): void {
  if (!isMasterEncyclopediaEnabled()) return;
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void drainMasterIngestQueue(3).catch((err) => {
      console.warn('[MasterIngestWorker] Poll tick failed safely:', err);
    });
  }, intervalMs);
  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref();
  }
}

export function stopMasterIngestWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
