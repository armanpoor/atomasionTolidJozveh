import crypto from 'node:crypto';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { db, isSqlConfigured } from './index.ts';
import {
  masterCanonicalEntities,
  masterChapters,
  masterConflicts,
  masterIngestJobs,
  masterIngestLogs,
  masterKnowledgeUnits,
  masterUnitRevisions,
  masterVolumes,
} from './schema.ts';

export type MasterVolumeRow = typeof masterVolumes.$inferSelect;
export type MasterVolumeInsert = typeof masterVolumes.$inferInsert;

export type MasterChapterRow = typeof masterChapters.$inferSelect;
export type MasterChapterInsert = typeof masterChapters.$inferInsert;

export type MasterCanonicalEntityRow = typeof masterCanonicalEntities.$inferSelect;
export type MasterCanonicalEntityInsert = typeof masterCanonicalEntities.$inferInsert;

export type MasterKnowledgeUnitRow = typeof masterKnowledgeUnits.$inferSelect;
export type MasterKnowledgeUnitInsert = typeof masterKnowledgeUnits.$inferInsert;

export type MasterUnitRevisionRow = typeof masterUnitRevisions.$inferSelect;
export type MasterUnitRevisionInsert = typeof masterUnitRevisions.$inferInsert;

export type MasterConflictRow = typeof masterConflicts.$inferSelect;
export type MasterConflictInsert = typeof masterConflicts.$inferInsert;

export type MasterIngestJobRow = typeof masterIngestJobs.$inferSelect;
export type MasterIngestJobInsert = typeof masterIngestJobs.$inferInsert;

export type MasterIngestLogRow = typeof masterIngestLogs.$inferSelect;
export type MasterIngestLogInsert = typeof masterIngestLogs.$inferInsert;

interface InMemoryMasterEncyclopediaStore {
  volumes: Map<string, MasterVolumeRow>;
  chapters: Map<string, MasterChapterRow>;
  entities: Map<string, MasterCanonicalEntityRow>;
  units: Map<string, MasterKnowledgeUnitRow>;
  revisions: Map<string, MasterUnitRevisionRow>;
  conflicts: Map<string, MasterConflictRow>;
  jobs: Map<string, MasterIngestJobRow>;
  logs: Map<string, MasterIngestLogRow>;
}

declare global {
  var _inMemoryMasterEncyclopediaStore: InMemoryMasterEncyclopediaStore | undefined;
}

function getMemStore(): InMemoryMasterEncyclopediaStore {
  if (!global._inMemoryMasterEncyclopediaStore) {
    global._inMemoryMasterEncyclopediaStore = {
      volumes: new Map(),
      chapters: new Map(),
      entities: new Map(),
      units: new Map(),
      revisions: new Map(),
      conflicts: new Map(),
      jobs: new Map(),
      logs: new Map(),
    };
  }
  return global._inMemoryMasterEncyclopediaStore;
}

let forceInMemoryStore = false;

export function setForceInMemoryMasterEncyclopedia(enabled: boolean): void {
  forceInMemoryStore = enabled;
}

export function isMasterEncyclopediaForceInMemory(): boolean {
  return forceInMemoryStore;
}

function useInMemoryMode(): boolean {
  return forceInMemoryStore || !isSqlConfigured();
}

export function clearInMemoryMasterEncyclopediaStore(): void {
  const store = getMemStore();
  store.volumes.clear();
  store.chapters.clear();
  store.entities.clear();
  store.units.clear();
  store.revisions.clear();
  store.conflicts.clear();
  store.jobs.clear();
  store.logs.clear();
}

export function countMasterWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function estimateMasterPages(wordCount: number): number {
  if (wordCount <= 0) return 0;
  return Math.max(1, Math.ceil(wordCount / 300));
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function computeNormalizedUnitHash(text: string): string {
  const canonical = text
    .toLowerCase()
    .replace(/[\u200c\u200f\u200e\u2066-\u2069]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// ============================================================================
// VOLUMES
// ============================================================================

export async function listMasterVolumes(): Promise<MasterVolumeRow[]> {
  if (useInMemoryMode()) {
    return Array.from(getMemStore().volumes.values())
      .sort((a, b) => a.volumeNumber - b.volumeNumber)
      .map((v) => structuredClone(v));
  }
  return db.select().from(masterVolumes).orderBy(asc(masterVolumes.volumeNumber));
}

export async function getMasterVolumeById(id: string): Promise<MasterVolumeRow | null> {
  if (useInMemoryMode()) {
    const found = getMemStore().volumes.get(id);
    return found ? structuredClone(found) : null;
  }
  const rows = await db.select().from(masterVolumes).where(eq(masterVolumes.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createMasterVolume(
  input: Omit<MasterVolumeInsert, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<MasterVolumeRow> {
  const now = new Date();
  const row: MasterVolumeRow = {
    id: input.id ?? generateId('vol'),
    volumeNumber: input.volumeNumber,
    title: input.title,
    automotiveDomain: input.automotiveDomain,
    wordCount: input.wordCount ?? 0,
    estimatedPages: input.estimatedPages ?? estimateMasterPages(input.wordCount ?? 0),
    status: input.status ?? 'published',
    splitThresholdPages: input.splitThresholdPages ?? 500,
    splitThresholdWords: input.splitThresholdWords ?? 150000,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  };

  if (useInMemoryMode()) {
    getMemStore().volumes.set(row.id, structuredClone(row));
    return structuredClone(row);
  }
  const [inserted] = await db.insert(masterVolumes).values(row).returning();
  return inserted;
}

export async function updateMasterVolume(
  id: string,
  patch: Partial<
    Pick<
      MasterVolumeRow,
      | 'volumeNumber'
      | 'title'
      | 'automotiveDomain'
      | 'wordCount'
      | 'estimatedPages'
      | 'status'
      | 'splitThresholdPages'
      | 'splitThresholdWords'
      | 'description'
    >
  >
): Promise<MasterVolumeRow | null> {
  const now = new Date();
  if (useInMemoryMode()) {
    const store = getMemStore();
    const existing = store.volumes.get(id);
    if (!existing) return null;
    const updated: MasterVolumeRow = {
      ...existing,
      ...patch,
      updatedAt: now,
    };
    store.volumes.set(id, structuredClone(updated));
    return structuredClone(updated);
  }
  const [updated] = await db
    .update(masterVolumes)
    .set({ ...patch, updatedAt: now })
    .where(eq(masterVolumes.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteMasterVolume(id: string): Promise<boolean> {
  if (useInMemoryMode()) {
    const store = getMemStore();
    if (!store.volumes.has(id)) return false;
    store.volumes.delete(id);
    for (const [chapId, chap] of store.chapters.entries()) {
      if (chap.volumeId === id) store.chapters.delete(chapId);
    }
    const deletedUnitIds = new Set<string>();
    for (const [unitId, unit] of store.units.entries()) {
      if (unit.volumeId === id) {
        deletedUnitIds.add(unitId);
        store.units.delete(unitId);
      }
    }
    if (deletedUnitIds.size > 0) {
      for (const [confId, conf] of store.conflicts.entries()) {
        if (
          deletedUnitIds.has(conf.existingUnitId) ||
          (conf.incomingUnitId && deletedUnitIds.has(conf.incomingUnitId))
        ) {
          store.conflicts.delete(confId);
        }
      }
    }
    return true;
  }
  const deleted = await db.delete(masterVolumes).where(eq(masterVolumes.id, id)).returning();
  return deleted.length > 0;
}

// ============================================================================
// CHAPTERS
// ============================================================================

export async function listMasterChapters(volumeId?: string): Promise<MasterChapterRow[]> {
  if (useInMemoryMode()) {
    let list = Array.from(getMemStore().chapters.values());
    if (volumeId) {
      list = list.filter((c) => c.volumeId === volumeId);
    }
    return list
      .sort((a, b) => a.pedagogicalRank - b.pedagogicalRank || a.orderIndex - b.orderIndex)
      .map((c) => structuredClone(c));
  }
  if (volumeId) {
    return db
      .select()
      .from(masterChapters)
      .where(eq(masterChapters.volumeId, volumeId))
      .orderBy(asc(masterChapters.pedagogicalRank), asc(masterChapters.orderIndex));
  }
  return db
    .select()
    .from(masterChapters)
    .orderBy(asc(masterChapters.pedagogicalRank), asc(masterChapters.orderIndex));
}

export async function getMasterChapterById(id: string): Promise<MasterChapterRow | null> {
  if (useInMemoryMode()) {
    const found = getMemStore().chapters.get(id);
    return found ? structuredClone(found) : null;
  }
  const rows = await db.select().from(masterChapters).where(eq(masterChapters.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createMasterChapter(
  input: Omit<MasterChapterInsert, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<MasterChapterRow> {
  const now = new Date();
  const row: MasterChapterRow = {
    id: input.id ?? generateId('chap'),
    volumeId: input.volumeId,
    parentId: input.parentId ?? null,
    level: input.level ?? 1,
    orderIndex: input.orderIndex ?? 0,
    pedagogicalRank: input.pedagogicalRank ?? 1,
    title: input.title,
    shortSummary: input.shortSummary ?? null,
    wordCount: input.wordCount ?? 0,
    createdAt: now,
    updatedAt: now,
  };

  if (useInMemoryMode()) {
    getMemStore().chapters.set(row.id, structuredClone(row));
    return structuredClone(row);
  }
  const [inserted] = await db.insert(masterChapters).values(row).returning();
  return inserted;
}

export async function updateMasterChapter(
  id: string,
  patch: Partial<
    Pick<
      MasterChapterRow,
      'volumeId' | 'parentId' | 'level' | 'orderIndex' | 'pedagogicalRank' | 'title' | 'shortSummary' | 'wordCount'
    >
  >
): Promise<MasterChapterRow | null> {
  const now = new Date();
  if (useInMemoryMode()) {
    const store = getMemStore();
    const existing = store.chapters.get(id);
    if (!existing) return null;
    const updated: MasterChapterRow = {
      ...existing,
      ...patch,
      updatedAt: now,
    };
    store.chapters.set(id, structuredClone(updated));
    return structuredClone(updated);
  }
  const [updated] = await db
    .update(masterChapters)
    .set({ ...patch, updatedAt: now })
    .where(eq(masterChapters.id, id))
    .returning();
  return updated ?? null;
}

export async function moveMasterChapterToVolume(
  chapterId: string,
  targetVolumeId: string
): Promise<MasterChapterRow | null> {
  const targetVol = await getMasterVolumeById(targetVolumeId);
  if (!targetVol) return null;

  const updatedChapter = await updateMasterChapter(chapterId, { volumeId: targetVolumeId });
  if (!updatedChapter) return null;

  if (useInMemoryMode()) {
    const store = getMemStore();
    for (const [uId, unit] of store.units.entries()) {
      if (unit.chapterId === chapterId) {
        store.units.set(uId, { ...unit, volumeId: targetVolumeId, updatedAt: new Date() });
      }
    }
  } else {
    await db
      .update(masterKnowledgeUnits)
      .set({ volumeId: targetVolumeId, updatedAt: new Date() })
      .where(eq(masterKnowledgeUnits.chapterId, chapterId));
  }

  await recalculateVolumeAndChapterStats();
  return updatedChapter;
}

export async function mergeMasterChapters(
  sourceChapterId: string,
  targetChapterId: string
): Promise<{ mergedUnits: number; targetChapter: MasterChapterRow | null }> {
  if (sourceChapterId === targetChapterId) {
    return { mergedUnits: 0, targetChapter: await getMasterChapterById(targetChapterId) };
  }
  const target = await getMasterChapterById(targetChapterId);
  const source = await getMasterChapterById(sourceChapterId);
  if (!target || !source) {
    return { mergedUnits: 0, targetChapter: null };
  }

  let mergedUnits = 0;
  const now = new Date();

  if (useInMemoryMode()) {
    const store = getMemStore();
    for (const [uId, unit] of store.units.entries()) {
      if (unit.chapterId === sourceChapterId) {
        store.units.set(uId, {
          ...unit,
          chapterId: targetChapterId,
          volumeId: target.volumeId,
          updatedAt: now,
        });
        mergedUnits += 1;
      }
    }
    store.chapters.delete(sourceChapterId);
  } else {
    const moved = await db
      .update(masterKnowledgeUnits)
      .set({ chapterId: targetChapterId, volumeId: target.volumeId, updatedAt: now })
      .where(eq(masterKnowledgeUnits.chapterId, sourceChapterId))
      .returning();
    mergedUnits = moved.length;
    await db.delete(masterChapters).where(eq(masterChapters.id, sourceChapterId));
  }

  await recalculateVolumeAndChapterStats();
  return { mergedUnits, targetChapter: await getMasterChapterById(targetChapterId) };
}

// ============================================================================
// CANONICAL ENTITIES
// ============================================================================

export async function listMasterCanonicalEntities(): Promise<MasterCanonicalEntityRow[]> {
  if (useInMemoryMode()) {
    return Array.from(getMemStore().entities.values()).map((e) => structuredClone(e));
  }
  return db.select().from(masterCanonicalEntities).orderBy(asc(masterCanonicalEntities.canonicalName));
}

export async function upsertMasterCanonicalEntity(
  input: Omit<MasterCanonicalEntityInsert, 'createdAt' | 'updatedAt'>
): Promise<MasterCanonicalEntityRow> {
  const now = new Date();
  if (useInMemoryMode()) {
    const store = getMemStore();
    const existing = store.entities.get(input.id);
    const mergedAliases = Array.from(
      new Set([...(existing?.aliasesJson ?? []), ...(input.aliasesJson ?? [])])
    );
    const row: MasterCanonicalEntityRow = {
      id: input.id,
      entityType: input.entityType,
      canonicalName: input.canonicalName,
      aliasesJson: mergedAliases,
      domainTag: input.domainTag,
      metadataJson: input.metadataJson ?? existing?.metadataJson ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    store.entities.set(row.id, structuredClone(row));
    return structuredClone(row);
  }

  const existingRows = await db
    .select()
    .from(masterCanonicalEntities)
    .where(eq(masterCanonicalEntities.id, input.id))
    .limit(1);

  if (existingRows[0]) {
    const mergedAliases = Array.from(
      new Set([...existingRows[0].aliasesJson, ...input.aliasesJson])
    );
    const [updated] = await db
      .update(masterCanonicalEntities)
      .set({
        entityType: input.entityType,
        canonicalName: input.canonicalName,
        aliasesJson: mergedAliases,
        domainTag: input.domainTag,
        metadataJson: input.metadataJson ?? existingRows[0].metadataJson,
        updatedAt: now,
      })
      .where(eq(masterCanonicalEntities.id, input.id))
      .returning();
    return updated;
  }

  const [inserted] = await db
    .insert(masterCanonicalEntities)
    .values({
      ...input,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return inserted;
}

// ============================================================================
// KNOWLEDGE UNITS
// ============================================================================

export async function listMasterKnowledgeUnits(filter?: {
  volumeId?: string;
  chapterId?: string;
  domainTag?: string;
  verificationStatus?: string;
  lifecycleStatus?: string;
  sourceUploadHash?: string;
  ingestBatchId?: string;
}): Promise<MasterKnowledgeUnitRow[]> {
  if (useInMemoryMode()) {
    let rows = Array.from(getMemStore().units.values())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((u) => structuredClone(u));
    if (!filter) return rows;
    return rows.filter((u) => {
      if (filter.volumeId && u.volumeId !== filter.volumeId) return false;
      if (filter.chapterId && u.chapterId !== filter.chapterId) return false;
      if (filter.domainTag && u.domainTag !== filter.domainTag) return false;
      if (filter.verificationStatus && u.verificationStatus !== filter.verificationStatus) return false;
      if (filter.lifecycleStatus && u.lifecycleStatus !== filter.lifecycleStatus) return false;
      if (filter.sourceUploadHash && u.sourceUploadHash !== filter.sourceUploadHash) return false;
      if (filter.ingestBatchId && u.ingestBatchId !== filter.ingestBatchId) return false;
      return true;
    });
  }

  const conditions: SQL[] = [];
  if (filter?.volumeId) conditions.push(eq(masterKnowledgeUnits.volumeId, filter.volumeId));
  if (filter?.chapterId) conditions.push(eq(masterKnowledgeUnits.chapterId, filter.chapterId));
  if (filter?.domainTag) conditions.push(eq(masterKnowledgeUnits.domainTag, filter.domainTag));
  if (filter?.verificationStatus) {
    conditions.push(eq(masterKnowledgeUnits.verificationStatus, filter.verificationStatus));
  }
  if (filter?.lifecycleStatus) {
    conditions.push(eq(masterKnowledgeUnits.lifecycleStatus, filter.lifecycleStatus));
  }
  if (filter?.sourceUploadHash) {
    conditions.push(eq(masterKnowledgeUnits.sourceUploadHash, filter.sourceUploadHash));
  }
  if (filter?.ingestBatchId) {
    conditions.push(eq(masterKnowledgeUnits.ingestBatchId, filter.ingestBatchId));
  }

  if (conditions.length > 0) {
    return db
      .select()
      .from(masterKnowledgeUnits)
      .where(and(...conditions))
      .orderBy(asc(masterKnowledgeUnits.createdAt));
  }
  return db
    .select()
    .from(masterKnowledgeUnits)
    .orderBy(asc(masterKnowledgeUnits.createdAt));
}

export async function getMasterKnowledgeUnitById(id: string): Promise<MasterKnowledgeUnitRow | null> {
  if (useInMemoryMode()) {
    const found = getMemStore().units.get(id);
    return found ? structuredClone(found) : null;
  }
  const rows = await db
    .select()
    .from(masterKnowledgeUnits)
    .where(eq(masterKnowledgeUnits.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createMasterKnowledgeUnit(
  input: Omit<MasterKnowledgeUnitInsert, 'id' | 'createdAt' | 'updatedAt' | 'wordCount'> & {
    id?: string;
    wordCount?: number;
  }
): Promise<MasterKnowledgeUnitRow> {
  const now = new Date();
  const row: MasterKnowledgeUnitRow = {
    id: input.id ?? generateId('ku'),
    volumeId: input.volumeId,
    chapterId: input.chapterId,
    blockType: input.blockType ?? 'paragraph',
    cleanText: input.cleanText,
    normalizedHash: input.normalizedHash,
    domainTag: input.domainTag,
    canonicalEntityId: input.canonicalEntityId ?? null,
    verificationStatus: input.verificationStatus ?? 'verified',
    lifecycleStatus: input.lifecycleStatus ?? 'active',
    supersedesUnitId: input.supersedesUnitId ?? null,
    corroborationCount: input.corroborationCount ?? 1,
    distinctSourceHashesJson: input.distinctSourceHashesJson ?? [input.sourceUploadHash],
    evidenceTier: input.evidenceTier ?? 'text_or_screenshot_reported',
    ingestBatchId: input.ingestBatchId,
    sourceUploadHash: input.sourceUploadHash,
    technicalMetadataJson: input.technicalMetadataJson ?? null,
    wordCount: input.wordCount ?? countMasterWords(input.cleanText),
    createdAt: now,
    updatedAt: now,
  };

  if (useInMemoryMode()) {
    getMemStore().units.set(row.id, structuredClone(row));
    return structuredClone(row);
  }
  const [inserted] = await db.insert(masterKnowledgeUnits).values(row).returning();
  return inserted;
}

export async function updateMasterKnowledgeUnit(
  id: string,
  patch: Partial<
    Pick<
      MasterKnowledgeUnitRow,
      | 'volumeId'
      | 'chapterId'
      | 'blockType'
      | 'cleanText'
      | 'normalizedHash'
      | 'domainTag'
      | 'canonicalEntityId'
      | 'verificationStatus'
      | 'lifecycleStatus'
      | 'supersedesUnitId'
      | 'corroborationCount'
      | 'distinctSourceHashesJson'
      | 'evidenceTier'
      | 'technicalMetadataJson'
      | 'wordCount'
    >
  >
): Promise<MasterKnowledgeUnitRow | null> {
  const now = new Date();
  const computedWordCount =
    patch.cleanText !== undefined && patch.wordCount === undefined
      ? countMasterWords(patch.cleanText)
      : patch.wordCount;

  if (useInMemoryMode()) {
    const store = getMemStore();
    const existing = store.units.get(id);
    if (!existing) return null;
    const updated: MasterKnowledgeUnitRow = {
      ...existing,
      ...patch,
      wordCount: computedWordCount ?? existing.wordCount,
      updatedAt: now,
    };
    store.units.set(id, structuredClone(updated));
    return structuredClone(updated);
  }

  const [updated] = await db
    .update(masterKnowledgeUnits)
    .set({
      ...patch,
      ...(computedWordCount !== undefined ? { wordCount: computedWordCount } : {}),
      updatedAt: now,
    })
    .where(eq(masterKnowledgeUnits.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteMasterKnowledgeUnit(id: string): Promise<boolean> {
  if (useInMemoryMode()) {
    return getMemStore().units.delete(id);
  }
  const deleted = await db
    .delete(masterKnowledgeUnits)
    .where(eq(masterKnowledgeUnits.id, id))
    .returning();
  return deleted.length > 0;
}

// ============================================================================
// UNIT REVISIONS & ATOMIC BATCH ROLLBACK / SOURCE TAKEDOWN
// ============================================================================

export async function createMasterUnitRevision(
  input: Omit<MasterUnitRevisionInsert, 'id' | 'createdAt'> & { id?: string }
): Promise<MasterUnitRevisionRow> {
  const row: MasterUnitRevisionRow = {
    id: input.id ?? generateId('rev'),
    ingestBatchId: input.ingestBatchId,
    unitId: input.unitId,
    action: input.action,
    previousStateJson: input.previousStateJson ?? null,
    newStateJson: input.newStateJson ?? null,
    actorEmail: input.actorEmail ?? null,
    createdAt: new Date(),
  };

  if (useInMemoryMode()) {
    getMemStore().revisions.set(row.id, structuredClone(row));
    return structuredClone(row);
  }
  const [inserted] = await db.insert(masterUnitRevisions).values(row).returning();
  return inserted;
}

export async function listMasterUnitRevisions(
  ingestBatchId?: string
): Promise<MasterUnitRevisionRow[]> {
  if (useInMemoryMode()) {
    let rows = Array.from(getMemStore().revisions.values());
    if (ingestBatchId) {
      rows = rows.filter((r) => r.ingestBatchId === ingestBatchId);
    }
    return rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => structuredClone(r));
  }
  if (ingestBatchId) {
    return db
      .select()
      .from(masterUnitRevisions)
      .where(eq(masterUnitRevisions.ingestBatchId, ingestBatchId))
      .orderBy(desc(masterUnitRevisions.createdAt));
  }
  return db
    .select()
    .from(masterUnitRevisions)
    .orderBy(desc(masterUnitRevisions.createdAt));
}

export async function rollbackIngestBatch(ingestBatchId: string): Promise<{
  revertedUnits: number;
  deletedUnits: number;
  removedConflicts: number;
}> {
  const revisions = await listMasterUnitRevisions(ingestBatchId);
  let revertedUnits = 0;
  let deletedUnits = 0;

  for (const rev of revisions) {
    if (rev.action === 'created') {
      const removed = await deleteMasterKnowledgeUnit(rev.unitId);
      if (removed) deletedUnits += 1;
    } else if (rev.previousStateJson) {
      const prev = rev.previousStateJson as Partial<MasterKnowledgeUnitRow>;
      const updated = await updateMasterKnowledgeUnit(rev.unitId, {
        cleanText: prev.cleanText,
        normalizedHash: prev.normalizedHash,
        domainTag: prev.domainTag,
        canonicalEntityId: prev.canonicalEntityId,
        verificationStatus: prev.verificationStatus,
        lifecycleStatus: prev.lifecycleStatus,
        corroborationCount: prev.corroborationCount,
        distinctSourceHashesJson: prev.distinctSourceHashesJson,
        evidenceTier: prev.evidenceTier,
        technicalMetadataJson: prev.technicalMetadataJson,
        wordCount: prev.wordCount,
      });
      if (updated) revertedUnits += 1;
    }
  }

  let removedConflicts = 0;
  if (useInMemoryMode()) {
    const store = getMemStore();
    for (const [cId, c] of store.conflicts.entries()) {
      if (c.ingestBatchId === ingestBatchId) {
        store.conflicts.delete(cId);
        removedConflicts += 1;
      }
    }
    for (const [lId, l] of store.logs.entries()) {
      if (l.ingestBatchId === ingestBatchId) {
        store.logs.set(lId, { ...l, status: 'rolled_back' });
      }
    }
  } else {
    const deletedConflicts = await db
      .delete(masterConflicts)
      .where(eq(masterConflicts.ingestBatchId, ingestBatchId))
      .returning();
    removedConflicts = deletedConflicts.length;
    await db
      .update(masterIngestLogs)
      .set({ status: 'rolled_back' })
      .where(eq(masterIngestLogs.ingestBatchId, ingestBatchId));
  }

  await recalculateVolumeAndChapterStats();
  return { revertedUnits, deletedUnits, removedConflicts };
}

export async function takedownBySourceUploadHash(sourceUploadHash: string): Promise<{
  deletedUnits: number;
  sanitizedCorroborations: number;
  removedConflicts: number;
  affectedBatches: string[];
}> {
  const allUnits = await listMasterKnowledgeUnits();
  let deletedUnits = 0;
  let sanitizedCorroborations = 0;
  const affectedBatchSet = new Set<string>();

  for (const unit of allUnits) {
    if (unit.sourceUploadHash === sourceUploadHash) {
      affectedBatchSet.add(unit.ingestBatchId);
      const removed = await deleteMasterKnowledgeUnit(unit.id);
      if (removed) deletedUnits += 1;
    } else if (unit.distinctSourceHashesJson.includes(sourceUploadHash)) {
      const filtered = unit.distinctSourceHashesJson.filter((h) => h !== sourceUploadHash);
      await updateMasterKnowledgeUnit(unit.id, {
        distinctSourceHashesJson: filtered,
        corroborationCount: Math.max(1, filtered.length),
      });
      sanitizedCorroborations += 1;
    }
  }

  let removedConflicts = 0;
  if (useInMemoryMode()) {
    const store = getMemStore();
    for (const [cId, c] of store.conflicts.entries()) {
      if (c.sourceUploadHash === sourceUploadHash) {
        affectedBatchSet.add(c.ingestBatchId);
        store.conflicts.delete(cId);
        removedConflicts += 1;
      }
    }
    for (const [lId, l] of store.logs.entries()) {
      if (l.sourceUploadHash === sourceUploadHash) {
        store.logs.set(lId, { ...l, status: 'takedown_removed' });
      }
    }
  } else {
    const delC = await db
      .delete(masterConflicts)
      .where(eq(masterConflicts.sourceUploadHash, sourceUploadHash))
      .returning();
    removedConflicts = delC.length;
    await db
      .update(masterIngestLogs)
      .set({ status: 'takedown_removed' })
      .where(eq(masterIngestLogs.sourceUploadHash, sourceUploadHash));
  }

  await recalculateVolumeAndChapterStats();
  return {
    deletedUnits,
    sanitizedCorroborations,
    removedConflicts,
    affectedBatches: Array.from(affectedBatchSet),
  };
}

// ============================================================================
// CONFLICTS
// ============================================================================

export async function listMasterConflicts(status?: string): Promise<MasterConflictRow[]> {
  if (useInMemoryMode()) {
    let rows = Array.from(getMemStore().conflicts.values());
    if (status) rows = rows.filter((c) => c.status === status);
    return rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((c) => structuredClone(c));
  }
  if (status) {
    return db
      .select()
      .from(masterConflicts)
      .where(eq(masterConflicts.status, status))
      .orderBy(desc(masterConflicts.createdAt));
  }
  return db.select().from(masterConflicts).orderBy(desc(masterConflicts.createdAt));
}

export async function createMasterConflict(
  input: Omit<MasterConflictInsert, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<MasterConflictRow> {
  const now = new Date();
  const row: MasterConflictRow = {
    id: input.id ?? generateId('conf'),
    existingUnitId: input.existingUnitId,
    incomingUnitId: input.incomingUnitId ?? null,
    conflictType: input.conflictType,
    topic: input.topic,
    existingExcerpt: input.existingExcerpt,
    incomingExcerpt: input.incomingExcerpt,
    conditionContext: input.conditionContext ?? null,
    status: input.status ?? 'open',
    resolutionNote: input.resolutionNote ?? null,
    ingestBatchId: input.ingestBatchId,
    sourceUploadHash: input.sourceUploadHash,
    createdAt: now,
    updatedAt: now,
  };

  if (useInMemoryMode()) {
    getMemStore().conflicts.set(row.id, structuredClone(row));
    return structuredClone(row);
  }
  const [inserted] = await db.insert(masterConflicts).values(row).returning();
  return inserted;
}

export async function resolveMasterConflict(
  conflictId: string,
  resolution: 'approved_existing' | 'approved_incoming' | 'merged_conditional' | 'rejected',
  resolutionNote?: string,
  conditionContext?: string
): Promise<MasterConflictRow | null> {
  const now = new Date();
  let conflict: MasterConflictRow | null = null;

  if (useInMemoryMode()) {
    const store = getMemStore();
    const existing = store.conflicts.get(conflictId);
    if (!existing) return null;
    conflict = {
      ...existing,
      status: resolution,
      resolutionNote: resolutionNote ?? existing.resolutionNote,
      conditionContext: conditionContext ?? existing.conditionContext,
      updatedAt: now,
    };
    store.conflicts.set(conflictId, structuredClone(conflict));
  } else {
    const [updated] = await db
      .update(masterConflicts)
      .set({
        status: resolution,
        ...(resolutionNote !== undefined ? { resolutionNote } : {}),
        ...(conditionContext !== undefined ? { conditionContext } : {}),
        updatedAt: now,
      })
      .where(eq(masterConflicts.id, conflictId))
      .returning();
    conflict = updated ?? null;
  }

  if (!conflict) return null;

  // Apply resolution semantics to the underlying knowledge unit (recomputing normalizedHash)
  const existingUnit = await getMasterKnowledgeUnitById(conflict.existingUnitId);
  if (existingUnit) {
    if (resolution === 'approved_incoming') {
      await updateMasterKnowledgeUnit(existingUnit.id, {
        cleanText: conflict.incomingExcerpt,
        normalizedHash: computeNormalizedUnitHash(conflict.incomingExcerpt),
        verificationStatus: 'verified',
      });
    } else if (resolution === 'merged_conditional') {
      const conditionLabel =
        conflict.conditionContext?.trim() ||
        resolutionNote?.trim() ||
        'شرایط فنی و نسخه‌های متفاوت';
      const combinedText = `${existingUnit.cleanText}\n\n> **نسخه شرطی تکمیلی (${conditionLabel}):** ${conflict.incomingExcerpt}`;
      await updateMasterKnowledgeUnit(existingUnit.id, {
        cleanText: combinedText,
        normalizedHash: computeNormalizedUnitHash(combinedText),
        verificationStatus: 'verified',
      });
    }
    await recalculateVolumeAndChapterStats();
  }

  return conflict;
}

// ============================================================================
// PERSISTENT BACKGROUND INGEST QUEUE (JOBS + LOGS)
// ============================================================================

export async function enqueueMasterIngestJob(input: {
  id?: string;
  ingestBatchId?: string;
  sourceUploadHash: string;
  sourceFileName: string;
  sourceFormat: string;
  submittedByRole: 'owner' | 'user' | 'guest';
  submitterSessionHash: string;
  maxAttempts?: number;
  payloadJson?: Record<string, unknown> | null;
}): Promise<MasterIngestJobRow> {
  const now = new Date();
  const row: MasterIngestJobRow = {
    id: input.id ?? generateId('job'),
    ingestBatchId: input.ingestBatchId ?? generateId('batch'),
    sourceUploadHash: input.sourceUploadHash,
    sourceFileName: input.sourceFileName,
    sourceFormat: input.sourceFormat,
    submittedByRole: input.submittedByRole,
    submitterSessionHash: input.submitterSessionHash,
    status: 'queued',
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    payloadJson: input.payloadJson ?? null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  };

  if (useInMemoryMode()) {
    getMemStore().jobs.set(row.id, structuredClone(row));
    return structuredClone(row);
  }
  const [inserted] = await db.insert(masterIngestJobs).values(row).returning();
  return inserted;
}

export async function listMasterIngestJobs(limit = 50): Promise<MasterIngestJobRow[]> {
  if (useInMemoryMode()) {
    return Array.from(getMemStore().jobs.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((j) => structuredClone(j));
  }
  return db
    .select()
    .from(masterIngestJobs)
    .orderBy(desc(masterIngestJobs.createdAt))
    .limit(limit);
}

export async function getMasterIngestJobById(id: string): Promise<MasterIngestJobRow | null> {
  if (useInMemoryMode()) {
    const found = getMemStore().jobs.get(id);
    return found ? structuredClone(found) : null;
  }
  const rows = await db
    .select()
    .from(masterIngestJobs)
    .where(eq(masterIngestJobs.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function claimNextQueuedMasterIngestJob(): Promise<MasterIngestJobRow | null> {
  const now = new Date();
  if (useInMemoryMode()) {
    const store = getMemStore();
    const candidates = Array.from(store.jobs.values())
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const next = candidates[0];
    if (!next) return null;
    const claimed: MasterIngestJobRow = {
      ...next,
      status: 'processing',
      attempts: next.attempts + 1,
      startedAt: now,
      updatedAt: now,
    };
    store.jobs.set(claimed.id, structuredClone(claimed));
    return structuredClone(claimed);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const queuedRows = await db
      .select()
      .from(masterIngestJobs)
      .where(eq(masterIngestJobs.status, 'queued'))
      .orderBy(asc(masterIngestJobs.createdAt))
      .limit(1);
    const next = queuedRows[0];
    if (!next) return null;

    const [claimed] = await db
      .update(masterIngestJobs)
      .set({
        status: 'processing',
        attempts: next.attempts + 1,
        startedAt: now,
        updatedAt: now,
      })
      .where(and(eq(masterIngestJobs.id, next.id), eq(masterIngestJobs.status, 'queued')))
      .returning();
    if (claimed) return claimed;
  }
  return null;
}

export async function completeMasterIngestJob(jobId: string): Promise<MasterIngestJobRow | null> {
  const now = new Date();
  if (useInMemoryMode()) {
    const store = getMemStore();
    const existing = store.jobs.get(jobId);
    if (!existing) return null;
    const updated: MasterIngestJobRow = {
      ...existing,
      status: 'completed',
      lastError: null,
      completedAt: now,
      updatedAt: now,
    };
    store.jobs.set(jobId, structuredClone(updated));
    return structuredClone(updated);
  }
  const [updated] = await db
    .update(masterIngestJobs)
    .set({
      status: 'completed',
      lastError: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(masterIngestJobs.id, jobId))
    .returning();
  return updated ?? null;
}

/**
 * Handles retry logic and Dead-Letter Queue (DLQ) transition.
 * If attempts < maxAttempts -> requeue as 'queued'.
 * If attempts >= maxAttempts -> move to 'dlq'.
 */
export async function failMasterIngestJob(
  jobId: string,
  errorMessage: string
): Promise<MasterIngestJobRow | null> {
  const existing = await getMasterIngestJobById(jobId);
  if (!existing) return null;

  const now = new Date();
  const nextStatus = existing.attempts >= existing.maxAttempts ? 'dlq' : 'queued';

  if (useInMemoryMode()) {
    const store = getMemStore();
    const updated: MasterIngestJobRow = {
      ...existing,
      status: nextStatus,
      lastError: errorMessage.slice(0, 1000),
      updatedAt: now,
    };
    store.jobs.set(jobId, structuredClone(updated));
    return structuredClone(updated);
  }

  const [updated] = await db
    .update(masterIngestJobs)
    .set({
      status: nextStatus,
      lastError: errorMessage.slice(0, 1000),
      updatedAt: now,
    })
    .where(eq(masterIngestJobs.id, jobId))
    .returning();
  return updated ?? null;
}

export async function createMasterIngestLog(
  input: Omit<MasterIngestLogInsert, 'id' | 'createdAt'> & { id?: string }
): Promise<MasterIngestLogRow> {
  const row: MasterIngestLogRow = {
    id: input.id ?? generateId('log'),
    jobId: input.jobId,
    ingestBatchId: input.ingestBatchId,
    sourceUploadHash: input.sourceUploadHash,
    sourceFileName: input.sourceFileName,
    newUnitsCount: input.newUnitsCount ?? 0,
    duplicateUnitsCount: input.duplicateUnitsCount ?? 0,
    mergedUnitsCount: input.mergedUnitsCount ?? 0,
    conflictsCount: input.conflictsCount ?? 0,
    stagingUnitsCount: input.stagingUnitsCount ?? 0,
    createdVolumesJson: input.createdVolumesJson ?? [],
    createdChaptersJson: input.createdChaptersJson ?? [],
    modelsUsedJson: input.modelsUsedJson ?? ['layer0-deterministic'],
    durationMs: input.durationMs ?? 0,
    status: input.status ?? 'completed',
    summaryFa: input.summaryFa ?? null,
    createdAt: new Date(),
  };

  if (useInMemoryMode()) {
    getMemStore().logs.set(row.id, structuredClone(row));
    return structuredClone(row);
  }
  const [inserted] = await db.insert(masterIngestLogs).values(row).returning();
  return inserted;
}

export async function listMasterIngestLogs(limit = 50): Promise<MasterIngestLogRow[]> {
  if (useInMemoryMode()) {
    return Array.from(getMemStore().logs.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((l) => structuredClone(l));
  }
  return db
    .select()
    .from(masterIngestLogs)
    .orderBy(desc(masterIngestLogs.createdAt))
    .limit(limit);
}

// ============================================================================
// STATS RECALCULATION & FULL RESET
// ============================================================================

export async function recalculateVolumeAndChapterStats(): Promise<void> {
  const [volumes, chapters, units] = await Promise.all([
    listMasterVolumes(),
    listMasterChapters(),
    listMasterKnowledgeUnits(),
  ]);

  const activeVerifiedUnits = units.filter(
    (u) => u.lifecycleStatus === 'active' && u.verificationStatus === 'verified'
  );

  const chapterWords = new Map<string, number>();
  const volumeWords = new Map<string, number>();

  for (const unit of activeVerifiedUnits) {
    const wc = unit.wordCount || countMasterWords(unit.cleanText);
    chapterWords.set(unit.chapterId, (chapterWords.get(unit.chapterId) ?? 0) + wc);
    volumeWords.set(unit.volumeId, (volumeWords.get(unit.volumeId) ?? 0) + wc);
  }

  for (const chap of chapters) {
    const nextWc = chapterWords.get(chap.id) ?? 0;
    if (chap.wordCount !== nextWc) {
      await updateMasterChapter(chap.id, { wordCount: nextWc });
    }
  }

  for (const vol of volumes) {
    const nextWc = volumeWords.get(vol.id) ?? 0;
    const nextPages = estimateMasterPages(nextWc);
    if (vol.wordCount !== nextWc || vol.estimatedPages !== nextPages) {
      await updateMasterVolume(vol.id, { wordCount: nextWc, estimatedPages: nextPages });
    }
  }
}

export async function resetMasterEncyclopedia(): Promise<void> {
  if (useInMemoryMode()) {
    clearInMemoryMasterEncyclopediaStore();
    return;
  }
  await db.delete(masterConflicts);
  await db.delete(masterUnitRevisions);
  await db.delete(masterIngestLogs);
  await db.delete(masterIngestJobs);
  await db.delete(masterKnowledgeUnits);
  await db.delete(masterChapters);
  await db.delete(masterVolumes);
  await db.delete(masterCanonicalEntities);
}
