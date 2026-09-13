import React, { useEffect, useRef, useState } from 'react';
import { PanelButton } from './ui/Button';
import { SearchPanel } from './SearchPanel';
import { SummaryPanel } from './SummaryPanel';
import { TranslatePanel } from './TranslatePanel';
import { AudiobookPanel } from './AudiobookPanel';
import { DeepAnalysisPanel } from './DeepAnalysisPanel';
import { ChatPanel } from './ChatPanel';
import { NotesPanel } from './NotesPanel';
import { AnnotationPanel } from './AnnotationPanel';
import { DictPanel } from './DictPanel';
import { UnderstandPanel, type UnderstandMode } from './UnderstandPanel';
import { GlossaryPanel } from './GlossaryPanel';
import { TagsPanel } from './TagsPanel';

type Tab = 'search' | 'summary' | 'understand' | 'glossary' | 'tags' | 'translate' | 'deep' | 'chat' | 'notes' | 'annotations' | 'dict' | 'audiobook';

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

type OpenChatEventDetail = {
  question?: string;
};

type DictOpenEventDetail = {
  mode?: 'dict' | 'sentence';
  selectedText?: string;
  sentence?: string;
  paragraphId?: string;
};

type UnderstandOpenEventDetail = {
  mode?: UnderstandMode;
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
  const [showMoreTools, setShowMoreTools] = useState(false);
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
  const [understandRequest, setUnderstandRequest] = useState<{
    id: number;
    mode: UnderstandMode;
    selectedText: string;
    sentence: string;
    paragraphId?: string;
  } | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'search', label: 'Search' },
    { key: 'understand', label: 'Understand' },
    { key: 'chat', label: 'Chat' },
    { key: 'summary', label: 'Summary' },
    { key: 'dict', label: 'Dict' },
    { key: 'translate', label: 'Translate' },
    { key: 'deep', label: 'Deep' },
    { key: 'glossary', label: 'Glossary' },
    { key: 'tags', label: 'Tags' },
    { key: 'notes', label: 'Notes' },
    { key: 'annotations', label: 'Marks' },
    { key: 'audiobook', label: 'Audio' },
  ];
  const primaryTabs = tabs.filter((tab) => ['search', 'understand', 'chat'].includes(tab.key));
  const advancedTabs = tabs.filter((tab) => !['search', 'understand', 'chat'].includes(tab.key));

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
      setShowMoreTools(true);
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
      setShowMoreTools(true);
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

    const onOpenChat = (event: Event) => {
      const customEvent = event as CustomEvent<OpenChatEventDetail>;
      const question = customEvent.detail?.question?.trim();
      setActiveTab('chat');
      if (question) {
        setChatRequest({
          id: Date.now(),
          question,
        });
      }
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

    const onOpenAudiobook = () => {
      setActiveTab('audiobook');
      setShowMoreTools(true);
      if (collapsed) {
        onToggleCollapse();
      }
    };

    const onOpenAnnotations = () => {
      setActiveTab('annotations');
      setShowMoreTools(true);
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
      setShowMoreTools(true);
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

    const onOpenUnderstand = (event: Event) => {
      const customEvent = event as CustomEvent<UnderstandOpenEventDetail>;
      const selectedText = customEvent.detail?.selectedText?.trim();
      if (!selectedText) return;
      const sentence = customEvent.detail?.sentence?.trim() || selectedText;
      const mode = customEvent.detail?.mode || 'simple';
      setActiveTab('understand');
      setUnderstandRequest({
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

    const onOpenGlossary = (_event: Event) => {
      setActiveTab('glossary');
      setShowMoreTools(true);
      if (collapsed) {
        onToggleCollapse();
      }
    };

    window.addEventListener('reader:chat-explain', onExplain as EventListener);
    window.addEventListener('reader:take-note', onTakeNote as EventListener);
    window.addEventListener('reader:translate-selection', onTranslateSelection as EventListener);
    window.addEventListener('reader:chat-question', onChatQuestion as EventListener);
    window.addEventListener('reader:open-chat', onOpenChat as EventListener);
    window.addEventListener('reader:open-search', onOpenSearch as EventListener);
    window.addEventListener('reader:open-annotations', onOpenAnnotations as EventListener);
    window.addEventListener('reader:open-audiobook', onOpenAudiobook as EventListener);
    window.addEventListener('reader:open-dict', onOpenDict as EventListener);
    window.addEventListener('reader:open-understand', onOpenUnderstand as EventListener);
    window.addEventListener('reader:open-glossary', onOpenGlossary as EventListener);
    return () => {
      window.removeEventListener('reader:chat-explain', onExplain as EventListener);
      window.removeEventListener('reader:take-note', onTakeNote as EventListener);
      window.removeEventListener('reader:translate-selection', onTranslateSelection as EventListener);
      window.removeEventListener('reader:chat-question', onChatQuestion as EventListener);
      window.removeEventListener('reader:open-chat', onOpenChat as EventListener);
      window.removeEventListener('reader:open-search', onOpenSearch as EventListener);
      window.removeEventListener('reader:open-annotations', onOpenAnnotations as EventListener);
      window.removeEventListener('reader:open-audiobook', onOpenAudiobook as EventListener);
      window.removeEventListener('reader:open-dict', onOpenDict as EventListener);
      window.removeEventListener('reader:open-understand', onOpenUnderstand as EventListener);
      window.removeEventListener('reader:open-glossary', onOpenGlossary as EventListener);
    };
  }, [collapsed, onToggleCollapse]);

  const renderTabs = (groupTabs: typeof tabs) => groupTabs.map((tab) => (
    <PanelButton
      key={tab.key}
      onClick={() => setActiveTab(tab.key)}
      role="tab"
      aria-selected={activeTab === tab.key}
      title={tab.label}
      className={`reader-tool-tab ${
        activeTab === tab.key
          ? 'bg-action-subtle text-action-text reader-tab-active'
          : 'text-navigation hover:bg-surface-subtle'
      }`}
    >
      <span className="min-w-0 truncate">{tab.label}</span>
    </PanelButton>
  ));

  return (
    <aside
      id="reader-tool-panel"
      className="relative h-full min-h-0 flex flex-col bg-surface border-l border-border flex-shrink-0"
      style={{ width: collapsed ? 48 : width }}
    >
      {collapsed ? (
        <div className="reader-panel-header justify-center p-2">
          <PanelButton
            onClick={onToggleCollapse}
            className="reader-panel-action text-navigation hover:bg-surface-subtle"
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
          </PanelButton>
        </div>
      ) : (
        <div className="reader-panel-header py-2.5">
          <span className="text-size-subheading font-semibold text-foreground">Tools</span>
          <PanelButton
            onClick={onToggleCollapse}
            className="reader-panel-action ml-2 text-navigation hover:bg-surface-subtle"
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
          </PanelButton>
        </div>
      )}

      {!collapsed && (
        <>
          {/* Tabs */}
          <div role="tablist" aria-label="Reader tools" className="reader-tool-tablist">
            <section data-testid="reader-tool-group-primary" className="reader-tool-group reader-tool-group-primary">
              <div className="reader-tool-group-tabs">{renderTabs(primaryTabs)}</div>
            </section>
            <PanelButton
              type="button"
              data-testid="reader-more-tools-button"
              aria-expanded={showMoreTools}
              aria-controls="reader-advanced-tools"
              onClick={() => {
                if (showMoreTools && !primaryTabs.some((tab) => tab.key === activeTab)) {
                  setActiveTab('search');
                }
                setShowMoreTools((previous) => !previous);
              }}
              className="reader-more-tools-button text-navigation hover:bg-surface-subtle"
            >
              <span>More tools</span>
              <span aria-hidden="true">{showMoreTools ? '−' : '+'}</span>
            </PanelButton>
            <section id="reader-advanced-tools" className={`reader-tool-group reader-tool-group-advanced ${showMoreTools ? '' : 'hidden'}`}>
              <div className="reader-tool-group-tabs">{renderTabs(advancedTabs)}</div>
            </section>
          </div>
          {/* Content */}
          <div className={activeTab === 'audiobook' ? 'hidden' : 'flex-1 min-h-0 overflow-y-auto'}>
            <div className={activeTab === 'search' ? '' : 'hidden'}><SearchPanel /></div>
            <div className={activeTab === 'summary' ? '' : 'hidden'}><SummaryPanel /></div>
            <div className={activeTab === 'understand' ? '' : 'hidden'}><UnderstandPanel request={understandRequest} /></div>
            <div className={activeTab === 'glossary' ? '' : 'hidden'}><GlossaryPanel /></div>
            <div className={activeTab === 'tags' ? '' : 'hidden'}><TagsPanel /></div>
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
          className="absolute top-0 left-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-surface-hover"
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
