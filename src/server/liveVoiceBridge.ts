import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { type FunctionDeclaration, Modality, Type } from '@google/genai';
import crypto from 'node:crypto';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getProjectBundle } from '../db/repository.ts';
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

function isAllowedWsOrigin(originHeader: string | undefined, hostHeader: string | undefined): boolean {
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
    if (hostHeader && originHost === hostHeader.toLowerCase()) {
      return true;
    }
    if (originUrl.hostname.endsWith('.run.app') || originUrl.hostname.endsWith('.googleusercontent.com')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function attachLiveVoiceWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({
    server,
    path: '/ws/live',
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });
  wss.on('error', (err) => {
    console.error('Live voice WebSocket server error:', err);
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : undefined;
    if (!isAllowedWsOrigin(originHeader, hostHeader)) {
      ws.close(1008, 'Origin not allowed');
      return;
    }

    let liveSession: Awaited<ReturnType<NonNullable<ReturnType<typeof createGeminiClient>>['live']['connect']>> | null =
      null;
    let authenticated = false;
    let startingSession = false;

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
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          liveSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: msg.text.slice(0, MAX_TEXT_CHARS) }] }],
            turnComplete: true,
          });
        } else if (msg.type === 'stop') {
          closeLiveSession();
        }
      } catch (err) {
        startingSession = false;
        sendJson({
          type: 'error',
          message: err instanceof Error ? err.message : 'خطا در پردازش پیام صوتی.',
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
