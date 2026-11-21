import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from './index.ts';
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

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string | null,
  photoUrl?: string | null
) {
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

export async function updateConflictRecord(
  projectId: string,
  conflictId: string,
  patch: Partial<{
    status: string;
    resolutionNote: string | null;
    webGroundingJson: Record<string, unknown> | null;
  }>
) {
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
