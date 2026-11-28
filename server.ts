import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from '@google/genai';
import { createProjectRouter } from './src/server/projectRoutes.ts';
import { attachLiveVoiceWebSocket } from './src/server/liveVoiceBridge.ts';
import {
  generateUnifiedTextOrJson,
  resolveAiProviderFromRequest,
  resolveThinkingLevelForGoogleModel,
} from './src/server/aiProvider.ts';
import {
  GOOGLE_MODEL_OPTIONS,
  normalizeGoogleModelId,
} from './src/lib/aiProviderConfig.ts';
import { issueGuestSession } from './src/server/guestSession.ts';
import { getOrCreateUser } from './src/db/repository.ts';
import { resolveServerBindConfig } from './src/server/serverBindConfig.ts';
import { requireAuth } from './src/middleware/auth.ts';
import { buildUniversalSystemPromptBlock } from './src/lib/universalSystemPrompt.ts';
import {
  createAuthCapabilitiesRouter,
  createAutomotiveGatekeeperRouter,
  createMasterEncyclopediaAdminRouter,
  registerMasterEncyclopediaWorkerProcessor,
} from './src/server/masterEncyclopediaRoutes.ts';
import {
  startMasterIngestWorker,
  stopMasterIngestWorker,
} from './src/server/masterIngestWorker.ts';
import { runEncyclopediaIsolated } from './src/lib/masterEncyclopedia/featureFlag.ts';
import { createCollaborationRouter } from './src/server/collaborationRoutes.ts';
import { requirePersonalOutputEnabled } from './src/middleware/personalOutputGuard.ts';
import { checkGuestUploadRateLimit } from './src/lib/masterEncyclopedia/automotiveGatekeeper.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const retryable = status === 429 || status === 500 || status === 503 || status === 504;
      if (!retryable || attempt === maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

const ANALYSIS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    unifiedTitle: {
      type: Type.STRING,
      description: 'عنوان جامع و حرفه‌ای فارسی برای سند یکپارچه‌شده نهایی',
    },
    unifiedSubtitle: {
      type: Type.STRING,
      description: 'زیرعنوان توضیحی کوتاه و دقیق فارسی برای روی جلد سند',
    },
    executiveSummary: {
      type: Type.STRING,
      description: 'خلاصه شفاف و فارسی از تحلیل محتوا، فصل‌بندی، ادغام تکرارها و بهبودهای انجام‌شده',
    },
    thematicChapters: {
      type: Type.ARRAY,
      description: 'فصل‌بندی موضوعی پیشنهادی برای تجمیع مباحث پراکنده از همه فایل‌های ورودی',
      items: {
        type: Type.OBJECT,
        properties: {
          chapterTitle: { type: Type.STRING },
          topicSummary: { type: Type.STRING },
          sectionIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      },
    },
    semanticDuplicates: {
      type: Type.ARRAY,
      description: 'مباحث تکراری یا هم‌پوشان شناسایی‌شده در فایل‌ها همراه با مفاهیم حفظ‌شده',
      items: {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING },
          canonicalSectionId: { type: Type.STRING },
          redundantSectionIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          mergeRationale: { type: Type.STRING },
          preservedConcepts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      },
    },
    generatedTables: {
      type: Type.ARRAY,
      description: 'جداول مقایسه‌ای یا خلاصه مهندسی واقعی تولیدشده از متن برای درج مستقیم در سند ورد',
      items: {
        type: Type.OBJECT,
        properties: {
          targetChapterTitle: { type: Type.STRING },
          caption: { type: Type.STRING },
          rationale: { type: Type.STRING },
          headers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          rows: {
            type: Type.ARRAY,
            items: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
        },
      },
    },
    generatedDiagrams: {
      type: Type.ARRAY,
      description: 'نمودارها، فلوچارت‌ها یا معماری‌های آموزشی واقعی با برچسب‌های فارسی برای رسم تصویری و درج در ورد',
      items: {
        type: Type.OBJECT,
        properties: {
          targetChapterTitle: { type: Type.STRING },
          kind: {
            type: Type.STRING,
            description: 'یکی از: flowchart | comparison_bars | architecture | process_steps',
          },
          title: { type: Type.STRING },
          caption: { type: Type.STRING },
          rationale: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                detail: { type: Type.STRING },
                value: { type: Type.NUMBER },
                group: { type: Type.STRING },
              },
            },
          },
        },
      },
    },
  },
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));

  app.post('/api/auth/guest', async (req, res) => {
    try {
      const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
        : '';
      const clientIp = forwardedFor || req.socket.remoteAddress || 'unknown';
      const rate = checkGuestUploadRateLimit(`guest-session-ip:${clientIp}`, 30, 60 * 60 * 1000);
      if (!rate.allowed) {
        res.status(429).json({
          error: `تعداد درخواست ایجاد نشست مهمان بیش از حد مجاز است. لطفاً پس از ${rate.retryAfterSeconds} ثانیه دوباره تلاش کنید.`,
        });
        return;
      }

      const session = issueGuestSession();
      await getOrCreateUser(session.uid, session.email, session.displayName, null);
      res.status(201).json(session);
    } catch (err) {
      console.error('Failed to issue guest session:', err);
      res.status(500).json({ error: 'خطا در ایجاد نشست مهمان. لطفاً دوباره تلاش کنید.' });
    }
  });

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use('/api/auth', createAuthCapabilitiesRouter());
  app.use('/api/automotive', createAutomotiveGatekeeperRouter());
  app.use('/api/admin/encyclopedia', createMasterEncyclopediaAdminRouter());
  app.use('/api/collab', createCollaborationRouter());
  app.use('/api/projects', createProjectRouter());

  app.get('/api/ai/status', (_req, res) => {
    const configured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );
    res.json({
      configured,
      defaultModel: 'gemini-4-hydrogen',
      defaultThinkingLevel: 'HIGH',
      models: GOOGLE_MODEL_OPTIONS.map((m, idx) => ({
        id: m.id,
        name: m.labelFa,
        description: m.descriptionFa,
        supportsThinkingLevels: m.supportsXHigh
          ? ['LOW', 'MEDIUM', 'HIGH', 'XHIGH']
          : ['LOW', 'MEDIUM', 'HIGH'],
        recommended: idx === 0,
      })),
    });
  });

  app.post('/api/ai/analyze', requireAuth, requirePersonalOutputEnabled, async (req, res) => {
    try {
      const body = req.body as {
        model?: string;
        thinkingLevel?: string;
        sourceFiles?: string[];
        bookTitle?: string;
        sectionCatalog?: Array<{
          sectionId: string;
          chapterNumber: number;
          chapterTitle: string;
          sourceFile: string;
          title: string;
          excerpt: string;
          wordCount: number;
        }>;
        generateTablesAndDiagrams?: boolean;
        generateTables?: boolean;
        generateDiagrams?: boolean;
      };

      const requestedModel = normalizeGoogleModelId(body.model);
      const rawLevel = (body.thinkingLevel || 'HIGH').toUpperCase();
      const resolvedLevel = resolveThinkingLevelForGoogleModel(requestedModel, rawLevel);

      const catalog = Array.isArray(body.sectionCatalog) ? body.sectionCatalog.slice(0, 120) : [];
      if (catalog.length === 0) {
        res.status(400).json({ error: 'هیچ بخش قابل تحلیلی برای پردازش ارسال نشده است.' });
        return;
      }

      const provider = resolveAiProviderFromRequest(req);
      const allowTables =
        body.generateTables !== undefined
          ? Boolean(body.generateTables)
          : body.generateTablesAndDiagrams !== false;
      const allowDiagrams =
        body.generateDiagrams !== undefined
          ? Boolean(body.generateDiagrams)
          : body.generateTablesAndDiagrams !== false;

      const promptPayload = {
        bookTitle: body.bookTitle || 'سند یکپارچه',
        sourceFiles: body.sourceFiles || [],
        totalSections: catalog.length,
        generateTables: allowTables,
        generateDiagrams: allowDiagrams,
        sections: catalog,
      };

      const systemInstruction = [
        'شما یک سردبیر ارشد فنی و معمار کتاب‌های آموزشی فارسی هستید.',
        'وظیفه شما تحلیل فهرست بخش‌های یک یا چند فایل ورودی و ارائه طرح یکپارچه‌سازی بدون حذف هیچ مفهوم علمی یا فنی است.',
        buildUniversalSystemPromptBlock({ mode: 'analysis' }),
        'قوانین قطعی ساختار خروجی:',
        '۱. تمام خروجی‌ها باید به زبان فارسی رسمی، شیرین، روان، بدون کلمات قلمبه‌سلمبه و با نیم‌فاصله صحیح باشد.',
        '۲. هر sectionId موجود در ورودی باید دقیقاً در یکی از فصل‌های thematicChapters قرار گیرد تا هیچ مفهومی حذف نشود و ترتیب فصل‌ها از پیش‌نیازهای پایه (شروع از صفر) به مباحث پیشرفته باشد.',
        '۳. اگر موضوع واحدی به شکل پراکنده در چند فایل یا چند بخش تکرار شده، آن‌ها را در یک فصل موضوعی منسجم تجمیع کرده و در semanticDuplicates گزارش دهید.',
        allowTables
          ? '۴. فقط در صورت وجود داده‌های مقایسه‌ای یا پارامتری واقعی در متن، ۲ تا ۵ جدول خلاصه/مقایسه‌ای (generatedTables) بدون جعل عدد یا آدرس هگز تولید کنید.'
          : '۴. آرایه generatedTables را حتماً خالی ([]) برگردانید و هیچ جدولی تولید نکنید.',
        allowDiagrams
          ? '۵. فقط برای مفاهیم فرآیندی یا ساختاری واقعی در متن، ۲ تا ۴ نمودار آموزشی (generatedDiagrams) با ۳ تا ۶ آیتم (و فقط در صورت وجود عدد واقعی در متن مقدار value) تولید کنید.'
          : '۵. آرایه generatedDiagrams را حتماً خالی ([]) برگردانید و هیچ نموداری تولید نکنید.',
      ].join('\n');

      const result = await runWithRetry(() =>
        generateUnifiedTextOrJson({
          provider,
          googleModel: requestedModel,
          thinkingLevel: resolvedLevel,
          systemInstruction,
          prompt: `این ساختار و چکیده بخش‌های فایل‌های ورودی است. لطفاً تحلیل کامل یکپارچه‌سازی، فصل‌بندی موضوعی و تشخیص تکرارها را در قالب JSON معتبر برگردان:\n\n${JSON.stringify(promptPayload)}`,
          expectJson: true,
          googleResponseSchema: ANALYSIS_RESPONSE_SCHEMA,
        })
      );

      const rawJson = (result.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawJson) as Record<string, unknown>;
      } catch {
        const firstBrace = rawJson.indexOf('{');
        const lastBrace = rawJson.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          try {
            parsed = JSON.parse(rawJson.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
          } catch {
            res.status(502).json({ error: 'پاسخ JSON دریافتی از مدل هوش مصنوعی ناقص یا نامعتبر بود. لطفاً مجدداً تلاش کنید.' });
            return;
          }
        } else {
          res.status(502).json({ error: 'پاسخ JSON دریافتی از مدل هوش مصنوعی ناقص یا نامعتبر بود. لطفاً مجدداً تلاش کنید.' });
          return;
        }
      }

      if (!allowTables) parsed.generatedTables = [];
      if (!allowDiagrams) parsed.generatedDiagrams = [];

      res.json({
        ok: true,
        model: result.modelUsed,
        thinkingLevel: resolvedLevel,
        analyzedAt: new Date().toISOString(),
        analysis: parsed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      const status = (err as { status?: number })?.status;
      console.error('[server] POST /api/ai/analyze error:', err);
      if (status === 403 || status === 400 || message.includes('API_KEY')) {
        res.status(status === 403 ? 403 : 400).json({
          error:
            'خطای احراز هویت یا پیکربندی کلید API هوش مصنوعی — لطفاً تنظیمات کلید API را در بخش Settings > Secrets بررسی کنید.',
        });
        return;
      }
      if (status === 429) {
        res.status(429).json({
          error: 'سهمیه فراخوانی هوش مصنوعی تکمیل شده است (کد ۴۲۹). لحظاتی بعد دوباره تلاش کنید یا کلید دارای سهمیه بیشتر در Settings > Secrets انتخاب کنید.',
        });
        return;
      }
      res.status(503).json({
        error: 'سرویس تحلیل هوشمند موقتاً در دسترس نیست. لطفاً چند لحظه بعد دوباره تلاش کنید.',
      });
    }
  });

  const { port, host, isProd, disableHmr } = resolveServerBindConfig();
  const server = http.createServer(app);
  attachLiveVoiceWebSocket(server);

  let viteServer: { close: () => Promise<void> } | null = null;

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = disableHmr || process.env.ENABLE_HMR !== 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : true,
        watch: hmrDisabled ? null : undefined,
      },
      appType: 'spa',
    });
    viteServer = vite;
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.on('error', (err) => {
    console.error(`HTTP server failed to bind ${host}:${port}:`, err);
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopMasterIngestWorker();
    const forceTimer = setTimeout(() => process.exit(0), 2000);
    forceTimer.unref();
    Promise.resolve(viteServer?.close())
      .catch(() => undefined)
      .finally(() => {
        server.close(() => process.exit(0));
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  process.on('unhandledRejection', (reason) => {
    console.error('[server] Unhandled promise rejection (kept alive):', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[server] Uncaught exception:', err);
    if ((err as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
      process.exit(1);
    }
  });

  server.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}`);
    // Initialize Master Encyclopedia background worker after HTTP server is ready
    void runEncyclopediaIsolated(
      'worker-bootstrap',
      async () => {
        registerMasterEncyclopediaWorkerProcessor();
        startMasterIngestWorker(15000);
        return true;
      },
      false
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
