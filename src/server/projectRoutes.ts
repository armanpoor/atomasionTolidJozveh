import { Router } from 'express';
import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type, FunctionDeclaration } from '@google/genai';
import { requireAuth, AuthRequest } from '../middleware/auth.ts';
import {
  clearProjectPipelineArtifacts,
  createProjectRecord,
  deleteProjectRecord,
  getProjectBundle,
  insertSourceFileWithUnits,
  listUserProjects,
  replaceProjectConflicts,
  saveAuditReportRecord,
  saveDedupResults,
  saveOutlineNodesForProject,
  updateConflictRecord,
  updateOutlineNodesOrderAndApproval,
  updateProjectRecord,
} from '../db/repository.ts';
import { db } from '../db/index.ts';
import { contentUnits, outlineNodes } from '../db/schema.ts';
import { and, eq } from 'drizzle-orm';
import {
  ChatProposal,
  DEFAULT_DOCX_CONFIG,
  DeepReviewFinding,
  DeepReviewReportDto,
  DocxExportConfig,
  FileRole,
  GoogleSearchMode,
  SourceFileFormat,
  WebGroundingSource,
  WorkflowMode,
} from '../lib/bookTypes.ts';
import { detectFileFormat, parseAnySourceFile, toPersianDigits } from '../lib/formatParsers.ts';
import {
  assembleFinalBookAndAudit,
  buildInitialOutline,
  computeJaccardSimilarity,
  DedupPipelineOutput,
  deterministicHash,
  extractAtomicUnitsFromBook,
  isGenuineNumericConflict,
  normalizePersianForComparison,
  runDeterministicLosslessDedup,
  tokenizeContent,
} from '../lib/zeroLossPipeline.ts';
import {
  AiUsageDelta,
  extractAiUsageFromCheckpoint,
  mergeAiUsageDelta,
} from '../lib/aiUsageMetrics.ts';

const ALLOWED_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

const THINKING_LEVEL_MAP: Record<string, ThinkingLevel> = {
  LOW: ThinkingLevel.LOW,
  MEDIUM: ThinkingLevel.MEDIUM,
  HIGH: ThinkingLevel.HIGH,
  XHIGH: ThinkingLevel.XHIGH,
  MINIMAL: ThinkingLevel.MINIMAL,
};

export function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function resolveThinkingLevel(model: string, levelRaw?: string): ThinkingLevel {
  const upper = (levelRaw || 'HIGH').toUpperCase();
  let resolved = THINKING_LEVEL_MAP[upper] ?? ThinkingLevel.HIGH;
  if (model === 'gemini-4-hydrogen' && resolved === ThinkingLevel.MINIMAL) {
    resolved = ThinkingLevel.LOW;
  }
  if (model === 'gemini-3.1-flash-lite' && resolved === ThinkingLevel.XHIGH) {
    resolved = ThinkingLevel.HIGH;
  }
  return resolved;
}

function extractGroundingSources(response: unknown): WebGroundingSource[] {
  const sources: WebGroundingSource[] = [];
  const seen = new Set<string>();
  const resp = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
  };
  const chunks = resp?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  for (const ch of chunks) {
    const uri = ch?.web?.uri?.trim();
    const title = ch?.web?.title?.trim() || uri || 'منبع وب';
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title, uri });
    }
  }
  return sources;
}

function extractUsageDeltaFromResponse(
  response: unknown,
  opts: {
    modelUsed?: string;
    fallbackPromptChars?: number;
    fallbackOutputChars?: number;
    isGrounding?: boolean;
    isDeepReview?: boolean;
    isChat?: boolean;
  } = {}
): AiUsageDelta {
  const meta = (
    response as {
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        totalTokenCount?: number;
      };
    }
  )?.usageMetadata;

  const promptTokens =
    typeof meta?.promptTokenCount === 'number' && meta.promptTokenCount > 0
      ? meta.promptTokenCount
      : Math.ceil((opts.fallbackPromptChars ?? 0) / 3);
  const outputTokens =
    typeof meta?.candidatesTokenCount === 'number' && meta.candidatesTokenCount > 0
      ? meta.candidatesTokenCount
      : Math.ceil((opts.fallbackOutputChars ?? 0) / 3);
  const thinkingTokens =
    typeof meta?.thoughtsTokenCount === 'number' && meta.thoughtsTokenCount > 0
      ? meta.thoughtsTokenCount
      : 0;
  const totalTokens =
    typeof meta?.totalTokenCount === 'number' && meta.totalTokenCount > 0
      ? meta.totalTokenCount
      : promptTokens + outputTokens + thinkingTokens;

  return {
    promptTokens,
    outputTokens,
    thinkingTokens,
    totalTokens,
    requestCount: 1,
    groundingCallCount: opts.isGrounding ? 1 : 0,
    deepReviewCount: opts.isDeepReview ? 1 : 0,
    chatCallCount: opts.isChat ? 1 : 0,
    modelUsed: opts.modelUsed,
  };
}

async function recordProjectAiUsage(
  projectId: string,
  ownerUid: string,
  delta: AiUsageDelta
) {
  try {
    const fresh = await getProjectBundle(projectId, ownerUid);
    if (!fresh) return null;
    const prevCheckpoint = (fresh.project.checkpointJson || {}) as Record<string, unknown>;
    const existing = extractAiUsageFromCheckpoint(prevCheckpoint);
    const updated = mergeAiUsageDelta(existing, delta);
    await updateProjectRecord(projectId, ownerUid, {
      checkpointJson: {
        ...prevCheckpoint,
        aiUsage: updated,
      },
    });
    return updated;
  } catch (err) {
    console.warn('[AI Usage ledger persist warning]:', err);
    return null;
  }
}

function safeParseGeminiJson<T>(rawText: string | undefined, fallback: T): T {
  const cleaned = (rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return fallback;
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function formatGeminiError(err: unknown, fallbackMessage: string): { statusCode: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || '');
  const upper = raw.toUpperCase();

  let parsedCode: number | undefined;
  let parsedStatus = '';
  let parsedMessage = '';
  if (raw.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as {
        error?: { code?: number; status?: string; message?: string };
      };
      parsedCode = obj?.error?.code;
      parsedStatus = String(obj?.error?.status || '').toUpperCase();
      parsedMessage = String(obj?.error?.message || '').trim();
    } catch {
      // ignore non-JSON parse errors
    }
  }

  const combinedUpper = `${upper} ${parsedStatus}`;

  if (
    parsedCode === 429 ||
    combinedUpper.includes('429') ||
    combinedUpper.includes('RESOURCE_EXHAUSTED') ||
    combinedUpper.includes('EXCEEDED YOUR CURRENT QUOTA')
  ) {
    return {
      statusCode: 429,
      message:
        'سهمیه مجاز درخواست‌های Gemini API در پلن رایگان کلید متصل به پروژه پر شده است (خطای 429 RESOURCE_EXHAUSTED). لطفاً ۱ تا ۲ دقیقه دیگر مجدداً تلاش کنید یا از بخش Settings > Secrets یک کلید API دارای Billing فعال متصل کنید.',
    };
  }
  if (
    parsedCode === 503 ||
    combinedUpper.includes('503') ||
    combinedUpper.includes('UNAVAILABLE') ||
    combinedUpper.includes('OVERLOADED')
  ) {
    return {
      statusCode: 503,
      message:
        'سرویس هوش مصنوعی Gemini موقتاً شلوغ است (خطای 503). لطفاً ۳۰ ثانیه دیگر دوباره تلاش کنید.',
    };
  }
  if (
    parsedCode === 504 ||
    combinedUpper.includes('504') ||
    combinedUpper.includes('DEADLINE_EXCEEDED') ||
    combinedUpper.includes('TIMEOUT')
  ) {
    return {
      statusCode: 504,
      message:
        'زمان پردازش درخواست هوش مصنوعی به پایان رسید (Timeout). لطفاً دوباره تلاش کنید؛ سیستم به‌طور خودکار از سطح استدلال بهینه‌تر استفاده خواهد کرد.',
    };
  }
  if (
    parsedCode === 403 ||
    combinedUpper.includes('403') ||
    combinedUpper.includes('PERMISSION_DENIED') ||
    combinedUpper.includes('API_KEY_INVALID')
  ) {
    return {
      statusCode: 403,
      message:
        'کلید Gemini API معتبر نیست یا دسترسی لازم را ندارد (خطای 403). لطفاً کلید متصل در بخش Settings > Secrets را بررسی کنید.',
    };
  }
  if (parsedCode === 404 || combinedUpper.includes('404') || combinedUpper.includes('NOT_FOUND')) {
    return {
      statusCode: 404,
      message: 'مدل انتخاب‌شده در دسترس نیست (خطای 404). لطفاً مدل Gemini 4 Hydrogen را انتخاب کنید.',
    };
  }
  if (parsedCode === 400 || combinedUpper.includes('INVALID_ARGUMENT')) {
    return {
      statusCode: 400,
      message: parsedMessage
        ? `خطای پارامتر درخواست به Gemini API (کد 400): ${parsedMessage.slice(0, 180)}`
        : `${fallbackMessage} (کد 400)`,
    };
  }

  return {
    statusCode: 500,
    message: parsedMessage
      ? `${fallbackMessage} (${parsedMessage.slice(0, 180)})`
      : raw && !raw.trim().startsWith('{')
        ? raw
        : fallbackMessage,
  };
}

async function generateWithGroundingFallback(
  ai: GoogleGenAI,
  prompt: string,
  thinkingLevel: ThinkingLevel = ThinkingLevel.LOW
) {
  try {
    return await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel },
      },
    });
  } catch (primaryErr) {
    const raw = primaryErr instanceof Error ? primaryErr.message : String(primaryErr || '');
    const isQuotaOrBusy =
      raw.includes('429') ||
      raw.includes('503') ||
      raw.toUpperCase().includes('RESOURCE_EXHAUSTED') ||
      raw.toUpperCase().includes('UNAVAILABLE') ||
      raw.toUpperCase().includes('QUOTA');
    if (!isQuotaOrBusy) throw primaryErr;

    // Wait briefly and fall back to gemini-3.1-flash-lite (separate free-tier quota bucket)
    await new Promise((r) => setTimeout(r, 1200));
    return await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
  }
}

/**
 * Layer 2 Semantic Conflict Verification:
 * Runs a single batched Gemini call over Layer-1 candidate conflicts to eliminate any remaining
 * complementary / parallel / elaboration / distinct-condition false positives.
 * Falls back cleanly to Layer-1 candidates if AI is unavailable or quota-limited.
 */
async function verifyConflictsWithAi(
  ai: GoogleGenAI | null,
  candidates: DedupPipelineOutput['conflicts']
): Promise<{
  verified: DedupPipelineOutput['conflicts'];
  aiVerified: boolean;
  usageDelta: AiUsageDelta | null;
}> {
  if (!ai || candidates.length === 0) {
    return { verified: candidates, aiVerified: false, usageDelta: null };
  }

  const batch = candidates.slice(0, 40).map((c) => ({
    id: c.id,
    topic: c.topic,
    excerptA: c.excerptA,
    excerptB: c.excerptB,
  }));

  const prompt = [
    'شما ممیز ارشد دقیق اسناد فنی هستید. فهرست زیر نامزدهای احتمالی «تناقض» بین دو فایل مختلف است.',
    'برای هر مورد با سخت‌گیری کامل بررسی کن آیا دو متن واقعاً با یکدیگر **تضاد منطقی یا عددی ناسازگار درباره دقیقاً یک موضوع و یک شرط یکسان** دارند (isRealConflict: true) یا فقط **مکمل یکدیگر، ردیف‌های موازی، مثال‌های متفاوت، بسط/توضیح بیشتر، یا مربوط به دو حالت/شرط مختلف** هستند (isRealConflict: false).',
    'مثال عدم تناقض (false): «عدد ۱۴ در دسیمال = حرف E» در برابر «عدد ۱۱ در دسیمال = حرف B» (مکمل هم هستند)، یا «فشار در دور آرام ۱.۵ بار» در برابر «فشار در تمام‌گاز ۴ بار» (دو شرط مختلف).',
    'مثال تناقض واقعی (true): «حداکثر فشار ریل سوخت در حالت تمام‌گاز ۴ بار است» در برابر «حداکثر فشار ریل سوخت در حالت تمام‌گاز ۶ بار است» (دقیقاً یک موضوع و یک شرط با دو مقدار ناسازگار).',
    `نامزدها:\n${JSON.stringify(batch)}`,
  ].join('\n\n');

  const schema = {
    type: Type.OBJECT,
    properties: {
      results: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            isRealConflict: { type: Type.BOOLEAN },
            shortReason: { type: Type.STRING },
          },
          required: ['id', 'isRealConflict'],
        },
      },
    },
    required: ['results'],
  };

  const modelsToTry: Array<{ model: string; level: ThinkingLevel }> = [
    { model: 'gemini-4-hydrogen', level: ThinkingLevel.MEDIUM },
    { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.LOW },
  ];

  for (const attempt of modelsToTry) {
    try {
      const res = await ai.models.generateContent({
        model: attempt.model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          thinkingConfig: { thinkingLevel: attempt.level },
        },
      });
      const usageDelta = extractUsageDeltaFromResponse(res, {
        modelUsed: attempt.model,
        fallbackPromptChars: prompt.length,
        fallbackOutputChars: (res.text || '').length,
      });
      const parsed = safeParseGeminiJson<{
        results?: Array<{ id?: string; isRealConflict?: boolean; shortReason?: string }>;
      }>(res.text, {});

      if (Array.isArray(parsed.results) && parsed.results.length > 0) {
        const verdictById = new Map(parsed.results.map((r) => [String(r.id || ''), r]));
        const verified = candidates.filter((c) => {
          const v = verdictById.get(c.id);
          // Keep ONLY genuine contradictions; drop anything marked false
          return v ? v.isRealConflict === true : true;
        });
        return { verified, aiVerified: true, usageDelta };
      }
    } catch (err) {
      console.warn(`AI conflict verification attempt (${attempt.model}) skipped:`, err);
    }
  }

  return { verified: candidates, aiVerified: false, usageDelta: null };
}

function buildChapterExcerpt(
  units: Array<{ outlineNodeId: string | null; status: string; rawText: string }>,
  nodeId: string,
  maxChars = 2200
): string {
  const parts: string[] = [];
  let len = 0;
  for (const u of units) {
    if (u.outlineNodeId !== nodeId || u.status === 'merged') continue;
    const snippet = u.rawText.trim();
    if (!snippet) continue;
    if (len + snippet.length > maxChars) {
      parts.push(snippet.slice(0, Math.max(120, maxChars - len)));
      break;
    }
    parts.push(snippet);
    len += snippet.length + 2;
  }
  return parts.join('\n\n');
}

function formatBundleForClient(bundle: NonNullable<Awaited<ReturnType<typeof getProjectBundle>>>) {
  const unitCountsByFile = new Map<string, number>();
  for (const u of bundle.contentUnits) {
    unitCountsByFile.set(u.sourceFileId, (unitCountsByFile.get(u.sourceFileId) || 0) + 1);
  }

  return {
    project: {
      ...bundle.project,
      createdAt: bundle.project.createdAt.toISOString(),
      updatedAt: bundle.project.updatedAt.toISOString(),
    },
    sourceFiles: bundle.sourceFiles.map((f) => {
      const meta = (f.metadataJson || {}) as Record<string, unknown>;
      return {
        ...f,
        fileRole: f.role,
        checksum: f.fileHash,
        unitCount: Number(meta.unitCount ?? unitCountsByFile.get(f.id) ?? 0),
        uploadedAt: f.uploadedAt.toISOString(),
      };
    }),
    contentUnits: bundle.contentUnits.map((u) => {
      const payload = (u.payloadJson || {}) as Record<string, unknown>;
      return {
        ...u,
        headingPath: String(payload.headingPath ?? ''),
        normalizedHash: u.contentHash,
        metadataJson: payload,
      };
    }),
    dedupClusters: bundle.dedupClusters.map((c) => {
      const details = (c.preservedDetailsJson || {}) as Record<string, unknown>;
      const mergedUnitIds = Array.isArray(details.mergedUnitIds)
        ? details.mergedUnitIds.map(String)
        : [c.mergedUnitId];
      return {
        ...c,
        mergedUnitIds,
        losslessSummary: c.mergeRationale ?? null,
      };
    }),
    conflicts: bundle.conflicts.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    outlineNodes: bundle.outlineNodes,
    auditReport: bundle.auditReport
      ? {
          ...bundle.auditReport,
          uniqueUnitsPreserved: bundle.auditReport.uniqueUnitsCount,
          duplicatesMerged: bundle.auditReport.mergedDuplicatesCount,
          conflictsDetected: bundle.auditReport.conflictsCount,
          conflictsResolved: Number(
            ((bundle.auditReport.sourceTraceJson || {}) as Record<string, unknown>).conflictsResolved ?? 0
          ),
          detailsJson: bundle.auditReport.sourceTraceJson ?? null,
          generatedAt: bundle.auditReport.generatedAt.toISOString(),
        }
      : null,
  };
}

const CHAT_EDITOR_TOOLS: FunctionDeclaration[] = [
  {
    name: 'rename_chapter',
    description: 'تغییر عنوان یکی از فصل‌های سند در ساختار فصل‌بندی.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه دقیق فصل (مثلاً node_...)' },
        newTitle: { type: Type.STRING, description: 'عنوان جدید فارسی فصل' },
      },
      required: ['nodeId', 'newTitle'],
    },
  },
  {
    name: 'move_chapter',
    description: 'جابه‌جایی ترتیب یک فصل به موقعیت جدید (شروع از ۱).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل' },
        targetOrder: { type: Type.INTEGER, description: 'شماره ترتیب جدید از ۱ تا تعداد فصل‌ها' },
      },
      required: ['nodeId', 'targetOrder'],
    },
  },
  {
    name: 'split_chapter',
    description: 'تقسیم یک فصل شلوغ به دو فصل مجزا بدون حذف هیچ محتوایی.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل مبدأ' },
        newChapterTitle: { type: Type.STRING, description: 'عنوان فصل دوم جدید' },
      },
      required: ['nodeId', 'newChapterTitle'],
    },
  },
  {
    name: 'add_callout_box',
    description: 'افزودن یک باکس نکته، هشدار، جمع‌بندی یا نکته مهندسی به یک فصل مشخص.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل مقصد' },
        variant: {
          type: Type.STRING,
          description: 'یکی از: concept | warning | engineering | project | qa',
        },
        title: { type: Type.STRING, description: 'عنوان باکس نکته' },
        body: { type: Type.STRING, description: 'متن فارسی داخل باکس' },
      },
      required: ['nodeId', 'title', 'body'],
    },
  },
  {
    name: 'add_comparison_table',
    description: 'ایجاد و درج یک جدول مقایسه‌ای ساختاریافته در فصل انتخاب‌شده.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل مقصد' },
        caption: { type: Type.STRING, description: 'عنوان جدول' },
        headers: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'عناوین ستون‌ها',
        },
        rows: {
          type: Type.ARRAY,
          items: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          description: 'ردیف‌های جدول',
        },
      },
      required: ['nodeId', 'caption', 'headers', 'rows'],
    },
  },
  {
    name: 'insert_dictated_paragraph',
    description: 'افزودن یک پاراگراف یا یادداشت جدید به فصل مشخص‌شده.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل مقصد' },
        sectionTitle: { type: Type.STRING, description: 'عنوان زیربخش اختیاری' },
        text: { type: Type.STRING, description: 'متن فارسی پاراگراف جدید' },
      },
      required: ['nodeId', 'text'],
    },
  },
];

async function reassembleAndPersistProject(projectId: string, ownerUid: string) {
  const bundle = await getProjectBundle(projectId, ownerUid);
  if (!bundle) return null;
  const formatted = formatBundleForClient(bundle);
  const rawSettings = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
  const config: DocxExportConfig = {
    ...DEFAULT_DOCX_CONFIG,
    ...rawSettings,
    optimization: {
      ...DEFAULT_DOCX_CONFIG.optimization,
      ...(rawSettings.optimization || {}),
    },
  };

  const assembled = assembleFinalBookAndAudit({
    projectId,
    projectTitle: bundle.project.title,
    workflowMode: (bundle.project.workflowMode as WorkflowMode) || 'multi_merge',
    config,
    sourceFiles: formatted.sourceFiles as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['sourceFiles'],
    units: formatted.contentUnits as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['units'],
    clusters: formatted.dedupClusters as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['clusters'],
    conflicts: formatted.conflicts as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['conflicts'],
    outlineNodes: formatted.outlineNodes as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['outlineNodes'],
  });

  await saveAuditReportRecord({
    id: assembled.audit.id,
    projectId: assembled.audit.projectId,
    totalSourceFiles: assembled.audit.totalSourceFiles,
    totalInputUnits: assembled.audit.totalInputUnits,
    uniqueUnitsCount: assembled.audit.uniqueUnitsPreserved,
    mergedDuplicatesCount: assembled.audit.duplicatesMerged,
    conflictsCount: assembled.audit.conflictsDetected,
    coveragePercent: assembled.audit.coveragePercent,
    sourceTraceJson: {
      ...(assembled.audit.detailsJson || {}),
      conflictsResolved: assembled.audit.conflictsResolved,
    },
  });
  await updateProjectRecord(projectId, ownerUid, {
    bookSnapshotJson: assembled.book as unknown as Record<string, unknown>,
    pipelineStage: 5,
    status: 'completed',
  });

  const updated = await getProjectBundle(projectId, ownerUid);
  return updated ? formatBundleForClient(updated) : null;
}

export function createProjectRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // 1. LIST PROJECTS
  router.get('/', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const rows = await listUserProjects(user.uid);
      res.json({
        projects: rows.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در دریافت پروژه‌ها.' });
    }
  });

  // 2. CREATE PROJECT
  router.post('/', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const body = req.body as {
        title?: string;
        workflowMode?: WorkflowMode;
        settingsJson?: Record<string, unknown>;
      };
      const title = (body.title || 'پروژه تدوین و یکپارچه‌سازی جدید').trim().slice(0, 180);
      const validModes = new Set<WorkflowMode>([
        'single_polish',
        'multi_merge',
        'master_update',
        'raw_synthesis',
      ]);
      const workflowMode: WorkflowMode =
        body.workflowMode && validModes.has(body.workflowMode) ? body.workflowMode : 'multi_merge';

      const id = `proj_${crypto.randomBytes(6).toString('hex')}`;
      const created = await createProjectRecord({
        id,
        ownerUid: user.uid,
        title,
        workflowMode,
        settingsJson: {
          ...DEFAULT_DOCX_CONFIG,
          ...(body.settingsJson || {}),
        },
      });

      const bundle = await getProjectBundle(created.id, user.uid);
      res.status(201).json(bundle ? formatBundleForClient(bundle) : { project: created });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ایجاد پروژه.' });
    }
  });

  // 3. GET FULL PROJECT BUNDLE
  router.get('/:id', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const bundle = await getProjectBundle(req.params.id, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        return;
      }
      res.json(formatBundleForClient(bundle));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در دریافت جزئیات پروژه.' });
    }
  });

  // 4. UPDATE PROJECT METADATA / SETTINGS / PAUSE-RESUME
  router.patch('/:id', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const body = req.body as {
        title?: string;
        workflowMode?: WorkflowMode;
        status?: string;
        pipelineStage?: number;
        settingsJson?: Record<string, unknown>;
        checkpointJson?: Record<string, unknown>;
      };
      const updated = await updateProjectRecord(req.params.id, user.uid, {
        ...(body.title !== undefined ? { title: body.title.trim().slice(0, 180) } : {}),
        ...(body.workflowMode !== undefined ? { workflowMode: body.workflowMode } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.pipelineStage !== undefined ? { pipelineStage: body.pipelineStage } : {}),
        ...(body.settingsJson !== undefined ? { settingsJson: body.settingsJson } : {}),
        ...(body.checkpointJson !== undefined ? { checkpointJson: body.checkpointJson } : {}),
      });
      if (!updated) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }
      const bundle = await getProjectBundle(req.params.id, user.uid);
      res.json(bundle ? formatBundleForClient(bundle) : { project: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ویرایش پروژه.' });
    }
  });

  // 5. DELETE PROJECT
  router.delete('/:id', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      await deleteProjectRecord(req.params.id, user.uid);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در حذف پروژه.' });
    }
  });

  // 6. STAGE 1: BATCH INGESTION (supports 1 to 100+ files via chunked batches with checkpointing)
  router.post('/:id/ingest', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const existing = await getProjectBundle(projectId, user.uid);
      if (!existing) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const body = req.body as {
        replaceExisting?: boolean;
        files?: Array<{
          name: string;
          format?: SourceFileFormat;
          role?: FileRole;
          sizeBytes?: number;
          text?: string;
          base64?: string;
        }>;
      };

      const incoming = Array.isArray(body.files) ? body.files : [];
      if (incoming.length === 0) {
        res.status(400).json({ error: 'هیچ فایلی برای استخراج ارسال نشده است.' });
        return;
      }

      if (body.replaceExisting) {
        await clearProjectPipelineArtifacts(projectId, true);
      }

      await updateProjectRecord(projectId, user.uid, {
        pipelineStage: 1,
        status: 'ingesting',
      });

      let runningUnitOrder = body.replaceExisting ? 0 : existing.contentUnits.length;
      const ingestedSummaries: Array<{ fileName: string; unitCount: number; wordCount: number }> = [];

      for (const f of incoming) {
        const format = f.format ?? detectFileFormat(f.name);
        const role: FileRole = f.role ?? 'standard';
        const buffer = f.base64 ? Buffer.from(f.base64, 'base64') : undefined;
        const parsed = await parseAnySourceFile({
          name: f.name,
          format,
          text: f.text,
          buffer: buffer ? new Uint8Array(buffer) : undefined,
        });

        const fileId = `sf_${deterministicHash(`${projectId}:${f.name}:${f.sizeBytes ?? 0}:${Date.now()}:${Math.random()}`)}`;
        const atomicUnits = extractAtomicUnitsFromBook({
          projectId,
          sourceFileId: fileId,
          fileName: f.name,
          fileRole: role,
          book: parsed,
          startingOrder: runningUnitOrder,
        });
        runningUnitOrder += atomicUnits.length;

        const wordCount = atomicUnits.reduce(
          (sum, u) => sum + u.rawText.split(/\s+/).filter(Boolean).length,
          0
        );
        const checksum = deterministicHash(atomicUnits.map((u) => u.normalizedHash).join('|'));

        await insertSourceFileWithUnits({
          file: {
            id: fileId,
            projectId,
            fileName: f.name,
            format,
            role,
            sizeBytes: f.sizeBytes ?? (buffer?.byteLength ?? (f.text?.length ?? 0)),
            wordCount,
            fileHash: checksum,
            metadataJson: { unitCount: atomicUnits.length },
          },
          units: atomicUnits.map((u) => ({
            id: u.id,
            projectId: u.projectId,
            sourceFileId: u.sourceFileId,
            unitType: u.unitType,
            unitOrder: u.unitOrder,
            rawText: u.rawText,
            contentHash: u.normalizedHash,
            status: u.status,
            canonicalUnitId: null,
            outlineNodeId: null,
            payloadJson: {
              ...(u.metadataJson || {}),
              headingPath: u.headingPath,
            },
          })),
        });

        ingestedSummaries.push({
          fileName: f.name,
          unitCount: atomicUnits.length,
          wordCount,
        });
      }

      const fresh = await getProjectBundle(projectId, user.uid);
      if (fresh) {
        const autoTitle =
          fresh.project.title === 'پروژه تدوین و یکپارچه‌سازی جدید' && fresh.sourceFiles.length > 0
            ? fresh.sourceFiles[0].fileName.replace(/\.(docx|pdf|md|txt|json|csv|html)$/i, '')
            : fresh.project.title;
        await updateProjectRecord(projectId, user.uid, {
          title: autoTitle,
          pipelineStage: 1,
          status: 'draft',
          checkpointJson: {
            ...((fresh.project.checkpointJson || {}) as Record<string, unknown>),
            stage: 1,
            processedFileCount: fresh.sourceFiles.length,
            totalUnits: fresh.contentUnits.length,
            lastUpdatedAt: new Date().toISOString(),
          },
        });
      }

      const finalBundle = await getProjectBundle(projectId, user.uid);
      res.json({
        ingested: ingestedSummaries,
        bundle: finalBundle ? formatBundleForClient(finalBundle) : null,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در مرحله استخراج واحدهای محتوایی.',
      });
    }
  });

  // 7. STAGE 2: TWO-PASS LOSSLESS UNION DEDUP + CONFLICT DETECTION + PROPOSED OUTLINE
  router.post('/:id/dedup', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }
      if (bundle.contentUnits.length === 0) {
        res.status(400).json({ error: 'ابتدا حداقل یک فایل ورودی در پروژه بارگذاری و استخراج کنید.' });
        return;
      }

      await updateProjectRecord(projectId, user.uid, {
        pipelineStage: 2,
        status: 'deduping',
      });

      const formatted = formatBundleForClient(bundle);
      const workflowMode = (bundle.project.workflowMode as WorkflowMode) || 'multi_merge';

      // Pass 1: Deterministic Exact + Near-Duplicate Lossless Union & Strict Conflict Preservation
      const dedup = runDeterministicLosslessDedup({
        projectId,
        workflowMode,
        sourceFiles: formatted.sourceFiles as unknown as Parameters<typeof runDeterministicLosslessDedup>[0]['sourceFiles'],
        units: formatted.contentUnits as unknown as Parameters<typeof runDeterministicLosslessDedup>[0]['units'],
      });

      const settings = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
      const useAi = settings.useAiBackend !== false;
      const ai = useAi ? createGeminiClient() : null;

      // Pass 1B: Optional Batched AI Semantic Conflict Verification (drops complementary false positives)
      let finalConflicts = dedup.conflicts;
      let dedupAiUsage = extractAiUsageFromCheckpoint(
        (bundle.project.checkpointJson || {}) as Record<string, unknown>
      );
      if (ai && dedup.conflicts.length > 0) {
        const verifiedResult = await verifyConflictsWithAi(ai, dedup.conflicts);
        if (verifiedResult.usageDelta) {
          dedupAiUsage = mergeAiUsageDelta(dedupAiUsage, verifiedResult.usageDelta);
        }
        finalConflicts = verifiedResult.verified;
        if (finalConflicts.length !== dedup.conflicts.length) {
          const genuineConflictUnitIds = new Set(
            finalConflicts.flatMap((c) => [c.unitAId, c.unitBId])
          );
          for (const upd of dedup.unitUpdates) {
            if (upd.status === 'conflict' && !genuineConflictUnitIds.has(upd.id)) {
              upd.status = 'active';
            }
          }
        }
      }

      await saveDedupResults({
        projectId,
        unitUpdates: dedup.unitUpdates,
        clusters: dedup.clusters.map((c) => ({
          id: c.id,
          projectId: c.projectId,
          canonicalUnitId: c.canonicalUnitId,
          mergedUnitId: c.mergedUnitIds[0] || c.canonicalUnitId,
          matchType: c.matchType,
          similarityScore: c.similarityScore,
          mergeRationale: c.losslessSummary,
          preservedDetailsJson: {
            mergedUnitIds: c.mergedUnitIds,
          },
        })),
        conflictRows: finalConflicts,
      });

      // Reload updated units and build Stage 3 proposed outline
      const afterDedup = await getProjectBundle(projectId, user.uid);
      if (!afterDedup) {
        res.status(404).json({ error: 'پروژه پس از ادغام یافت نشد.' });
        return;
      }
      const formattedAfter = formatBundleForClient(afterDedup);

      const proposed = buildInitialOutline({
        projectId,
        workflowMode,
        sourceFiles: formattedAfter.sourceFiles as unknown as Parameters<typeof buildInitialOutline>[0]['sourceFiles'],
        units: formattedAfter.contentUnits as unknown as Parameters<typeof buildInitialOutline>[0]['units'],
      });

      // Optional Pass 2: Gemini semantic refinement of outline chapter titles (never drops units!)
      if (ai && proposed.nodes.length >= 2 && proposed.nodes.length <= 24) {
        try {
          const requestedModel =
            settings.aiModel && ALLOWED_MODELS.has(settings.aiModel)
              ? settings.aiModel
              : 'gemini-4-hydrogen';
          const level = resolveThinkingLevel(requestedModel, settings.aiThinkingLevel);
          const outlinePreview = proposed.nodes.map((n) => ({
            id: n.id,
            title: n.title,
            summary: n.summary,
          }));
          const outlinePrompt = `فهرست فصل‌های پیشنهادی زیر برای حالت «${workflowMode}» از فایل‌های کاربر استخراج شده است. لطفاً فقط عناوین فارسی فصل‌ها را حرفه‌ای، یکدست، دقیق و منسجم کن (بدون حذف یا تغییر id فصل‌ها). خروجی JSON باشد:\n${JSON.stringify(outlinePreview)}`;

          const aiRes = await ai.models.generateContent({
            model: requestedModel,
            contents: outlinePrompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  refinedNodes: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        title: { type: Type.STRING },
                        summary: { type: Type.STRING },
                      },
                    },
                  },
                },
              },
              thinkingConfig: { thinkingLevel: level },
            },
          });

          dedupAiUsage = mergeAiUsageDelta(
            dedupAiUsage,
            extractUsageDeltaFromResponse(aiRes, {
              modelUsed: requestedModel,
              fallbackPromptChars: outlinePrompt.length,
              fallbackOutputChars: (aiRes.text || '').length,
            })
          );

          const parsedAi = safeParseGeminiJson<{
            refinedNodes?: Array<{ id?: string; title?: string; summary?: string }>;
          }>(aiRes.text, {});
          if (Array.isArray(parsedAi.refinedNodes)) {
            const byId = new Map(parsedAi.refinedNodes.map((r) => [r.id, r]));
            for (const node of proposed.nodes) {
              const r = byId.get(node.id);
              if (r?.title && r.title.trim().length >= 3) {
                node.title = r.title.trim();
              }
              if (r?.summary && r.summary.trim().length >= 6) {
                node.summary = r.summary.trim();
              }
            }
          }
        } catch (aiErr) {
          console.warn('Optional Pass 2 AI outline polish skipped:', aiErr);
        }
      }

      await saveOutlineNodesForProject({
        projectId,
        nodes: proposed.nodes,
        unitAssignments: proposed.unitAssignments,
      });

      await updateProjectRecord(projectId, user.uid, {
        pipelineStage: 3,
        status: 'awaiting_outline',
        checkpointJson: {
          ...((bundle.project.checkpointJson || {}) as Record<string, unknown>),
          stage: 3,
          clustersCount: dedup.clusters.length,
          conflictsCount: finalConflicts.length,
          outlineCount: proposed.nodes.length,
          aiUsage: dedupAiUsage,
          lastUpdatedAt: new Date().toISOString(),
        },
      });

      const finalBundle = await getProjectBundle(projectId, user.uid);
      res.json(finalBundle ? formatBundleForClient(finalBundle) : null);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در مرحله حذف تکراری‌ها و تحلیل تناقض.',
      });
    }
  });

  // 8. STAGE 3: SAVE HUMAN-IN-THE-LOOP OUTLINE EDITS (REORDER / RENAME / SPLIT / MERGE / APPROVE)
  router.put('/:id/outline', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const body = req.body as {
        nodes?: Array<{
          id: string;
          title: string;
          summary?: string | null;
          nodeOrder: number;
          level?: number;
          parentId?: string | null;
          isApproved?: boolean;
          webEnrichmentJson?: Record<string, unknown> | null;
        }>;
        reassignments?: Array<{ fromNodeId: string; toNodeId: string }>;
      };

      const nodes = Array.isArray(body.nodes) ? body.nodes : [];
      if (nodes.length === 0) {
        res.status(400).json({ error: 'فهرست فصل‌ها نمی‌تواند خالی باشد.' });
        return;
      }

      await updateOutlineNodesOrderAndApproval(
        projectId,
        nodes.map((n, idx) => ({
          id: n.id,
          title: n.title.trim() || `فصل ${toPersianDigits(idx + 1)}`,
          summary: n.summary ?? null,
          nodeOrder: idx + 1,
          level: n.level ?? 1,
          parentId: n.parentId ?? null,
          isApproved: Boolean(n.isApproved),
          webEnrichmentJson: n.webEnrichmentJson ?? null,
        }))
      );

      // Reassign units if chapters were merged
      if (Array.isArray(body.reassignments)) {
        for (const r of body.reassignments) {
          await db
            .update(contentUnits)
            .set({ outlineNodeId: r.toNodeId })
            .where(and(eq(contentUnits.projectId, projectId), eq(contentUnits.outlineNodeId, r.fromNodeId)));
        }
      }

      const updated = await getProjectBundle(projectId, user.uid);
      res.json(updated ? formatBundleForClient(updated) : null);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ذخیره ساختار فصل‌بندی.' });
    }
  });

  // 9. STAGE 4 & 5: FINALIZE DOCUMENT, VISUAL ENRICHMENT & 100% COVERAGE AUDIT
  router.post('/:id/finalize', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      await updateProjectRecord(projectId, user.uid, {
        pipelineStage: 4,
        status: 'structuring',
      });

      // Mark all outline nodes approved
      if (bundle.outlineNodes.length > 0) {
        await updateOutlineNodesOrderAndApproval(
          projectId,
          bundle.outlineNodes.map((n, idx) => ({
            id: n.id,
            title: n.title,
            summary: n.summary,
            nodeOrder: idx + 1,
            level: n.level,
            parentId: n.parentId,
            isApproved: true,
            webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
          }))
        );
      }

      // Optional isolated Google Search Enrichment when user chose 'conflicts_and_enrichment' or 'full_document_enrichment'
      const settings = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
      const searchMode: GoogleSearchMode = settings.googleSearchMode ?? 'conflicts_only';
      const ai = createGeminiClient();

      if (
        (searchMode === 'conflicts_and_enrichment' || searchMode === 'full_document_enrichment') &&
        ai &&
        bundle.outlineNodes.length > 0
      ) {
        const unenriched = bundle.outlineNodes.filter((n) => !n.webEnrichmentJson);
        const targetNodes =
          searchMode === 'full_document_enrichment' ? unenriched : unenriched.slice(0, 3);

        for (const node of targetNodes) {
          try {
            const chapterExcerpt = buildChapterExcerpt(bundle.contentUnits, node.id, 1800);
            const prompt = [
              `با استفاده از جستجوی گوگل، متن فصل «${node.title}» از سند «${bundle.project.title}» را با اطلاعات مستند، استانداردهای به‌روز، نکات کلیدی جامانده و مثال‌های کاربردی به زبان فارسی روان تکمیل کن (۱ تا ۲ پاراگراف منسجم و علمی بدون تکرار متن موجود).`,
              chapterExcerpt ? `خلاصه محتوای فعلی این فصل:\n${chapterExcerpt}` : '',
            ]
              .filter(Boolean)
              .join('\n\n');

            const gRes = await generateWithGroundingFallback(ai, prompt, ThinkingLevel.LOW);
            const summary = (gRes.text || '').trim();
            await recordProjectAiUsage(
              projectId,
              user.uid,
              extractUsageDeltaFromResponse(gRes, {
                modelUsed: 'gemini-3-flash-preview',
                isGrounding: true,
                fallbackPromptChars: prompt.length,
                fallbackOutputChars: summary.length,
              })
            );
            const sources = extractGroundingSources(gRes);
            if (summary) {
              await db
                .update(outlineNodes)
                .set({
                  webEnrichmentJson: {
                    title: node.title,
                    summary,
                    sources,
                    checkedAt: new Date().toISOString(),
                  },
                })
                .where(and(eq(outlineNodes.id, node.id), eq(outlineNodes.projectId, projectId)));
            }
          } catch (gErr) {
            console.warn('Optional web enrichment skipped for node:', node.id, gErr);
            const raw = gErr instanceof Error ? gErr.message : String(gErr || '');
            if (raw.includes('429') || raw.toUpperCase().includes('RESOURCE_EXHAUSTED')) {
              break;
            }
          }
        }
      }

      const finalBundle = await reassembleAndPersistProject(projectId, user.uid);
      res.json(finalBundle);
    } catch (err) {
      const formattedErr = formatGeminiError(err, 'خطا در تدوین نهایی و تولید گزارش ممیزی.');
      res.status(formattedErr.statusCode).json({ error: formattedErr.message });
    }
  });

  // 10. RESOLVE CONFLICT
  router.post('/:id/conflicts/:conflictId/resolve', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const { id: projectId, conflictId } = req.params;
      const body = req.body as {
        status?: 'open' | 'keep_both' | 'choose_a' | 'choose_b' | 'resolved_web';
        resolutionNote?: string;
      };
      const validStatuses = new Set(['open', 'keep_both', 'choose_a', 'choose_b', 'resolved_web']);
      if (!body.status || !validStatuses.has(body.status)) {
        res.status(400).json({ error: 'وضعیت حل تناقض نامعتبر است.' });
        return;
      }

      const updatedConflict = await updateConflictRecord(projectId, conflictId, {
        status: body.status,
        resolutionNote: body.resolutionNote ?? null,
      });
      if (!updatedConflict) {
        res.status(404).json({ error: 'رکورد تناقض یافت نشد.' });
        return;
      }

      // If project already has a final book snapshot, refresh it so resolution reflects immediately
      const bundle = await getProjectBundle(projectId, user.uid);
      if (bundle?.project.bookSnapshotJson) {
        const refreshed = await reassembleAndPersistProject(projectId, user.uid);
        res.json({ conflict: updatedConflict, bundle: refreshed });
        return;
      }

      res.json({ conflict: updatedConflict, bundle: bundle ? formatBundleForClient(bundle) : null });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ذخیره تصمیم تناقض.' });
    }
  });

  // 10B. RESCAN & CLEAN FALSE-POSITIVE CONFLICTS (Layer 1 Strict Deterministic + Layer 2 AI Verification)
  // Preserves outlineNodes, webEnrichment, and dedupClusters untouched while removing complementary false positives!
  router.post('/:id/rescan-conflicts', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const previousCount = bundle.conflicts.length;
      const formatted = formatBundleForClient(bundle);
      const fileMap = new Map(formatted.sourceFiles.map((f) => [f.id, f.fileName]));

      // Scan all active (non-merged) paragraph/callout/list units across distinct source files with strict Layer 1
      const eligibleUnits = formatted.contentUnits.filter(
        (u) =>
          u.status !== 'merged' &&
          (u.unitType === 'paragraph' || u.unitType === 'callout' || u.unitType === 'list')
      );
      const tokenCache = new Map(eligibleUnits.map((u) => [u.id, tokenizeContent(u.rawText)]));

      const candidates: DedupPipelineOutput['conflicts'] = [];
      const seenPairs = new Set<string>();

      // Preserve any existing conflict's user resolution/grounding if it still qualifies as a genuine conflict
      const existingByPair = new Map<string, (typeof bundle.conflicts)[number]>();
      for (const oldC of bundle.conflicts) {
        const pk = [oldC.unitAId, oldC.unitBId].sort().join('::');
        existingByPair.set(pk, oldC);
      }

      for (let i = 0; i < eligibleUnits.length; i++) {
        const a = eligibleUnits[i];
        const tokA = tokenCache.get(a.id) || [];
        for (let j = i + 1; j < eligibleUnits.length; j++) {
          const b = eligibleUnits[j];
          if (a.sourceFileId === b.sourceFileId || a.unitType !== b.unitType) continue;
          const tokB = tokenCache.get(b.id) || [];
          const sim = computeJaccardSimilarity(tokA, tokB);
          if (sim < 0.35) continue;

          if (isGenuineNumericConflict(a.rawText, b.rawText)) {
            const pairKey = [a.id, b.id].sort().join('::');
            if (seenPairs.has(pairKey)) continue;
            seenPairs.add(pairKey);
            const topic =
              (b.headingPath || a.headingPath || 'تناقض مقدار عددی در اسناد')
                .split('>')[0]
                .trim();
            candidates.push({
              id: `conf_${deterministicHash(`${projectId}:${pairKey}`)}`,
              projectId,
              topic,
              unitAId: a.id,
              unitBId: b.id,
              fileAName: fileMap.get(a.sourceFileId) || 'فایل ۱',
              fileBName: fileMap.get(b.sourceFileId) || 'فایل ۲',
              excerptA: a.rawText.slice(0, 420),
              excerptB: b.rawText.slice(0, 420),
              status: 'open',
            });
          }
        }
      }

      const settings = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
      const ai = settings.useAiBackend !== false ? createGeminiClient() : null;
      const { verified, aiVerified, usageDelta } = await verifyConflictsWithAi(ai, candidates);

      const conflictRowsToSave = verified.map((c) => {
        const pairKey = [c.unitAId, c.unitBId].sort().join('::');
        const old = existingByPair.get(pairKey);
        return {
          ...c,
          status: old?.status ?? 'open',
          resolutionNote: old?.resolutionNote ?? null,
          webGroundingJson: (old?.webGroundingJson as Record<string, unknown> | null) ?? null,
        };
      });

      await replaceProjectConflicts({
        projectId,
        conflictRows: conflictRowsToSave,
        conflictUnitIds: conflictRowsToSave.flatMap((c) => [c.unitAId, c.unitBId]),
      });

      const prevCp = (bundle.project.checkpointJson || {}) as Record<string, unknown>;
      const nextAiUsage = usageDelta
        ? mergeAiUsageDelta(extractAiUsageFromCheckpoint(prevCp), usageDelta)
        : extractAiUsageFromCheckpoint(prevCp);

      await updateProjectRecord(projectId, user.uid, {
        checkpointJson: {
          ...prevCp,
          conflictsCount: conflictRowsToSave.length,
          aiUsage: nextAiUsage,
          lastConflictRescanAt: new Date().toISOString(),
        },
      });

      const refreshed = bundle.project.bookSnapshotJson
        ? await reassembleAndPersistProject(projectId, user.uid)
        : await getProjectBundle(projectId, user.uid).then((b) => (b ? formatBundleForClient(b) : null));

      res.json({
        previousCount,
        currentCount: conflictRowsToSave.length,
        removedCount: Math.max(0, previousCount - conflictRowsToSave.length),
        aiVerified,
        bundle: refreshed,
      });
    } catch (err) {
      console.error('[Rescan conflicts error]:', err);
      const formattedErr = formatGeminiError(err, 'خطا در پالایش مجدد تناقض‌ها.');
      res.status(formattedErr.statusCode).json({ error: formattedErr.message });
    }
  });

  // 11. EXPLICIT GOOGLE SEARCH GROUNDING (Conflict Verification OR Isolated Web Enrichment)
  router.post('/:id/grounding', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'کلید API هوش مصنوعی در تنظیمات محیط سرور تنظیم نشده است.',
        });
        return;
      }

      const body = req.body as {
        targetType: 'conflict' | 'outline_node' | 'full_document';
        targetId?: string;
        customQuery?: string;
      };

      if (body.targetType === 'conflict') {
        const conf = bundle.conflicts.find((c) => c.id === body.targetId);
        if (!conf) {
          res.status(404).json({ error: 'تناقض موردنظر یافت نشد.' });
          return;
        }

        const prompt = [
          'دو فایل مختلف درباره یک موضوع اطلاعات متفاوت یا متناقضی ارائه داده‌اند. با استفاده از جستجوی گوگل، صحت علمی/فنی هر دو روایت را بررسی کن و به فارسی دقیق و مستند پاسخ بده:',
          `موضوع: ${conf.topic}`,
          `روایت ۱ (${conf.fileAName}): ${conf.excerptA}`,
          `روایت ۲ (${conf.fileBName}): ${conf.excerptB}`,
          body.customQuery ? `پرسش تکمیلی کاربر: ${body.customQuery}` : '',
          'لطفاً در حداکثر یک پاراگراف شفاف توضیح بده کدام مقدار یا شرط از نظر منابع معتبر دقیق‌تر است و در چه شرایطی هرکدام صحیح هستند.',
        ]
          .filter(Boolean)
          .join('\n');

        const gRes = await generateWithGroundingFallback(ai, prompt, ThinkingLevel.MEDIUM);

        const summary = (gRes.text || 'نتیجه‌ای از جستجوی وب دریافت نشد.').trim();
        const sources = extractGroundingSources(gRes);
        const webGroundingJson = {
          summary,
          sources,
          checkedAt: new Date().toISOString(),
          query: body.customQuery || conf.topic,
        };

        await updateConflictRecord(projectId, conf.id, { webGroundingJson });
        await recordProjectAiUsage(
          projectId,
          user.uid,
          extractUsageDeltaFromResponse(gRes, {
            modelUsed: 'gemini-4-hydrogen',
            fallbackPromptChars: prompt.length,
            fallbackOutputChars: summary.length,
            isGrounding: true,
          })
        );
        const refreshed = bundle.project.bookSnapshotJson
          ? await reassembleAndPersistProject(projectId, user.uid)
          : await getProjectBundle(projectId, user.uid).then((b) => (b ? formatBundleForClient(b) : null));

        res.json({ webGrounding: webGroundingJson, bundle: refreshed });
        return;
      }

      if (body.targetType === 'outline_node') {
        const node = bundle.outlineNodes.find((n) => n.id === body.targetId);
        if (!node) {
          res.status(404).json({ error: 'فصل موردنظر یافت نشد.' });
          return;
        }

        const chapterExcerpt = buildChapterExcerpt(bundle.contentUnits, node.id, 2200);
        const prompt = [
          `با استفاده از جستجوی گوگل، درباره فصل «${node.title}» در سند «${bundle.project.title}» یک باکس اطلاعات تکمیلی به‌روز، مستند و کاربردی به زبان فارسی (۱ تا ۲ پاراگراف دقیق) بنویس تا نکات علمی یا عملی جاافتاده از متن فعلی را کامل کند.`,
          chapterExcerpt ? `متن فعلی فصل:\n${chapterExcerpt}` : '',
          body.customQuery ? `تأکید کاربر: ${body.customQuery}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        const gRes = await generateWithGroundingFallback(ai, prompt, ThinkingLevel.LOW);

        const webEnrichmentJson = {
          title: node.title,
          summary: (gRes.text || '').trim(),
          sources: extractGroundingSources(gRes),
          checkedAt: new Date().toISOString(),
        };

        await db
          .update(outlineNodes)
          .set({ webEnrichmentJson })
          .where(and(eq(outlineNodes.id, node.id), eq(outlineNodes.projectId, projectId)));

        await recordProjectAiUsage(
          projectId,
          user.uid,
          extractUsageDeltaFromResponse(gRes, {
            modelUsed: 'gemini-4-hydrogen',
            fallbackPromptChars: prompt.length,
            fallbackOutputChars: webEnrichmentJson.summary.length,
            isGrounding: true,
          })
        );

        const refreshed = bundle.project.bookSnapshotJson
          ? await reassembleAndPersistProject(projectId, user.uid)
          : await getProjectBundle(projectId, user.uid).then((b) => (b ? formatBundleForClient(b) : null));

        res.json({ webEnrichment: webEnrichmentJson, bundle: refreshed });
        return;
      }

      if (body.targetType === 'full_document') {
        const nodes = [...bundle.outlineNodes].sort((a, b) => a.nodeOrder - b.nodeOrder);
        if (nodes.length === 0) {
          res.status(400).json({ error: 'ابتدا مرحله استخراج و فصل‌بندی سند را اجرا کنید.' });
          return;
        }

        let enrichedChaptersCount = 0;
        let failedChaptersCount = 0;
        let quotaError: { statusCode: number; message: string } | null = null;

        // Process sequentially with a tiny gap to protect Free Tier RPM limits while enriching ALL chapters
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const chapterExcerpt = buildChapterExcerpt(bundle.contentUnits, node.id, 2400);
          const prompt = [
            `شما پژوهشگر فنی و ویراستار علمی هستید. با استفاده از جستجوی گوگل (Google Search)، متن فصل «${node.title}» از سند «${bundle.project.title}» را تکمیل و غنی کن.`,
            'قواعد مهم:',
            '۱) مطالب تکراری موجود در متن فعلی را بازنویسی نکن؛ فقط جزئیات تکمیلی، استانداردهای جدید، اعداد مرجع، نکات ایمنی/عملی و مثال‌های مستند جاافتاده را در ۱ تا ۲ پاراگراف فارسی دقیق و خوانا بنویس.',
            '۲) فقط به منابع معتبر وب استناد کن.',
            chapterExcerpt ? `محتوای فعلی فصل:\n${chapterExcerpt}` : '',
            body.customQuery ? `دستور تکمیلی کاربر: ${body.customQuery}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');

          try {
            const gRes = await generateWithGroundingFallback(ai, prompt, ThinkingLevel.LOW);
            const summary = (gRes.text || '').trim();
            const sources = extractGroundingSources(gRes);
            await recordProjectAiUsage(
              projectId,
              user.uid,
              extractUsageDeltaFromResponse(gRes, {
                modelUsed: 'gemini-4-hydrogen',
                fallbackPromptChars: prompt.length,
                fallbackOutputChars: summary.length,
                isGrounding: true,
              })
            );
            if (summary) {
              await db
                .update(outlineNodes)
                .set({
                  webEnrichmentJson: {
                    title: `تکمیل جامع با جستجوی گوگل — ${node.title}`,
                    summary,
                    sources,
                    checkedAt: new Date().toISOString(),
                  },
                })
                .where(and(eq(outlineNodes.id, node.id), eq(outlineNodes.projectId, projectId)));
              enrichedChaptersCount += 1;
            }
            if (i < nodes.length - 1) {
              await new Promise((r) => setTimeout(r, 350));
            }
          } catch (chapterErr) {
            failedChaptersCount += 1;
            const parsedErr = formatGeminiError(chapterErr, 'خطا در جستجوی گوگل برای فصل.');
            if (parsedErr.statusCode === 429) {
              quotaError = parsedErr;
              break;
            }
          }
        }

        if (enrichedChaptersCount === 0 && quotaError) {
          res.status(429).json({ error: quotaError.message });
          return;
        }

        const refreshed = bundle.project.bookSnapshotJson
          ? await reassembleAndPersistProject(projectId, user.uid)
          : await getProjectBundle(projectId, user.uid).then((b) => (b ? formatBundleForClient(b) : null));

        res.json({
          enrichedChaptersCount,
          failedChaptersCount,
          totalChapters: nodes.length,
          warning: quotaError?.message,
          bundle: refreshed,
        });
        return;
      }

      res.status(400).json({ error: 'نوع هدف جستجوی وب معتبر نیست.' });
    } catch (err) {
      const formattedErr = formatGeminiError(err, 'خطا در اجرای جستجوی گوگل (Grounding).');
      res.status(formattedErr.statusCode).json({ error: formattedErr.message });
    }
  });

  // 11B. HIGH-REASONING DEEP AI REVIEW & LOSSLESS IMPROVEMENT PASS (Gemini 4 Hydrogen + XHIGH)
  router.post('/:id/deep-review', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }
      if (bundle.outlineNodes.length === 0) {
        res.status(400).json({ error: 'ابتدا مرحله استخراج و فصل‌بندی سند را اجرا کنید.' });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({ error: 'کلید API هوش مصنوعی در تنظیمات سرور تنظیم نشده است.' });
        return;
      }

      const body = (req.body || {}) as { focusNote?: string; stream?: boolean };
      const wantsStream =
        Boolean(body.stream) ||
        String(req.headers.accept || '')
          .toLowerCase()
          .includes('application/x-ndjson');

      const emitStream = (payload: Record<string, unknown>) => {
        if (!wantsStream || res.writableEnded) return;
        try {
          res.write(`${JSON.stringify(payload)}\n`);
          (res as unknown as { flush?: () => void }).flush?.();
        } catch {
          // Ignore write errors if client disconnected
        }
      };

      if (wantsStream) {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
      }

      const nodes = [...bundle.outlineNodes].sort((a, b) => a.nodeOrder - b.nodeOrder);

      emitStream({
        type: 'progress',
        percent: 8,
        stage: `بررسی ساختار ${toPersianDigits(nodes.length)} فصل و واحدهای محتوایی پروژه...`,
      });

      // Dynamically budget chapter excerpts so large multi-chapter books stay fast and well within model limits
      const detailedNodeLimit = Math.min(nodes.length, 28);
      const perChapterChars = Math.max(260, Math.min(1100, Math.floor(18000 / Math.max(1, detailedNodeLimit))));

      const chapterDigests = nodes.slice(0, detailedNodeLimit).map((n) => {
        const nodeUnits = bundle.contentUnits.filter(
          (u) => u.outlineNodeId === n.id && u.status !== 'merged'
        );
        return {
          nodeId: n.id,
          order: n.nodeOrder,
          title: n.title,
          unitCount: nodeUnits.length,
          tableCount: nodeUnits.filter((u) => u.unitType === 'table').length,
          calloutCount: nodeUnits.filter((u) => u.unitType === 'callout').length,
          excerpt: buildChapterExcerpt(bundle.contentUnits, n.id, perChapterChars),
        };
      });

      const remainingChaptersSummary =
        nodes.length > detailedNodeLimit
          ? nodes.slice(detailedNodeLimit).map((n) => ({
              nodeId: n.id,
              order: n.nodeOrder,
              title: n.title,
            }))
          : [];

      const prompt = [
        'شما سردبیر ارشد فنی و ممیز کیفیت اسناد حرفه‌ای فارسی هستید.',
        `سند «${bundle.project.title}» (حالت: ${bundle.project.workflowMode}) را با بالاترین دقت بررسی کن و هرگونه نقص ساختاری، عنوان مبهم، نبود جمع‌بندی/هشدار کلیدی، داده متراکم قابل تبدیل به جدول، یا شکاف منطقی بین فصل‌ها را کشف و برطرف کن.`,
        'قانون مطلق عدم افت محتوا (Strict Zero-Loss): هیچ بخشی از متن اصلی کاربر را حذف نکن؛ فقط بهبودهای افزایشی و ساختاری (اصلاح عنوان فصل، افزودن باکس نکته/هشدار/جمع‌بندی، ساخت جدول مقایسه‌ای/مرجع و افزودن پاراگراف پیوندی یا تعریف جامانده) ارائه بده.',
        'نکته فرمت جدول: در addedTables هر ردیف داخل آرایه rows باید یک رشته با جداکننده « | » بین ستون‌ها باشد (مثلاً: "مقدار اول | مقدار دوم | توضیح").',
        body.focusNote ? `تمرکز ویژه درخواست‌شده توسط کاربر: ${body.focusNote}` : '',
        `خلاصه ساختار و محتوای فصل‌های سند:\n${JSON.stringify(chapterDigests)}`,
        remainingChaptersSummary.length > 0
          ? `فهرست سایر فصل‌های سند:\n${JSON.stringify(remainingChaptersSummary)}`
          : '',
        bundle.conflicts.length > 0
          ? `تعداد تناقض‌های شناسایی‌شده بین فایل‌ها: ${bundle.conflicts.length}`
          : '',
        'خروجی باید صرفاً یک شیء JSON معتبر مطابق ساختار خواسته‌شده باشد.',
      ]
        .filter(Boolean)
        .join('\n\n');

      const deepReviewSchema = {
        type: Type.OBJECT,
        properties: {
          overallScore: { type: Type.INTEGER, description: 'امتیاز کیفیت سند از ۱ تا ۱۰۰' },
          overallAssessment: { type: Type.STRING, description: 'جمع‌بندی کوتاه فارسی وضعیت سند و بهبودها' },
          findings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                severity: { type: Type.STRING, description: 'high | medium | low' },
                category: { type: Type.STRING },
                chapterTitle: { type: Type.STRING },
                issue: { type: Type.STRING },
                fixApplied: { type: Type.STRING },
              },
              required: ['severity', 'category', 'chapterTitle', 'issue', 'fixApplied'],
            },
          },
          titleRefinements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nodeId: { type: Type.STRING },
                newTitle: { type: Type.STRING },
                rationale: { type: Type.STRING },
              },
              required: ['nodeId', 'newTitle', 'rationale'],
            },
          },
          addedCallouts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nodeId: { type: Type.STRING },
                variant: { type: Type.STRING, description: 'concept | warning | engineering | revision | qa' },
                title: { type: Type.STRING },
                body: { type: Type.STRING },
                rationale: { type: Type.STRING },
              },
              required: ['nodeId', 'variant', 'title', 'body', 'rationale'],
            },
          },
          addedTables: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nodeId: { type: Type.STRING },
                caption: { type: Type.STRING },
                headers: { type: Type.ARRAY, items: { type: Type.STRING } },
                rows: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'هر ردیف به‌صورت رشته با جداکننده | بین ستون‌ها',
                },
                rationale: { type: Type.STRING },
              },
              required: ['nodeId', 'caption', 'headers', 'rows', 'rationale'],
            },
          },
          addedParagraphs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nodeId: { type: Type.STRING },
                sectionTitle: { type: Type.STRING },
                text: { type: Type.STRING },
                rationale: { type: Type.STRING },
              },
              required: ['nodeId', 'sectionTitle', 'text', 'rationale'],
            },
          },
        },
        required: ['overallScore', 'overallAssessment', 'findings'],
      };

      type DeepReviewParsed = {
        overallScore?: number;
        overallAssessment?: string;
        findings?: Array<{
          severity?: string;
          category?: string;
          chapterTitle?: string;
          issue?: string;
          fixApplied?: string;
        }>;
        titleRefinements?: Array<{ nodeId?: string; newTitle?: string; rationale?: string }>;
        addedCallouts?: Array<{
          nodeId?: string;
          variant?: string;
          title?: string;
          body?: string;
          rationale?: string;
        }>;
        addedTables?: Array<{
          nodeId?: string;
          caption?: string;
          headers?: string[];
          rows?: Array<string | string[]>;
          rationale?: string;
        }>;
        addedParagraphs?: Array<{
          nodeId?: string;
          sectionTitle?: string;
          text?: string;
          rationale?: string;
        }>;
      };

      // Resilient multi-tier reasoning ladder:
      // 1) gemini-4-hydrogen + XHIGH -> 2) gemini-4-hydrogen + HIGH -> 3) gemini-3.1-flash-lite + HIGH -> 4) flash-lite JSON mode
      const reviewAttempts: Array<{
        model: string;
        level: ThinkingLevel;
        levelLabel: DeepReviewReportDto['thinkingLevel'];
        useSchema: boolean;
      }> = [
        { model: 'gemini-4-hydrogen', level: ThinkingLevel.XHIGH, levelLabel: 'XHIGH', useSchema: true },
        { model: 'gemini-4-hydrogen', level: ThinkingLevel.HIGH, levelLabel: 'HIGH', useSchema: true },
        { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.HIGH, levelLabel: 'HIGH', useSchema: true },
        { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MEDIUM, levelLabel: 'MEDIUM', useSchema: false },
      ];

      emitStream({
        type: 'progress',
        percent: 18,
        stage: `آماده‌سازی چکیده هوشمند ${toPersianDigits(detailedNodeLimit)} فصل محوری و قوانین ممیزی بدون افت...`,
      });

      let parsed: DeepReviewParsed | null = null;
      let modelUsed = 'gemini-4-hydrogen';
      let thinkingLevelUsed: DeepReviewReportDto['thinkingLevel'] = 'XHIGH';
      let deepReviewUsageDelta: AiUsageDelta | null = null;
      let lastAiErr: unknown = null;

      for (let i = 0; i < reviewAttempts.length; i++) {
        const attempt = reviewAttempts[i];
        const basePct = Math.min(62, 24 + i * 10);
        let currentPct = basePct;

        emitStream({
          type: 'progress',
          percent: currentPct,
          stage:
            i === 0
              ? `در حال تحلیل عمیق سند با مدل ${attempt.model} (سطح استدلال ${attempt.levelLabel})...`
              : `تلاش مجدد با مسیر جایگزین ${attempt.model} (سطح ${attempt.levelLabel})...`,
          model: attempt.model,
          thinkingLevel: attempt.levelLabel,
          attempt: i + 1,
          totalAttempts: reviewAttempts.length,
        });

        // Keep-alive progress heartbeat every 2.5s so proxies never idle-timeout during deep thinking
        const heartbeat = wantsStream
          ? setInterval(() => {
              currentPct = Math.min(73, currentPct + 3);
              emitStream({
                type: 'progress',
                percent: currentPct,
                stage: `در حال استدلال عمیق روی ساختار، عناوین، جداول و شکاف‌های منطقی (${attempt.levelLabel})...`,
                model: attempt.model,
                thinkingLevel: attempt.levelLabel,
                attempt: i + 1,
                totalAttempts: reviewAttempts.length,
              });
            }, 2500)
          : null;

        try {
          const aiRes = await ai.models.generateContent({
            model: attempt.model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              ...(attempt.useSchema ? { responseSchema: deepReviewSchema } : {}),
              thinkingConfig: { thinkingLevel: attempt.level },
            },
          });
          const candidate = safeParseGeminiJson<DeepReviewParsed | null>(aiRes.text, null);
          if (candidate && (candidate.overallAssessment || Array.isArray(candidate.findings))) {
            parsed = candidate;
            modelUsed = attempt.model;
            thinkingLevelUsed = attempt.levelLabel;
            deepReviewUsageDelta = extractUsageDeltaFromResponse(aiRes, {
              modelUsed: attempt.model,
              fallbackPromptChars: prompt.length,
              fallbackOutputChars: (aiRes.text || '').length,
              isDeepReview: true,
            });
            break;
          }
          lastAiErr = new Error('پاسخ JSON ساختاریافته از مدل هوش مصنوعی دریافت نشد.');
        } catch (attemptErr) {
          lastAiErr = attemptErr;
          console.warn(
            `[DeepReview] Attempt ${i + 1}/${reviewAttempts.length} (${attempt.model}/${attempt.levelLabel}) failed:`,
            attemptErr instanceof Error ? attemptErr.message.slice(0, 260) : attemptErr
          );
          // Do not waste retries on invalid API key (403)
          const rawMsg = attemptErr instanceof Error ? attemptErr.message.toUpperCase() : '';
          if (rawMsg.includes('403') || rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('API_KEY_INVALID')) {
            break;
          }
          if (i < reviewAttempts.length - 1) {
            await new Promise((r) => setTimeout(r, 800));
          }
        } finally {
          if (heartbeat) clearInterval(heartbeat);
        }
      }

      if (!parsed) {
        throw lastAiErr || new Error('پاسخی از سرویس بازبینی عمیق دریافت نشد.');
      }

      emitStream({
        type: 'progress',
        percent: 78,
        stage: 'اعتبارسنجی گزارش هوش مصنوعی و آماده‌سازی بهبودهای بدون افت...',
        model: modelUsed,
        thinkingLevel: thinkingLevelUsed,
      });

      const validNodeIds = new Set(nodes.map((n) => n.id));
      const fallbackNode = nodes[0];
      const defaultSourceFileId = bundle.sourceFiles[0]?.id;

      let titlesRefined = 0;
      let calloutsAdded = 0;
      let tablesAdded = 0;
      let paragraphsAdded = 0;

      // 1. Apply chapter title refinements (if any)
      if (Array.isArray(parsed.titleRefinements) && parsed.titleRefinements.length > 0) {
        const nextNodes = nodes.map((n) => ({ ...n }));
        for (const tr of parsed.titleRefinements) {
          if (!tr.nodeId || !tr.newTitle || tr.newTitle.trim().length < 3) continue;
          const target = nextNodes.find((n) => n.id === tr.nodeId);
          if (target && target.title !== tr.newTitle.trim()) {
            target.title = tr.newTitle.trim();
            titlesRefined += 1;
          }
        }
        if (titlesRefined > 0) {
          await updateOutlineNodesOrderAndApproval(
            projectId,
            nextNodes.map((n, idx) => ({
              id: n.id,
              title: n.title,
              summary: n.summary,
              nodeOrder: idx + 1,
              level: n.level,
              parentId: n.parentId,
              isApproved: n.isApproved,
              webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
            }))
          );
        }
      }

      // 2. Insert lossless additive improvements into content_units with explicit AI Review provenance
      let nextOrder =
        bundle.contentUnits.reduce((maxOrd, u) => Math.max(maxOrd, u.unitOrder || 0), 0) + 1;
      const resolveTargetNode = (nid?: string) =>
        (nid && validNodeIds.has(nid) ? nodes.find((n) => n.id === nid) : null) || fallbackNode;

      if (defaultSourceFileId) {
        for (const co of (parsed.addedCallouts || []).slice(0, 6)) {
          const title = String(co.title || '').trim();
          const bodyText = String(co.body || '').trim();
          if (!title || !bodyText) continue;
          const targetNode = resolveTargetNode(co.nodeId);
          const unitId = `u_rev_co_${crypto.randomBytes(4).toString('hex')}`;
          const rawText = `${title}\n${bodyText}`;
          await db.insert(contentUnits).values({
            id: unitId,
            projectId,
            sourceFileId: defaultSourceFileId,
            unitOrder: nextOrder++,
            unitType: 'callout',
            rawText,
            contentHash: deterministicHash(`rev_callout::${normalizePersianForComparison(rawText)}:${unitId}`),
            status: 'active',
            canonicalUnitId: null,
            outlineNodeId: targetNode.id,
            payloadJson: {
              headingPath: `${targetNode.title} > نکات تکمیلی بازبینی هوشمند`,
              fileName: `بازبینی عمیق هوش مصنوعی (${thinkingLevelUsed})`,
              fileRole: 'supplement',
              block: {
                type: 'callout',
                id: unitId,
                variant: ['concept', 'warning', 'engineering', 'revision', 'qa', 'project'].includes(
                  String(co.variant || '')
                )
                  ? String(co.variant)
                  : 'concept',
                title,
                paragraphs: bodyText.split(/\n+/).filter(Boolean),
              },
            },
          });
          calloutsAdded += 1;
        }

        for (const tbl of (parsed.addedTables || []).slice(0, 4)) {
          const caption = String(tbl.caption || '').trim();
          const headers = Array.isArray(tbl.headers)
            ? tbl.headers.map((h) => String(h || '').trim()).filter(Boolean)
            : [];
          const rows: string[][] = Array.isArray(tbl.rows)
            ? tbl.rows
                .map((r) => {
                  if (Array.isArray(r)) return r.map((c) => String(c || '').trim());
                  return String(r || '')
                    .split('|')
                    .map((c) => c.trim());
                })
                .filter((cells) => cells.length > 0 && cells.some((c) => c.length > 0))
                .map((cells) => {
                  if (cells.length === headers.length) return cells;
                  if (cells.length > headers.length) return cells.slice(0, headers.length);
                  return [...cells, ...Array(headers.length - cells.length).fill('—')];
                })
            : [];
          if (!caption || headers.length < 2 || rows.length === 0) continue;
          const targetNode = resolveTargetNode(tbl.nodeId);
          const unitId = `u_rev_tbl_${crypto.randomBytes(4).toString('hex')}`;
          const rawText = `${caption}\n${headers.join(' | ')}`;
          await db.insert(contentUnits).values({
            id: unitId,
            projectId,
            sourceFileId: defaultSourceFileId,
            unitOrder: nextOrder++,
            unitType: 'table',
            rawText,
            contentHash: deterministicHash(`rev_table::${normalizePersianForComparison(rawText)}:${unitId}`),
            status: 'active',
            canonicalUnitId: null,
            outlineNodeId: targetNode.id,
            payloadJson: {
              headingPath: `${targetNode.title} > جمع‌بندی جدولی بازبینی هوشمند`,
              fileName: `بازبینی عمیق هوش مصنوعی (${thinkingLevelUsed})`,
              fileRole: 'supplement',
              block: {
                type: 'table',
                id: unitId,
                caption,
                headers,
                rows,
                generatedBy: 'ai',
                rationale: tbl.rationale || 'ساخته‌شده در بازبینی عمیق هوش مصنوعی',
              },
            },
          });
          tablesAdded += 1;
        }

        for (const para of (parsed.addedParagraphs || []).slice(0, 5)) {
          const text = String(para.text || '').trim();
          if (text.length < 25) continue;
          const targetNode = resolveTargetNode(para.nodeId);
          const unitId = `u_rev_p_${crypto.randomBytes(4).toString('hex')}`;
          const sectionTitle = String(para.sectionTitle || 'توضیح تکمیلی بازبینی عمیق').trim();
          await db.insert(contentUnits).values({
            id: unitId,
            projectId,
            sourceFileId: defaultSourceFileId,
            unitOrder: nextOrder++,
            unitType: 'paragraph',
            rawText: text,
            contentHash: deterministicHash(`rev_para::${normalizePersianForComparison(text)}:${unitId}`),
            status: 'active',
            canonicalUnitId: null,
            outlineNodeId: targetNode.id,
            payloadJson: {
              headingPath: `${targetNode.title} > ${sectionTitle}`,
              fileName: `بازبینی عمیق هوش مصنوعی (${thinkingLevelUsed})`,
              fileRole: 'supplement',
              block: {
                type: 'paragraph',
                id: unitId,
                text,
              },
            },
          });
          paragraphsAdded += 1;
        }
      }

      const findings: DeepReviewFinding[] = (Array.isArray(parsed.findings) ? parsed.findings : [])
        .slice(0, 12)
        .map((f) => ({
          severity: f.severity === 'high' || f.severity === 'low' ? f.severity : 'medium',
          category: String(f.category || 'بهبود ساختاری'),
          chapterTitle: String(f.chapterTitle || 'کل سند'),
          issue: String(f.issue || ''),
          fixApplied: String(f.fixApplied || 'در نسخه جدید سند اعمال شد'),
        }));

      const review: DeepReviewReportDto = {
        reviewedAt: new Date().toISOString(),
        modelUsed,
        thinkingLevel: thinkingLevelUsed,
        overallScore: Math.max(1, Math.min(100, Number(parsed.overallScore || 90))),
        overallAssessment:
          String(parsed.overallAssessment || '').trim() ||
          'بازبینی عمیق سند با موفقیت انجام شد و بهبودهای پیشنهادی بدون حذف هیچ محتوایی در سند اعمال گردید.',
        appliedCounts: {
          titlesRefined,
          calloutsAdded,
          tablesAdded,
          paragraphsAdded,
        },
        findings,
      };

      const prevReviewCp = (bundle.project.checkpointJson || {}) as Record<string, unknown>;
      const updatedUsageAfterReview = deepReviewUsageDelta
        ? mergeAiUsageDelta(extractAiUsageFromCheckpoint(prevReviewCp), deepReviewUsageDelta)
        : extractAiUsageFromCheckpoint(prevReviewCp);

      emitStream({
        type: 'progress',
        percent: 90,
        stage: 'ثبت گزارش بازبینی و به‌روزرسانی مصرف توکن پروژه...',
        model: modelUsed,
        thinkingLevel: thinkingLevelUsed,
      });

      await updateProjectRecord(projectId, user.uid, {
        checkpointJson: {
          ...prevReviewCp,
          lastDeepReview: review,
          aiUsage: updatedUsageAfterReview,
        },
      });

      emitStream({
        type: 'progress',
        percent: 96,
        stage: 'بازچینی نهایی کتاب، فهرست مطالب و گزارش ممیزی ۱۰۰٪...',
        model: modelUsed,
        thinkingLevel: thinkingLevelUsed,
      });

      const finalBundle = await reassembleAndPersistProject(projectId, user.uid);

      if (wantsStream) {
        emitStream({
          type: 'progress',
          percent: 100,
          stage: 'بازبینی عمیق با موفقیت تکمیل شد.',
          model: modelUsed,
          thinkingLevel: thinkingLevelUsed,
        });
        emitStream({ type: 'complete', review, bundle: finalBundle });
        if (!res.writableEnded) res.end();
      } else {
        res.json({ review, bundle: finalBundle });
      }
    } catch (err) {
      console.error('[DeepReview fatal error]:', err);
      const formattedErr = formatGeminiError(err, 'خطا در اجرای بازبینی عمیق با هوش مصنوعی.');
      if (res.headersSent) {
        try {
          res.write(`${JSON.stringify({ type: 'error', error: formattedErr.message })}\n`);
          res.end();
        } catch {
          // Ignore if already closed
        }
      } else {
        res.status(formattedErr.statusCode).json({ error: formattedErr.message });
      }
    }
  });

  // 12. CONTEXT-AWARE GEMINI EDITOR CHATBOT (with Structured Tool Proposals)
  router.post('/:id/chat', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const body = req.body as {
        message?: string;
        history?: Array<{ role: 'user' | 'model'; text: string }>;
        model?: string;
        enableGoogleSearch?: boolean;
      };
      const message = (body.message || '').trim();
      if (!message) {
        res.status(400).json({ error: 'متن پیام نمی‌تواند خالی باشد.' });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({ error: 'کلید API هوش مصنوعی در تنظیمات سرور تنظیم نشده است.' });
        return;
      }

      const requestedModel =
        body.model && ALLOWED_MODELS.has(body.model) ? body.model : 'gemini-4-hydrogen';

      const projectContext = {
        title: bundle.project.title,
        workflowMode: bundle.project.workflowMode,
        pipelineStage: bundle.project.pipelineStage,
        sourceFiles: bundle.sourceFiles.map((f) => ({
          name: f.fileName,
          role: f.role,
          unitCount: Number(((f.metadataJson || {}) as Record<string, unknown>).unitCount ?? 0),
        })),
        outlineNodes: bundle.outlineNodes.map((n) => ({
          id: n.id,
          order: n.nodeOrder,
          title: n.title,
          summary: n.summary,
        })),
        openConflicts: bundle.conflicts.map((c) => ({
          id: c.id,
          topic: c.topic,
          fileA: c.fileAName,
          fileB: c.fileBName,
          status: c.status,
        })),
        coveragePercent: bundle.auditReport?.coveragePercent ?? null,
      };

      const systemInstruction = [
        'شما دستیار هوشمند و سردبیر ارشد «استودیو صفحه‌آرایی و ادغام بدون افت اسناد» هستید.',
        'همیشه به زبان فارسی دقیق، محترمانه و مختصر پاسخ دهید.',
        'قانون مطلق: هرگز پیشنهادی ندهید که محتوای یکتایی از فایل‌های کاربر را حذف کند.',
        'اگر کاربر درخواست ویرایش ساختار سند دارد (مثل تغییر نام فصل، جابه‌جایی فصل، تقسیم فصل، افزودن باکس نکته، ساخت جدول مقایسه‌ای یا درج متن جدید)، حتماً ابزار متناظر را با nodeId دقیق از کانتکست فراخوانی کنید تا کارت تأیید برای کاربر ساخته شود.',
        `وضعیت فعلی سند پروژه:\n${JSON.stringify(projectContext)}`,
      ].join('\n');

      const recentHistory = (Array.isArray(body.history) ? body.history.slice(-8) : []).map((h) => ({
        role: h.role === 'model' ? 'model' : 'user',
        parts: [{ text: h.text }],
      }));

      const toolsList: Array<Record<string, unknown>> = [
        { functionDeclarations: CHAT_EDITOR_TOOLS },
      ];
      if (body.enableGoogleSearch) {
        toolsList.push({ googleSearch: {} });
      }

      const response = await ai.models.generateContent({
        model: requestedModel,
        contents: [...recentHistory, { role: 'user', parts: [{ text: message }] }],
        config: {
          systemInstruction,
          tools: toolsList as never,
          ...(body.enableGoogleSearch
            ? { toolConfig: { includeServerSideToolInvocations: true } as never }
            : {}),
          thinkingConfig: {
            thinkingLevel:
              requestedModel === 'gemini-4-hydrogen' ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
          },
        },
      });

      const proposals: ChatProposal[] = [];
      const fnCalls = response.functionCalls || [];
      for (const call of fnCalls) {
        const name = call.name as ChatProposal['action'];
        const args = (call.args || {}) as Record<string, unknown>;
        const nodeTitle =
          bundle.outlineNodes.find((n) => n.id === args.nodeId)?.title || String(args.nodeId || '');

        let title = 'پیشنهاد ویرایش سند';
        let summary = JSON.stringify(args);
        if (name === 'rename_chapter') {
          title = `تغییر نام فصل به «${String(args.newTitle || '')}»`;
          summary = `عنوان فصل «${nodeTitle}» به «${String(args.newTitle || '')}» تغییر می‌کند.`;
        } else if (name === 'move_chapter') {
          title = `جابه‌جایی فصل «${nodeTitle}» به جایگاه ${toPersianDigits(Number(args.targetOrder || 1))}`;
          summary = `ترتیب فصل «${nodeTitle}» بدون حذف هیچ محتوایی تغییر می‌کند.`;
        } else if (name === 'split_chapter') {
          title = `تقسیم فصل «${nodeTitle}»`;
          summary = `نیمه دوم فصل به فصل جدید «${String(args.newChapterTitle || '')}» منتقل می‌شود.`;
        } else if (name === 'add_callout_box') {
          title = `افزودن باکس نکته: ${String(args.title || '')}`;
          summary = `درج باکس نکته در فصل «${nodeTitle}».`;
        } else if (name === 'add_comparison_table') {
          title = `درج جدول مقایسه‌ای: ${String(args.caption || '')}`;
          summary = `جدول با ${toPersianDigits(Array.isArray(args.rows) ? args.rows.length : 0)} ردیف در فصل «${nodeTitle}» درج می‌شود.`;
        } else if (name === 'insert_dictated_paragraph') {
          title = `درج متن جدید در فصل «${nodeTitle}»`;
          summary = String(args.text || '').slice(0, 140);
        }

        proposals.push({
          id: `prop_${crypto.randomBytes(4).toString('hex')}`,
          action: name,
          title,
          summary,
          args,
          applied: false,
        });
      }

      const groundingSources = extractGroundingSources(response);
      const reply =
        (response.text || '').trim() ||
        (proposals.length > 0
          ? 'پیشنهاد ویرایش ساختاریافته زیر آماده شد. با زدن دکمه «تأیید و اعمال روی سند» بلافاصله در سند و پایگاه داده ثبت می‌شود.'
          : 'درخواست شما بررسی شد.');

      const updatedChatUsage = await recordProjectAiUsage(
        projectId,
        user.uid,
        extractUsageDeltaFromResponse(response, {
          modelUsed: requestedModel,
          fallbackPromptChars: systemInstruction.length + message.length,
          fallbackOutputChars: reply.length,
          isGrounding: Boolean(body.enableGoogleSearch),
          isChat: true,
        })
      );

      res.json({
        reply,
        proposals,
        groundingSources,
        modelUsed: requestedModel,
        ...(updatedChatUsage ? { aiUsage: updatedChatUsage } : {}),
      });
    } catch (err) {
      const formattedErr = formatGeminiError(err, 'خطا در پردازش پیام دستیار هوشمند.');
      res.status(formattedErr.statusCode).json({ error: formattedErr.message });
    }
  });

  // 13. APPLY CONFIRMED CHAT OR VOICE PROPOSAL DIRECTLY TO POSTGRESQL & RE-ASSEMBLE BOOK
  router.post('/:id/apply-proposal', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const proposal = req.body as ChatProposal;
      const args = proposal.args || {};
      const nodes = [...bundle.outlineNodes].sort((a, b) => a.nodeOrder - b.nodeOrder);

      const defaultSourceFileId = bundle.sourceFiles[0]?.id;
      const findNodeOrFirst = (nodeId: unknown) =>
        nodes.find((n) => n.id === String(nodeId || '')) || nodes[0];

      if (proposal.action === 'rename_chapter') {
        const target = findNodeOrFirst(args.nodeId);
        if (target && args.newTitle) {
          target.title = String(args.newTitle).trim();
          await updateOutlineNodesOrderAndApproval(
            projectId,
            nodes.map((n, idx) => ({
              id: n.id,
              title: n.title,
              summary: n.summary,
              nodeOrder: idx + 1,
              level: n.level,
              parentId: n.parentId,
              isApproved: n.isApproved,
              webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
            }))
          );
        }
      } else if (proposal.action === 'move_chapter') {
        const idx = nodes.findIndex((n) => n.id === String(args.nodeId || ''));
        if (idx !== -1) {
          const [moved] = nodes.splice(idx, 1);
          const targetIdx = Math.max(0, Math.min(nodes.length, Number(args.targetOrder || 1) - 1));
          nodes.splice(targetIdx, 0, moved);
          await updateOutlineNodesOrderAndApproval(
            projectId,
            nodes.map((n, i) => ({
              id: n.id,
              title: n.title,
              summary: n.summary,
              nodeOrder: i + 1,
              level: n.level,
              parentId: n.parentId,
              isApproved: n.isApproved,
              webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
            }))
          );
        }
      } else if (proposal.action === 'split_chapter') {
        const targetIdx = nodes.findIndex((n) => n.id === String(args.nodeId || ''));
        if (targetIdx !== -1) {
          const sourceNode = nodes[targetIdx];
          const newNodeId = `node_${projectId}_split_${Date.now()}`;
          const newTitle = String(args.newChapterTitle || `${sourceNode.title} (بخش دوم)`).trim();

          nodes.splice(targetIdx + 1, 0, {
            id: newNodeId,
            projectId,
            parentId: null,
            level: 1,
            nodeOrder: targetIdx + 2,
            title: newTitle,
            summary: 'ایجادشده از تقسیم فصل بدون افت محتوا',
            isApproved: sourceNode.isApproved,
            webEnrichmentJson: null,
          });

          await updateOutlineNodesOrderAndApproval(
            projectId,
            nodes.map((n, i) => ({
              id: n.id,
              title: n.title,
              summary: n.summary,
              nodeOrder: i + 1,
              level: n.level,
              parentId: n.parentId,
              isApproved: n.isApproved,
              webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
            }))
          );

          // Move second half of sourceNode's active units to the new chapter
          const sourceUnits = bundle.contentUnits.filter(
            (u) => u.outlineNodeId === sourceNode.id && u.status !== 'merged'
          );
          const half = Math.ceil(sourceUnits.length / 2);
          for (const u of sourceUnits.slice(half)) {
            await db
              .update(contentUnits)
              .set({ outlineNodeId: newNodeId })
              .where(and(eq(contentUnits.id, u.id), eq(contentUnits.projectId, projectId)));
          }
        }
      } else if (
        (proposal.action === 'add_callout_box' ||
          proposal.action === 'add_comparison_table' ||
          proposal.action === 'insert_dictated_paragraph') &&
        defaultSourceFileId
      ) {
        const targetNode = findNodeOrFirst(args.nodeId);
        const nextOrder = bundle.contentUnits.length + 1;
        const unitId = `u_edit_${crypto.randomBytes(4).toString('hex')}`;

        let unitType = 'paragraph';
        let rawText = '';
        let blockPayload: Record<string, unknown> = {};

        if (proposal.action === 'add_callout_box') {
          unitType = 'callout';
          const title = String(args.title || 'نکته تکمیلی');
          const bodyText = String(args.body || '');
          rawText = `${title}\n${bodyText}`;
          blockPayload = {
            type: 'callout',
            id: unitId,
            variant: String(args.variant || 'concept'),
            title,
            paragraphs: bodyText.split(/\n+/).filter(Boolean),
          };
        } else if (proposal.action === 'add_comparison_table') {
          unitType = 'table';
          const caption = String(args.caption || 'جدول مقایسه‌ای');
          const headers = Array.isArray(args.headers) ? args.headers.map(String) : ['موضوع', 'توضیح'];
          const rows = Array.isArray(args.rows)
            ? args.rows.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)]))
            : [];
          rawText = `${caption}\n${headers.join(' | ')}`;
          blockPayload = {
            type: 'table',
            id: unitId,
            caption,
            headers,
            rows,
            generatedBy: 'ai',
          };
        } else {
          unitType = 'paragraph';
          rawText = String(args.text || '').trim();
          blockPayload = {
            type: 'paragraph',
            id: unitId,
            text: rawText,
          };
        }

        if (rawText) {
          const sectionSuffix = args.sectionTitle ? ` > ${String(args.sectionTitle)}` : '';
          await db.insert(contentUnits).values({
            id: unitId,
            projectId,
            sourceFileId: defaultSourceFileId,
            unitOrder: nextOrder,
            unitType,
            rawText,
            contentHash: deterministicHash(`${unitType}::${normalizePersianForComparison(rawText)}:${unitId}`),
            status: 'active',
            canonicalUnitId: null,
            outlineNodeId: targetNode?.id ?? null,
            payloadJson: {
              headingPath: `${targetNode?.title || 'فصل اول'}${sectionSuffix}`,
              fileName: 'دستیار هوشمند / دیکته ویراستار',
              fileRole: 'supplement',
              block: blockPayload,
            },
          });
        }
      }

      const finalBundle = await reassembleAndPersistProject(projectId, user.uid);
      res.json({ ok: true, bundle: finalBundle });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در اعمال تغییر پیشنهادی روی سند.',
      });
    }
  });

  return router;
}
