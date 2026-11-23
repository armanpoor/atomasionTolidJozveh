import type { ParsedBook, ProjectStatus, WorkflowMode } from './bookTypes.ts';

export type RevisionActorType = 'user' | 'ai' | 'system';

export type RevisionActionType =
  | 'project_created'
  | 'files_ingested'
  | 'file_deleted'
  | 'dedup_completed'
  | 'outline_updated'
  | 'document_finalized'
  | 'conflict_resolved'
  | 'conflicts_rescanned'
  | 'web_grounding'
  | 'deep_ai_review'
  | 'ai_proposal_applied'
  | 'audio_transcribed'
  | 'winols_map_edited'
  | 'winols_damos_exported'
  | 'docx_exported'
  | 'markdown_exported'
  | 'print_preview_opened'
  | 'ai_provider_changed'
  | 'manual_checkpoint'
  | 'rollback_restored'
  | 'settings_updated'
  | 'harness_blueprint_approved'
  | 'harness_section_verified'
  | 'harness_quarantine_resolved';

export type RevisionCategoryFilter =
  | 'all'
  | 'files_merge'
  | 'ai'
  | 'winols'
  | 'export'
  | 'settings';

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
  exportFormat?: string;
  mapsExported?: number;
  fileName?: string;
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

export interface RevisionMetricDelta {
  chaptersDelta: number;
  unitsDelta: number;
  openConflictsDelta: number;
}

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

export function getRevisionCategory(actionType: RevisionActionType): Exclude<RevisionCategoryFilter, 'all'> {
  switch (actionType) {
    case 'project_created':
    case 'files_ingested':
    case 'file_deleted':
    case 'dedup_completed':
    case 'outline_updated':
    case 'document_finalized':
    case 'conflict_resolved':
    case 'conflicts_rescanned':
      return 'files_merge';
    case 'web_grounding':
    case 'deep_ai_review':
    case 'ai_proposal_applied':
    case 'audio_transcribed':
    case 'harness_blueprint_approved':
    case 'harness_section_verified':
    case 'harness_quarantine_resolved':
      return 'ai';
    case 'winols_map_edited':
    case 'winols_damos_exported':
      return 'winols';
    case 'docx_exported':
    case 'markdown_exported':
    case 'print_preview_opened':
      return 'export';
    case 'ai_provider_changed':
    case 'manual_checkpoint':
    case 'rollback_restored':
    case 'settings_updated':
    default:
      return 'settings';
  }
}

export function getActionLabelFa(actionType: RevisionActionType): string {
  switch (actionType) {
    case 'project_created':
      return 'ایجاد پروژه';
    case 'files_ingested':
      return 'بارگذاری و استخراج فایل‌ها';
    case 'file_deleted':
      return 'حذف فایل منبع';
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
    case 'audio_transcribed':
      return 'تبدیل ویس کارگاهی به متن';
    case 'winols_map_edited':
      return 'ویرایش مشخصات نقشه WinOLS';
    case 'winols_damos_exported':
      return 'خروجی داموس WinOLS 2.24 (.a2l / Map Pack)';
    case 'docx_exported':
      return 'دانلود فایل ورد (.docx)';
    case 'markdown_exported':
      return 'دانلود نسخه Markdown';
    case 'print_preview_opened':
      return 'پیش‌نمایش چاپ و PDF';
    case 'ai_provider_changed':
      return 'تغییر ارائه‌دهنده / کلید هوش مصنوعی';
    case 'manual_checkpoint':
      return 'ثبت نقطه بازیابی دستی (Checkpoint)';
    case 'rollback_restored':
      return 'بازگشت به نسخه قبلی';
    case 'settings_updated':
      return 'تغییر تنظیمات پروژه';
    case 'harness_blueprint_approved':
      return 'تأیید نقشه راه هارنس (HITL Gate)';
    case 'harness_section_verified':
      return 'تأیید زیربخش توسط ممیزی دولایه هارنس';
    case 'harness_quarantine_resolved':
      return 'تعیین‌تکلیف دستی زیربخش قرنطینه‌شده';
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
    categoryFilter?: RevisionCategoryFilter;
    query?: string;
  } = {}
): ProjectRevisionDto[] {
  const actorFilter = opts.actorFilter || 'all';
  const categoryFilter = opts.categoryFilter || 'all';
  const normalizedQuery = (opts.query || '').trim().toLowerCase();

  return revisions.filter((rev) => {
    if (actorFilter === 'user' && rev.actorType !== 'user') return false;
    if (actorFilter === 'ai' && rev.actorType !== 'ai' && rev.actorType !== 'system') {
      return false;
    }
    if (categoryFilter !== 'all' && getRevisionCategory(rev.actionType) !== categoryFilter) {
      return false;
    }
    if (!normalizedQuery) return true;
    const haystack = [
      rev.title,
      rev.summary,
      rev.actorName,
      rev.details?.fileName || '',
      rev.details?.exportFormat || '',
      rev.details?.note || '',
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

/**
 * Computes Before/After metric deltas for each revision relative to the immediately older version.
 * Expects `revisions` in any order and matches by descending `versionNumber`.
 */
export function computeRevisionMetricDeltas(
  revisions: ProjectRevisionDto[]
): Record<string, RevisionMetricDelta> {
  const sortedAsc = [...revisions].sort((a, b) => a.versionNumber - b.versionNumber);
  const deltas: Record<string, RevisionMetricDelta> = {};

  for (let i = 0; i < sortedAsc.length; i++) {
    const curr = sortedAsc[i];
    const prev = i > 0 ? sortedAsc[i - 1] : null;
    if (!prev) {
      deltas[curr.id] = { chaptersDelta: 0, unitsDelta: 0, openConflictsDelta: 0 };
      continue;
    }
    const currCh = typeof curr.details?.chaptersCount === 'number' ? curr.details.chaptersCount : null;
    const prevCh = typeof prev.details?.chaptersCount === 'number' ? prev.details.chaptersCount : null;
    const currU = typeof curr.details?.unitsCount === 'number' ? curr.details.unitsCount : null;
    const prevU = typeof prev.details?.unitsCount === 'number' ? prev.details.unitsCount : null;
    const currC = typeof curr.details?.openConflictsCount === 'number' ? curr.details.openConflictsCount : null;
    const prevC = typeof prev.details?.openConflictsCount === 'number' ? prev.details.openConflictsCount : null;

    deltas[curr.id] = {
      chaptersDelta: currCh !== null && prevCh !== null ? currCh - prevCh : 0,
      unitsDelta: currU !== null && prevU !== null ? currU - prevU : 0,
      openConflictsDelta: currC !== null && prevC !== null ? currC - prevC : 0,
    };
  }

  return deltas;
}

export function exportRevisionsToJson(
  projectTitle: string,
  revisions: ProjectRevisionDto[]
): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      projectTitle,
      exportedAt: new Date().toISOString(),
      totalRevisions: revisions.length,
      revisions,
    },
    null,
    2
  );
}

export function exportRevisionsToCsv(revisions: ProjectRevisionDto[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = [
    'Version',
    'TimestampISO',
    'ActorType',
    'ActorName',
    'ActionType',
    'ActionLabelFa',
    'Title',
    'Summary',
    'Stage',
    'Chapters',
    'Units',
    'OpenConflicts',
    'HasSnapshot',
    'FileNameOrFormat',
  ];
  const rows = revisions.map((r) =>
    [
      r.versionNumber,
      r.createdAt,
      r.actorType,
      r.actorName,
      r.actionType,
      getActionLabelFa(r.actionType),
      r.title,
      r.summary,
      r.details?.pipelineStage ?? '',
      r.details?.chaptersCount ?? '',
      r.details?.unitsCount ?? '',
      r.details?.openConflictsCount ?? '',
      r.hasSnapshot ? 'Yes' : 'No',
      r.details?.fileName || r.details?.exportFormat || '',
    ]
      .map(esc)
      .join(',')
  );
  return `\uFEFF${headers.map(esc).join(',')}\n${rows.join('\n')}`;
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
