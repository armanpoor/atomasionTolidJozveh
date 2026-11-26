import type { CoverageLedger, CoverageStatus, HarnessState } from './types.ts';

const DB_NAME = 'studio_ecu_harness_v1';
const DB_VERSION = 1;
const STORE_NAME = 'harness_states';

const memoryFallbackStore = new Map<string, HarnessState>();

function hasIndexedDb(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined';
}

function openHarnessDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB is not available in this runtime.'));
      return;
    }
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open Harness IndexedDB.'));
  });
}

function buildScopedStorageKey(projectId: string, ownerUid?: string | null): string {
  const uid = (ownerUid || '').trim();
  return uid ? `${uid}::${projectId}` : projectId;
}

export async function saveHarnessStateLocal(
  state: HarnessState,
  ownerUid?: string | null
): Promise<void> {
  if (!state?.projectId) return;
  const scopedKey = buildScopedStorageKey(state.projectId, ownerUid);
  const clone: HarnessState & { _storageKey?: string } = JSON.parse(JSON.stringify(state));
  memoryFallbackStore.set(scopedKey, clone);

  if (!hasIndexedDb()) return;
  try {
    const db = await openHarnessDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ ...clone, projectId: scopedKey });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    });
    db.close();
  } catch {
    // Keep memory fallback silently if browser blocks IndexedDB in restricted iframe/private mode
  }
}

export async function loadHarnessStateLocal(
  projectId: string,
  ownerUid?: string | null
): Promise<HarnessState | null> {
  if (!projectId) return null;
  const scopedKey = buildScopedStorageKey(projectId, ownerUid);
  const hasUid = Boolean((ownerUid || '').trim());
  if (!hasIndexedDb()) {
    const mem = hasUid ? memoryFallbackStore.get(scopedKey) : memoryFallbackStore.get(projectId);
    return mem ? JSON.parse(JSON.stringify(mem)) : null;
  }

  try {
    const db = await openHarnessDb();
    const loaded = await new Promise<HarnessState | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(scopedKey);
      req.onsuccess = () => resolve((req.result as HarnessState | undefined) || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
    db.close();
    if (loaded) {
      const restored = { ...loaded, projectId };
      memoryFallbackStore.set(scopedKey, restored);
      return restored;
    }
  } catch {
    // Fall back to in-memory cache
  }

  const mem = hasUid ? memoryFallbackStore.get(scopedKey) : memoryFallbackStore.get(projectId);
  return mem ? JSON.parse(JSON.stringify(mem)) : null;
}

export async function clearHarnessStateLocal(
  projectId: string,
  ownerUid?: string | null
): Promise<void> {
  const hasUid = Boolean((ownerUid || '').trim());
  const scopedKey = buildScopedStorageKey(projectId, ownerUid);
  memoryFallbackStore.delete(scopedKey);
  if (!hasUid) {
    memoryFallbackStore.delete(projectId);
  }
  if (!hasIndexedDb()) return;
  try {
    const db = await openHarnessDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(scopedKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
    });
    db.close();
  } catch {
    // ignore
  }
}

export function extractHarnessStateFromCheckpoint(
  checkpointJson: Record<string, unknown> | null | undefined
): HarnessState | null {
  if (!checkpointJson || typeof checkpointJson !== 'object') return null;
  const candidate = (checkpointJson as Record<string, unknown>).harnessState;
  if (!candidate || typeof candidate !== 'object') return null;
  const state = candidate as Partial<HarnessState>;
  if (
    state.schemaVersion !== 1 ||
    typeof state.projectId !== 'string' ||
    !state.blueprint ||
    !state.coverageLedger
  ) {
    return null;
  }
  return state as HarnessState;
}

function progressScore(state: HarnessState): number {
  const sections = Object.values(state.coverageLedger?.bySectionId || {});
  let score = state.blueprint?.approved ? 10 : 0;
  for (const s of sections) {
    if (s.status === 'verified') score += 5;
    else if (s.status === 'drafted' || s.status === 'drafted_unverified') score += 2;
    else if (s.status === 'quarantined') score += 1;
  }
  return score;
}

/**
 * Reconciles Cloud SQL harnessState (primary) with IndexedDB local mirror (offline/refresh backup).
 * Prefers newer timestamp when timestamps differ meaningfully, while ensuring verified sections
 * and resolved quarantine records are never lost during race conditions.
 */
export function reconcileHarnessStates(
  cloudState: HarnessState | null,
  localState: HarnessState | null
): HarnessState | null {
  if (!cloudState && !localState) return null;
  if (!cloudState) return localState;
  if (!localState) return cloudState;

  const cloudTs = Date.parse(cloudState.updatedAt || '') || 0;
  const localTs = Date.parse(localState.updatedAt || '') || 0;

  const sameBlueprint =
    cloudState.blueprint.version === localState.blueprint.version &&
    (!cloudState.blueprint.sourceCorpusHash ||
      !localState.blueprint.sourceCorpusHash ||
      cloudState.blueprint.sourceCorpusHash === localState.blueprint.sourceCorpusHash);

  // If cloudState was explicitly rolled back / reset to idle meaningfully later than localState (>2s),
  // never let stale IndexedDB state resurrect sections that were cleared on the server.
  const cloudWasAuthoritativelyReset =
    cloudState.status === 'idle' &&
    localState.status !== 'idle' &&
    cloudTs > localTs + 2000;

  let primary = cloudState;
  let secondary = localState;

  if (sameBlueprint) {
    if (cloudWasAuthoritativelyReset) {
      return cloudState;
    }
    const cloudScore = progressScore(cloudState);
    const localScore = progressScore(localState);
    if (localScore > cloudScore || (localScore === cloudScore && localTs > cloudTs)) {
      primary = localState;
      secondary = cloudState;
    }
  } else if (localState.blueprint.version > cloudState.blueprint.version && localTs > cloudTs) {
    primary = localState;
    secondary = cloudState;
  }

  if (!sameBlueprint) {
    return primary;
  }

  // Merge any verified sections from secondary AND keep resolved quarantine status
  const mergedSectionsIR = { ...primary.sectionsIR };
  const mergedBySectionId = { ...primary.coverageLedger.bySectionId };
  const mergedByChunkId = { ...primary.coverageLedger.byChunkId };

  for (const [secId, secEntry] of Object.entries(secondary.coverageLedger.bySectionId)) {
    const primEntry = mergedBySectionId[secId];
    if (
      secEntry.status === 'verified' &&
      (!primEntry || primEntry.status !== 'verified') &&
      secondary.sectionsIR[secId]
    ) {
      mergedSectionsIR[secId] = secondary.sectionsIR[secId];
      mergedBySectionId[secId] = secEntry;
      for (const [chunkId, chunkEntry] of Object.entries(secondary.coverageLedger.byChunkId)) {
        if (chunkEntry.sectionId === secId) {
          mergedByChunkId[chunkId] = chunkEntry;
        }
      }
    }
  }

  const resolvedQuarantineBySec = new Map<string, (typeof primary.quarantineQueue)[number]>();
  for (const q of [...(primary.quarantineQueue || []), ...(secondary.quarantineQueue || [])]) {
    if (q.resolved) {
      resolvedQuarantineBySec.set(q.sectionId, q);
    }
  }
  const mergedQuarantine = (primary.quarantineQueue || []).map((q) => {
    const resolvedQ = resolvedQuarantineBySec.get(q.sectionId);
    if (resolvedQ && !q.resolved) {
      return resolvedQ;
    }
    return q;
  });

  return {
    ...primary,
    sectionsIR: mergedSectionsIR,
    quarantineQueue: mergedQuarantine,
    coverageLedger: {
      bySectionId: mergedBySectionId,
      byChunkId: mergedByChunkId,
    },
  };
}

export interface CoverageLedgerSummaryStats {
  totalChunks: number;
  pendingChunks: number;
  draftedChunks: number;
  verifiedChunks: number;
  quarantinedChunks: number;
  totalSections: number;
  verifiedSections: number;
  draftedSections: number;
  pendingSections: number;
  quarantinedSections: number;
  totalWords: number;
  verifiedWords: number;
  verifiedPercent: number;
  byChapterId: Record<
    string,
    {
      totalChunks: number;
      verifiedChunks: number;
      draftedChunks: number;
      quarantinedChunks: number;
      pendingChunks: number;
      verifiedPercent: number;
    }
  >;
}

export function computeCoverageLedgerStats(ledger: CoverageLedger): CoverageLedgerSummaryStats {
  const chunks = Object.values(ledger.byChunkId || {});
  const sections = Object.values(ledger.bySectionId || {});

  const counts: Record<CoverageStatus, number> = {
    pending: 0,
    drafted: 0,
    drafted_unverified: 0,
    verified: 0,
    quarantined: 0,
  };
  const secCounts: Record<CoverageStatus, number> = {
    pending: 0,
    drafted: 0,
    drafted_unverified: 0,
    verified: 0,
    quarantined: 0,
  };

  let totalWords = 0;
  let verifiedWords = 0;

  const byChapterId: CoverageLedgerSummaryStats['byChapterId'] = {};

  for (const chunk of chunks) {
    counts[chunk.status] = (counts[chunk.status] || 0) + 1;
    const wc = Math.max(0, Number(chunk.wordCount) || 0);
    totalWords += wc;
    if (chunk.status === 'verified') {
      verifiedWords += wc;
    }

    if (!byChapterId[chunk.chapterId]) {
      byChapterId[chunk.chapterId] = {
        totalChunks: 0,
        verifiedChunks: 0,
        draftedChunks: 0,
        quarantinedChunks: 0,
        pendingChunks: 0,
        verifiedPercent: 0,
      };
    }
    const chStat = byChapterId[chunk.chapterId];
    chStat.totalChunks += 1;
    if (chunk.status === 'verified') chStat.verifiedChunks += 1;
    else if (chunk.status === 'drafted' || chunk.status === 'drafted_unverified') chStat.draftedChunks += 1;
    else if (chunk.status === 'quarantined') chStat.quarantinedChunks += 1;
    else chStat.pendingChunks += 1;
  }

  for (const chStat of Object.values(byChapterId)) {
    chStat.verifiedPercent =
      chStat.totalChunks > 0 ? Math.round((chStat.verifiedChunks / chStat.totalChunks) * 100) : 0;
  }

  for (const sec of sections) {
    secCounts[sec.status] = (secCounts[sec.status] || 0) + 1;
  }

  const totalChunks = chunks.length;
  const verifiedPercent =
    totalChunks > 0 ? Math.round((counts.verified / totalChunks) * 100) : 0;

  return {
    totalChunks,
    pendingChunks: counts.pending,
    draftedChunks: counts.drafted + counts.drafted_unverified,
    verifiedChunks: counts.verified,
    quarantinedChunks: counts.quarantined,
    totalSections: sections.length,
    verifiedSections: secCounts.verified,
    draftedSections: secCounts.drafted + secCounts.drafted_unverified,
    pendingSections: secCounts.pending,
    quarantinedSections: secCounts.quarantined,
    totalWords,
    verifiedWords,
    verifiedPercent,
    byChapterId,
  };
}
