import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_PROVIDER_METADATA,
  DEFAULT_AI_PROVIDER_CONFIG,
  formatFriendlyProviderErrorFa,
  resolveCapabilityRoutingPlan,
  validateCustomBaseUrl,
} from './aiProviderConfig.ts';

test('formatFriendlyProviderErrorFa cleanly converts raw Gemini 503 UNAVAILABLE JSON into readable Persian', () => {
  const rawScreenshotError = new Error(
    '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}'
  );
  const formatted = formatFriendlyProviderErrorFa(rawScreenshotError, 'Gemini', 'creator');

  assert.equal(formatted.status, 'busy');
  assert.equal(formatted.isTransientBusy, true);
  assert.ok(formatted.statusLabelFa.includes('503'));
  assert.ok(!formatted.detailFa.includes('{'), 'Friendly detail must NEVER leak raw JSON braces');
  assert.ok(!formatted.detailFa.includes('UNAVAILABLE'), 'Friendly detail must be natural Persian');
  assert.ok(formatted.detailFa.includes('ترافیک بالا'));
});

test('formatFriendlyProviderErrorFa handles 429 quota, 401 invalid key, and 404 model not found', () => {
  const q = formatFriendlyProviderErrorFa(new Error('429 RESOURCE_EXHAUSTED'), 'Gemini', 'creator');
  assert.equal(q.status, 'exhausted');
  assert.equal(q.isTransientBusy, false);

  const auth = formatFriendlyProviderErrorFa(new Error('401 authentication_error'), 'Anthropic', 'personal');
  assert.equal(auth.status, 'invalid_key');

  const nf = formatFriendlyProviderErrorFa(new Error('404 NOT_FOUND'), 'OpenAI', 'personal');
  assert.equal(nf.status, 'error');
  assert.ok(nf.statusLabelFa.includes('404'));
});

test('Anthropic presets expose Claude Opus 4.1, Claude Opus 4, and Claude Sonnet 4', () => {
  const presets = AI_PROVIDER_METADATA.anthropic.presets || [];
  const modelIds = presets.map((p) => p.modelId);
  assert.ok(modelIds.includes('claude-opus-4-1-20250805'), 'Must include Claude Opus 4.1');
  assert.ok(modelIds.includes('claude-opus-4-20250514'), 'Must include Claude Opus 4');
  assert.ok(modelIds.includes('claude-sonnet-4-20250514'), 'Must include Claude Sonnet 4');
});

test('resolveCapabilityRoutingPlan supports 3-slot hybrid routing (Claude Opus + Perplexity Sonar + Groq Whisper)', () => {
  const hybridConfig = {
    ...DEFAULT_AI_PROVIDER_CONFIG,
    provider: 'anthropic' as const,
    providers: {
      ...DEFAULT_AI_PROVIDER_CONFIG.providers,
      anthropic: {
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant-test',
        modelId: 'claude-opus-4-1-20250805',
      },
    },
    webSearchRoute: {
      provider: 'perplexity_sonar' as const,
      baseUrl: 'https://api.perplexity.ai',
      apiKey: 'pplx-test',
      modelId: 'sonar-pro',
    },
    audioRoute: {
      provider: 'groq_whisper' as const,
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'gsk-test',
      modelId: 'whisper-large-v3-turbo',
    },
  };

  const plan = resolveCapabilityRoutingPlan(hybridConfig, 'gemini-4-hydrogen');
  assert.equal(plan.isHybrid, true);
  assert.ok(plan.primaryLabelFa.includes('claude-opus-4-1-20250805'));
  assert.ok(plan.webSearchLabelFa.includes('Perplexity'));
  assert.ok(plan.webSearchLabelFa.includes('sonar-pro'));
  assert.ok(plan.audioLabelFa.includes('Groq Whisper'));
  assert.ok(plan.audioLabelFa.includes('whisper-large-v3-turbo'));
});

test('validateCustomBaseUrl accepts public HTTPS search/audio gateways and rejects private/HTTP SSRF URLs', () => {
  assert.equal(validateCustomBaseUrl('https://api.perplexity.ai').valid, true);
  assert.equal(validateCustomBaseUrl('https://api.groq.com/openai/v1').valid, true);
  assert.equal(validateCustomBaseUrl('https://api.anthropic.com/v1').valid, true);
  assert.equal(validateCustomBaseUrl('http://api.openai.com/v1').valid, false);
  assert.equal(validateCustomBaseUrl('https://localhost:8080/v1').valid, false);
  assert.equal(validateCustomBaseUrl('https://169.254.169.254/latest').valid, false);
  assert.equal(validateCustomBaseUrl('https://127.0.0.1/v1').valid, false);
});
