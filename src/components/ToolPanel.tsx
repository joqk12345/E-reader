import React, { useEffect, useRef, useState } from 'react';
import { SearchPanel } from './SearchPanel';
import { SummaryPanel } from './SummaryPanel';
import { TranslatePanel } from './TranslatePanel';
import { AudiobookPanel } from './AudiobookPanel';
import { DeepAnalysisPanel } from './DeepAnalysisPanel';
import { ChatPanel } from './ChatPanel';
import { NotesPanel } from './NotesPanel';
import { AnnotationPanel } from './AnnotationPanel';
import { DictPanel } from './DictPanel';

type Tab = 'search' | 'summary' | 'translate' | 'deep' | 'chat' | 'notes' | 'annotations' | 'dict' | 'audiobook';

type ExplainEventDetail = {
  selectedText?: string;
};

type TakeNoteEventDetail = {
  docId?: string;
  paragraphId?: string;
  selectedText?: string;
  noteText?: string;
};

type TranslateEventDetail = {
  selectedText?: string;
  autoRun?: boolean;
};

type ChatQuestionEventDetail = {
  question?: string;
};

type DictOpenEventDetail = {
  mode?: 'dict' | 'sentence';
  selectedText?: string;
  sentence?: string;
  paragraphId?: string;
};

type ToolPanelProps = {
  collapsed: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onToggleCollapse: () => void;
  onWidthChange: (width: number) => void;
};

export const ToolPanel: React.FC<ToolPanelProps> = ({
  collapsed,
  width,
  minWidth,
  maxWidth,
  onToggleCollapse,
  onWidthChange,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const [chatRequest, setChatRequest] = useState<{ id: number; question: string } | null>(null);
  const [noteRequest, setNoteRequest] = useState<{
    id: number;
    docId?: string;
    paragraphId?: string;
    selectedText: string;
    noteText?: string;
  } | null>(null);
  const [translateRequest, setTranslateRequest] = useState<{
    id: number;
    selectedText: string;
    autoRun?: boolean;
  } | null>(null);
  const [dictRequest, setDictRequest] = useState<{
    id: number;
    mode: 'dict' | 'sentence';
    selectedText: string;
    sentence: string;
    paragraphId?: string;
  } | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'search', label: 'Search', icon: '🔍' },
    { key: 'summary', label: 'Summary', icon: '📝' },
    { key: 'dict', label: 'Dict', icon: '📘' },
    { key: 'translate', label: 'Translate', icon: '🌐' },
    { key: 'deep', label: 'Deep', icon: '🧠' },
    { key: 'chat', label: 'Chat', icon: '💬' },
    { key: 'notes', label: 'Notes', icon: '📒' },
    { key: 'annotations', label: 'Marks', icon: '🖍️' },
    { key: 'audiobook', label: 'Audio', icon: '🎧' },
  ];

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      const delta = dragStateRef.current.startX - event.clientX;
      const nextWidth = Math.min(
        maxWidth,
        Math.max(minWidth, dragStateRef.current.startWidth + delta)
      );
      onWidthChange(nextWidth);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [maxWidth, minWidth, onWidthChange]);

  useEffect(() => {
    const onExplain = (event: Event) => {
      const customEvent = event as CustomEvent<ExplainEventDetail>;
      const selectedText = customEvent.detail?.selectedText?.trim();
      if (!selectedText) return;
      const question = `Please explain this selected content in the current reading context:\n\n"${selectedText}"`;
      setActiveTab('chat');
      setChatRequest({
        id: Date.now(),
        question,
      });
      if (collapsed) {
        onToggleCollapse();
      }
    };

    const onTakeNote = (event: Event) => {
      const customEvent = event as CustomEvent<TakeNoteEventDetail>;
      const selectedText = customEvent.detail?.selectedText?.trim();
      if (!selectedText) return;
      setActiveTab('notes');
      setNoteRequest({
        id: Date.now(),
        docId: customEvent.detail?.docId,
        paragraphId: customEvent.detail?.paragraphId,
        selectedText,
        noteText: customEvent.detail?.noteText,
      });
      if (collapsed) {
        onToggleCollapse();
      }
    };

    const onTranslateSelection = (event: Event) => {
      const customEvent = event as CustomEvent<TranslateEventDetail>;
      const selectedText = customEvent.detail?.selectedText?.trim();
      if (!selectedText) return;
      setActiveTab('translate');
      setTranslateRequest({
        id: Date.now(),
        selectedText,
        autoRun: customEvent.detail?.autoRun ?? false,
      });
      if (collapsed) {
        onToggleCollapse();
      }
    };

    const onChatQuestion = (event: Event) => {
      const customEvent = event as CustomEvent<ChatQuestionEventDetail>;
      const question = customEvent.detail?.question?.trim();
      if (!question) return;
      setActiveTab('chat');
      setChatRequest({
        id: Date.now(),
        question,
      });
      if (collapsed) {
        onToggleCollapse();
      }
    };

    const onOpenSearch = () => {
      setActiveTab('search');
      if (collapsed) {
        onToggleCollapse();
      }
    };

    const onOpenAnnotations = () => {
      setActiveTab('annotations');
      if (collapsed) {
        onToggleCollapse();
      }
    };

    const onOpenDict = (event: Event) => {
      const customEvent = event as CustomEvent<DictOpenEventDetail>;
      const selectedText = customEvent.detail?.selectedText?.trim();
      if (!selectedText) return;
      const sentence = customEvent.detail?.sentence?.trim() || selectedText;
      const mode = customEvent.detail?.mode === 'sentence' ? 'sentence' : 'dict';
      setActiveTab('dict');
      setDictRequest({
        id: Date.now(),
        mode,
        selectedText,
        sentence,
        paragraphId: customEvent.detail?.paragraphId,
      });
      if (collapsed) {
        onToggleCollapse();
      }
    };

    window.addEventListener('reader:chat-explain', onExplain as EventListener);
    window.addEventListener('reader:take-note', onTakeNote as EventListener);
    window.addEventListener('reader:translate-selection', onTranslateSelection as EventListener);
    window.addEventListener('reader:chat-question', onChatQuestion as EventListener);
    window.addEventListener('reader:open-search', onOpenSearch as EventListener);
    window.addEventListener('reader:open-annotations', onOpenAnnotations as EventListener);
    window.addEventListener('reader:open-dict', onOpenDict as EventListener);
    return () => {
      window.removeEventListener('reader:chat-explain', onExplain as EventListener);
      window.removeEventListener('reader:take-note', onTakeNote as EventListener);
      window.removeEventListener('reader:translate-selection', onTranslateSelection as EventListener);
      window.removeEventListener('reader:chat-question', onChatQuestion as EventListener);
      window.removeEventListener('reader:open-search', onOpenSearch as EventListener);
      window.removeEventListener('reader:open-annotations', onOpenAnnotations as EventListener);
      window.removeEventListener('reader:open-dict', onOpenDict as EventListener);
    };
  }, [collapsed, onToggleCollapse]);

  return (
    <aside
      className="relative h-full min-h-0 flex flex-col bg-white border-l border-gray-200 flex-shrink-0"
      style={{ width: collapsed ? 48 : width }}
    >
      {collapsed ? (
        <div className="flex items-center justify-center border-b border-gray-200 p-2 flex-shrink-0">
          <button
            onClick={onToggleCollapse}
            className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-gray-100 text-gray-600"
            title="Expand tools"
            aria-label="Expand tools"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 4l-6 6 6 6" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2.5">
          <span className="text-sm font-semibold text-gray-800">Tools</span>
          <button
            onClick={onToggleCollapse}
            className="ml-2 inline-flex items-center justify-center h-6 w-6 rounded hover:bg-gray-100 text-gray-600"
            title="Collapse tools"
            aria-label="Collapse tools"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 4l6 6-6 6" />
            </svg>
          </button>
        </div>
      )}

      {collapsed ? (
        <div className="flex-1 min-h-0 py-2 space-y-1 overflow-y-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                onToggleCollapse();
              }}
              title={tab.label}
              className={`mx-auto w-8 h-8 rounded-md flex items-center justify-center text-sm ${
                activeTab === tab.key
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span>{tab.icon}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="grid grid-cols-3 border-b border-gray-200">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors border-r border-b border-gray-100 last:border-r-0 ${
                  activeTab === tab.key
                    ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
          {/* Content */}
          <div className={activeTab === 'audiobook' ? 'hidden' : 'flex-1 min-h-0 overflow-y-auto'}>
            <div className={activeTab === 'search' ? '' : 'hidden'}><SearchPanel /></div>
            <div className={activeTab === 'summary' ? '' : 'hidden'}><SummaryPanel /></div>
            <div className={activeTab === 'translate' ? '' : 'hidden'}><TranslatePanel request={translateRequest} /></div>
            <div className={activeTab === 'deep' ? '' : 'hidden'}><DeepAnalysisPanel /></div>
            <div className={activeTab === 'chat' ? '' : 'hidden'}><ChatPanel request={chatRequest} /></div>
            <div className={activeTab === 'notes' ? '' : 'hidden'}><NotesPanel request={noteRequest} /></div>
            <div className={activeTab === 'annotations' ? '' : 'hidden'}><AnnotationPanel /></div>
            <div className={activeTab === 'dict' ? '' : 'hidden'}><DictPanel request={dictRequest} /></div>
          </div>
        </>
      )}

      <div className={collapsed || activeTab !== 'audiobook' ? 'hidden' : 'flex-1 min-h-0 overflow-y-auto'}>
        <AudiobookPanel />
      </div>

      {!collapsed && (
        <div
          className="absolute top-0 left-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-gray-200"
          onPointerDown={(event) => {
            dragStateRef.current = { startX: event.clientX, startWidth: width };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />
      )}
    </aside>
  );
};
