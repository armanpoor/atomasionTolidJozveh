import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  FileAudio,
  Globe,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import {
  ChatProposal,
  OutlineNodeDto,
  WebGroundingSource,
} from '../lib/bookTypes';
import {
  FirestoreChatMessage,
  addProjectChatMessage,
  markChatProposalApplied,
  subscribeProjectChatMessages,
} from '../lib/firebase';

interface AssistantDrawerProps {
  open: boolean;
  onClose: () => void;
  uid: string;
  isGuest?: boolean;
  projectId: string | null;
  outlineNodes: OutlineNodeDto[];
  aiModel: string;
  getIdToken: () => Promise<string>;
  webSearchEngineLabel?: string;
  onTranscribeAudio?: (file: File) => Promise<{ transcript: string; providerLabelFa: string }>;
  onSendChat: (payload: {
    message: string;
    history: Array<{ role: 'user' | 'model'; text: string }>;
    model: string;
    enableGoogleSearch: boolean;
  }) => Promise<{
    reply: string;
    proposals: ChatProposal[];
    groundingSources?: WebGroundingSource[];
  }>;
  onApplyProposal: (proposal: ChatProposal) => Promise<void>;
}

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function downsampleTo16k(float32: Float32Array, inputSampleRate: number): Int16Array {
  if (inputSampleRate === 16000) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = inputSampleRate / 16000;
  const outLength = Math.floor(float32.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const idx = Math.min(float32.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, float32[idx]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export const AssistantDrawer: React.FC<AssistantDrawerProps> = ({
  open,
  onClose,
  uid,
  isGuest = false,
  projectId,
  outlineNodes,
  aiModel,
  getIdToken,
  webSearchEngineLabel = 'جستجوی زنده وب',
  onTranscribeAudio,
  onSendChat,
  onApplyProposal,
}) => {
  const [tab, setTab] = useState<'chat' | 'voice'>('chat');
  const [messages, setMessages] = useState<FirestoreChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [transcribingFile, setTranscribingFile] = useState(false);
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [localProposals, setLocalProposals] = useState<Record<string, ChatProposal[]>>({});
  const [localSources, setLocalSources] = useState<Record<string, WebGroundingSource[]>>({});
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatAudioInputRef = useRef<HTMLInputElement | null>(null);

  // Live Voice states
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [targetNodeId, setTargetNodeId] = useState<string>('');
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [liveModelTranscript, setLiveModelTranscript] = useState('');
  const [voiceProposals, setVoiceProposals] = useState<ChatProposal[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (outlineNodes.length > 0 && !targetNodeId) {
      setTargetNodeId(outlineNodes[0].id);
    }
  }, [outlineNodes, targetNodeId]);

  useEffect(() => {
    if (!uid || !projectId || isGuest) {
      setMessages([]);
      return;
    }
    const unsub = subscribeProjectChatMessages(uid, projectId, (docs) => {
      setMessages(docs);
    });
    return () => unsub();
  }, [uid, projectId, isGuest]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, tab]);

  const stopVoiceSession = () => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      wsRef.current?.close();
    } catch {
      // ignore
    }
    wsRef.current = null;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (inputCtxRef.current) {
      void inputCtxRef.current.close();
      inputCtxRef.current = null;
    }
    for (const s of scheduledSourcesRef.current) {
      try {
        s.stop();
      } catch {
        // ignore
      }
    }
    scheduledSourcesRef.current = [];
    if (outputCtxRef.current) {
      void outputCtxRef.current.close();
      outputCtxRef.current = null;
    }
    nextStartTimeRef.current = 0;
    setVoiceActive(false);
    setVoiceConnecting(false);
  };

  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, []);

  const schedulePcm24kAudio = (base64Pcm: string) => {
    if (!outputCtxRef.current) {
      outputCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = outputCtxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const int16 = base64ToInt16(base64Pcm);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, nextStartTimeRef.current);
    src.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;
    scheduledSourcesRef.current.push(src);
    src.onended = () => {
      scheduledSourcesRef.current = scheduledSourcesRef.current.filter((s) => s !== src);
    };
  };

  const startVoiceSession = async () => {
    if (!projectId) {
      setVoiceError('ابتدا یک پروژه فعال انتخاب کنید.');
      return;
    }
    setVoiceError(null);
    setVoiceConnecting(true);
    setLiveUserTranscript('');
    setLiveModelTranscript('');

    try {
      const token = await getIdToken();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            token,
            projectId,
            targetNodeId: targetNodeId || outlineNodes[0]?.id || '',
          })
        );
      };

      ws.onmessage = (evt) => {
        const data = JSON.parse(evt.data) as {
          type?: string;
          data?: string;
          text?: string;
          message?: string;
          proposal?: ChatProposal;
        };
        if (data.type === 'ready') {
          setVoiceConnecting(false);
          setVoiceActive(true);
          // Start 16kHz PCM microphone streaming
          const inCtx = new AudioContext();
          inputCtxRef.current = inCtx;
          const source = inCtx.createMediaStreamSource(stream);
          const processor = inCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;
          processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const channel = e.inputBuffer.getChannelData(0);
            const pcm16 = downsampleTo16k(channel, inCtx.sampleRate);
            ws.send(
              JSON.stringify({
                type: 'audio',
                data: int16ToBase64(pcm16),
              })
            );
          };
          source.connect(processor);
          processor.connect(inCtx.destination);
        } else if (data.type === 'audio' && data.data) {
          schedulePcm24kAudio(data.data);
        } else if (data.type === 'input_transcript' && data.text) {
          setLiveUserTranscript((prev) => `${prev}${data.text}`);
        } else if (data.type === 'output_transcript' && data.text) {
          setLiveModelTranscript((prev) => `${prev}${data.text}`);
        } else if (data.type === 'interrupted') {
          for (const s of scheduledSourcesRef.current) {
            try {
              s.stop();
            } catch {
              // ignore
            }
          }
          scheduledSourcesRef.current = [];
          nextStartTimeRef.current = 0;
        } else if (data.type === 'proposal' && data.proposal) {
          setVoiceProposals((prev) => [data.proposal!, ...prev]);
        } else if (data.type === 'error') {
          setVoiceError(data.message || 'خطا در اتصال صوتی زنده.');
          stopVoiceSession();
        } else if (data.type === 'closed') {
          stopVoiceSession();
        }
      };

      ws.onerror = () => {
        setVoiceError('ارتباط WebSocket با سرویس صوتی زنده برقرار نشد.');
        stopVoiceSession();
      };
    } catch (err) {
      setVoiceError(
        err instanceof Error
          ? err.message
          : 'دسترسی به میکروفون رد شد یا مرورگر پشتیبانی نمی‌کند.'
      );
      stopVoiceSession();
    }
  };

  const handleSubmitChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || !projectId || sending) return;

    setInputText('');
    setChatError(null);
    setSending(true);

    try {
      const userMsgId = `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      if (isGuest) {
        setMessages((prev) => [
          ...prev,
          {
            id: userMsgId,
            ownerId: uid,
            projectId,
            role: 'user',
            source: 'text',
            text,
            hasProposal: false,
            proposalApplied: false,
            proposalSummary: '',
            createdAt: Date.now(),
          },
        ]);
      } else {
        await addProjectChatMessage(uid, projectId, {
          id: userMsgId,
          role: 'user',
          source: 'text',
          text,
        });
      }

      const history = messages.slice(-8).map((m) => ({
        role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        text: m.text,
      }));

      const res = await onSendChat({
        message: text,
        history,
        model: aiModel,
        enableGoogleSearch: enableWebSearch,
      });

      const assistantMsgId = `msg_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      if (isGuest) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            ownerId: uid,
            projectId,
            role: 'assistant',
            source: 'text',
            text: res.reply,
            hasProposal: res.proposals.length > 0,
            proposalApplied: false,
            proposalSummary: res.proposals.map((p) => p.title).join(' · '),
            createdAt: Date.now(),
          },
        ]);
      } else {
        await addProjectChatMessage(uid, projectId, {
          id: assistantMsgId,
          role: 'assistant',
          source: 'text',
          text: res.reply,
          hasProposal: res.proposals.length > 0,
          proposalSummary: res.proposals.map((p) => p.title).join(' · '),
        });
      }

      if (res.proposals.length > 0) {
        setLocalProposals((prev) => ({ ...prev, [assistantMsgId]: res.proposals }));
      }
      if (res.groundingSources && res.groundingSources.length > 0) {
        setLocalSources((prev) => ({ ...prev, [assistantMsgId]: res.groundingSources! }));
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'خطا در ارسال پیام به دستیار.');
    } finally {
      setSending(false);
    }
  };

  const handleConfirmProposal = async (proposal: ChatProposal, messageId?: string) => {
    setApplyingId(proposal.id);
    setChatError(null);
    try {
      await onApplyProposal(proposal);
      setAppliedIds((prev) => new Set(prev).add(proposal.id));
      if (messageId && projectId && !isGuest) {
        void markChatProposalApplied(uid, projectId, messageId).catch(() => {});
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'اعمال تغییر روی سند ناموفق بود.');
    } finally {
      setApplyingId(null);
    }
  };

  if (!open) return null;

  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-full max-w-[390px] lg:static lg:z-auto lg:w-[370px] xl:w-[395px] shrink-0 border-r border-[#E2DDD3] bg-[#FCFBF8] shadow-xl lg:shadow-none flex flex-col lg:h-[calc(100vh-58px)]">
      {/* Drawer Header */}
      <div className="flex items-center justify-between border-b border-[#E2DDD3] bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#1E3A5F]" />
          <span className="text-sm font-bold text-[#1A1816]">دستیار هوشمند و صوتی تدوین</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="بستن پنل دستیار"
          className="flex h-8 w-8 items-center justify-center rounded-md text-[#57534E] hover:bg-[#F5F3EE] cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Mode Switch Tabs */}
      <div className="grid grid-cols-2 border-b border-[#E2DDD3] bg-[#F6F4EE] p-1 gap-1">
        <button
          type="button"
          onClick={() => setTab('chat')}
          className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
            tab === 'chat'
              ? 'bg-white text-[#1E3A5F] shadow-xs'
              : 'text-[#57534E] hover:text-[#1A1816]'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          چت‌بات سردبیر
        </button>
        <button
          type="button"
          onClick={() => setTab('voice')}
          className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
            tab === 'voice'
              ? 'bg-white text-[#1E3A5F] shadow-xs'
              : 'text-[#57534E] hover:text-[#1A1816]'
          }`}
        >
          <Mic className="h-3.5 w-3.5" />
          ویرایش صوتی زنده
        </button>
      </div>

      {/* CHAT TAB */}
      {tab === 'chat' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {messages.length === 0 && (
              <div className="rounded-xl border border-[#E5E0D6] bg-white p-4 text-xs text-[#57534E] leading-6 space-y-2">
                <div className="font-bold text-[#1E3A5F]">چه کمکی از دستیار سردبیر می‌خواهید؟</div>
                <p>
                  چت‌بات به فصل‌بندی، فایل‌های ورودی و تناقض‌های پروژه دسترسی دارد. می‌توانید فرمان‌هایی مانند این‌ها بدهید:
                </p>
                <ul className="list-disc pr-4 space-y-1 text-[11.5px]">
                  <li>«فصل اول را به دو فصل مجزا تقسیم کن»</li>
                  <li>«یک جدول مقایسه‌ای خلاصه به فصل ۲ اضافه کن»</li>
                  <li>«یک باکس هشدار ایمنی در فصل آخر درج کن»</li>
                </ul>
              </div>
            )}

            {messages.map((msg) => {
              const proposals: ChatProposal[] = localProposals[msg.id] || [];
              const sources = localSources[msg.id] || [];

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-start' : 'items-end'
                  }`}
                >
                  <div
                    className={`max-w-[92%] rounded-xl px-3.5 py-2.5 text-xs leading-6 whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-[#1E3A5F] text-white'
                        : 'border border-[#E2DDD3] bg-white text-[#1A1816]'
                    }`}
                  >
                    {msg.text}
                  </div>

                  {/* Structured 1-Click Apply Proposals */}
                  {proposals.length > 0 ? (
                    <div className="mt-2 w-[94%] space-y-2">
                      {proposals.map((prop) => {
                        const done = appliedIds.has(prop.id) || msg.proposalApplied;
                        const busy = applyingId === prop.id;
                        return (
                          <div
                            key={prop.id}
                            className="rounded-xl border border-[#C6D5E6] bg-[#EEF3F8] p-3 space-y-2 text-xs"
                          >
                            <div className="font-bold text-[#1E3A5F]">{prop.title}</div>
                            <p className="text-[11.5px] text-[#3B5578] leading-5">{prop.summary}</p>
                            <button
                              type="button"
                              disabled={done || busy}
                              onClick={() => handleConfirmProposal(prop, msg.id)}
                              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition-colors cursor-pointer ${
                                done
                                  ? 'bg-[#14532D] text-white'
                                  : 'bg-[#1E3A5F] text-white hover:bg-[#162C49]'
                              }`}
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                              {done ? 'روی سند اعمال شد' : 'تأیید و اعمال روی سند'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : msg.hasProposal && msg.proposalSummary ? (
                    <div className="mt-1.5 w-[94%] rounded-lg border border-[#E2DDD3] bg-[#F7F5F0] px-3 py-2 text-[11px] text-[#57534E]">
                      <span className="font-bold text-[#1E3A5F]">پیشنهاد ثبت‌شده: </span>
                      <span>{msg.proposalSummary}</span>
                      {msg.proposalApplied && (
                        <span className="mr-2 font-bold text-[#14532D]">(اعمال‌شده)</span>
                      )}
                    </div>
                  ) : null}

                  {sources.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5 w-[94%]">
                      {sources.map((s, i) => (
                        <a
                          key={i}
                          href={s.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-[#D7CBE6] bg-[#F7F4FA] px-2 py-0.5 text-[10.5px] text-[#5B21B6]"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span className="max-w-[160px] truncate">{s.title}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {chatError && (
              <div className="rounded-lg border border-[#E6BFB7] bg-[#FDF2F0] p-2.5 text-xs text-[#9A3412]">
                {chatError}
              </div>
            )}
            <div ref={listEndRef} />
          </div>

          {/* Chat Input */}
          <form
            onSubmit={handleSubmitChat}
            className="border-t border-[#E2DDD3] bg-white p-3 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#5B21B6] cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableWebSearch}
                  onChange={(e) => setEnableWebSearch(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#5B21B6]"
                />
                <Globe className="h-3.5 w-3.5" />
                <span>
                  جستجوی وب:{' '}
                  <bdi dir="ltr" className="font-mono text-[10.5px]">
                    {webSearchEngineLabel}
                  </bdi>
                </span>
              </label>

              {onTranscribeAudio && (
                <>
                  <input
                    ref={chatAudioInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file || !projectId) return;
                      setTranscribingFile(true);
                      setChatError(null);
                      try {
                        const out = await onTranscribeAudio(file);
                        setInputText((prev) =>
                          prev.trim() ? `${prev.trim()}\n${out.transcript}` : out.transcript
                        );
                      } catch (err) {
                        setChatError(
                          err instanceof Error ? err.message : 'تبدیل ویس به متن ناموفق بود.'
                        );
                      } finally {
                        setTranscribingFile(false);
                      }
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={transcribingFile || sending || !projectId}
                    onClick={() => chatAudioInputRef.current?.click()}
                    title="آپلود فایل صوتی (MP3 / WAV / M4A / OGG) برای تبدیل خودکار به متن"
                    className="inline-flex items-center gap-1 rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2 py-1 text-[10.5px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-50 cursor-pointer"
                  >
                    {transcribingFile ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <FileAudio className="h-3 w-3" />
                    )}
                    <span>{transcribingFile ? 'در حال پیاده‌سازی ویس...' : 'آپلود ویس به متن'}</span>
                  </button>
                </>
              )}
            </div>

            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmitChat(e);
                  }
                }}
                placeholder="فرمان ویرایش بنویسید یا ویس آپلود کنید..."
                className="flex-1 resize-none rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || transcribingFile || !inputText.trim() || !projectId}
                aria-label="ارسال پیام"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1E3A5F] text-white hover:bg-[#162C49] disabled:opacity-40 cursor-pointer"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* LIVE VOICE TAB (Gemini 3.8 Live) */}
      {tab === 'voice' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3 text-center">
            <div
              className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full transition-colors ${
                voiceActive
                  ? 'bg-[#FDF2F0] text-[#9A3412] ring-4 ring-[#F5D0C5]'
                  : 'bg-[#EEF3F8] text-[#1E3A5F]'
              }`}
            >
              {voiceActive ? (
                <Volume2 className="h-7 w-7 animate-pulse" />
              ) : (
                <Mic className="h-7 w-7" />
              )}
            </div>

            <div className="space-y-1">
              <div className="text-sm font-bold text-[#1A1816]">
                حالت ویرایش صوتی زنده (فارسی)
              </div>
              <p className="text-xs text-[#57534E] leading-5">
                با دستیار صوتی درباره فصل‌ها صحبت کنید یا پاراگراف جدید دیکته کنید تا به‌صورت مستقیم برای درج در فصل انتخابی آماده شود.
              </p>
            </div>

            {outlineNodes.length > 0 && (
              <div className="text-right space-y-1 pt-1">
                <label className="text-[11px] font-bold text-[#57534E]">
                  فصل مقصد برای دیکته صوتی:
                </label>
                <select
                  value={targetNodeId}
                  onChange={(e) => setTargetNodeId(e.target.value)}
                  disabled={voiceActive}
                  className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-xs text-[#1A1816]"
                >
                  {outlineNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={voiceActive ? stopVoiceSession : startVoiceSession}
              disabled={voiceConnecting || !projectId}
              className={`w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-colors cursor-pointer disabled:opacity-50 ${
                voiceActive
                  ? 'bg-[#9A3412] hover:bg-[#7C2D12]'
                  : 'bg-[#1E3A5F] hover:bg-[#162C49]'
              }`}
            >
              {voiceConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  در حال اتصال میکروفون و جلسه صوتی...
                </>
              ) : voiceActive ? (
                <>
                  <MicOff className="h-4 w-4" />
                  پایان مکالمه صوتی
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  شروع ویرایش و دیکته صوتی زنده
                </>
              )}
            </button>

            {voiceError && (
              <div className="rounded-lg border border-[#E6BFB7] bg-[#FDF2F0] p-2.5 text-xs text-[#9A3412] text-right">
                {voiceError}
              </div>
            )}
          </div>

          {/* Live Transcripts */}
          {(liveUserTranscript || liveModelTranscript) && (
            <div className="space-y-2.5 text-xs">
              {liveUserTranscript && (
                <div className="rounded-xl border border-[#C6D5E6] bg-[#EEF3F8] p-3">
                  <div className="font-bold text-[#1E3A5F] mb-1">گفتار شما:</div>
                  <p className="leading-6 text-[#1A1816]">{liveUserTranscript}</p>
                </div>
              )}
              {liveModelTranscript && (
                <div className="rounded-xl border border-[#E2DDD3] bg-white p-3">
                  <div className="font-bold text-[#14532D] mb-1">پاسخ صوتی دستیار:</div>
                  <p className="leading-6 text-[#1A1816]">{liveModelTranscript}</p>
                </div>
              )}
            </div>
          )}

          {/* Voice-generated Edit/Dictation Proposals */}
          {voiceProposals.length > 0 && (
            <div className="space-y-2.5">
              <div className="text-xs font-bold text-[#1A1816]">
                پیشنهادهای ثبت‌شده از دستور صوتی:
              </div>
              {voiceProposals.map((prop) => {
                const done = appliedIds.has(prop.id);
                const busy = applyingId === prop.id;
                return (
                  <div
                    key={prop.id}
                    className="rounded-xl border border-[#C6D5E6] bg-[#EEF3F8] p-3 space-y-2 text-xs"
                  >
                    <div className="font-bold text-[#1E3A5F]">{prop.title}</div>
                    <p className="text-[11.5px] text-[#292524] leading-6">{prop.summary}</p>
                    <button
                      type="button"
                      disabled={done || busy}
                      onClick={() => handleConfirmProposal(prop)}
                      className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-bold text-white cursor-pointer ${
                        done ? 'bg-[#14532D]' : 'bg-[#1E3A5F] hover:bg-[#162C49]'
                      }`}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {done ? 'در سند درج شد' : 'تأیید و درج در سند'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
