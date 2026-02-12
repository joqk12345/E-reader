import React, { useEffect, useRef, useState } from 'react';
import { SearchPanel } from './SearchPanel';
import { SummaryPanel } from './SummaryPanel';
import { TranslatePanel } from './TranslatePanel';
import { AudiobookPanel } from './AudiobookPanel';
import { DeepAnalysisPanel } from './DeepAnalysisPanel';
import { ChatPanel } from './ChatPanel';
import { NotesPanel } from './NotesPanel';

type Tab = 'search' | 'summary' | 'translate' | 'deep' | 'chat' | 'notes' | 'audiobook';

type ExplainEventDetail = {
  selectedText?: string;
};

type TakeNoteEventDetail = {
  docId?: string;
  paragraphId?: string;
  selectedText?: string;
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
  } | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'search', label: 'Search', icon: '🔍' },
    { key: 'summary', label: 'Summary', icon: '📝' },
    { key: 'translate', label: 'Translate', icon: '🌐' },
    { key: 'deep', label: 'Deep', icon: '🧠' },
    { key: 'chat', label: 'Chat', icon: '💬' },
    { key: 'notes', label: 'Notes', icon: '📒' },
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
      setActiveTab('chat');
      setChatRequest({
        id: Date.now(),
        question: `Please explain this selected content in the current reading context:\n\n"${selectedText}"`,
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
      });
      if (collapsed) {
        onToggleCollapse();
      }
    };

    window.addEventListener('reader:chat-explain', onExplain as EventListener);
    window.addEventListener('reader:take-note', onTakeNote as EventListener);
    return () => {
      window.removeEventListener('reader:chat-explain', onExplain as EventListener);
      window.removeEventListener('reader:take-note', onTakeNote as EventListener);
    };
  }, [collapsed, onToggleCollapse]);

  return (
    <aside
      className="relative h-full min-h-0 flex flex-col bg-white border-l border-gray-200 flex-shrink-0"
      style={{ width: collapsed ? 48 : width }}
    >
      <div className={`flex items-center justify-between border-b border-gray-200 ${collapsed ? 'p-2' : 'px-3 py-2.5'}`}>
        {collapsed ? (
          <span className="text-[11px] font-semibold text-gray-700">Tools</span>
        ) : (
          <span className="text-sm font-semibold text-gray-800">Tools</span>
        )}
        <button
          onClick={onToggleCollapse}
          className="ml-2 inline-flex items-center justify-center h-6 w-6 rounded hover:bg-gray-100 text-gray-600"
          title={collapsed ? 'Expand tools' : 'Collapse tools'}
          aria-label={collapsed ? 'Expand tools' : 'Collapse tools'}
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
            {collapsed ? <path d="M12 4l-6 6 6 6" /> : <path d="M8 4l6 6-6 6" />}
          </svg>
        </button>
      </div>

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
            {activeTab === 'search' && <SearchPanel />}
            {activeTab === 'summary' && <SummaryPanel />}
            {activeTab === 'translate' && <TranslatePanel />}
            {activeTab === 'deep' && <DeepAnalysisPanel />}
            {activeTab === 'chat' && <ChatPanel request={chatRequest} />}
            {activeTab === 'notes' && <NotesPanel request={noteRequest} />}
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
