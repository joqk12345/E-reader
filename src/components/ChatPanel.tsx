import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
};

type ChatTurnInput = {
  role: ChatRole;
  content: string;
};

type ChatPanelProps = {
  request?: {
    id: number;
    question: string;
  } | null;
};

const makeId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

export const ChatPanel: React.FC<ChatPanelProps> = ({ request }) => {
  const { selectedDocumentId, currentSectionId, currentParagraph } = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const targetLabel = useMemo(() => {
    if (currentParagraph) return 'Current Paragraph';
    if (currentSectionId) return 'Current Section';
    if (selectedDocumentId) return 'Entire Document';
    return 'None';
  }, [currentParagraph, currentSectionId, selectedDocumentId]);

  const canAsk = Boolean(selectedDocumentId);

  const scrollToBottom = () => {
    window.setTimeout(() => {
      if (!listRef.current) return;
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }, 0);
  };

  const getFriendlyError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const normalized = msg.toLowerCase();
    if (
      normalized.includes('failed to send request') ||
      normalized.includes('connection refused') ||
      normalized.includes('econnrefused') ||
      normalized.includes('timed out')
    ) {
      return 'QA 服务暂不可用。请确认 LLM 服务已启动并加载模型。';
    }
    return msg || 'Chat failed';
  };

  const ask = async (overrideQuestion?: string) => {
    const question = (overrideQuestion ?? input).trim();
    if (!question || isAsking || !canAsk) return;

    setError(null);
    setInput('');
    setIsAsking(true);

    const userMessage: ChatMessage = {
      id: makeId(),
      role: 'user',
      content: question,
      createdAt: Date.now(),
    };
    const nextMessages: ChatMessage[] = [...messages, userMessage];
    setMessages(nextMessages);
    scrollToBottom();

    try {
      const history: ChatTurnInput[] = nextMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const answer = await invoke<string>('chat_with_context', {
        question,
        docId: currentParagraph ? undefined : selectedDocumentId,
        sectionId: currentParagraph ? undefined : currentSectionId || undefined,
        paragraphId: currentParagraph?.id || undefined,
        history,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          content: stripThinking(answer),
          createdAt: Date.now(),
        },
      ]);
      scrollToBottom();
    } catch (err) {
      const msg = getFriendlyError(err);
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          content: `抱歉，当前无法完成回答：${msg}`,
          createdAt: Date.now(),
        },
      ]);
      scrollToBottom();
    } finally {
      setIsAsking(false);
    }
  };

  useEffect(() => {
    if (!request?.question) return;
    void ask(request.question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">
            Context: <span className="font-medium text-gray-900">{targetLabel}</span>
          </span>
          <button
            onClick={clearChat}
            className="px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 border-b border-red-200 bg-red-50 text-xs text-red-600">
          {error}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center text-sm text-gray-500">
            请输入问题，我会基于当前文章上下文回答。
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={`max-w-[92%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800 border border-gray-200'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {isAsking && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-700 border border-gray-200 rounded-lg px-3 py-2 text-sm">
              Thinking...
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-gray-200">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask();
              }
            }}
            rows={2}
            placeholder={canAsk ? 'Ask about current context...' : 'Please select a document first'}
            disabled={!canAsk || isAsking}
            className="flex-1 resize-none border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          <button
            onClick={() => void ask()}
            disabled={!canAsk || isAsking || !input.trim()}
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300"
          >
            Send
          </button>
        </div>
        <p className="mt-1 text-[11px] text-gray-500">Enter to send, Shift+Enter for newline</p>
      </div>
    </div>
  );
};
