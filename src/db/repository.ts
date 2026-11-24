import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, isSqlConfigured } from './index.ts';
import {
  auditReports,
  conflicts,
  contentUnits,
  dedupClusters,
  outlineNodes,
  projectRevisions,
  projects,
  sourceFiles,
  users,
} from './schema.ts';
import type { ProjectRevisionSnapshotPayload } from '../lib/changeLogUtils.ts';

type UserRow = typeof users.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type SourceFileRow = typeof sourceFiles.$inferSelect;
type ContentUnitRow = typeof contentUnits.$inferSelect;
type DedupClusterRow = typeof dedupClusters.$inferSelect;
type ConflictRow = typeof conflicts.$inferSelect;
type OutlineNodeRow = typeof outlineNodes.$inferSelect;
type AuditReportRow = typeof auditReports.$inferSelect;
type ProjectRevisionRow = typeof projectRevisions.$inferSelect;

interface InMemoryRepoStore {
  nextUserId: number;
  users: Map<string, UserRow>;
  projects: Map<string, ProjectRow>;
  sourceFiles: Map<string, SourceFileRow>;
  contentUnits: Map<string, ContentUnitRow>;
  dedupClusters: Map<string, DedupClusterRow>;
  conflicts: Map<string, ConflictRow>;
  outlineNodes: Map<string, OutlineNodeRow>;
  auditReports: Map<string, AuditReportRow>;
  projectRevisions: Map<string, ProjectRevisionRow>;
}

declare global {
  var _inMemoryRepoStore: InMemoryRepoStore | undefined;
}

function mem(): InMemoryRepoStore {
  if (!global._inMemoryRepoStore) {
    global._inMemoryRepoStore = {
      nextUserId: 1,
      users: new Map(),
      projects: new Map(),
      sourceFiles: new Map(),
      contentUnits: new Map(),
      dedupClusters: new Map(),
      conflicts: new Map(),
      outlineNodes: new Map(),
      auditReports: new Map(),
      projectRevisions: new Map(),
    };
  }
  return global._inMemoryRepoStore;
}

function cloneRecord<T>(val: T): T {
  return structuredClone(val);
}

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string | null,
  photoUrl?: string | null
) {
  if (!isSqlConfigured()) {
    const store = mem();
    const now = new Date();
    const existing = store.users.get(uid);
    if (existing) {
      const updated: UserRow = {
        ...existing,
        email,
        displayName: displayName ?? null,
        photoUrl: photoUrl ?? null,
        updatedAt: now,
      };
      store.users.set(uid, updated);
      return cloneRecord(updated);
    }
    const created: UserRow = {
      id: store.nextUserId++,
      uid,
      email,
      displayName: displayName ?? null,
      photoUrl: photoUrl ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store.users.set(uid, created);
    return cloneRecord(created);
  }

  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: displayName ?? null,
        photoUrl: photoUrl ?? null,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          displayName: displayName ?? null,
          photoUrl: photoUrl ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query failed (getOrCreateUser):', error);
    throw new Error('خطا در همگام‌سازی اطلاعات حساب کاربری در پایگاه داده.', { cause: error });
  }
}

export async function listUserProjects(ownerUid: string) {
  if (!isSqlConfigured()) {
    const store = mem();
    const userProjects = Array.from(store.projects.values())
      .filter((p) => p.ownerUid === ownerUid)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return userProjects.map((p) => {
      const files = Array.from(store.sourceFiles.values()).filter((f) => f.projectId === p.id);
      const totalWordCount = files.reduce((acc, f) => acc + (Number(f.wordCount) || 0), 0);
      return {
        id: p.id,
        title: p.title,
        workflowMode: p.workflowMode,
        pipelineStage: p.pipelineStage,
        status: p.status,
        settingsJson: cloneRecord(p.settingsJson),
        checkpointJson: cloneRecord(p.checkpointJson),
        sourceFileCount: files.length,
        totalWordCount,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      };
    });
  }

  try {
    const rows = await db
      .select({
        id: projects.id,
        title: projects.title,
        workflowMode: projects.workflowMode,
        pipelineStage: projects.pipelineStage,
        status: projects.status,
        settingsJson: projects.settingsJson,
        checkpointJson: projects.checkpointJson,
        sourceFileCount: sql<number>`CAST(COUNT(${sourceFiles.id}) AS INTEGER)`,
        totalWordCount: sql<number>`CAST(COALESCE(SUM(${sourceFiles.wordCount}), 0) AS INTEGER)`,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .leftJoin(sourceFiles, eq(sourceFiles.projectId, projects.id))
      .where(eq(projects.ownerUid, ownerUid))
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt));

    return rows.map((row) => ({
      ...row,
      sourceFileCount: Number(row.sourceFileCount) || 0,
      totalWordCount: Number(row.totalWordCount) || 0,
    }));
  } catch (error) {
    console.error('Database query failed (listUserProjects):', error);
    throw new Error('خطا در دریافت فهرست پروژه‌ها از پایگاه داده.', { cause: error });
  }
}

export async function createProjectRecord(params: {
  id: string;
  ownerUid: string;
  title: string;
  workflowMode: string;
  settingsJson?: Record<string, unknown>;
}) {
  if (!isSqlConfigured()) {
    const store = mem();
    const now = new Date();
    const created: ProjectRow = {
      id: params.id,
      ownerUid: params.ownerUid,
      title: params.title,
      workflowMode: params.workflowMode,
      pipelineStage: 1,
      status: 'draft',
      settingsJson: cloneRecord(params.settingsJson ?? {}),
      checkpointJson: { stage: 1, processedFileCount: 0 },
      bookSnapshotJson: null,
      createdAt: now,
      updatedAt: now,
    };
    store.projects.set(created.id, created);
    return cloneRecord(created);
  }

  try {
    const rows = await db
      .insert(projects)
      .values({
        id: params.id,
        ownerUid: params.ownerUid,
        title: params.title,
        workflowMode: params.workflowMode,
        pipelineStage: 1,
        status: 'draft',
        settingsJson: params.settingsJson ?? {},
        checkpointJson: { stage: 1, processedFileCount: 0 },
      })
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Database query failed (createProjectRecord):', error);
    throw new Error('خطا در ایجاد پروژه جدید در پایگاه داده.', { cause: error });
  }
}

export async function getOwnedProject(projectId: string, ownerUid: string) {
  if (!isSqlConfigured()) {
    const store = mem();
    const proj = store.projects.get(projectId);
    if (!proj || proj.ownerUid !== ownerUid) return null;
    return cloneRecord(proj);
  }

  try {
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerUid, ownerUid)))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (getOwnedProject):', error);
    throw new Error('خطا در بازیابی اطلاعات پروژه.', { cause: error });
  }
}

export async function updateProjectRecord(
  projectId: string,
  ownerUid: string,
  patch: Partial<{
    title: string;
    workflowMode: string;
    pipelineStage: number;
    status: string;
    settingsJson: Record<string, unknown>;
    checkpointJson: Record<string, unknown>;
    bookSnapshotJson: Record<string, unknown>;
  }>
) {
  if (!isSqlConfigured()) {
    const store = mem();
    const existing = store.projects.get(projectId);
    if (!existing || existing.ownerUid !== ownerUid) return null;
    const updated: ProjectRow = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.workflowMode !== undefined ? { workflowMode: patch.workflowMode } : {}),
      ...(patch.pipelineStage !== undefined ? { pipelineStage: patch.pipelineStage } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.settingsJson !== undefined ? { settingsJson: cloneRecord(patch.settingsJson) } : {}),
      ...(patch.checkpointJson !== undefined
        ? { checkpointJson: cloneRecord(patch.checkpointJson) }
        : {}),
      ...(patch.bookSnapshotJson !== undefined
        ? { bookSnapshotJson: cloneRecord(patch.bookSnapshotJson) }
        : {}),
      updatedAt: new Date(),
    };
    store.projects.set(projectId, updated);
    return cloneRecord(updated);
  }

  try {
    const rows = await db
      .update(projects)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, projectId), eq(projects.ownerUid, ownerUid)))
      .returning();
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (updateProjectRecord):', error);
    throw new Error('خطا در به‌روزرسانی وضعیت پروژه.', { cause: error });
  }
}

export async function deleteProjectRecord(projectId: string, ownerUid: string) {
  if (!isSqlConfigured()) {
    const store = mem();
    const existing = store.projects.get(projectId);
    if (!existing || existing.ownerUid !== ownerUid) return;
    store.projects.delete(projectId);
    for (const [k, v] of store.sourceFiles) if (v.projectId === projectId) store.sourceFiles.delete(k);
    for (const [k, v] of store.contentUnits) if (v.projectId === projectId) store.contentUnits.delete(k);
    for (const [k, v] of store.dedupClusters) if (v.projectId === projectId) store.dedupClusters.delete(k);
    for (const [k, v] of store.conflicts) if (v.projectId === projectId) store.conflicts.delete(k);
    for (const [k, v] of store.outlineNodes) if (v.projectId === projectId) store.outlineNodes.delete(k);
    for (const [k, v] of store.auditReports) if (v.projectId === projectId) store.auditReports.delete(k);
    for (const [k, v] of store.projectRevisions) {
      if (v.projectId === projectId) store.projectRevisions.delete(k);
    }
    return;
  }

  try {
    await db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerUid, ownerUid)));
  } catch (error) {
    console.error('Database query failed (deleteProjectRecord):', error);
    throw new Error('خطا در حذف پروژه از پایگاه داده.', { cause: error });
  }
}

export async function getProjectBundle(projectId: string, ownerUid: string) {
  if (!isSqlConfigured()) {
    const store = mem();
    const project = await getOwnedProject(projectId, ownerUid);
    if (!project) return null;

    const files = Array.from(store.sourceFiles.values())
      .filter((f) => f.projectId === projectId)
      .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())
      .map(cloneRecord);
    const units = Array.from(store.contentUnits.values())
      .filter((u) => u.projectId === projectId)
      .sort((a, b) => a.unitOrder - b.unitOrder)
      .map(cloneRecord);
    const clusters = Array.from(store.dedupClusters.values())
      .filter((c) => c.projectId === projectId)
      .map(cloneRecord);
    const conflictList = Array.from(store.conflicts.values())
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(cloneRecord);
    const outline = Array.from(store.outlineNodes.values())
      .filter((n) => n.projectId === projectId)
      .sort((a, b) => a.nodeOrder - b.nodeOrder)
      .map(cloneRecord);
    const audits = Array.from(store.auditReports.values())
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())
      .map(cloneRecord);

    return {
      project,
      sourceFiles: files,
      contentUnits: units,
      dedupClusters: clusters,
      conflicts: conflictList,
      outlineNodes: outline,
      auditReport: audits[0] ?? null,
    };
  }

  try {
    const project = await getOwnedProject(projectId, ownerUid);
    if (!project) return null;

    const [files, units, clusters, conflictList, outline, audits] = await Promise.all([
      db
        .select()
        .from(sourceFiles)
        .where(eq(sourceFiles.projectId, projectId))
        .orderBy(asc(sourceFiles.uploadedAt)),
      db
        .select()
        .from(contentUnits)
        .where(eq(contentUnits.projectId, projectId))
        .orderBy(asc(contentUnits.unitOrder)),
      db.select().from(dedupClusters).where(eq(dedupClusters.projectId, projectId)),
      db
        .select()
        .from(conflicts)
        .where(eq(conflicts.projectId, projectId))
        .orderBy(asc(conflicts.createdAt)),
      db
        .select()
        .from(outlineNodes)
        .where(eq(outlineNodes.projectId, projectId))
        .orderBy(asc(outlineNodes.nodeOrder)),
      db
        .select()
        .from(auditReports)
        .where(eq(auditReports.projectId, projectId))
        .orderBy(desc(auditReports.generatedAt))
        .limit(1),
    ]);

    return {
      project,
      sourceFiles: files,
      contentUnits: units,
      dedupClusters: clusters,
      conflicts: conflictList,
      outlineNodes: outline,
      auditReport: audits[0] ?? null,
    };
  } catch (error) {
    console.error('Database query failed (getProjectBundle):', error);
    throw new Error('خطا در بارگذاری جزئیات کامل پروژه از پایگاه داده.', { cause: error });
  }
}

export async function insertSourceFileWithUnits(params: {
  file: typeof sourceFiles.$inferInsert;
  units: Array<typeof contentUnits.$inferInsert>;
}) {
  if (!isSqlConfigured()) {
    const store = mem();
    if (!store.sourceFiles.has(params.file.id)) {
      store.sourceFiles.set(params.file.id, {
        id: params.file.id,
        projectId: params.file.projectId,
        fileName: params.file.fileName,
        format: params.file.format,
        role: params.file.role ?? 'standard',
        wordCount: params.file.wordCount ?? 0,
        sizeBytes: params.file.sizeBytes ?? 0,
        fileHash: params.file.fileHash,
        metadataJson: cloneRecord(params.file.metadataJson ?? null),
        uploadedAt: params.file.uploadedAt ?? new Date(),
      });
    }
    for (const u of params.units) {
      if (!store.contentUnits.has(u.id)) {
        store.contentUnits.set(u.id, {
          id: u.id,
          projectId: u.projectId,
          sourceFileId: u.sourceFileId,
          unitType: u.unitType,
          unitOrder: u.unitOrder,
          rawText: u.rawText,
          payloadJson: cloneRecord(u.payloadJson ?? null),
          contentHash: u.contentHash,
          status: u.status ?? 'unique',
          canonicalUnitId: u.canonicalUnitId ?? null,
          outlineNodeId: u.outlineNodeId ?? null,
        });
      }
    }
    return;
  }

  try {
    await db
      .insert(sourceFiles)
      .values(params.file)
      .onConflictDoNothing({ target: sourceFiles.id });

    // Chunk unit inserts for large 100+ file batches
    const chunkSize = 150;
    for (let i = 0; i < params.units.length; i += chunkSize) {
      const slice = params.units.slice(i, i + chunkSize);
      if (slice.length > 0) {
        await db
          .insert(contentUnits)
          .values(slice)
          .onConflictDoNothing({ target: contentUnits.id });
      }
    }
  } catch (error) {
    console.error('Database query failed (insertSourceFileWithUnits):', error);
    throw new Error('خطا در ذخیره فایل منبع و واحدهای محتوایی در پایگاه داده.', { cause: error });
  }
}

export async function clearProjectPipelineArtifacts(projectId: string, clearFiles = false) {
  if (!isSqlConfigured()) {
    const store = mem();
    for (const [k, v] of store.dedupClusters) if (v.projectId === projectId) store.dedupClusters.delete(k);
    for (const [k, v] of store.conflicts) if (v.projectId === projectId) store.conflicts.delete(k);
    for (const [k, v] of store.outlineNodes) if (v.projectId === projectId) store.outlineNodes.delete(k);
    for (const [k, v] of store.auditReports) if (v.projectId === projectId) store.auditReports.delete(k);
    if (clearFiles) {
      for (const [k, v] of store.contentUnits) if (v.projectId === projectId) store.contentUnits.delete(k);
      for (const [k, v] of store.sourceFiles) if (v.projectId === projectId) store.sourceFiles.delete(k);
    }
    return;
  }

  try {
    await db.delete(dedupClusters).where(eq(dedupClusters.projectId, projectId));
    await db.delete(conflicts).where(eq(conflicts.projectId, projectId));
    await db.delete(outlineNodes).where(eq(outlineNodes.projectId, projectId));
    await db.delete(auditReports).where(eq(auditReports.projectId, projectId));
    if (clearFiles) {
      await db.delete(contentUnits).where(eq(contentUnits.projectId, projectId));
      await db.delete(sourceFiles).where(eq(sourceFiles.projectId, projectId));
    }
  } catch (error) {
    console.error('Database query failed (clearProjectPipelineArtifacts):', error);
    throw new Error('خطا در بازنشانی داده‌های میانی پروژه.', { cause: error });
  }
}

export async function saveDedupResults(params: {
  projectId: string;
  unitUpdates: Array<{
    id: string;
    status: string;
    canonicalUnitId: string | null;
    rawText?: string;
    payloadJson?: Record<string, unknown>;
  }>;
  clusters: Array<typeof dedupClusters.$inferInsert>;
  conflictRows: Array<typeof conflicts.$inferInsert>;
}) {
  if (!isSqlConfigured()) {
    const store = mem();
    for (const [k, v] of store.dedupClusters) {
      if (v.projectId === params.projectId) store.dedupClusters.delete(k);
    }
    for (const [k, v] of store.conflicts) {
      if (v.projectId === params.projectId) store.conflicts.delete(k);
    }

    for (const u of params.unitUpdates) {
      const existing = store.contentUnits.get(u.id);
      if (existing && existing.projectId === params.projectId) {
        store.contentUnits.set(u.id, {
          ...existing,
          status: u.status,
          canonicalUnitId: u.canonicalUnitId,
          ...(u.rawText !== undefined ? { rawText: u.rawText } : {}),
          ...(u.payloadJson !== undefined ? { payloadJson: cloneRecord(u.payloadJson) } : {}),
        });
      }
    }

    for (const c of params.clusters) {
      store.dedupClusters.set(c.id, {
        id: c.id,
        projectId: c.projectId,
        canonicalUnitId: c.canonicalUnitId,
        mergedUnitId: c.mergedUnitId,
        matchType: c.matchType,
        similarityScore: c.similarityScore ?? 1,
        mergeRationale: c.mergeRationale ?? null,
        preservedDetailsJson: cloneRecord(c.preservedDetailsJson ?? null),
      });
    }

    const now = new Date();
    for (const cf of params.conflictRows) {
      store.conflicts.set(cf.id, {
        id: cf.id,
        projectId: cf.projectId,
        topic: cf.topic,
        unitAId: cf.unitAId,
        unitBId: cf.unitBId,
        fileAName: cf.fileAName,
        fileBName: cf.fileBName,
        excerptA: cf.excerptA,
        excerptB: cf.excerptB,
        status: cf.status ?? 'open',
        resolutionNote: cf.resolutionNote ?? null,
        webGroundingJson: cloneRecord(cf.webGroundingJson ?? null),
        createdAt: cf.createdAt ?? now,
        updatedAt: cf.updatedAt ?? now,
      });
    }
    return;
  }

  try {
    await db.delete(dedupClusters).where(eq(dedupClusters.projectId, params.projectId));
    await db.delete(conflicts).where(eq(conflicts.projectId, params.projectId));

    for (const u of params.unitUpdates) {
      await db
        .update(contentUnits)
        .set({
          status: u.status,
          canonicalUnitId: u.canonicalUnitId,
          ...(u.rawText !== undefined ? { rawText: u.rawText } : {}),
          ...(u.payloadJson !== undefined ? { payloadJson: u.payloadJson } : {}),
        })
        .where(and(eq(contentUnits.id, u.id), eq(contentUnits.projectId, params.projectId)));
    }

    if (params.clusters.length > 0) {
      const chunkSize = 150;
      for (let i = 0; i < params.clusters.length; i += chunkSize) {
        await db.insert(dedupClusters).values(params.clusters.slice(i, i + chunkSize));
      }
    }

    if (params.conflictRows.length > 0) {
      await db.insert(conflicts).values(params.conflictRows);
    }
  } catch (error) {
    console.error('Database query failed (saveDedupResults):', error);
    throw new Error('خطا در ذخیره نتایج حذف تکراری و تناقض‌ها در پایگاه داده.', { cause: error });
  }
}

export async function saveOutlineNodesForProject(params: {
  projectId: string;
  nodes: Array<typeof outlineNodes.$inferInsert>;
  unitAssignments: Array<{ unitId: string; outlineNodeId: string }>;
}) {
  if (!isSqlConfigured()) {
    const store = mem();
    for (const [k, v] of store.outlineNodes) {
      if (v.projectId === params.projectId) store.outlineNodes.delete(k);
    }
    for (const n of params.nodes) {
      store.outlineNodes.set(n.id, {
        id: n.id,
        projectId: n.projectId,
        parentId: n.parentId ?? null,
        level: n.level ?? 1,
        nodeOrder: n.nodeOrder,
        title: n.title,
        summary: n.summary ?? null,
        isApproved: n.isApproved ?? false,
        webEnrichmentJson: cloneRecord(n.webEnrichmentJson ?? null),
      });
    }
    for (const assign of params.unitAssignments) {
      const u = store.contentUnits.get(assign.unitId);
      if (u && u.projectId === params.projectId) {
        store.contentUnits.set(u.id, { ...u, outlineNodeId: assign.outlineNodeId });
      }
    }
    return;
  }

  try {
    await db.delete(outlineNodes).where(eq(outlineNodes.projectId, params.projectId));
    if (params.nodes.length > 0) {
      await db.insert(outlineNodes).values(params.nodes);
    }
    for (const assign of params.unitAssignments) {
      await db
        .update(contentUnits)
        .set({ outlineNodeId: assign.outlineNodeId })
        .where(
          and(
            eq(contentUnits.id, assign.unitId),
            eq(contentUnits.projectId, params.projectId)
          )
        );
    }
  } catch (error) {
    console.error('Database query failed (saveOutlineNodesForProject):', error);
    throw new Error('خطا در ذخیره ساختار فصل‌بندی پروژه.', { cause: error });
  }
}

export async function updateOutlineNodesOrderAndApproval(
  projectId: string,
  nodes: Array<{
    id: string;
    title: string;
    summary?: string | null;
    nodeOrder: number;
    level: number;
    parentId?: string | null;
    isApproved: boolean;
    webEnrichmentJson?: Record<string, unknown> | null;
  }>
) {
  if (!isSqlConfigured()) {
    const store = mem();
    for (const [k, v] of store.outlineNodes) {
      if (v.projectId === projectId) store.outlineNodes.delete(k);
    }
    for (const n of nodes) {
      store.outlineNodes.set(n.id, {
        id: n.id,
        projectId,
        parentId: n.parentId ?? null,
        level: n.level,
        nodeOrder: n.nodeOrder,
        title: n.title,
        summary: n.summary ?? null,
        isApproved: n.isApproved,
        webEnrichmentJson: cloneRecord(n.webEnrichmentJson ?? null),
      });
    }
    return;
  }

  try {
    await db.delete(outlineNodes).where(eq(outlineNodes.projectId, projectId));
    if (nodes.length > 0) {
      await db.insert(outlineNodes).values(
        nodes.map((n) => ({
          id: n.id,
          projectId,
          parentId: n.parentId ?? null,
          level: n.level,
          nodeOrder: n.nodeOrder,
          title: n.title,
          summary: n.summary ?? null,
          isApproved: n.isApproved,
          webEnrichmentJson: n.webEnrichmentJson ?? null,
        }))
      );
    }
  } catch (error) {
    console.error('Database query failed (updateOutlineNodesOrderAndApproval):', error);
    throw new Error('خطا در به‌روزرسانی ترتیب و تأیید ساختار فصل‌ها.', { cause: error });
  }
}

export async function reassignUnitsOutlineNodeByPreviousNode(
  projectId: string,
  fromNodeId: string,
  toNodeId: string
) {
  if (!isSqlConfigured()) {
    const store = mem();
    for (const [k, v] of store.contentUnits) {
      if (v.projectId === projectId && v.outlineNodeId === fromNodeId) {
        store.contentUnits.set(k, { ...v, outlineNodeId: toNodeId });
      }
    }
    return;
  }

  try {
    await db
      .update(contentUnits)
      .set({ outlineNodeId: toNodeId })
      .where(and(eq(contentUnits.projectId, projectId), eq(contentUnits.outlineNodeId, fromNodeId)));
  } catch (error) {
    console.error('Database query failed (reassignUnitsOutlineNodeByPreviousNode):', error);
    throw new Error('خطا در انتقال واحدهای محتوایی بین فصل‌ها.', { cause: error });
  }
}

export async function updateContentUnitOutlineNode(
  projectId: string,
  unitId: string,
  outlineNodeId: string | null
) {
  if (!isSqlConfigured()) {
    const store = mem();
    const u = store.contentUnits.get(unitId);
    if (u && u.projectId === projectId) {
      store.contentUnits.set(unitId, { ...u, outlineNodeId });
    }
    return;
  }

  try {
    await db
      .update(contentUnits)
      .set({ outlineNodeId })
      .where(and(eq(contentUnits.id, unitId), eq(contentUnits.projectId, projectId)));
  } catch (error) {
    console.error('Database query failed (updateContentUnitOutlineNode):', error);
    throw new Error('خطا در تغییر فصل واحد محتوایی.', { cause: error });
  }
}

export async function updateOutlineNodeWebEnrichment(
  projectId: string,
  nodeId: string,
  webEnrichmentJson: Record<string, unknown> | null
) {
  if (!isSqlConfigured()) {
    const store = mem();
    const n = store.outlineNodes.get(nodeId);
    if (n && n.projectId === projectId) {
      store.outlineNodes.set(nodeId, { ...n, webEnrichmentJson: cloneRecord(webEnrichmentJson) });
    }
    return;
  }

  try {
    await db
      .update(outlineNodes)
      .set({ webEnrichmentJson })
      .where(and(eq(outlineNodes.id, nodeId), eq(outlineNodes.projectId, projectId)));
  } catch (error) {
    console.error('Database query failed (updateOutlineNodeWebEnrichment):', error);
    throw new Error('خطا در ذخیره تکمیل وب برای فصل.', { cause: error });
  }
}

export async function insertContentUnitRecord(unit: typeof contentUnits.$inferInsert) {
  if (!isSqlConfigured()) {
    const store = mem();
    store.contentUnits.set(unit.id, {
      id: unit.id,
      projectId: unit.projectId,
      sourceFileId: unit.sourceFileId,
      unitType: unit.unitType,
      unitOrder: unit.unitOrder,
      rawText: unit.rawText,
      payloadJson: cloneRecord(unit.payloadJson ?? null),
      contentHash: unit.contentHash,
      status: unit.status ?? 'active',
      canonicalUnitId: unit.canonicalUnitId ?? null,
      outlineNodeId: unit.outlineNodeId ?? null,
    });
    return;
  }

  try {
    await db.insert(contentUnits).values(unit);
  } catch (error) {
    console.error('Database query failed (insertContentUnitRecord):', error);
    throw new Error('خطا در افزودن واحد محتوایی جدید.', { cause: error });
  }
}

export async function updateConflictRecord(
  projectId: string,
  conflictId: string,
  patch: Partial<{
    status: string;
    resolutionNote: string | null;
    webGroundingJson: Record<string, unknown> | null;
  }>
) {
  if (!isSqlConfigured()) {
    const store = mem();
    const existing = store.conflicts.get(conflictId);
    if (!existing || existing.projectId !== projectId) return null;
    const updated: ConflictRow = {
      ...existing,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.resolutionNote !== undefined ? { resolutionNote: patch.resolutionNote } : {}),
      ...(patch.webGroundingJson !== undefined
        ? { webGroundingJson: cloneRecord(patch.webGroundingJson) }
        : {}),
      updatedAt: new Date(),
    };
    store.conflicts.set(conflictId, updated);
    return cloneRecord(updated);
  }

  try {
    const rows = await db
      .update(conflicts)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(and(eq(conflicts.id, conflictId), eq(conflicts.projectId, projectId)))
      .returning();
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (updateConflictRecord):', error);
    throw new Error('خطا در ذخیره تصمیم حل تناقض در پایگاه داده.', { cause: error });
  }
}

export async function replaceProjectConflicts(params: {
  projectId: string;
  conflictRows: Array<typeof conflicts.$inferInsert>;
  conflictUnitIds: string[];
}) {
  if (!isSqlConfigured()) {
    const store = mem();
    for (const [k, u] of store.contentUnits) {
      if (u.projectId === params.projectId && u.status === 'conflict') {
        store.contentUnits.set(k, { ...u, status: 'active' });
      }
    }
    for (const [k, c] of store.conflicts) {
      if (c.projectId === params.projectId) store.conflicts.delete(k);
    }
    const now = new Date();
    for (const cf of params.conflictRows) {
      store.conflicts.set(cf.id, {
        id: cf.id,
        projectId: cf.projectId,
        topic: cf.topic,
        unitAId: cf.unitAId,
        unitBId: cf.unitBId,
        fileAName: cf.fileAName,
        fileBName: cf.fileBName,
        excerptA: cf.excerptA,
        excerptB: cf.excerptB,
        status: cf.status ?? 'open',
        resolutionNote: cf.resolutionNote ?? null,
        webGroundingJson: cloneRecord(cf.webGroundingJson ?? null),
        createdAt: cf.createdAt ?? now,
        updatedAt: cf.updatedAt ?? now,
      });
    }
    const uniqueIds = new Set(params.conflictUnitIds);
    for (const uid of uniqueIds) {
      const u = store.contentUnits.get(uid);
      if (u && u.projectId === params.projectId && u.status === 'active') {
        store.contentUnits.set(uid, { ...u, status: 'conflict' });
      }
    }
    return;
  }

  try {
    // 1. Reset any previously flagged 'conflict' units back to 'active' (preserving 'merged' units untouched)
    await db
      .update(contentUnits)
      .set({ status: 'active' })
      .where(and(eq(contentUnits.projectId, params.projectId), eq(contentUnits.status, 'conflict')));

    // 2. Replace conflicts table rows for this project
    await db.delete(conflicts).where(eq(conflicts.projectId, params.projectId));

    if (params.conflictRows.length > 0) {
      await db.insert(conflicts).values(params.conflictRows);
    }

    // 3. Re-mark genuine conflict participant units as 'conflict'
    const uniqueIds = Array.from(new Set(params.conflictUnitIds));
    for (const uid of uniqueIds) {
      await db
        .update(contentUnits)
        .set({ status: 'conflict' })
        .where(
          and(
            eq(contentUnits.projectId, params.projectId),
            eq(contentUnits.id, uid),
            eq(contentUnits.status, 'active')
          )
        );
    }
  } catch (error) {
    console.error('Database query failed (replaceProjectConflicts):', error);
    throw new Error('خطا در پالایش و به‌روزرسانی جدول تناقض‌ها در پایگاه داده.', { cause: error });
  }
}

export async function saveAuditReportRecord(report: typeof auditReports.$inferInsert) {
  if (!isSqlConfigured()) {
    const store = mem();
    for (const [k, v] of store.auditReports) {
      if (v.projectId === report.projectId) store.auditReports.delete(k);
    }
    const row: AuditReportRow = {
      id: report.id,
      projectId: report.projectId,
      totalSourceFiles: report.totalSourceFiles ?? 0,
      totalInputUnits: report.totalInputUnits ?? 0,
      uniqueUnitsCount: report.uniqueUnitsCount ?? 0,
      mergedDuplicatesCount: report.mergedDuplicatesCount ?? 0,
      conflictsCount: report.conflictsCount ?? 0,
      coveragePercent: report.coveragePercent ?? 100,
      sourceTraceJson: cloneRecord(report.sourceTraceJson ?? null),
      generatedAt: report.generatedAt ?? new Date(),
    };
    store.auditReports.set(row.id, row);
    return cloneRecord(row);
  }

  try {
    await db.delete(auditReports).where(eq(auditReports.projectId, report.projectId));
    const rows = await db.insert(auditReports).values(report).returning();
    return rows[0];
  } catch (error) {
    console.error('Database query failed (saveAuditReportRecord):', error);
    throw new Error('خطا در ذخیره گزارش ممیزی پوشش در پایگاه داده.', { cause: error });
  }
}

export async function createProjectRevisionRecord(params: {
  id: string;
  projectId: string;
  actorType: 'user' | 'ai' | 'system';
  actorName: string;
  actionType: string;
  title: string;
  summary: string;
  detailsJson?: Record<string, unknown> | null;
  snapshotJson?: Record<string, unknown> | null;
}) {
  if (!isSqlConfigured()) {
    const store = mem();
    let maxVersion = 0;
    for (const r of store.projectRevisions.values()) {
      if (r.projectId === params.projectId && r.versionNumber > maxVersion) {
        maxVersion = r.versionNumber;
      }
    }
    const row: ProjectRevisionRow = {
      id: params.id,
      projectId: params.projectId,
      versionNumber: maxVersion + 1,
      actorType: params.actorType,
      actorName: params.actorName,
      actionType: params.actionType,
      title: params.title,
      summary: params.summary,
      detailsJson: cloneRecord(params.detailsJson ?? null),
      snapshotJson: cloneRecord(params.snapshotJson ?? null),
      createdAt: new Date(),
    };
    store.projectRevisions.set(row.id, row);
    return cloneRecord(row);
  }

  try {
    const maxRow = await db
      .select({
        maxVersion: sql<number>`CAST(COALESCE(MAX(${projectRevisions.versionNumber}), 0) AS INTEGER)`,
      })
      .from(projectRevisions)
      .where(eq(projectRevisions.projectId, params.projectId));

    const nextVersion = (Number(maxRow[0]?.maxVersion) || 0) + 1;

    const rows = await db
      .insert(projectRevisions)
      .values({
        id: params.id,
        projectId: params.projectId,
        versionNumber: nextVersion,
        actorType: params.actorType,
        actorName: params.actorName,
        actionType: params.actionType,
        title: params.title,
        summary: params.summary,
        detailsJson: params.detailsJson ?? null,
        snapshotJson: params.snapshotJson ?? null,
      })
      .returning();

    return rows[0];
  } catch (error) {
    console.error('Database query failed (createProjectRevisionRecord):', error);
    throw new Error('خطا در ثبت رکورد تاریخچه تغییرات در پایگاه داده.', { cause: error });
  }
}

export async function listProjectRevisions(projectId: string, ownerUid: string, limit = 80) {
  if (!isSqlConfigured()) {
    const owned = await getOwnedProject(projectId, ownerUid);
    if (!owned) return null;
    const store = mem();
    const rows = Array.from(store.projectRevisions.values())
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .slice(0, limit);

    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      versionNumber: r.versionNumber,
      actorType: r.actorType,
      actorName: r.actorName,
      actionType: r.actionType,
      title: r.title,
      summary: r.summary,
      detailsJson: cloneRecord(r.detailsJson),
      hasSnapshot: r.snapshotJson !== null,
      createdAt: new Date(r.createdAt),
    }));
  }

  try {
    const owned = await getOwnedProject(projectId, ownerUid);
    if (!owned) return null;

    const rows = await db
      .select({
        id: projectRevisions.id,
        projectId: projectRevisions.projectId,
        versionNumber: projectRevisions.versionNumber,
        actorType: projectRevisions.actorType,
        actorName: projectRevisions.actorName,
        actionType: projectRevisions.actionType,
        title: projectRevisions.title,
        summary: projectRevisions.summary,
        detailsJson: projectRevisions.detailsJson,
        hasSnapshot: sql<boolean>`${projectRevisions.snapshotJson} IS NOT NULL`,
        createdAt: projectRevisions.createdAt,
      })
      .from(projectRevisions)
      .where(eq(projectRevisions.projectId, projectId))
      .orderBy(desc(projectRevisions.versionNumber))
      .limit(limit);

    return rows;
  } catch (error) {
    console.error('Database query failed (listProjectRevisions):', error);
    throw new Error('خطا در دریافت تاریخچه تغییرات پروژه از پایگاه داده.', { cause: error });
  }
}

export async function getProjectRevisionWithSnapshot(
  projectId: string,
  revisionId: string,
  ownerUid: string
) {
  if (!isSqlConfigured()) {
    const owned = await getOwnedProject(projectId, ownerUid);
    if (!owned) return null;
    const store = mem();
    const rev = store.projectRevisions.get(revisionId);
    if (!rev || rev.projectId !== projectId) return null;
    return cloneRecord(rev);
  }

  try {
    const owned = await getOwnedProject(projectId, ownerUid);
    if (!owned) return null;

    const rows = await db
      .select()
      .from(projectRevisions)
      .where(
        and(eq(projectRevisions.id, revisionId), eq(projectRevisions.projectId, projectId))
      )
      .limit(1);

    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (getProjectRevisionWithSnapshot):', error);
    throw new Error('خطا در بازیابی نسخه انتخاب‌شده از تاریخچه تغییرات.', { cause: error });
  }
}

export async function restoreProjectFromRevisionSnapshot(
  projectId: string,
  ownerUid: string,
  snapshot: ProjectRevisionSnapshotPayload
) {
  if (!isSqlConfigured()) {
    const owned = await getOwnedProject(projectId, ownerUid);
    if (!owned) return null;
    const store = mem();

    const currentProj = store.projects.get(projectId)!;
    store.projects.set(projectId, {
      ...currentProj,
      title: snapshot.title,
      workflowMode: snapshot.workflowMode,
      pipelineStage: snapshot.pipelineStage,
      status: snapshot.status,
      settingsJson: cloneRecord(snapshot.settingsJson ?? owned.settingsJson ?? {}),
      bookSnapshotJson: cloneRecord(
        (snapshot.bookSnapshotJson as Record<string, unknown> | null) ?? null
      ),
      updatedAt: new Date(),
    });

    for (const [k, n] of store.outlineNodes) {
      if (n.projectId === projectId) store.outlineNodes.delete(k);
    }
    for (const n of snapshot.outlineNodes) {
      store.outlineNodes.set(n.id, {
        id: n.id,
        projectId,
        parentId: n.parentId ?? null,
        level: n.level,
        nodeOrder: n.nodeOrder,
        title: n.title,
        summary: n.summary ?? null,
        isApproved: Boolean(n.isApproved),
        webEnrichmentJson: cloneRecord(n.webEnrichmentJson ?? null),
      });
    }

    for (const u of snapshot.contentUnits) {
      const existingUnit = store.contentUnits.get(u.id);
      if (existingUnit && existingUnit.projectId === projectId) {
        store.contentUnits.set(u.id, {
          ...existingUnit,
          status: u.status,
          canonicalUnitId: u.canonicalUnitId ?? null,
          outlineNodeId: u.outlineNodeId ?? null,
          rawText: u.rawText,
        });
      }
    }

    const now = new Date();
    for (const c of snapshot.conflicts) {
      const existingConflict = store.conflicts.get(c.id);
      if (existingConflict && existingConflict.projectId === projectId) {
        store.conflicts.set(c.id, {
          ...existingConflict,
          status: c.status,
          resolutionNote: c.resolutionNote ?? null,
          webGroundingJson: cloneRecord(c.webGroundingJson ?? null),
          updatedAt: now,
        });
      }
    }

    return await getProjectBundle(projectId, ownerUid);
  }

  try {
    const owned = await getOwnedProject(projectId, ownerUid);
    if (!owned) return null;

    // 1. Restore project-level metadata and compiled book snapshot
    await db
      .update(projects)
      .set({
        title: snapshot.title,
        workflowMode: snapshot.workflowMode,
        pipelineStage: snapshot.pipelineStage,
        status: snapshot.status,
        settingsJson: snapshot.settingsJson ?? owned.settingsJson ?? {},
        bookSnapshotJson: (snapshot.bookSnapshotJson as Record<string, unknown> | null) ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, projectId), eq(projects.ownerUid, ownerUid)));

    // 2. Restore outline nodes
    await db.delete(outlineNodes).where(eq(outlineNodes.projectId, projectId));
    if (snapshot.outlineNodes.length > 0) {
      await db.insert(outlineNodes).values(
        snapshot.outlineNodes.map((n) => ({
          id: n.id,
          projectId,
          parentId: n.parentId ?? null,
          level: n.level,
          nodeOrder: n.nodeOrder,
          title: n.title,
          summary: n.summary ?? null,
          isApproved: Boolean(n.isApproved),
          webEnrichmentJson: n.webEnrichmentJson ?? null,
        }))
      );
    }

    // 3. Restore content unit statuses, assignments, and text
    for (const u of snapshot.contentUnits) {
      await db
        .update(contentUnits)
        .set({
          status: u.status,
          canonicalUnitId: u.canonicalUnitId ?? null,
          outlineNodeId: u.outlineNodeId ?? null,
          rawText: u.rawText,
        })
        .where(and(eq(contentUnits.id, u.id), eq(contentUnits.projectId, projectId)));
    }

    // 4. Restore conflict resolutions & web grounding
    for (const c of snapshot.conflicts) {
      await db
        .update(conflicts)
        .set({
          status: c.status,
          resolutionNote: c.resolutionNote ?? null,
          webGroundingJson: c.webGroundingJson ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(conflicts.id, c.id), eq(conflicts.projectId, projectId)));
    }

    return await getProjectBundle(projectId, ownerUid);
  } catch (error) {
    console.error('Database query failed (restoreProjectFromRevisionSnapshot):', error);
    throw new Error('خطا در بازگردانی وضعیت پروژه به نسخه انتخاب‌شده.', { cause: error });
  }
}
