import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { type FunctionDeclaration, Modality, Type } from '@google/genai';
import crypto from 'node:crypto';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getProjectBundle } from '../db/repository.ts';
import { getPlatformSettings, recordTokenLedgerDelta } from '../db/collaborationRepository.ts';
import { createGeminiClient } from './projectRoutes.ts';
import { isGuestBearerToken, verifyGuestToken } from './guestSession.ts';

const LIVE_VOICE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'insert_dictated_paragraph',
    description: 'ثبت متن دیکته‌شده توسط کاربر در یک فصل مشخص از سند.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل مقصد از ساختار سند' },
        text: { type: Type.STRING, description: 'متن فارسی تمیز و ویراستاری‌شده برای درج در سند' },
      },
      required: ['nodeId', 'text'],
    },
  },
  {
    name: 'add_callout_box',
    description: 'ایجاد یک باکس نکته یا هشدار در یک فصل مشخص.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل مقصد' },
        variant: { type: Type.STRING, description: 'concept | warning | engineering | project' },
        title: { type: Type.STRING, description: 'عنوان باکس نکته' },
        body: { type: Type.STRING, description: 'متن داخل باکس' },
      },
      required: ['nodeId', 'title', 'body'],
    },
  },
  {
    name: 'rename_chapter',
    description: 'تغییر عنوان یکی از فصل‌های سند.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل' },
        newTitle: { type: Type.STRING, description: 'عنوان جدید فصل' },
      },
      required: ['nodeId', 'newTitle'],
    },
  },
];

const MAX_WS_PAYLOAD_BYTES = 256 * 1024;
const MAX_AUDIO_BASE64_CHARS = 200_000;
const MAX_TEXT_CHARS = 8_000;
const AUTH_TIMEOUT_MS = 10_000;
const WS_RATE_WINDOW_MS = 10_000;
const WS_MAX_MESSAGES_PER_WINDOW = 120;

export function isAllowedWsOrigin(
  originHeader: string | undefined,
  headersOrHost?: string | Record<string, string | string[] | undefined>
): boolean {
  if (!originHeader) return true;
  try {
    const originUrl = new URL(originHeader);
    const originHost = originUrl.host.toLowerCase();
    if (
      originUrl.hostname === 'localhost' ||
      originUrl.hostname === '127.0.0.1' ||
      originUrl.hostname === '::1'
    ) {
      return true;
    }

    const allowedHosts = new Set<string>();
    if (typeof headersOrHost === 'string') {
      if (headersOrHost.trim()) allowedHosts.add(headersOrHost.trim().toLowerCase());
    } else if (headersOrHost && typeof headersOrHost === 'object') {
      const addHeaderHosts = (val: string | string[] | undefined) => {
        if (!val) return;
        const raw = Array.isArray(val) ? val.join(',') : val;
        for (const part of raw.split(',')) {
          const clean = part.trim().toLowerCase();
          if (clean) allowedHosts.add(clean);
        }
      };
      addHeaderHosts(headersOrHost.host);
      addHeaderHosts(headersOrHost['x-forwarded-host']);
    }

    if (allowedHosts.has(originHost)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function attachLiveVoiceWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });
  wss.on('error', (err) => {
    console.error('Live voice WebSocket server error:', err);
  });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== '/ws/live') {
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  server.once('close', () => {
    try {
      wss.close();
    } catch {
      // ignore close errors during shutdown
    }
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (!isAllowedWsOrigin(originHeader, req.headers)) {
      ws.close(1008, 'Origin not allowed');
      return;
    }

    let liveSession: Awaited<ReturnType<NonNullable<ReturnType<typeof createGeminiClient>>['live']['connect']>> | null =
      null;
    let authenticated = false;
    let startingSession = false;
    const recentMessageTimestamps: number[] = [];

    const closeLiveSession = () => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore close errors
        }
        liveSession = null;
      }
      authenticated = false;
      startingSession = false;
    };

    const sendJson = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    const authTimer = setTimeout(() => {
      if (!authenticated && !startingSession) {
        sendJson({ type: 'error', message: 'زمان احراز هویت اتصال صوتی به پایان رسید.' });
        ws.close(1008, 'Auth timeout');
      }
    }, AUTH_TIMEOUT_MS);
    authTimer.unref?.();

    ws.on('message', async (raw) => {
      const nowMs = Date.now();
      while (
        recentMessageTimestamps.length > 0 &&
        nowMs - recentMessageTimestamps[0] > WS_RATE_WINDOW_MS
      ) {
        recentMessageTimestamps.shift();
      }
      if (recentMessageTimestamps.length >= WS_MAX_MESSAGES_PER_WINDOW) {
        sendJson({ type: 'error', message: 'تعداد پیام‌های صوتی بیش از حد مجاز است. لحظه‌ای صبر کنید.' });
        return;
      }
      recentMessageTimestamps.push(nowMs);

      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          token?: string;
          projectId?: string;
          targetNodeId?: string;
          data?: string;
          text?: string;
        };

        if (msg.type === 'start') {
          if (startingSession) {
            return;
          }
          if (liveSession) {
            closeLiveSession();
          }
          startingSession = true;

          if (!msg.token) {
            startingSession = false;
            sendJson({ type: 'error', message: 'توکن احراز هویت برای اتصال صوتی ارسال نشده است.' });
            ws.close(1008, 'Missing token');
            return;
          }

          let uid: string;
          if (isGuestBearerToken(msg.token)) {
            const guest = verifyGuestToken(msg.token);
            if (!guest) {
              startingSession = false;
              sendJson({ type: 'error', message: 'نشست مهمان برای اتصال صوتی منقضی یا نامعتبر است.' });
              ws.close(1008, 'Invalid guest token');
              return;
            }
            uid = guest.uid;
          } else {
            try {
              const decoded = await adminAuth.verifyIdToken(msg.token);
              uid = decoded.uid;
            } catch {
              startingSession = false;
              sendJson({ type: 'error', message: 'احراز هویت جلسه صوتی نامعتبر یا منقضی است.' });
              ws.close(1008, 'Invalid auth token');
              return;
            }
          }

          clearTimeout(authTimer);

          const platformSettings = await getPlatformSettings();
          if (!platformSettings.enableUserPersonalOutput) {
            await recordTokenLedgerDelta({ zeroTokenBlockedPersonalCalls: 1 }).catch(() => undefined);
            startingSession = false;
            sendJson({
              type: 'error',
              message:
                'مسیر پردازش و دستیار شخصی هم‌اکنون توسط مالک غیرفعال است (صفر مصرف توکن برای خروجی شخصی).',
            });
            ws.close(1008, 'Personal output disabled');
            return;
          }

          const ai = createGeminiClient();
          if (!ai) {
            startingSession = false;
            sendJson({ type: 'error', message: 'کلید API هوش مصنوعی در تنظیمات سرور تنظیم نشده است.' });
            ws.close(1011, 'Missing AI key');
            return;
          }

          let contextSummary = 'کاربر هنوز پروژه‌ای باز نکرده است.';
          if (msg.projectId) {
            const bundle = await getProjectBundle(msg.projectId, uid);
            if (bundle) {
              const outlineSummary = bundle.outlineNodes.map((n) => ({
                id: n.id,
                order: n.nodeOrder,
                title: n.title,
              }));
              const conflictsSummary = bundle.conflicts.map((c) => ({
                topic: c.topic,
                fileA: c.fileAName,
                fileB: c.fileBName,
                status: c.status,
              }));
              contextSummary = JSON.stringify({
                projectTitle: bundle.project.title,
                selectedDictationNodeId: msg.targetNodeId || outlineSummary[0]?.id || '',
                chapters: outlineSummary,
                conflicts: conflictsSummary,
              });
            }
          }

          const systemInstruction = [
            'شما دستیار ویرایش صوتی زنده «استودیو تدوین و صفحه‌آرایی بدون افت» هستید و به زبان فارسی روان، طبیعی و کوتاه صحبت می‌کنید.',
            'کاربر می‌تواند درباره فصل‌ها و تناقض‌ها بپرسد یا متن جدیدی برای درج در سند دیکته کند.',
            'هر زمان کاربر خواست متنی را دیکته کند، باکس نکته اضافه کند یا نام فصلی را عوض کند، ابزار مناسب را فراخوانی کن و به فارسی کوتاه تأیید بده.',
            `اطلاعات سند فعلی کاربر:\n${contextSummary}`,
          ].join('\n');

          liveSession = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              systemInstruction,
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              tools: [{ functionDeclarations: LIVE_VOICE_TOOLS }],
            },
            callbacks: {
              onopen: () => {
                authenticated = true;
                startingSession = false;
                sendJson({ type: 'ready' });
              },
              onmessage: (serverMsg) => {
                const parts = serverMsg.serverContent?.modelTurn?.parts || [];
                for (const part of parts) {
                  if (part.inlineData?.data) {
                    sendJson({
                      type: 'audio',
                      data: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                    });
                  }
                }

                if (serverMsg.serverContent?.inputTranscription?.text) {
                  sendJson({
                    type: 'input_transcript',
                    text: serverMsg.serverContent.inputTranscription.text,
                  });
                }
                if (serverMsg.serverContent?.outputTranscription?.text) {
                  sendJson({
                    type: 'output_transcript',
                    text: serverMsg.serverContent.outputTranscription.text,
                  });
                }
                if (serverMsg.serverContent?.interrupted) {
                  sendJson({ type: 'interrupted' });
                }
                if (serverMsg.serverContent?.turnComplete) {
                  sendJson({ type: 'turn_complete' });
                }

                const calls = serverMsg.toolCall?.functionCalls || [];
                if (calls.length > 0 && liveSession) {
                  const responses = [];
                  for (const call of calls) {
                    const args = (call.args || {}) as Record<string, unknown>;
                    sendJson({
                      type: 'proposal',
                      proposal: {
                        id: `vprop_${crypto.randomBytes(4).toString('hex')}`,
                        action: call.name,
                        title:
                          call.name === 'insert_dictated_paragraph'
                            ? 'پیشنهاد درج متن دیکته‌شده صوتی'
                            : call.name === 'add_callout_box'
                              ? `افزودن باکس نکته: ${String(args.title || '')}`
                              : `تغییر عنوان فصل به «${String(args.newTitle || '')}»`,
                        summary: String(args.text || args.body || args.newTitle || ''),
                        args,
                        applied: false,
                      },
                    });
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: {
                        status: 'proposed_to_user_for_confirmation',
                      },
                    });
                  }
                  liveSession.sendToolResponse({ functionResponses: responses });
                }
              },
              onerror: (e) => {
                const errMsg =
                  typeof e === 'object' && e !== null && 'message' in e
                    ? String((e as { message?: unknown }).message || 'خطای ناشناخته')
                    : 'خطای ناشناخته';
                sendJson({
                  type: 'error',
                  message: `خطای اتصال صوتی زنده: ${errMsg}`,
                });
              },
              onclose: () => {
                sendJson({ type: 'closed' });
              },
            },
          });
          startingSession = false;
          return;
        }

        if (!authenticated || !liveSession) return;

        if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length > 0) {
          if (msg.data.length > MAX_AUDIO_BASE64_CHARS) {
            sendJson({ type: 'error', message: 'بسته صوتی ارسال‌شده بیش از حد مجاز است.' });
            return;
          }
          try {
            liveSession.sendRealtimeInput({
              audio: {
                data: msg.data,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
          } catch (sendErr) {
            console.warn('[LiveVoiceBridge] sendRealtimeInput failed:', sendErr);
            sendJson({ type: 'error', message: 'ارسال بسته صوتی به جلسه زنده با خطا مواجه شد.' });
          }
        } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          try {
            liveSession.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: msg.text.slice(0, MAX_TEXT_CHARS) }] }],
              turnComplete: true,
            });
          } catch (sendErr) {
            console.warn('[LiveVoiceBridge] sendClientContent failed:', sendErr);
            sendJson({ type: 'error', message: 'ارسال پیام متنی به جلسه زنده با خطا مواجه شد.' });
          }
        } else if (msg.type === 'stop') {
          closeLiveSession();
        }
      } catch (err) {
        startingSession = false;
        console.warn('[LiveVoiceBridge] Message processing error:', err);
        sendJson({
          type: 'error',
          message: 'خطا در پردازش پیام صوتی. لطفاً اتصال را دوباره بررسی کنید.',
        });
      }
    });

    ws.on('error', () => {
      clearTimeout(authTimer);
      closeLiveSession();
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      closeLiveSession();
    });
  });
}
