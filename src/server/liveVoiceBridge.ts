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

export function attachLiveVoiceWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/ws/live' });
  wss.on('error', (err) => {
    console.error('Live voice WebSocket server error:', err);
  });

  wss.on('connection', (ws: WebSocket) => {
    let liveSession: Awaited<ReturnType<NonNullable<ReturnType<typeof createGeminiClient>>['live']['connect']>> | null =
      null;
    let authenticated = false;

    const sendJson = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

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
          if (!msg.token) {
            sendJson({ type: 'error', message: 'توکن احراز هویت برای اتصال صوتی ارسال نشده است.' });
            ws.close();
            return;
          }

          let uid: string;
          if (isGuestBearerToken(msg.token)) {
            const guest = verifyGuestToken(msg.token);
            if (!guest) {
              sendJson({ type: 'error', message: 'نشست مهمان برای اتصال صوتی منقضی یا نامعتبر است.' });
              ws.close();
              return;
            }
            uid = guest.uid;
          } else {
            try {
              const decoded = await adminAuth.verifyIdToken(msg.token);
              uid = decoded.uid;
            } catch {
              sendJson({ type: 'error', message: 'احراز هویت جلسه صوتی نامعتبر یا منقضی است.' });
              ws.close();
              return;
            }
          }

          const ai = createGeminiClient();
          if (!ai) {
            sendJson({ type: 'error', message: 'کلید API هوش مصنوعی در تنظیمات سرور تنظیم نشده است.' });
            ws.close();
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
                sendJson({ type: 'ready' });
              },
              onmessage: (serverMsg) => {
                // Forward 24kHz PCM audio output
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

                // Forward transcriptions
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

                // Forward tool calls as structured proposals for user confirmation
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
          return;
        }

        if (!authenticated || !liveSession) return;

        if (msg.type === 'audio' && msg.data) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (msg.type === 'text' && msg.text) {
          liveSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: msg.text }] }],
            turnComplete: true,
          });
        } else if (msg.type === 'stop') {
          liveSession.close();
          liveSession = null;
        }
      } catch (err) {
        sendJson({
          type: 'error',
          message: err instanceof Error ? err.message : 'خطا در پردازش پیام صوتی.',
        });
      }
    });

    ws.on('close', () => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore close errors
        }
        liveSession = null;
      }
    });
  });
}
