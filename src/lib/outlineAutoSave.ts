import type { OutlineNodeDto } from './bookTypes.ts';

export const OUTLINE_DRAFT_STORAGE_PREFIX = 'editorial_outline_autosave_v1:';
export const OUTLINE_DRAFT_VERSION = 1 as const;

export interface OutlineReassignment {
  fromNodeId: string;
  toNodeId: string;
}

export interface OutlineDraftPayload {
  version: typeof OUTLINE_DRAFT_VERSION;
  projectId: string;
  savedAt: string;
  serverFingerprint: string;
  nodes: OutlineNodeDto[];
  reassignments: OutlineReassignment[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getOutlineDraftKey(projectId: string): string {
  return `${OUTLINE_DRAFT_STORAGE_PREFIX}${projectId}`;
}

/**
 * Deterministic fingerprint of chapter structure (IDs, order, titles, approval)
 * used to detect whether a locally auto-saved draft actually differs from server state.
 */
export function computeOutlineFingerprint(nodes: OutlineNodeDto[]): string {
  const sorted = [...nodes].sort((a, b) => a.nodeOrder - b.nodeOrder);
  return sorted
    .map((n) => `${n.id}|${n.nodeOrder}|${n.title.trim()}|${n.isApproved ? '1' : '0'}`)
    .join('\n');
}

function isValidOutlineNode(item: unknown): item is OutlineNodeDto {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    obj.id.trim().length > 0 &&
    typeof obj.title === 'string' &&
    typeof obj.nodeOrder === 'number' &&
    Number.isFinite(obj.nodeOrder)
  );
}

function isValidReassignment(item: unknown): item is OutlineReassignment {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.fromNodeId === 'string' &&
    obj.fromNodeId.trim().length > 0 &&
    typeof obj.toNodeId === 'string' &&
    obj.toNodeId.trim().length > 0
  );
}

export function serializeOutlineDraft(params: {
  projectId: string;
  serverNodes: OutlineNodeDto[];
  draftNodes: OutlineNodeDto[];
  reassignments: OutlineReassignment[];
  savedAt?: string;
}): string {
  const payload: OutlineDraftPayload = {
    version: OUTLINE_DRAFT_VERSION,
    projectId: params.projectId,
    savedAt: params.savedAt || new Date().toISOString(),
    serverFingerprint: computeOutlineFingerprint(params.serverNodes),
    nodes: params.draftNodes.map((n, idx) => ({
      ...n,
      nodeOrder: idx + 1,
    })),
    reassignments: params.reassignments.filter(isValidReassignment),
  };
  return JSON.stringify(payload);
}

/**
 * Strictly validates and parses a stored draft JSON string.
 * Rejects malformed JSON, mismatched project IDs, wrong versions, or invalid node arrays.
 */
export function parseOutlineDraft(
  raw: string | null | undefined,
  expectedProjectId: string
): OutlineDraftPayload | null {
  if (!raw || typeof raw !== 'string' || !expectedProjectId.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OutlineDraftPayload>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== OUTLINE_DRAFT_VERSION) return null;
    if (parsed.projectId !== expectedProjectId) return null;
    if (typeof parsed.savedAt !== 'string' || !parsed.savedAt) return null;
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null;

    const validNodes = parsed.nodes.filter(isValidOutlineNode);
    if (validNodes.length !== parsed.nodes.length) return null;

    const validReassignments = Array.isArray(parsed.reassignments)
      ? parsed.reassignments.filter(isValidReassignment)
      : [];

    return {
      version: OUTLINE_DRAFT_VERSION,
      projectId: parsed.projectId,
      savedAt: parsed.savedAt,
      serverFingerprint:
        typeof parsed.serverFingerprint === 'string' ? parsed.serverFingerprint : '',
      nodes: validNodes.map((n, idx) => ({
        ...n,
        projectId: n.projectId || expectedProjectId,
        parentId: n.parentId ?? null,
        level: typeof n.level === 'number' ? n.level : 1,
        nodeOrder: idx + 1,
        summary: n.summary ?? null,
        isApproved: Boolean(n.isApproved),
        webEnrichmentJson: n.webEnrichmentJson ?? null,
      })),
      reassignments: validReassignments,
    };
  } catch {
    return null;
  }
}

/**
 * Returns true only when the locally stored draft contains real unsaved changes
 * compared to the currently loaded server nodes.
 */
export function hasMeaningfulDraftDiff(
  draft: OutlineDraftPayload | null,
  serverNodes: OutlineNodeDto[]
): boolean {
  if (!draft) return false;
  if (draft.reassignments.length > 0) return true;
  return computeOutlineFingerprint(draft.nodes) !== computeOutlineFingerprint(serverNodes);
}

function getBrowserStorage(override?: StorageLike | null): StorageLike | null {
  if (override !== undefined) return override;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Saves non-sensitive Stage 3 outline draft (chapter titles, order, merges) to browser storage
 * for instant crash/offline protection. Never stores API keys or user credentials.
 */
export function saveOutlineDraft(
  params: {
    projectId: string;
    serverNodes: OutlineNodeDto[];
    draftNodes: OutlineNodeDto[];
    reassignments: OutlineReassignment[];
    savedAt?: string;
  },
  storage?: StorageLike | null
): { ok: boolean; savedAt: string } {
  const savedAt = params.savedAt || new Date().toISOString();
  const target = getBrowserStorage(storage);
  if (!target || !params.projectId.trim()) return { ok: false, savedAt };
  try {
    const serialized = serializeOutlineDraft({ ...params, savedAt });
    target.setItem(getOutlineDraftKey(params.projectId), serialized);
    return { ok: true, savedAt };
  } catch {
    return { ok: false, savedAt };
  }
}

export function loadOutlineDraft(
  projectId: string,
  storage?: StorageLike | null
): OutlineDraftPayload | null {
  const target = getBrowserStorage(storage);
  if (!target || !projectId.trim()) return null;
  try {
    const raw = target.getItem(getOutlineDraftKey(projectId));
    return parseOutlineDraft(raw, projectId);
  } catch {
    return null;
  }
}

export function clearOutlineDraft(
  projectId: string,
  storage?: StorageLike | null
): void {
  const target = getBrowserStorage(storage);
  if (!target || !projectId.trim()) return;
  try {
    target.removeItem(getOutlineDraftKey(projectId));
  } catch {
    // ignore storage removal errors in restricted browsing contexts
  }
}

export function formatTimeFa(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return date.toISOString().slice(11, 19);
  }
}
