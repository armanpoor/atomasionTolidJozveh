import {
  AssistantChatResponse,
  ChatProposal,
  DeepReviewResponse,
  FileRole,
  ProjectBundleDto,
  ProjectSummaryDto,
  SourceFileFormat,
  WorkflowMode,
} from './bookTypes';
import {
  AiProviderConfig,
  AiQuotaProbeResponse,
  getActiveProviderCredentials,
  getEffectiveAudioRoute,
  getEffectiveWebSearchRoute,
  normalizeKeyAuthMode,
} from './aiProviderConfig';
import {
  DeepReviewProgressEvent,
  normalizeDeepReviewReport,
  parseNdjsonBuffer,
} from './deepReviewStream';
import type { ProjectRevisionDto } from './changeLogUtils';

function buildProviderHeaders(config?: AiProviderConfig | null): Record<string, string> {
  if (!config) return {};
  const creds = getActiveProviderCredentials(config);
  const keyMode = normalizeKeyAuthMode(config.googleKeyMode);
  const headers: Record<string, string> = {
    'X-AI-Provider': config.provider,
    'X-AI-Key-Mode': keyMode,
  };
  if (creds.baseUrl.trim()) {
    headers['X-AI-Base-Url'] = creds.baseUrl.trim();
  }
  // Always forward user's session API key if entered so auto_creator_first can seamlessly fall back to it
  if (creds.apiKey.trim()) {
    headers['X-AI-Api-Key'] = creds.apiKey.trim();
  }
  if (config.provider !== 'google_aistudio' && creds.modelId.trim()) {
    headers['X-AI-Custom-Model'] = creds.modelId.trim();
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
    const token = await this.getToken();
    const providerHeaders = buildProviderHeaders(
      overrideProvider ?? this.getProviderConfig?.()
    );
    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...providerHeaders,
        ...(init.headers || {}),
      },
    });

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
      ingested: Array<{ fileName: string; unitCount: number; wordCount: number }>;
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

  finalizeProject(projectId: string) {
    return this.request<ProjectBundleDto>(
      `/api/projects/${encodeURIComponent(projectId)}/finalize`,
      { method: 'POST', body: JSON.stringify({}) }
    );
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
    const token = await this.getToken();
    const providerHeaders = buildProviderHeaders(this.getProviderConfig?.());
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/deep-review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson, application/json',
        Authorization: `Bearer ${token}`,
        ...providerHeaders,
      },
      body: JSON.stringify({ ...payload, stream: true }),
    });

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
}
