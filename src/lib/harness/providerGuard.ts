/**
 * Package B Red-Team Hardening:
 * Pure, deterministic Server Gateway Guardrails:
 * 1. ProviderCapabilityProfile matrix (Google, Anthropic, OpenAI, OpenRouter, 9Router, Custom)
 * 2. Request payload sanitization & safe json_schema -> json_object fallback + role-based reasoning caps
 * 3. HTML/Cloudflare non-JSON gateway error detection (upstream_gateway_error)
 * 4. Strict Retryable (429/502/503/529 + Retry-After + Exponential Backoff + Jitter) vs Fatal (400/401/402/403) classification
 * 5. Deterministic 0-token JSON repair before schema rejection
 * 6. Silent model-swap detection (model_mismatch) + author downgrade guard
 * 7. Strictly factual cache & reasoning token extraction (never fabricated)
 */

import type { AiProviderType, AiTaskType } from '../tokenOptimizer.ts';
import { lookupModelPricing } from '../tokenOptimizer.ts';

export type ProviderFlavor =
  | 'google_aistudio'
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | '9router'
  | 'custom_openai';

export interface ProviderCapabilityProfile {
  flavor: ProviderFlavor;
  provider: AiProviderType;
  modelId: string;
  isReasoningModel: boolean;
  supportsPromptCaching: boolean;
  minCachePrefixTokens: number;
  cacheTtlMs: number;
  supportsJsonSchema: boolean;
  supportsJsonObject: boolean;
  supportsTemperature: boolean;
  supportsThinkingConfig: boolean;
  supportsReasoningEffort: boolean;
  supportsAnthropicCacheControl: boolean;
  /** Whether provider typically reports factual cache read tokens in usage payload */
  reportsCacheTelemetryNatively: boolean;
}

const REASONING_MODEL_RX =
  /(?:^|\/)(?:o1(?:[-.]|$)|o3(?:[-.]|$)|o4-mini|deepseek-reasoner|deepseek-r1|sonar-reasoning|qwq)/i;

export function isReasoningModelId(modelId: string): boolean {
  return REASONING_MODEL_RX.test((modelId || '').trim());
}

export function detectProviderFlavor(params: {
  provider: AiProviderType;
  baseUrl?: string | null;
}): ProviderFlavor {
  const url = (params.baseUrl || '').trim().toLowerCase();
  if (url.includes('9router') || url.includes('ninerouter') || url.includes(':20128')) {
    return '9router';
  }
  if (url.includes('openrouter.ai')) {
    return 'openrouter';
  }
  if (params.provider === 'google_aistudio') return 'google_aistudio';
  if (params.provider === 'anthropic') return 'anthropic';
  if (params.provider === 'openai' || url.includes('api.openai.com')) return 'openai';
  return 'custom_openai';
}

/**
 * Resolves the exact capability profile for a provider + baseUrl + modelId combination.
 */
export interface CustomCapabilityOverride {
  supportsJsonSchema?: boolean;
  supportsPromptCaching?: boolean;
  supportsTools?: boolean;
}

export function resolveProviderCapabilityProfile(params: {
  provider: AiProviderType;
  baseUrl?: string | null;
  modelId?: string | null;
  customProfile?: CustomCapabilityOverride | null;
}): ProviderCapabilityProfile {
  const modelId = (params.modelId || '').trim();
  const lowModel = modelId.toLowerCase();
  const flavor = detectProviderFlavor({ provider: params.provider, baseUrl: params.baseUrl });
  const isReasoning = isReasoningModelId(modelId);
  const applyOverride = (base: ProviderCapabilityProfile): ProviderCapabilityProfile => {
    if (!params.customProfile) return base;
    return {
      ...base,
      supportsJsonSchema:
        typeof params.customProfile.supportsJsonSchema === 'boolean'
          ? params.customProfile.supportsJsonSchema
          : base.supportsJsonSchema,
      supportsPromptCaching:
        typeof params.customProfile.supportsPromptCaching === 'boolean'
          ? params.customProfile.supportsPromptCaching
          : base.supportsPromptCaching,
    };
  };

  if (flavor === 'google_aistudio') {
    return applyOverride({
      flavor,
      provider: params.provider,
      modelId,
      isReasoningModel: isReasoning,
      supportsPromptCaching: true,
      minCachePrefixTokens: 2048,
      cacheTtlMs: 60 * 60 * 1000, // 60 min default Gemini context cache window
      supportsJsonSchema: true,
      supportsJsonObject: true,
      supportsTemperature: true,
      supportsThinkingConfig: true,
      supportsReasoningEffort: false,
      supportsAnthropicCacheControl: false,
      reportsCacheTelemetryNatively: true,
    });
  }

  if (flavor === 'anthropic') {
    const isHaiku = lowModel.includes('haiku');
    return applyOverride({
      flavor,
      provider: params.provider,
      modelId,
      isReasoningModel: isReasoning,
      supportsPromptCaching: true,
      minCachePrefixTokens: isHaiku ? 2048 : 1024,
      cacheTtlMs: 5 * 60 * 1000, // 5 min Anthropic ephemeral cache TTL
      supportsJsonSchema: false,
      supportsJsonObject: false,
      supportsTemperature: !isReasoning,
      supportsThinkingConfig: false,
      supportsReasoningEffort: false,
      supportsAnthropicCacheControl: true,
      reportsCacheTelemetryNatively: true,
    });
  }

  if (flavor === 'openai') {
    return applyOverride({
      flavor,
      provider: params.provider,
      modelId,
      isReasoningModel: isReasoning,
      supportsPromptCaching: true,
      minCachePrefixTokens: 1024,
      cacheTtlMs: 5 * 60 * 1000,
      supportsJsonSchema: true,
      supportsJsonObject: true,
      supportsTemperature: !isReasoning,
      supportsThinkingConfig: false,
      supportsReasoningEffort: isReasoning,
      supportsAnthropicCacheControl: false,
      reportsCacheTelemetryNatively: true,
    });
  }

  if (flavor === 'openrouter') {
    return applyOverride({
      flavor,
      provider: params.provider,
      modelId,
      isReasoningModel: isReasoning,
      supportsPromptCaching: lowModel.includes('claude') || lowModel.includes('gpt-4') || lowModel.includes('gpt-5') || lowModel.includes('gpt-6') || lowModel.includes('gemini'),
      minCachePrefixTokens: lowModel.includes('haiku') || lowModel.includes('gemini') ? 2048 : 1024,
      cacheTtlMs: 5 * 60 * 1000,
      supportsJsonSchema: false, // Safer fallback to json_object across heterogeneous OpenRouter backends
      supportsJsonObject: true,
      supportsTemperature: !isReasoning,
      supportsThinkingConfig: false,
      supportsReasoningEffort: isReasoning,
      supportsAnthropicCacheControl: false,
      reportsCacheTelemetryNatively: false,
    });
  }

  // 9Router and generic custom OpenAI-compatible proxies (including Iranian gateways):
  return applyOverride({
    flavor,
    provider: params.provider,
    modelId,
    isReasoningModel: isReasoning,
    supportsPromptCaching: false,
    minCachePrefixTokens: 1024,
    cacheTtlMs: 5 * 60 * 1000,
    supportsJsonSchema: false,
    supportsJsonObject: true,
    supportsTemperature: !isReasoning,
    supportsThinkingConfig: false,
    supportsReasoningEffort: isReasoning,
    supportsAnthropicCacheControl: false,
    reportsCacheTelemetryNatively: false,
  });
}

export interface RoleReasoningCap {
  googleThinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  googleThinkingBudgetTokens: number;
  openaiReasoningEffort?: 'low' | 'medium' | 'high';
  anthropicThinkingDisabled: boolean;
}

/**
 * Hard per-role reasoning/thinking budget caps so utility/judge roles never burn
 * expensive reasoning tokens unnecessarily.
 */
export function resolveRoleReasoningCap(taskRole?: AiTaskType): RoleReasoningCap {
  if (taskRole === 'harness_utility' || taskRole === 'conflict_triage') {
    return {
      googleThinkingLevel: 'MINIMAL',
      googleThinkingBudgetTokens: 0,
      openaiReasoningEffort: 'low',
      anthropicThinkingDisabled: true,
    };
  }
  if (taskRole === 'harness_judge') {
    return {
      googleThinkingLevel: 'LOW',
      googleThinkingBudgetTokens: 256,
      openaiReasoningEffort: 'low',
      anthropicThinkingDisabled: true,
    };
  }
  if (taskRole === 'harness_patch') {
    return {
      googleThinkingLevel: 'LOW',
      googleThinkingBudgetTokens: 512,
      openaiReasoningEffort: 'low',
      anthropicThinkingDisabled: true,
    };
  }
  // Author / deep_review
  return {
    googleThinkingLevel: 'MEDIUM',
    googleThinkingBudgetTokens: 2048,
    openaiReasoningEffort: 'medium',
    anthropicThinkingDisabled: false,
  };
}

export interface SanitizedOpenAiPayloadResult {
  payload: Record<string, unknown>;
  strippedParameters: string[];
  responseFormatMode: 'json_schema' | 'json_object' | 'none';
}

/**
 * Strips incompatible parameters based on ProviderCapabilityProfile and applies safe
 * json_schema -> json_object fallback and role-based reasoning caps for OpenAI-compatible gateways.
 */
export function sanitizeOpenAiCompatiblePayload(params: {
  profile: ProviderCapabilityProfile;
  rawPayload: Record<string, unknown>;
  expectJson?: boolean;
  jsonSchema?: Record<string, unknown> | null;
  taskRole?: AiTaskType;
  forceDowngradeJsonFormat?: boolean;
}): SanitizedOpenAiPayloadResult {
  const payload: Record<string, unknown> = { ...params.rawPayload };
  const strippedParameters: string[] = [];

  // Strip non-OpenAI fields that custom routers/proxies choke on
  if ('thinkingConfig' in payload && !params.profile.supportsThinkingConfig) {
    delete payload.thinkingConfig;
    strippedParameters.push('thinkingConfig');
  }
  if ('cache_control' in payload && !params.profile.supportsAnthropicCacheControl) {
    delete payload.cache_control;
    strippedParameters.push('cache_control');
  }
  if ('temperature' in payload && !params.profile.supportsTemperature) {
    delete payload.temperature;
    strippedParameters.push('temperature');
  }
  if ('top_p' in payload && !params.profile.supportsTemperature) {
    delete payload.top_p;
    strippedParameters.push('top_p');
  }

  // Reasoning models: convert max_tokens -> max_completion_tokens on native OpenAI & cap reasoning_effort
  if (
    params.profile.isReasoningModel &&
    params.profile.flavor === 'openai' &&
    'max_tokens' in payload
  ) {
    payload.max_completion_tokens = payload.max_tokens;
    delete payload.max_tokens;
    strippedParameters.push('max_tokens->max_completion_tokens');
  }

  const roleCap = resolveRoleReasoningCap(params.taskRole);
  if (params.profile.supportsReasoningEffort) {
    if (roleCap.openaiReasoningEffort) {
      payload.reasoning_effort = roleCap.openaiReasoningEffort;
    }
  } else if ('reasoning_effort' in payload) {
    delete payload.reasoning_effort;
    strippedParameters.push('reasoning_effort');
  }

  // JSON response_format with safe fallback from json_schema -> json_object on 9Router / custom proxies
  let responseFormatMode: SanitizedOpenAiPayloadResult['responseFormatMode'] = 'none';
  if (params.expectJson) {
    if (
      params.jsonSchema &&
      params.profile.supportsJsonSchema &&
      !params.forceDowngradeJsonFormat
    ) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'harness_semantic_section_ir',
          strict: false,
          schema: params.jsonSchema,
        },
      };
      responseFormatMode = 'json_schema';
    } else if (params.profile.supportsJsonObject && !params.forceDowngradeJsonFormat) {
      payload.response_format = { type: 'json_object' };
      responseFormatMode = 'json_object';
      if (params.jsonSchema && !params.profile.supportsJsonSchema) {
        strippedParameters.push('response_format.json_schema->json_object');
      }
    } else {
      delete payload.response_format;
      if (params.forceDowngradeJsonFormat) {
        strippedParameters.push('response_format');
      }
      responseFormatMode = 'none';
    }
  }

  return {
    payload,
    strippedParameters,
    responseFormatMode,
  };
}

// ============================================================================
// HTML / NON-JSON GATEWAY ERROR DETECTION & RETRYABLE VS FATAL CLASSIFICATION
// ============================================================================

export type ProviderErrorCategory = 'upstream_gateway_error' | 'retryable' | 'fatal';

export type ProviderErrorCode =
  | 'upstream_gateway_error'
  | 'rate_limited'
  | 'transient_upstream'
  | 'timeout'
  | 'fatal_auth_or_billing'
  | 'fatal_bad_request'
  | 'model_mismatch_downgrade';

export interface ProviderErrorClassification {
  category: ProviderErrorCategory;
  code: ProviderErrorCode;
  status: number;
  retryable: boolean;
  retryAfterMs: number | null;
  neverEnterPatchLoop: boolean;
  messageFa: string;
}

export class ProviderGatewayError extends Error {
  public readonly code: ProviderErrorCode;
  public readonly category: ProviderErrorCategory;
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly retryAfterMs: number | null;
  public readonly neverEnterPatchLoop: boolean;

  constructor(classification: ProviderErrorClassification) {
    super(classification.messageFa);
    this.name = 'ProviderGatewayError';
    this.code = classification.code;
    this.category = classification.category;
    this.status = classification.status;
    this.retryable = classification.retryable;
    this.retryAfterMs = classification.retryAfterMs;
    this.neverEnterPatchLoop = classification.neverEnterPatchLoop;
  }
}

export function isHtmlErrorPayload(contentType: string | null | undefined, bodyText: string): boolean {
  const ct = (contentType || '').toLowerCase();
  const sample = (bodyText || '').trim().slice(0, 600).toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) {
    return true;
  }
  if (
    sample.startsWith('<!doctype html') ||
    sample.startsWith('<html') ||
    sample.includes('<head>') ||
    sample.includes('cloudflare') && sample.includes('<title>') ||
    sample.includes('502 bad gateway') && sample.includes('<') ||
    sample.includes('504 gateway time-out') && sample.includes('<')
  ) {
    return true;
  }
  return false;
}

/**
 * Parses HTTP Retry-After header (seconds integer or HTTP-date) into milliseconds.
 */
export function parseRetryAfterHeaderMs(
  retryAfterHeader: string | null | undefined,
  nowMs = Date.now()
): number | null {
  const raw = (retryAfterHeader || '').trim();
  if (!raw) return null;
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(120_000, Math.round(asSeconds * 1000));
  }
  const parsedDate = Date.parse(raw);
  if (Number.isFinite(parsedDate)) {
    const diff = parsedDate - nowMs;
    return Math.min(120_000, Math.max(0, Math.round(diff)));
  }
  return null;
}

/**
 * Deterministic classifier separating HTML upstream gateway pages, Retryable (429/502/503/529),
 * and Fatal (400/401/402/403) responses.
 */
export function classifyProviderHttpResponse(params: {
  status: number;
  contentType?: string | null;
  bodyText: string;
  retryAfterHeader?: string | null;
  providerLabelFa?: string;
  nowMs?: number;
}): ProviderErrorClassification {
  const label = params.providerLabelFa || 'ارائه‌دهنده هوش مصنوعی';
  const retryAfterMs = parseRetryAfterHeaderMs(params.retryAfterHeader, params.nowMs);
  const htmlDetected = isHtmlErrorPayload(params.contentType, params.bodyText);

  if (htmlDetected) {
    const isTransientStatus =
      params.status === 502 || params.status === 503 || params.status === 504 || params.status === 529 || params.status === 429;
    return {
      category: 'upstream_gateway_error',
      code: 'upstream_gateway_error',
      status: params.status || 502,
      retryable: isTransientStatus,
      retryAfterMs,
      neverEnterPatchLoop: true,
      messageFa: `[upstream_gateway_error] درگاه ${label} به جای JSON یک صفحه خطای HTML برگرداند (کد ${params.status || 502} — احتمال اختلال Cloudflare/پروکسی). عملیات متوقف شد و وارد حلقه اصلاح جراحی نمی‌شود.`,
    };
  }

  // Fatal client/auth/billing errors -> immediate stop, ZERO retries
  if (params.status === 401 || params.status === 403) {
    return {
      category: 'fatal',
      code: 'fatal_auth_or_billing',
      status: params.status,
      retryable: false,
      retryAfterMs: null,
      neverEnterPatchLoop: true,
      messageFa: `خطای احراز هویت یا دسترسی در ${label} (کد ${params.status}): کلید API نامعتبر است یا مجوز این مدل را ندارد. اجرا فوراً متوقف شد.`,
    };
  }
  if (params.status === 402) {
    return {
      category: 'fatal',
      code: 'fatal_auth_or_billing',
      status: 402,
      retryable: false,
      retryAfterMs: null,
      neverEnterPatchLoop: true,
      messageFa: `اعتبار حساب کاربری در ${label} به پایان رسیده است (کد 402 Payment Required). اجرا فوراً متوقف شد.`,
    };
  }
  if (params.status === 400 || params.status === 404 || params.status === 422) {
    return {
      category: 'fatal',
      code: 'fatal_bad_request',
      status: params.status,
      retryable: false,
      retryAfterMs: null,
      neverEnterPatchLoop: true,
      messageFa: `درخواست نامعتبر یا مدل ناشناخته در ${label} (کد ${params.status}): ${params.bodyText.slice(0, 180)}`,
    };
  }

  // Retryable rate-limit or upstream overload
  if (params.status === 429) {
    return {
      category: 'retryable',
      code: 'rate_limited',
      status: 429,
      retryable: true,
      retryAfterMs,
      neverEnterPatchLoop: true,
      messageFa: `محدودیت نرخ درخواست (429 Rate Limit) در ${label}.${retryAfterMs ? ` مکث پیشنهادی سرور: ${Math.ceil(retryAfterMs / 1000)} ثانیه.` : ''}`,
    };
  }
  if (params.status === 502 || params.status === 503 || params.status === 504 || params.status === 529) {
    return {
      category: 'retryable',
      code: 'transient_upstream',
      status: params.status,
      retryable: true,
      retryAfterMs,
      neverEnterPatchLoop: true,
      messageFa: `شلوغی یا خطای موقت درگاه بالادستی ${label} (کد ${params.status}). قابل تلاش مجدد با Backoff.`,
    };
  }

  return {
    category: 'fatal',
    code: 'fatal_bad_request',
    status: params.status,
    retryable: false,
    retryAfterMs: null,
    neverEnterPatchLoop: true,
    messageFa: `خطای غیرمنتظره در ${label} (کد ${params.status}): ${params.bodyText.slice(0, 180)}`,
  };
}

/**
 * Exponential Backoff + Jitter honoring server Retry-After header when present.
 */
export function computeRetryBackoffDelayMs(params: {
  attempt: number; // 0-indexed retry attempt
  retryAfterMs?: number | null;
  baseDelayMs?: number;
  maxDelayMs?: number;
  randomFn?: () => number;
}): number {
  const base = Math.max(50, params.baseDelayMs ?? 600);
  const maxDelay = Math.max(base, params.maxDelayMs ?? 20_000);
  const rand = params.randomFn ?? Math.random;

  if (typeof params.retryAfterMs === 'number' && Number.isFinite(params.retryAfterMs) && params.retryAfterMs > 0) {
    const jitter = Math.round(rand() * 250);
    return Math.min(maxDelay, Math.round(params.retryAfterMs) + jitter);
  }

  const exp = Math.min(maxDelay, base * Math.pow(2, Math.max(0, params.attempt)));
  const jitter = Math.round(exp * (0.2 + rand() * 0.3));
  return Math.min(maxDelay, Math.round(exp * 0.75 + jitter));
}

// ============================================================================
// DETERMINISTIC 0-TOKEN JSON REPAIR (BEFORE SCHEMA REJECTION)
// ============================================================================

export interface JsonRepairResult<T = unknown> {
  ok: boolean;
  value: T | null;
  repaired: boolean;
  repairSteps: string[];
  error?: string;
}

function escapeRawControlCharsInsideJsonStrings(input: string): { text: string; changed: boolean } {
  let out = '';
  let inString = false;
  let escaped = false;
  let changed = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (ch === '\n') {
        out += '\\n';
        changed = true;
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        changed = true;
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        changed = true;
        continue;
      }
      if (code >= 0x00 && code <= 0x1f) {
        changed = true;
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return { text: out, changed };
}

function removeTrailingCommasOutsideStrings(input: string): { text: string; changed: boolean } {
  let out = '';
  let inString = false;
  let escaped = false;
  let changed = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      // Look ahead past whitespace for } or ]
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (j < input.length && (input[j] === '}' || input[j] === ']')) {
        changed = true;
        continue;
      }
    }
    out += ch;
  }
  return { text: out, changed };
}

function closeUnbalancedJsonDelimiters(input: string): { text: string; changed: boolean } {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      stack.push('}');
    } else if (ch === '[') {
      stack.push(']');
    } else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  let out = input;
  let changed = false;
  if (inString) {
    out += '"';
    changed = true;
  }
  if (stack.length > 0) {
    // Strip trailing comma if present before closing
    const trimmed = out.replace(/,\s*$/, '');
    if (trimmed !== out) out = trimmed;
    out += stack.reverse().join('');
    changed = true;
  }
  return { text: out, changed };
}

/**
 * Deterministic 0-token JSON repairer executed BEFORE declaring a schema failure.
 * Handles Markdown fences, leading/trailing chatter, smart quotes around keys, raw newlines/control chars
 * inside strings, trailing commas, and simple unclosed trailing braces/brackets.
 */
export function repairMalformedJsonDeterministic<T = Record<string, unknown>>(
  raw: string
): JsonRepairResult<T> {
  const repairSteps: string[] = [];
  const original = (raw || '').trim();
  if (!original) {
    return { ok: false, value: null, repaired: false, repairSteps, error: 'پاسخ خالی است.' };
  }

  // Fast path: already valid JSON
  try {
    const direct = JSON.parse(original) as T;
    if (direct !== null && typeof direct === 'object') {
      return { ok: true, value: direct, repaired: false, repairSteps };
    }
  } catch {
    // Continue to deterministic repair pipeline
  }

  let candidate = original;

  // 1. Strip UTF-8 BOM & Markdown code fences
  if (candidate.charCodeAt(0) === 0xfeff) {
    candidate = candidate.slice(1);
    repairSteps.push('strip_bom');
  }
  const fenceMatch = candidate.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    candidate = fenceMatch[1].trim();
    repairSteps.push('strip_markdown_fence');
  } else if (/^```(?:json|JSON)?/i.test(candidate)) {
    candidate = candidate.replace(/^```(?:json|JSON)?\s*/i, '').replace(/```\s*$/, '').trim();
    repairSteps.push('strip_unclosed_markdown_fence');
  }

  // 2. Slice outer JSON object/array boundaries if extra prose surrounds it
  const firstObj = candidate.indexOf('{');
  const firstArr = candidate.indexOf('[');
  const startIdx =
    firstObj >= 0 && firstArr >= 0 ? Math.min(firstObj, firstArr) : Math.max(firstObj, firstArr);
  if (startIdx > 0) {
    candidate = candidate.slice(startIdx);
    repairSteps.push('trim_leading_prose');
  }
  const isObj = candidate.startsWith('{');
  const lastClose = candidate.lastIndexOf(isObj ? '}' : ']');
  if (lastClose > 0 && lastClose < candidate.length - 1) {
    const trailing = candidate.slice(lastClose + 1).trim();
    // Only strip if trailing looks like prose (not unfinished JSON structure)
    if (trailing && !/^[,}\]]+$/.test(trailing)) {
      candidate = candidate.slice(0, lastClose + 1);
      repairSteps.push('trim_trailing_prose');
    }
  }

  // 3. Escape raw newlines/tabs/control chars inside string literals
  const ctrlRes = escapeRawControlCharsInsideJsonStrings(candidate);
  if (ctrlRes.changed) {
    candidate = ctrlRes.text;
    repairSteps.push('escape_control_chars_in_strings');
  }

  // 4. Remove trailing commas before } or ]
  const commaRes = removeTrailingCommasOutsideStrings(candidate);
  if (commaRes.changed) {
    candidate = commaRes.text;
    repairSteps.push('remove_trailing_commas');
  }

  try {
    const parsed = JSON.parse(candidate) as T;
    if (parsed !== null && typeof parsed === 'object') {
      return { ok: true, value: parsed, repaired: true, repairSteps };
    }
  } catch {
    // Try closing unbalanced quotes/braces
  }

  // 5. Close unbalanced quote / brackets / braces + re-clean trailing commas
  const closedRes = closeUnbalancedJsonDelimiters(candidate);
  if (closedRes.changed) {
    candidate = removeTrailingCommasOutsideStrings(closedRes.text).text;
    repairSteps.push('close_unbalanced_delimiters');
  }

  try {
    const parsed = JSON.parse(candidate) as T;
    if (parsed !== null && typeof parsed === 'object') {
      return { ok: true, value: parsed, repaired: true, repairSteps };
    }
  } catch (err) {
    return {
      ok: false,
      value: null,
      repaired: false,
      repairSteps,
      error: err instanceof Error ? err.message : 'JSON parsing failed after repair',
    };
  }

  return {
    ok: false,
    value: null,
    repaired: false,
    repairSteps,
    error: 'نتیجه JSON آبجکت یا آرایه معتبر نیست.',
  };
}

// ============================================================================
// SILENT MODEL-SWAP DETECTION (model_mismatch) & AUTHOR DOWNGRADE GUARD
// ============================================================================

export interface ModelMismatchEvaluation {
  mismatch: boolean;
  code: 'model_mismatch' | null;
  requestedModel: string;
  actualModel: string;
  requestedTierRank: number;
  actualTierRank: number;
  isDowngrade: boolean;
  shouldHalt: boolean;
  pricingModelId: string;
  warningFa?: string;
}

function normalizeModelComparableId(raw: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    // Strip provider prefix like "anthropic/", "openai/", "google/"
    .replace(/^[a-z0-9_-]+\//, '')
    // Strip common date snapshot suffixes (-20250805, -2025-04-14, -latest, :free)
    .replace(/(?:-20\d{2}[-]?\d{2}[-]?\d{2}|-latest|:free)$/i, '');
}

export function inferModelTierRank(modelId: string): number {
  const low = (modelId || '').toLowerCase();
  if (
    low.includes('opus') ||
    low.includes('fable-5') ||
    low.includes('gpt-6.2-astra') ||
    low.includes('gemini-4-carbon') ||
    low.includes('gemini-4-neon') ||
    low.includes('gemini-3.1-pro') ||
    low.includes('gemini-2.5-pro') ||
    low.includes('qwen4-max') ||
    /(?:^|\/|-)(?:o3|o1)(?:$|-)/.test(low) ||
    (low.includes('gpt-4.1') && !low.includes('mini') && !low.includes('nano'))
  ) {
    return 3; // Flagship
  }
  if (
    low.includes('sonnet') ||
    low.includes('gpt-6.2-sol') ||
    (low.includes('gpt-5') && !low.includes('mini') && !low.includes('nano')) ||
    low.includes('gemini-4-argon') ||
    low.includes('gemini-4-hydrogen') ||
    (low.includes('gpt-4o') && !low.includes('mini')) ||
    low.includes('deepseek-v4-pro') ||
    low.includes('deepseek-reasoner') ||
    low.includes('deepseek-r1') ||
    low.includes('grok-4.7') ||
    low.includes('o4-mini') ||
    low.includes('o3-mini')
  ) {
    return 2; // Balanced
  }
  return 1; // Economy / small
}

/**
 * Compares requested model vs actual response.model returned by API / 9Router.
 * Always computes pricing against actualModel and detects tier downgrades on harness_author.
 */
export function evaluateModelMismatch(params: {
  requestedModel: string;
  actualModel?: string | null;
  taskRole?: AiTaskType;
  haltOnAuthorDowngrade?: boolean;
}): ModelMismatchEvaluation {
  const requested = (params.requestedModel || '').trim();
  const actual = (params.actualModel || '').trim() || requested;
  const normReq = normalizeModelComparableId(requested);
  const normAct = normalizeModelComparableId(actual);

  const requestedRank = inferModelTierRank(requested);
  const actualRank = inferModelTierRank(actual);

  // Consider equivalent if normalized strings match OR one is a dated snapshot of the exact same model family
  const exactMatch =
    !normReq ||
    !normAct ||
    normReq === normAct ||
    (normAct.startsWith(`${normReq}-`) && actualRank === requestedRank) ||
    (normReq.startsWith(`${normAct}-`) && actualRank === requestedRank);

  if (exactMatch) {
    return {
      mismatch: false,
      code: null,
      requestedModel: requested,
      actualModel: actual,
      requestedTierRank: requestedRank,
      actualTierRank: actualRank,
      isDowngrade: false,
      shouldHalt: false,
      pricingModelId: actual,
    };
  }

  const reqPricing = lookupModelPricing(requested);
  const actPricing = lookupModelPricing(actual);
  const isDowngrade =
    actualRank < requestedRank ||
    (actualRank === requestedRank && actPricing.outputPerMillionUsd < reqPricing.outputPerMillionUsd * 0.55);

  const shouldHalt = Boolean(
    params.haltOnAuthorDowngrade && params.taskRole === 'harness_author' && isDowngrade
  );

  return {
    mismatch: true,
    code: 'model_mismatch',
    requestedModel: requested,
    actualModel: actual,
    requestedTierRank: requestedRank,
    actualTierRank: actualRank,
    isDowngrade,
    shouldHalt,
    pricingModelId: actual,
    warningFa: isDowngrade
      ? `هشدار تعویض بی‌صدای مدل (model_mismatch — افت رده): مدل درخواستی «${requested}» بود اما درگاه مدل پایین‌تر «${actual}» را اجرا کرد. هزینه با تعرفه مدل واقعی محاسبه شد.`
      : `هشدار تعویض مدل (model_mismatch): مدل درخواستی «${requested}» بود اما درگاه «${actual}» را برگرداند. هزینه با تعرفه مدل واقعی محاسبه شد.`,
  };
}

// ============================================================================
// STRICTLY FACTUAL CACHE & REASONING TOKEN TELEMETRY EXTRACTION
// ============================================================================

export interface RealCacheTelemetryResult {
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheTelemetryReported: boolean;
  displayLabelFa: string;
}

/**
 * Reads cache hit tokens EXCLUSIVELY from actual provider API usage fields:
 * - Anthropic: `cache_read_input_tokens`, `cache_creation_input_tokens`
 * - OpenAI / OpenRouter / 9Router: `prompt_tokens_details.cached_tokens`, `cached_tokens`
 * - Google Gemini: `cachedContentTokenCount`
 * NEVER guesses or substitutes synthetic numbers when fields are missing.
 */
export function extractRealCacheTelemetry(usageObj: Record<string, unknown> | null | undefined): RealCacheTelemetryResult {
  if (!usageObj || typeof usageObj !== 'object') {
    return {
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheTelemetryReported: false,
      displayLabelFa: 'گزارش‌نشده توسط ارائه‌دهنده',
    };
  }

  const promptDetails = (usageObj.prompt_tokens_details || usageObj.input_tokens_details) as
    | Record<string, unknown>
    | undefined;

  const hasAnthropicRead = typeof usageObj.cache_read_input_tokens === 'number';
  const hasAnthropicCreate = typeof usageObj.cache_creation_input_tokens === 'number';
  const hasOpenAiDetails = typeof promptDetails?.cached_tokens === 'number';
  const hasTopLevelCached = typeof usageObj.cached_tokens === 'number';
  const hasGeminiCached = typeof usageObj.cachedContentTokenCount === 'number';

  const reported =
    hasAnthropicRead || hasAnthropicCreate || hasOpenAiDetails || hasTopLevelCached || hasGeminiCached;

  if (!reported) {
    return {
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheTelemetryReported: false,
      displayLabelFa: 'گزارش‌نشده توسط ارائه‌دهنده',
    };
  }

  const cachedInputTokens = Math.max(
    0,
    Number(
      hasAnthropicRead
        ? usageObj.cache_read_input_tokens
        : hasOpenAiDetails
          ? promptDetails!.cached_tokens
          : hasTopLevelCached
            ? usageObj.cached_tokens
            : hasGeminiCached
              ? usageObj.cachedContentTokenCount
              : 0
    ) || 0
  );

  const cacheCreationInputTokens = Math.max(
    0,
    Number(hasAnthropicCreate ? usageObj.cache_creation_input_tokens : 0) || 0
  );

  return {
    cachedInputTokens,
    cacheCreationInputTokens,
    cacheTelemetryReported: true,
    displayLabelFa: `${cachedInputTokens} توکن کش‌شده (واقعی API)`,
  };
}

/**
 * Extracts factual reasoning / thinking tokens from Google, OpenAI, DeepSeek, or proxy usage objects.
 */
export function extractRealReasoningTokens(usageObj: Record<string, unknown> | null | undefined): number {
  if (!usageObj || typeof usageObj !== 'object') return 0;
  const completionDetails = usageObj.completion_tokens_details as Record<string, unknown> | undefined;
  const outputDetails = usageObj.output_tokens_details as Record<string, unknown> | undefined;

  const candidates = [
    usageObj.thoughtsTokenCount,
    completionDetails?.reasoning_tokens,
    outputDetails?.reasoning_tokens,
    usageObj.reasoning_tokens,
    usageObj.thinking_tokens,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
      return Math.round(c);
    }
  }
  return 0;
}
