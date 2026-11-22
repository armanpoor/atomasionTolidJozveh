import type { ParsedBook, ProjectStatus, WorkflowMode } from './bookTypes.ts';

export type RevisionActorType = 'user' | 'ai' | 'system';

export type RevisionActionType =
  | 'project_created'
  | 'files_ingested'
  | 'dedup_completed'
  | 'outline_updated'
  | 'document_finalized'
  | 'conflict_resolved'
  | 'conflicts_rescanned'
  | 'web_grounding'
  | 'deep_ai_review'
  | 'ai_proposal_applied'
  | 'rollback_restored'
  | 'settings_updated';

export interface RevisionSnapshotOutlineNode {
  id: string;
  parentId: string | null;
  level: number;
  nodeOrder: number;
  title: string;
  summary: string | null;
  isApproved: boolean;
  webEnrichmentJson: Record<string, unknown> | null;
}

export interface RevisionSnapshotUnitState {
  id: string;
  status: string;
  canonicalUnitId: string | null;
  outlineNodeId: string | null;
  rawText: string;
}

export interface RevisionSnapshotConflictState {
  id: string;
  status: string;
  resolutionNote: string | null;
  webGroundingJson: Record<string, unknown> | null;
}

export interface ProjectRevisionSnapshotPayload {
  schemaVersion: 1;
  title: string;
  workflowMode: WorkflowMode | string;
  pipelineStage: number;
  status: ProjectStatus | string;
  settingsJson: Record<string, unknown> | null;
  bookSnapshotJson: ParsedBook | Record<string, unknown> | null;
  outlineNodes: RevisionSnapshotOutlineNode[];
  contentUnits: RevisionSnapshotUnitState[];
  conflicts: RevisionSnapshotConflictState[];
}

export interface ProjectRevisionDetails {
  chaptersCount?: number;
  unitsCount?: number;
  conflictsCount?: number;
  openConflictsCount?: number;
  pipelineStage?: number;
  hasBookSnapshot?: boolean;
  modelUsed?: string;
  restoredFromVersion?: number;
  restoredFromRevisionId?: string;
  note?: string;
}

export interface ProjectRevisionDto {
  id: string;
  projectId: string;
  versionNumber: number;
  actorType: RevisionActorType;
  actorName: string;
  actionType: RevisionActionType;
  title: string;
  summary: string;
  details: ProjectRevisionDetails;
  hasSnapshot: boolean;
  createdAt: string;
}

export type RevisionActorFilter = 'all' | 'user' | 'ai';

export function getActorLabelFa(actorType: RevisionActorType): string {
  switch (actorType) {
    case 'ai':
      return 'هوش مصنوعی';
    case 'system':
      return 'موتور پردازش';
    case 'user':
    default:
      return 'کاربر';
  }
}

export function getActionLabelFa(actionType: RevisionActionType): string {
  switch (actionType) {
    case 'project_created':
      return 'ایجاد پروژه';
    case 'files_ingested':
      return 'بارگذاری و استخراج فایل‌ها';
    case 'dedup_completed':
      return 'ادغام بدون افت و کشف تناقض';
    case 'outline_updated':
      return 'ویرایش ساختار فصل‌ها';
    case 'document_finalized':
      return 'صفحه‌آرایی و ساخت نسخه نهایی';
    case 'conflict_resolved':
      return 'تعیین‌تکلیف تناقض';
    case 'conflicts_rescanned':
      return 'پالایش هوشمند تناقض‌ها';
    case 'web_grounding':
      return 'تکمیل و راستی‌آزمایی با جستجوی گوگل';
    case 'deep_ai_review':
      return 'بازبینی عمیق هوش مصنوعی';
    case 'ai_proposal_applied':
      return 'اعمال پیشنهاد دستیار هوشمند';
    case 'rollback_restored':
      return 'بازگشت به نسخه قبلی';
    case 'settings_updated':
      return 'تغییر تنظیمات پروژه';
    default:
      return 'تغییر در پروژه';
  }
}

export function formatRevisionTimestampFa(isoString: string): string {
  if (!isoString) return '—';
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(dt);
  } catch {
    return dt.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function filterProjectRevisions(
  revisions: ProjectRevisionDto[],
  opts: {
    actorFilter?: RevisionActorFilter;
    query?: string;
  } = {}
): ProjectRevisionDto[] {
  const actorFilter = opts.actorFilter || 'all';
  const normalizedQuery = (opts.query || '').trim().toLowerCase();

  return revisions.filter((rev) => {
    if (actorFilter === 'user' && rev.actorType !== 'user') return false;
    if (actorFilter === 'ai' && rev.actorType !== 'ai' && rev.actorType !== 'system') {
      return false;
    }
    if (!normalizedQuery) return true;
    const haystack = [
      rev.title,
      rev.summary,
      rev.actorName,
      getActionLabelFa(rev.actionType),
      getActorLabelFa(rev.actorType),
      `نسخه ${rev.versionNumber}`,
      String(rev.versionNumber),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function buildRevisionSnapshotPayload(input: {
  project: {
    title: string;
    workflowMode: string;
    pipelineStage: number;
    status: string;
    settingsJson?: Record<string, unknown> | null;
    bookSnapshotJson?: Record<string, unknown> | null;
  };
  outlineNodes: Array<{
    id: string;
    parentId?: string | null;
    level: number;
    nodeOrder: number;
    title: string;
    summary?: string | null;
    isApproved: boolean;
    webEnrichmentJson?: Record<string, unknown> | null;
  }>;
  contentUnits: Array<{
    id: string;
    status: string;
    canonicalUnitId?: string | null;
    outlineNodeId?: string | null;
    rawText: string;
  }>;
  conflicts: Array<{
    id: string;
    status: string;
    resolutionNote?: string | null;
    webGroundingJson?: Record<string, unknown> | null;
  }>;
}): ProjectRevisionSnapshotPayload {
  return {
    schemaVersion: 1,
    title: input.project.title,
    workflowMode: input.project.workflowMode,
    pipelineStage: input.project.pipelineStage,
    status: input.project.status,
    settingsJson: input.project.settingsJson ?? null,
    bookSnapshotJson: input.project.bookSnapshotJson ?? null,
    outlineNodes: input.outlineNodes.map((n) => ({
      id: n.id,
      parentId: n.parentId ?? null,
      level: n.level,
      nodeOrder: n.nodeOrder,
      title: n.title,
      summary: n.summary ?? null,
      isApproved: Boolean(n.isApproved),
      webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
    })),
    contentUnits: input.contentUnits.map((u) => ({
      id: u.id,
      status: u.status,
      canonicalUnitId: u.canonicalUnitId ?? null,
      outlineNodeId: u.outlineNodeId ?? null,
      rawText: u.rawText,
    })),
    conflicts: input.conflicts.map((c) => ({
      id: c.id,
      status: c.status,
      resolutionNote: c.resolutionNote ?? null,
      webGroundingJson: (c.webGroundingJson as Record<string, unknown> | null) ?? null,
    })),
  };
}

export function isValidRevisionSnapshot(
  raw: unknown
): raw is ProjectRevisionSnapshotPayload {
  if (!raw || typeof raw !== 'object') return false;
  const candidate = raw as Partial<ProjectRevisionSnapshotPayload>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.title === 'string' &&
    typeof candidate.pipelineStage === 'number' &&
    Array.isArray(candidate.outlineNodes) &&
    Array.isArray(candidate.contentUnits) &&
    Array.isArray(candidate.conflicts)
  );
}
