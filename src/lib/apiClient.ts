import type {
  AssistantChatResponse,
  ChatProposal,
  DeepReviewResponse,
  FileRole,
  ProjectBundleDto,
  ProjectSummaryDto,
  SourceFileFormat,
  ValidationDomain,
  WorkflowMode,
} from './bookTypes.ts';
import {
  type AiProviderConfig,
  type AiProviderType,
  type AiQuotaProbeResponse,
  type DiscoveredProviderModel,
  getActiveProviderCredentials,
  getEffectiveAudioRoute,
  getEffectiveTierRouting,
  getEffectiveWebSearchRoute,
  isPhase1StabilityLocked,
  normalizeAiDeploymentPhase,
  normalizeKeyAuthMode,
} from './aiProviderConfig.ts';
import {
  PHASE1_LOCKED_BASE_URL,
  PHASE1_LOCKED_MODEL,
  PHASE1_LOCKED_PROVIDER,
} from './llmAbstractionLayer.ts';
import type { ParallelImageResolutionResult } from './smartImageOrchestrator.ts';
import {
  type DeepReviewProgressEvent,
  normalizeDeepReviewReport,
  parseNdjsonBuffer,
} from './deepReviewStream.ts';
import type { ProjectRevisionDto } from './changeLogUtils.ts';
import type {
  Stage5ComparativePieItem,
  Stage5QualityMetrics,
} from './stage5QualityMetrics.ts';
import type {
  GlossaryTermEntry,
  HarnessState,
  Layer1AuditResult,
  Layer2AuditResult,
  SemanticBlock,
} from './harness/types.ts';
import type {
  AccessLevel,
  AiTokenUsageLedger,
  ChapterCommentItem,
  KnowledgeWishlistItem,
  LeaderboardEntry,
  PlatformSettingsRecord,
  TeamContributionRecord,
  TeamUploadedAssetRecord,
  VolumeGoogleDocLink,
} from './collaboration/platformTypes.ts';
import type { ProjectHealthMonitorReport } from './masterEncyclopedia/smartClusteringAndHealthMonitor.ts';

function encodeUtf8Base64(input: string): string {
  try {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch {
    return '';
  }
}

export function buildProviderHeaders(config?: AiProviderConfig | null): Record<string, string> {
  if (!config) {
    return {
      'X-AI-Deployment-Phase': 'phase1_stability_lock',
      'X-AI-Provider': PHASE1_LOCKED_PROVIDER,
      'X-AI-Key-Mode': 'auto_creator_first',
      'X-AI-Base-Url': PHASE1_LOCKED_BASE_URL,
      'X-AI-Custom-Model': PHASE1_LOCKED_MODEL,
    };
  }

  const deploymentPhase = normalizeAiDeploymentPhase(config.deploymentPhase);

  // PHASE 1 HARD-LOCK: Strictly use built-in Gemini 4 Neon platform quota.
  // NEVER transmit personal Google AI Studio API keys or third-party provider keys.
  if (isPhase1StabilityLocked(deploymentPhase)) {
    const tierRouting = getEffectiveTierRouting(config);
    const encodedSafeTier = encodeUtf8Base64(
      JSON.stringify({
        enabled: false,
        optimizationMode: tierRouting.optimizationMode,
        hardCostCapUsd: tierRouting.hardCostCapUsd,
        enablePromptCaching: tierRouting.enablePromptCaching,
        enableResponseCache: tierRouting.enableResponseCache,
        enableAntiDriftGuard: tierRouting.enableAntiDriftGuard,
        taskTierMap: tierRouting.taskTierMap,
        tiers: {
          economy: {
            provider: PHASE1_LOCKED_PROVIDER,
            baseUrl: PHASE1_LOCKED_BASE_URL,
            apiKey: '',
            modelId: PHASE1_LOCKED_MODEL,
          },
          balanced: {
            provider: PHASE1_LOCKED_PROVIDER,
            baseUrl: PHASE1_LOCKED_BASE_URL,
            apiKey: '',
            modelId: PHASE1_LOCKED_MODEL,
          },
          flagship: {
            provider: PHASE1_LOCKED_PROVIDER,
            baseUrl: PHASE1_LOCKED_BASE_URL,
            apiKey: '',
            modelId: PHASE1_LOCKED_MODEL,
          },
        },
      })
    );

    const lockedHeaders: Record<string, string> = {
      'X-AI-Deployment-Phase': 'phase1_stability_lock',
      'X-AI-Provider': PHASE1_LOCKED_PROVIDER,
      'X-AI-Key-Mode': 'auto_creator_first',
      'X-AI-Base-Url': PHASE1_LOCKED_BASE_URL,
      'X-AI-Custom-Model': PHASE1_LOCKED_MODEL,
      'X-AI-Search-Provider': 'same_as_primary',
      'X-AI-Audio-Provider': 'google_gemini_audio',
      'X-AI-Audio-Model': PHASE1_LOCKED_MODEL,
    };
    if (encodedSafeTier) {
      lockedHeaders['X-AI-Tier-Routing'] = encodedSafeTier;
    }
    return lockedHeaders;
  }

  // PHASE 2 OPEN MULTI-PROVIDER MODE: Full provider-agnostic routing
  const creds = getActiveProviderCredentials(config);
  const keyMode = normalizeKeyAuthMode(config.googleKeyMode);
  const headers: Record<string, string> = {
    'X-AI-Deployment-Phase': 'phase2_open_multi_provider',
    'X-AI-Provider': config.provider,
    'X-AI-Key-Mode': keyMode,
  };
  if (creds.baseUrl.trim()) {
    headers['X-AI-Base-Url'] = creds.baseUrl.trim();
  }
  if (creds.apiKey.trim()) {
    headers['X-AI-Api-Key'] = creds.apiKey.trim();
  }
  if (creds.modelId.trim()) {
    headers['X-AI-Custom-Model'] = creds.modelId.trim();
  }
  if (config.customModels && Object.keys(config.customModels).length > 0) {
    const encodedCustomModels = encodeUtf8Base64(JSON.stringify(config.customModels));
    if (encodedCustomModels) {
      headers['X-AI-Custom-Models'] = encodedCustomModels;
    }
  }

  // Forward Slot 2: Independent Web Search route headers (session-memory only)
  const searchRoute = getEffectiveWebSearchRoute(config);
  headers['X-AI-Search-Provider'] = searchRoute.provider;
  if (searchRoute.baseUrl) headers['X-AI-Search-Base-Url'] = searchRoute.baseUrl;
  if (searchRoute.apiKey) headers['X-AI-Search-Api-Key'] = searchRoute.apiKey;
  if (searchRoute.modelId) headers['X-AI-Search-Model'] = searchRoute.modelId;

  // Forward Slot 3: Independent Audio/Voice STT route headers (session-memory only)
  const audioRoute = getEffectiveAudioRoute(config);
  headers['X-AI-Audio-Provider'] = audioRoute.provider;
  if (audioRoute.baseUrl) headers['X-AI-Audio-Base-Url'] = audioRoute.baseUrl;
  if (audioRoute.apiKey) headers['X-AI-Audio-Api-Key'] = audioRoute.apiKey;
  if (audioRoute.modelId) headers['X-AI-Audio-Model'] = audioRoute.modelId;

  // Forward Multi-Tier Routing + Token Optimization + Hard Cost Cap (strictly session memory, never persisted)
  const tierRouting = getEffectiveTierRouting(config);
  const resolveTierPayload = (tierId: 'economy' | 'balanced' | 'flagship') => {
    const slot = tierRouting.tiers[tierId];
    const inheritedKey = config.providers?.[slot.provider]?.apiKey?.trim() || '';
    const inheritedUrl = config.providers?.[slot.provider]?.baseUrl?.trim() || '';
    return {
      provider: slot.provider,
      baseUrl: slot.baseUrl.trim() || inheritedUrl,
      apiKey: slot.apiKey.trim() || inheritedKey,
      modelId: slot.modelId.trim(),
    };
  };
  const encodedTier = encodeUtf8Base64(
    JSON.stringify({
      enabled: tierRouting.enabled,
      optimizationMode: tierRouting.optimizationMode,
      hardCostCapUsd: tierRouting.hardCostCapUsd,
      enablePromptCaching: tierRouting.enablePromptCaching,
      enableResponseCache: tierRouting.enableResponseCache,
      enableAntiDriftGuard: tierRouting.enableAntiDriftGuard,
      taskTierMap: tierRouting.taskTierMap,
      tiers: {
        economy: resolveTierPayload('economy'),
        balanced: resolveTierPayload('balanced'),
        flagship: resolveTierPayload('flagship'),
      },
    })
  );
  if (encodedTier) {
    headers['X-AI-Tier-Routing'] = encodedTier;
  }

  return headers;
}

export class ApiClient {
  constructor(
    private getToken: (forceRefresh?: boolean) => Promise<string>,
    private getProviderConfig?: () => AiProviderConfig
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit = {},
    overrideProvider?: AiProviderConfig
  ): Promise<T> {
    const providerHeaders = buildProviderHeaders(
      overrideProvider ?? this.getProviderConfig?.()
    );
    const executeFetch = async (forceRefresh: boolean) => {
      const token = await this.getToken(forceRefresh);
      return fetch(path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...providerHeaders,
          ...(init.headers || {}),
        },
      });
    };

    let res = await executeFetch(false);
    if (res.status === 401) {
      res = await executeFetch(true);
    }

    const rawText = await res.text();
    let data: unknown = null;
    if (rawText.trim()) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const errMsg =
        data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
          ? (data as { error: string }).error
          : `خطای سرور (کد ${res.status})`;
      throw new Error(errMsg);
    }

    if (data === null) {
      throw new Error('پاسخ معتبر JSON از سرور دریافت نشد. لطفاً دوباره تلاش کنید.');
    }

    return data as T;
  }

  probeAiQuota(
    payload: { projectId?: string; model?: string },
    overrideProvider?: AiProviderConfig
  ) {
    return this.request<AiQuotaProbeResponse>(
      '/api/projects/ai-quota-probe',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      overrideProvider
    );
  }

  probeProviderModels(payload: {
    provider: AiProviderType;
    baseUrl?: string;
    apiKey?: string;
  }) {
    return this.request<{
      ok: boolean;
      models: DiscoveredProviderModel[];
      baseUrlUsed?: string;
      error?: string;
    }>('/api/projects/probe-models', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  listProjects() {
    return this.request<{ projects: ProjectSummaryDto[] }>('/api/projects');
  }

  createProject(payload: {
    title: string;
    workflowMode: WorkflowMode;
    settingsJson?: Record<string, unknown>;
  }) {
    return this.request<ProjectBundleDto>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  seedGuestDemoProject() {
    return this.request<ProjectBundleDto>('/api/projects/seed-guest-demo', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  getProject(projectId: string) {
    return this.request<ProjectBundleDto>(`/api/projects/${encodeURIComponent(projectId)}`);
  }

  listProjectRevisions(projectId: string) {
    return this.request<{ revisions: ProjectRevisionDto[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/revisions`
    );
  }

  logProjectActivity(
    projectId: string,
    payload: {
      actionType: ProjectRevisionDto['actionType'];
      title: string;
      summary: string;
      captureSnapshot?: boolean;
      extraDetails?: Record<string, unknown>;
    }
  ) {
    return this.request<{ ok: boolean; revisions: ProjectRevisionDto[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/revisions/log`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  rollbackProjectRevision(projectId: string, revisionId: string) {
    return this.request<{
      ok: boolean;
      restoredVersion: number;
      bundle: ProjectBundleDto;
      revisions: ProjectRevisionDto[];
    }>(
      `/api/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/rollback`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    );
  }

  updateProject(
    projectId: string,
    patch: Partial<{
      title: string;
      workflowMode: WorkflowMode;
      status: string;
      pipelineStage: number;
      settingsJson: Record<string, unknown>;
      checkpointJson: Record<string, unknown>;
    }>
  ) {
    return this.request<ProjectBundleDto>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  deleteProject(projectId: string) {
    return this.request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });
  }

  getProjectQualityMetrics(projectId: string) {
    return this.request<{
      projectId: string;
      metrics: Stage5QualityMetrics;
      chartData: Stage5ComparativePieItem[];
      serverGeneratedAt: string;
      validationDomain?: ValidationDomain;
    }>(`/api/projects/${encodeURIComponent(projectId)}/quality-metrics`);
  }

  ingestFilesBatch(
    projectId: string,
    payload: {
      replaceExisting?: boolean;
      files: Array<{
        name: string;
        format?: SourceFileFormat;
        role?: FileRole;
        sizeBytes?: number;
        text?: string;
        base64?: string;
      }>;
    }
  ) {
    return this.request<{
      ingested: Array<{
        fileName: string;
        unitCount: number;
        wordCount: number;
        classification?: 'pure_automotive' | 'mixed_hybrid_pruned' | 'rejected_non_automotive';
        prunedOffTopicSegmentsCount?: number;
        keptAutomotiveSegmentsCount?: number;
        estimatedTokensSaved?: number;
        tokenSavingsPercent?: number;
        preprocessSummaryFa?: string;
      }>;
      adaptiveProfile?: import('./bookTypes').AdaptiveProjectProfile | null;
      bundle: ProjectBundleDto;
    }>(`/api/projects/${encodeURIComponent(projectId)}/ingest`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  runDedupStage(projectId: string) {
    return this.request<ProjectBundleDto>(
      `/api/projects/${encodeURIComponent(projectId)}/dedup`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  }

  ingestWorkspaceQueue(projectId: string) {
    return this.request<{
      ingested: Array<{ fileName: string; unitCount: number; wordCount: number }>;
      bundle: ProjectBundleDto;
    }>(`/api/projects/${encodeURIComponent(projectId)}/ingest-workspace-queue`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  saveOutline(
    projectId: string,
    payload: {
      nodes: Array<{
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
      validationDomain?: ValidationDomain;
    }
  ) {
    return this.request<ProjectBundleDto>(
      `/api/projects/${encodeURIComponent(projectId)}/outline`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
  }

  generateQuickDraft(
    projectId: string,
    payload?: {
      strategy?: 'heading_tree' | 'by_source_file';
      openStage4Preview?: boolean;
    }
  ) {
    return this.request<ProjectBundleDto>(
      `/api/projects/${encodeURIComponent(projectId)}/quick-draft`,
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }
    );
  }

  finalizeProject(projectId: string) {
    return this.request<ProjectBundleDto>(
      `/api/projects/${encodeURIComponent(projectId)}/finalize`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  }

  resolveProjectImagesParallel(
    projectId: string,
    payload?: { forceRequery?: boolean }
  ) {
    return this.request<{
      resolution: ParallelImageResolutionResult;
      bundle: ProjectBundleDto;
    }>(`/api/projects/${encodeURIComponent(projectId)}/resolve-images-parallel`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  generateAdaptiveVisuals(projectId: string) {
    return this.request<{
      profile: import('./bookTypes').AdaptiveProjectProfile;
      injectedCount: number;
      pythonRenderedCount: number;
      byVisualKind: Record<string, number>;
      bundle: ProjectBundleDto;
    }>(`/api/projects/${encodeURIComponent(projectId)}/generate-adaptive-visuals`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  resolveConflict(
    projectId: string,
    conflictId: string,
    payload: {
      status: 'open' | 'keep_both' | 'choose_a' | 'choose_b' | 'resolved_web';
      resolutionNote?: string;
    }
  ) {
    return this.request<{ bundle: ProjectBundleDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/conflicts/${encodeURIComponent(conflictId)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  rescanConflicts(projectId: string) {
    return this.request<{
      previousCount: number;
      currentCount: number;
      removedCount: number;
      aiVerified: boolean;
      bundle: ProjectBundleDto;
    }>(`/api/projects/${encodeURIComponent(projectId)}/rescan-conflicts`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  runGrounding(
    projectId: string,
    payload: {
      targetType: 'conflict' | 'outline_node' | 'full_document';
      targetId?: string;
      customQuery?: string;
    }
  ) {
    return this.request<{
      enrichedChaptersCount?: number;
      failedChaptersCount?: number;
      totalChapters?: number;
      bundle: ProjectBundleDto;
    }>(`/api/projects/${encodeURIComponent(projectId)}/grounding`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async runDeepAiReview(
    projectId: string,
    payload: {
      focusNote?: string;
    } = {},
    onProgress?: (event: DeepReviewProgressEvent) => void
  ): Promise<DeepReviewResponse> {
    const providerHeaders = buildProviderHeaders(this.getProviderConfig?.());
    const executeDeepReviewFetch = async (forceRefresh: boolean) => {
      const token = await this.getToken(forceRefresh);
      return fetch(`/api/projects/${encodeURIComponent(projectId)}/deep-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson, application/json',
          Authorization: `Bearer ${token}`,
          ...providerHeaders,
        },
        body: JSON.stringify({ ...payload, stream: true }),
      });
    };

    let res = await executeDeepReviewFetch(false);
    if (res.status === 401) {
      res = await executeDeepReviewFetch(true);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = `خطای سرور در بازبینی عمیق (کد ${res.status})`;
      try {
        const parsed = JSON.parse(errText) as { error?: string };
        if (parsed?.error) errMsg = parsed.error;
      } catch {
        // Keep status message
      }
      throw new Error(errMsg);
    }

    if (contentType.includes('application/json') || !res.body) {
      const text = await res.text();
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error('پاسخ بازبینی عمیق به‌صورت ناقص دریافت شد. لطفاً مجدداً تلاش کنید.');
      }
      if (parsed?.error && typeof parsed.error === 'string') {
        throw new Error(parsed.error);
      }
      const review = normalizeDeepReviewReport(parsed?.review);
      if (!review) {
        throw new Error('گزارش بازبینی عمیق از سرور دریافت نشد. لطفاً دوباره امتحان کنید.');
      }
      onProgress?.({
        type: 'progress',
        percent: 100,
        stage: 'بازبینی عمیق با موفقیت تکمیل شد.',
      });
      return {
        review,
        bundle: (parsed?.bundle as ProjectBundleDto) ?? (null as unknown as ProjectBundleDto),
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalResponse: DeepReviewResponse | null = null;
    let streamError: string | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const { events, remainder } = parseNdjsonBuffer(buffer);
        buffer = remainder;
        for (const ev of events) {
          if (ev.type === 'progress') {
            onProgress?.(ev);
          } else if (ev.type === 'complete') {
            finalResponse = {
              review: ev.review,
              bundle: (ev.bundle as ProjectBundleDto) ?? (null as unknown as ProjectBundleDto),
            };
          } else if (ev.type === 'error') {
            streamError = ev.error;
          }
        }
      }
      if (done) break;
    }

    if (buffer.trim()) {
      const { events } = parseNdjsonBuffer(`${buffer}\n`);
      for (const ev of events) {
        if (ev.type === 'progress') onProgress?.(ev);
        else if (ev.type === 'complete') {
          finalResponse = {
            review: ev.review,
            bundle: (ev.bundle as ProjectBundleDto) ?? (null as unknown as ProjectBundleDto),
          };
        } else if (ev.type === 'error') {
          streamError = ev.error;
        }
      }
    }

    if (streamError) {
      throw new Error(streamError);
    }
    if (!finalResponse) {
      throw new Error(
        'ارتباط با سرور پیش از تکمیل گزارش بازبینی عمیق قطع شد. لطفاً یک بار دیگر تلاش کنید.'
      );
    }
    return finalResponse;
  }

  sendChatMessage(
    projectId: string,
    payload: {
      message: string;
      history: Array<{ role: 'user' | 'model'; text: string }>;
      model?: string;
      enableGoogleSearch?: boolean;
    }
  ) {
    return this.request<AssistantChatResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/chat`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  applyProposal(projectId: string, proposal: ChatProposal) {
    return this.request<{ ok: boolean; bundle: ProjectBundleDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/apply-proposal`,
      {
        method: 'POST',
        body: JSON.stringify(proposal),
      }
    );
  }

  transcribeAudio(
    projectId: string,
    payload: {
      audioBase64: string;
      mimeType: string;
      fileName: string;
      addAsSourceFile?: boolean;
      role?: FileRole;
    }
  ) {
    return this.request<{
      transcript: string;
      modelUsed: string;
      providerLabelFa: string;
      sourceFileAdded?: { fileName: string; unitCount: number; wordCount: number } | null;
      bundle?: ProjectBundleDto | null;
    }>(`/api/projects/${encodeURIComponent(projectId)}/transcribe-audio`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  initHarnessBlueprint(
    projectId: string,
    payload?: { budgetCapUsd?: number; forceReset?: boolean; validationDomain?: ValidationDomain }
  ) {
    return this.request<{
      ok: boolean;
      harnessState: HarnessState;
      routingInfo: {
        authorModelId: string;
        patchModelId: string;
        utilityModelId: string;
        enablePromptCaching: boolean;
      };
      bundle: ProjectBundleDto;
    }>(`/api/projects/${encodeURIComponent(projectId)}/harness/blueprint/init`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  approveHarnessBlueprint(
    projectId: string,
    payload?: {
      budgetCapUsd?: number;
      glossaryEntries?: GlossaryTermEntry[];
      validationDomain?: ValidationDomain;
    }
  ) {
    return this.request<{
      ok: boolean;
      harnessState: HarnessState;
      routingInfo: {
        authorModelId: string;
        patchModelId: string;
        utilityModelId: string;
        enablePromptCaching: boolean;
      };
      bundle: ProjectBundleDto;
      revisions: ProjectRevisionDto[];
    }>(`/api/projects/${encodeURIComponent(projectId)}/harness/blueprint/approve`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  executeHarnessStep(
    projectId: string,
    payload?: { sectionId?: string; allowBudgetOverride?: boolean },
    requestOptions?: { signal?: AbortSignal }
  ) {
    return this.request<{
      ok: boolean;
      done: boolean;
      pausedByBudgetCap?: boolean;
      sectionId?: string;
      outcome?: 'verified' | 'quarantined' | 'budget_paused' | 'completed';
      layer1?: Layer1AuditResult;
      layer2?: Layer2AuditResult;
      harnessState: HarnessState;
      bundle: ProjectBundleDto;
    }>(`/api/projects/${encodeURIComponent(projectId)}/harness/step`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
      signal: requestOptions?.signal,
    });
  }

  resolveHarnessQuarantine(
    projectId: string,
    sectionId: string,
    payload: { editedBlocks?: SemanticBlock[]; resolutionNote?: string }
  ) {
    return this.request<{
      ok: boolean;
      harnessState: HarnessState;
      bundle: ProjectBundleDto;
      revisions: ProjectRevisionDto[];
    }>(
      `/api/projects/${encodeURIComponent(projectId)}/harness/quarantine/${encodeURIComponent(sectionId)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  retryQuarantineFlagship(
    projectId: string,
    sectionId: string,
    payload?: { allowBudgetOverride?: boolean },
    requestOptions?: { signal?: AbortSignal }
  ) {
    return this.request<{
      ok: boolean;
      done: boolean;
      pausedByBudgetCap?: boolean;
      sectionId?: string;
      outcome?: 'verified' | 'quarantined' | 'budget_paused' | 'completed';
      layer1?: Layer1AuditResult;
      layer2?: Layer2AuditResult;
      harnessState: HarnessState;
      bundle: ProjectBundleDto;
    }>(
      `/api/projects/${encodeURIComponent(projectId)}/harness/quarantine/${encodeURIComponent(sectionId)}/retry`,
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
        signal: requestOptions?.signal,
      }
    );
  }

  syncHarnessBook(projectId: string) {
    return this.request<{
      ok: boolean;
      harnessState: HarnessState;
      bundle: ProjectBundleDto;
    }>(`/api/projects/${encodeURIComponent(projectId)}/harness/sync-book`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  // ============================================================================
  // MASTER AUTOMOTIVE ENCYCLOPEDIA CAPABILITIES & OWNER ADMIN ENDPOINTS
  // ============================================================================

  getAuthCapabilities() {
    return this.request<{
      masterEncyclopediaEnabled: boolean;
      canManageEncyclopedia: boolean;
    }>('/api/auth/capabilities');
  }

  getMasterEncyclopediaOverview() {
    return this.request<{
      summary: {
        volumesCount: number;
        publishedVolumesCount: number;
        draftProposalsCount: number;
        chaptersCount: number;
        verifiedUnitsCount: number;
        stagingUnitsCount: number;
        openConflictsCount: number;
        canonicalEntitiesCount: number;
        totalWords: number;
        totalEstimatedPages: number;
        queuedJobsCount: number;
        dlqJobsCount: number;
      };
      domainBreakdown: Array<{
        domainId: string;
        shortLabelFa: string;
        unitCount: number;
      }>;
      volumes: Array<{
        id: string;
        volumeNumber: number;
        title: string;
        automotiveDomain: string;
        wordCount: number;
        estimatedPages: number;
        status: string;
        splitThresholdPages: number;
        splitThresholdWords: number;
        description: string | null;
        chapters: Array<{
          id: string;
          volumeId: string;
          title: string;
          pedagogicalRank: number;
          orderIndex: number;
          wordCount: number;
          unitCount: number;
        }>;
      }>;
      recentLogsCount: number;
    }>('/api/admin/encyclopedia/overview');
  }

  getMasterEncyclopediaJobsAndLogs() {
    return this.request<{
      jobs: Array<{
        id: string;
        ingestBatchId: string;
        sourceUploadHash: string;
        sourceFileName: string;
        sourceFormat: string;
        submittedByRole: string;
        status: string;
        attempts: number;
        maxAttempts: number;
        lastError: string | null;
        createdAt: string;
      }>;
      logs: Array<{
        id: string;
        jobId: string;
        ingestBatchId: string;
        sourceUploadHash: string;
        sourceFileName: string;
        newUnitsCount: number;
        duplicateUnitsCount: number;
        mergedUnitsCount: number;
        conflictsCount: number;
        stagingUnitsCount: number;
        durationMs: number;
        status: string;
        summaryFa: string | null;
        createdAt: string;
      }>;
    }>('/api/admin/encyclopedia/jobs-and-logs');
  }

  rollbackMasterBatch(ingestBatchId: string) {
    return this.request<{
      ok: boolean;
      revertedUnits: number;
      deletedUnits: number;
      removedConflicts: number;
    }>('/api/admin/encyclopedia/rollback-batch', {
      method: 'POST',
      body: JSON.stringify({ ingestBatchId }),
    });
  }

  takedownMasterSource(sourceUploadHash: string) {
    return this.request<{
      ok: boolean;
      deletedUnits: number;
      sanitizedCorroborations: number;
      removedConflicts: number;
    }>('/api/admin/encyclopedia/takedown', {
      method: 'POST',
      body: JSON.stringify({ sourceUploadHash }),
    });
  }

  getMasterStaging() {
    return this.request<{
      stagingUnits: Array<{
        id: string;
        volumeId: string;
        chapterId: string;
        cleanText: string;
        domainTag: string;
        canonicalEntityId: string | null;
        corroborationCount: number;
        evidenceTier: string;
        sourceUploadHash: string;
        createdAt: string;
      }>;
      draftProposals: Array<{
        id: string;
        volumeNumber: number;
        title: string;
        automotiveDomain: string;
        description: string | null;
      }>;
    }>('/api/admin/encyclopedia/staging');
  }

  moderateMasterStagingUnit(unitId: string, action: 'approve' | 'reject' | 'deprecate') {
    return this.request<{ ok: boolean }>(
      `/api/admin/encyclopedia/staging/units/${encodeURIComponent(unitId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ action }),
      }
    );
  }

  approveMasterVolumeProposal(volumeId: string) {
    return this.request<{ ok: boolean }>(
      `/api/admin/encyclopedia/volumes/${encodeURIComponent(volumeId)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    );
  }

  updateMasterVolumeSettings(
    volumeId: string,
    payload: { title?: string; splitThresholdPages?: number; splitThresholdWords?: number }
  ) {
    return this.request<{ ok: boolean }>(
      `/api/admin/encyclopedia/volumes/${encodeURIComponent(volumeId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  }

  renameMasterChapter(chapterId: string, title: string, pedagogicalRank?: number) {
    return this.request<{ ok: boolean }>(
      `/api/admin/encyclopedia/chapters/${encodeURIComponent(chapterId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ title, pedagogicalRank }),
      }
    );
  }

  moveMasterChapter(chapterId: string, targetVolumeId: string) {
    return this.request<{ ok: boolean }>('/api/admin/encyclopedia/chapters/move', {
      method: 'POST',
      body: JSON.stringify({ chapterId, targetVolumeId }),
    });
  }

  mergeMasterChapters(sourceChapterId: string, targetChapterId: string) {
    return this.request<{ ok: boolean; mergedUnits: number }>(
      '/api/admin/encyclopedia/chapters/merge',
      {
        method: 'POST',
        body: JSON.stringify({ sourceChapterId, targetChapterId }),
      }
    );
  }

  getMasterConflicts(status?: string) {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request<{
      conflicts: Array<{
        id: string;
        existingUnitId: string;
        conflictType: string;
        topic: string;
        existingExcerpt: string;
        incomingExcerpt: string;
        conditionContext: string | null;
        status: string;
        resolutionNote: string | null;
        ingestBatchId: string;
        sourceUploadHash: string;
        createdAt: string;
      }>;
    }>(`/api/admin/encyclopedia/conflicts${q}`);
  }

  resolveMasterConflict(
    conflictId: string,
    payload: {
      resolution: 'approved_existing' | 'approved_incoming' | 'merged_conditional' | 'rejected';
      resolutionNote?: string;
      conditionContext?: string;
    }
  ) {
    return this.request<{ ok: boolean }>(
      `/api/admin/encyclopedia/conflicts/${encodeURIComponent(conflictId)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  runMasterKnowledgeLinter() {
    return this.request<{
      orphanChapters: Array<{ chapterId: string; volumeId: string; title: string }>;
      crossVolumeConflicts: Array<{
        entityOrToken: string;
        volumeIds: string[];
        unitIds: string[];
        detailFa: string;
      }>;
      deprecatedUnits: Array<{ unitId: string; volumeId: string; chapterId: string }>;
      totalActiveVerifiedUnits: number;
      healthy: boolean;
    }>('/api/admin/encyclopedia/linter/run', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  importMasterMarkdown(fileName: string, markdownText: string) {
    return this.request<{
      ok: boolean;
      ingestBatchId: string;
      sourceUploadHash: string;
      newUnitsCount: number;
      mergedUnitsCount: number;
      conflictsCount: number;
      summaryFa: string;
    }>('/api/admin/encyclopedia/import-markdown', {
      method: 'POST',
      body: JSON.stringify({ fileName, markdownText }),
    });
  }

  resetMasterEncyclopedia() {
    return this.request<{ ok: boolean; messageFa: string }>('/api/admin/encyclopedia/reset', {
      method: 'POST',
      body: JSON.stringify({ confirmReset: 'RESET_MASTER_ENCYCLOPEDIA' }),
    });
  }

  async downloadMasterExport(
    format: 'md' | 'docx' | 'csv' | 'a2l' | 'xdf' | 'json',
    volumeId?: string
  ): Promise<{ blob: Blob; fileName: string }> {
    const token = await this.getToken();
    const qs = volumeId ? `?volumeId=${encodeURIComponent(volumeId)}` : '';
    const res = await fetch(`/api/admin/encyclopedia/export/${format}${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let msg = `خطا در دانلود خروجی (${res.status})`;
      try {
        const json = (await res.json()) as { error?: string };
        if (json.error) msg = json.error;
      } catch {
        // ignore parse errors
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const extMap: Record<typeof format, string> = {
      md: 'master-automotive-encyclopedia.md',
      docx: 'master-automotive-encyclopedia.docx',
      csv: 'master-automotive-calibration.csv',
      a2l: 'master-automotive-winols.a2l',
      xdf: 'master-automotive-tunerpro.xdf',
      json: 'master-calibration-spec.json',
    };
    return { blob, fileName: extMap[format] };
  }

  // ============================================================================
  // COLLABORATIVE AUTOMOTIVE KNOWLEDGE PLATFORM API (/api/collab/*)
  // ============================================================================

  getCollabBootstrap() {
    return this.request<{
      isOwner: boolean;
      user: { uid: string; email?: string; name?: string; isGuest: boolean };
      enableUserPersonalOutput: boolean;
      access: {
        library: boolean;
        drive: boolean;
        docs: boolean;
        sheets: boolean;
        levels: {
          library: AccessLevel;
          drive: AccessLevel;
          docs: AccessLevel;
          sheets: AccessLevel;
        };
      };
      workspaceConfig: {
        driveRootFolderId: string | null;
        driveRootFolderName: string;
        sheetsSpreadsheetId: string | null;
        sheetsSpreadsheetUrl: string | null;
        sheetsTabName: string;
      };
      stats: {
        volumesCount: number;
        totalWords: number;
        contributionsCount: number;
        acceptedContributionsCount: number;
        winolsAssetsCount: number;
        openWishlistCount: number;
        pendingSheetSyncCount: number;
      };
      tokenLedger?: AiTokenUsageLedger;
    }>('/api/collab/bootstrap');
  }

  submitCollabContribution(payload: {
    fileName: string;
    mimeType?: string;
    extractedText?: string;
    base64Data?: string;
    vehicleModel?: string;
    ecuModel?: string;
    mapList?: string;
    bountyId?: string;
    driveFileId?: string;
    driveWebViewLink?: string;
    driveFolderPath?: string;
  }) {
    return this.request<{
      ok: boolean;
      contribution: TeamContributionRecord;
      sheetRow: string[];
      recommendedDriveFolder: {
        categoryFolder: string;
        subFolder: string;
        displayPath: string;
      } | null;
      bountyFulfilled: KnowledgeWishlistItem | null;
      transcriptPreview?: string | null;
      conflictsDetected?: number;
      crossReferenceRoutedCount?: number;
      projectHealthReport?: ProjectHealthMonitorReport | null;
    }>('/api/collab/contribute', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  previewCollabIngest(payload: {
    fileName?: string;
    extractedText: string;
    vehicleModel?: string;
    ecuModel?: string;
    mapList?: string;
  }) {
    return this.request<{
      ok: boolean;
      gatekeeperDecision: string;
      gatekeeperReasonFa: string;
      detectedDomain: string;
      detectedVolumeId: string;
      detectedVolumeTitle: string;
      brokenTablesMergedCount: number;
      primaryCluster: {
        familyId: string;
        clusterTitleFa: string;
        subChapterTitleFa: string;
      };
      crossReferenceRoutedCount: number;
      routedLinesPreview: Array<{
        originChapterTitle: string;
        targetClusterTitleFa: string;
        targetSubChapterTitleFa: string;
        signals: string[];
      }>;
      phoneticCorrectionsCount: number;
      tokenAccounting: {
        inputHexCount: number;
        outputHexCount: number;
        inputDtcCount: number;
        outputDtcCount: number;
        zeroLossVerified: boolean;
      };
      healthReport: ProjectHealthMonitorReport;
    }>('/api/collab/preview-ingest', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateCollabContributionWorkspaceSync(
    contributionId: string,
    payload: {
      driveFileId?: string | null;
      driveWebViewLink?: string | null;
      driveFolderPath?: string | null;
      sheetSynced?: boolean;
    }
  ) {
    return this.request<{ ok: boolean; contribution: TeamContributionRecord }>(
      `/api/collab/contributions/${encodeURIComponent(contributionId)}/workspace-sync`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  }

  getCollabLibrary() {
    return this.request<{
      volumes: Array<{
        id: string;
        volumeNumber: number;
        title: string;
        automotiveDomain: string;
        domainLabelFa: string;
        wordCount: number;
        estimatedPages: number;
        status: string;
        description: string | null;
        googleDoc: VolumeGoogleDocLink | null;
        pdfAssets: TeamUploadedAssetRecord[];
        chapters: Array<{
          id: string;
          volumeId: string;
          orderIndex: number;
          pedagogicalRank: number;
          title: string;
          shortSummary: string | null;
          wordCount: number;
          unitsCount: number;
          units: Array<{
            id: string;
            blockType: string;
            cleanText: string;
            domainTag: string;
            canonicalEntityId: string | null;
            evidenceTier: string;
            verificationStatus: string;
            corroborationCount: number;
            ingestBatchId: string;
            createdAt: string;
            technicalMetadataJson: Record<string, unknown> | null;
          }>;
          contributors: Array<{
            displayName: string;
            email: string;
            count: number;
            lastBatchId: string;
          }>;
          recentBatches: Array<{
            ingestBatchId: string;
            sourceFileName: string;
            contributorName: string;
            createdAt: string;
            unitsCount: number;
          }>;
        }>;
      }>;
      pdfAssets: TeamUploadedAssetRecord[];
      canUseDocs: boolean;
      isOwner: boolean;
      totalContributions: number;
    }>('/api/collab/library');
  }

  async fetchCollabPdfBlobUrl(assetId: string): Promise<string> {
    const token = await this.getToken();
    const res = await fetch(`/api/collab/library/pdf/${encodeURIComponent(assetId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error(`خطا در بارگذاری پیش‌نمایش PDF (کد ${res.status})`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  linkCollabVolumeGoogleDoc(
    volumeId: string,
    payload: {
      googleDocId: string;
      googleDocUrl: string;
      pulledMarkdown?: string;
    }
  ) {
    return this.request<{
      ok: boolean;
      googleDoc: VolumeGoogleDocLink;
      mergeSummary: {
        newUnitsCount: number;
        mergedUnitsCount: number;
        ingestBatchId: string;
      } | null;
    }>(`/api/collab/library/volumes/${encodeURIComponent(volumeId)}/doc-link`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getCollabChapterComments(chapterId: string) {
    return this.request<{ comments: ChapterCommentItem[] }>(
      `/api/collab/chapters/${encodeURIComponent(chapterId)}/comments`
    );
  }

  addCollabChapterComment(
    chapterId: string,
    payload: {
      volumeId: string;
      commentType: 'comment' | 'correction';
      body: string;
    }
  ) {
    return this.request<{ ok: boolean; comment: ChapterCommentItem }>(
      `/api/collab/chapters/${encodeURIComponent(chapterId)}/comments`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  resolveCollabChapterComment(commentId: string) {
    return this.request<{ ok: boolean; comment: ChapterCommentItem }>(
      `/api/collab/chapters/comments/${encodeURIComponent(commentId)}/resolve`,
      {
        method: 'PATCH',
        body: JSON.stringify({}),
      }
    );
  }

  rollbackCollabBatch(ingestBatchId: string) {
    return this.request<{
      ok: boolean;
      revertedUnits: number;
      deletedUnits: number;
      removedConflicts: number;
      revertedCount?: number;
      deletedCount?: number;
    }>(
      `/api/collab/rollback/${encodeURIComponent(ingestBatchId)}`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    );
  }

  searchCollabAll(query: string) {
    return this.request<{
      query: string;
      bookMatches: Array<{
        unitId: string;
        volumeId: string;
        volumeTitle: string;
        chapterId: string;
        chapterTitle: string;
        excerpt: string;
        domainTag: string;
        evidenceTier: string;
        canonicalEntityId: string | null;
      }>;
      assetMatches: TeamUploadedAssetRecord[];
      contributionMatches: TeamContributionRecord[];
    }>(`/api/collab/search?q=${encodeURIComponent(query)}`);
  }

  getCollabLeaderboard() {
    return this.request<{
      leaderboard: LeaderboardEntry[];
      totalContributions: number;
      totalScoreDistributed: number;
    }>('/api/collab/leaderboard');
  }

  getCollabWishlist() {
    return this.request<{ items: KnowledgeWishlistItem[] }>('/api/collab/wishlist');
  }

  createCollabWishlistItem(payload: {
    title: string;
    description: string;
    domainId: string;
    vehicleModel?: string;
    ecuModel?: string;
    wantedFormat?: string;
    bonusScore?: number;
  }) {
    return this.request<{ ok: boolean; item: KnowledgeWishlistItem }>('/api/collab/wishlist', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  deleteCollabWishlistItem(id: string) {
    return this.request<{ ok: boolean }>(`/api/collab/wishlist/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  getCollabDriveIndex(params?: {
    q?: string;
    format?: string;
    vehicle?: string;
    ecu?: string;
    domain?: string;
  }) {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.format && params.format !== 'all') qs.set('format', params.format);
    if (params?.vehicle) qs.set('vehicle', params.vehicle);
    if (params?.ecu) qs.set('ecu', params.ecu);
    if (params?.domain && params.domain !== 'all') qs.set('domain', params.domain);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<{
      assets: TeamUploadedAssetRecord[];
      totalCount: number;
      driveRootFolderId: string | null;
      driveRootFolderName: string;
    }>(`/api/collab/drive-index${suffix}`);
  }

  getCollabSheetsReport() {
    return this.request<{
      headers: string[];
      rows: Array<{
        contributionId: string;
        uploaderUid?: string;
        canSyncRow?: boolean;
        sheetSynced: boolean;
        status: string;
        score: number;
        newPercent: number;
        duplicatePercent: number;
        driveWebViewLink: string | null;
        cells: string[];
      }>;
      summary: {
        totalRows: number;
        acceptedCount: number;
        winolsCount: number;
        avgNewPercent: number;
        pendingSyncCount: number;
      };
      spreadsheet: {
        spreadsheetId: string | null;
        spreadsheetUrl: string | null;
        tabName: string;
      };
      isOwner: boolean;
    }>('/api/collab/sheets-report');
  }

  getCollabOwnerSettings() {
    return this.request<{ settings: PlatformSettingsRecord }>('/api/collab/owner/settings');
  }

  updateCollabOwnerSettings(
    patch: Partial<{
      enableUserPersonalOutput: boolean;
      accessLibrary: AccessLevel;
      accessDrive: AccessLevel;
      accessDocs: AccessLevel;
      accessSheets: AccessLevel;
      driveRootFolderId: string | null;
      driveRootFolderName: string;
      sheetsSpreadsheetId: string | null;
      sheetsSpreadsheetUrl: string | null;
      sheetsTabName: string;
    }>
  ) {
    return this.request<{ ok: boolean; settings: PlatformSettingsRecord }>(
      '/api/collab/owner/settings',
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }
    );
  }
}
