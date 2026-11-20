import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createProjectRouter } from './src/server/projectRoutes.ts';
import { attachLiveVoiceWebSocket } from './src/server/liveVoiceBridge.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

const THINKING_LEVEL_MAP: Record<string, ThinkingLevel> = {
  LOW: ThinkingLevel.LOW,
  MEDIUM: ThinkingLevel.MEDIUM,
  HIGH: ThinkingLevel.HIGH,
  XHIGH: ThinkingLevel.XHIGH,
  MINIMAL: ThinkingLevel.MINIMAL,
};

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'کلید API هوش مصنوعی (GEMINI_API_KEY) در تنظیمات محیط سرور (Settings > Secrets) تنظیم نشده است.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

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
  app.use('/api/projects', createProjectRouter());

  app.get('/api/ai/status', (_req, res) => {
    const configured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );
    res.json({
      configured,
      defaultModel: 'gemini-4-hydrogen',
      defaultThinkingLevel: 'HIGH',
      models: [
        {
          id: 'gemini-4-hydrogen',
          name: 'Gemini 4 Hydrogen (هیدروژن)',
          description: 'مدل پیش‌فرض قدرتمند برای تحلیل عمیق، فصل‌بندی موضوعی، ادغام تکرارها و تولید جداول و نمودارها',
          supportsThinkingLevels: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH'],
          recommended: true,
        },
        {
          id: 'gemini-3.1-flash-lite',
          name: 'Gemini 3.1 Flash Lite (سریع)',
          description: 'پردازش بسیار سریع و سبک برای فایل‌های کوتاه و ساختارهای ساده',
          supportsThinkingLevels: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
          recommended: false,
        },
      ],
    });
  });

  app.post('/api/ai/analyze', async (req, res) => {
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
      };

      const requestedModel = body.model && ALLOWED_MODELS.has(body.model)
        ? body.model
        : 'gemini-4-hydrogen';

      const rawLevel = (body.thinkingLevel || 'HIGH').toUpperCase();
      let resolvedLevel = THINKING_LEVEL_MAP[rawLevel] ?? ThinkingLevel.HIGH;
      if (requestedModel === 'gemini-4-hydrogen' && resolvedLevel === ThinkingLevel.MINIMAL) {
        resolvedLevel = ThinkingLevel.LOW;
      }
      if (requestedModel === 'gemini-3.1-flash-lite' && resolvedLevel === ThinkingLevel.XHIGH) {
        resolvedLevel = ThinkingLevel.HIGH;
      }

      const catalog = Array.isArray(body.sectionCatalog) ? body.sectionCatalog.slice(0, 120) : [];
      if (catalog.length === 0) {
        res.status(400).json({ error: 'هیچ بخش قابل تحلیلی برای پردازش ارسال نشده است.' });
        return;
      }

      const ai = createGeminiClient();

      const promptPayload = {
        bookTitle: body.bookTitle || 'سند یکپارچه',
        sourceFiles: body.sourceFiles || [],
        totalSections: catalog.length,
        generateTablesAndDiagrams: body.generateTablesAndDiagrams !== false,
        sections: catalog,
      };

      const systemInstruction = [
        'شما یک سردبیر ارشد فنی و معمار مستندات فارسی هستید.',
        'وظیفه شما تحلیل فهرست بخش‌های یک یا چند فایل ورودی و ارائه طرح یکپارچه‌سازی بدون حذف هیچ مفهوم علمی یا فنی است.',
        'قوانین قطعی:',
        '۱. تمام خروجی‌ها باید به زبان فارسی استاندارد، روان و با نیم‌فاصله صحیح باشد.',
        '۲. هر sectionId موجود در ورودی باید دقیقاً در یکی از فصل‌های thematicChapters قرار گیرد تا هیچ مفهومی حذف نشود.',
        '۳. اگر موضوع واحدی به شکل پراکنده در چند فایل یا چند بخش تکرار شده، آن‌ها را در یک فصل موضوعی منسجم تجمیع کرده و در semanticDuplicates گزارش دهید.',
        '۴. اگر generateTablesAndDiagrams فعال است، ۳ تا ۶ جدول مقایسه‌ای/خلاصه واقعی (generatedTables) با داده‌های دقیقِ برگرفته از متن و ۳ تا ۵ نمودار/فلوچارت آموزشی واقعی (generatedDiagrams) برای درج مستقیم در فایل ورد تولید کنید.',
        '۵. در generatedDiagrams برای هر نمودار بین ۳ تا ۶ آیتم (label کوتاه فارسی، detail توضیح مختصر، و value عددی در صورت مقایسه) تولید کنید.',
      ].join('\n');

      const response = await runWithRetry(() =>
        ai.models.generateContent({
          model: requestedModel,
          contents: `این ساختار و چکیده بخش‌های فایل‌های ورودی است. لطفاً تحلیل کامل یکپارچه‌سازی، فصل‌بندی موضوعی، تشخیص تکرارها و تولید جداول و نمودارهای آموزشی را در قالب JSON برگردان:\n\n${JSON.stringify(promptPayload)}`,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: ANALYSIS_RESPONSE_SCHEMA,
            thinkingConfig: {
              thinkingLevel: resolvedLevel,
            },
          },
        })
      );

      const rawJson = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawJson);

      res.json({
        ok: true,
        model: requestedModel,
        thinkingLevel: rawLevel,
        analyzedAt: new Date().toISOString(),
        analysis: parsed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطای ناشناخته در ارتباط با سرویس هوش مصنوعی.';
      const status = (err as { status?: number })?.status;
      if (status === 403 || status === 400 || message.includes('API_KEY')) {
        res.status(status === 403 ? 403 : 400).json({
          error: `خطای احراز هویت یا کلید API هوش مصنوعی: ${message} — لطفاً کلید API را در بخش Settings > Secrets بررسی کنید.`,
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
        error: message,
      });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  const server = http.createServer(app);
  attachLiveVoiceWebSocket(server);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
