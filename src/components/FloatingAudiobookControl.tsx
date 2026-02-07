import React, { useEffect, useState } from 'react';

type AudiobookControlAction = 'play' | 'toggle-pause' | 'stop';

type AudiobookStateEventDetail = {
  isPlaying: boolean;
  isPaused: boolean;
  currentSentence: string;
  currentProvider: string;
  error: string | null;
  queueSize: number;
};

const initialState: AudiobookStateEventDetail = {
  isPlaying: false,
  isPaused: false,
  currentSentence: '',
  currentProvider: '',
  error: null,
  queueSize: 0,
};

export const FloatingAudiobookControl: React.FC = () => {
  const [state, setState] = useState<AudiobookStateEventDetail>(initialState);
  const [isMinimized, setIsMinimized] = useState(true);
  const [isClosed, setIsClosed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onState = (event: Event) => {
      const customEvent = event as CustomEvent<AudiobookStateEventDetail>;
      if (!customEvent.detail) return;
      setState(customEvent.detail);
    };

    window.addEventListener('reader:audiobook-state', onState as EventListener);
    return () => window.removeEventListener('reader:audiobook-state', onState as EventListener);
  }, []);

  const sendControl = (action: AudiobookControlAction) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('reader:audiobook-control', { detail: { action } }));
  };

  const handleMainAction = () => {
    if (!state.isPlaying) {
      sendControl('play');
      return;
    }
    sendControl('toggle-pause');
  };

  const mainLabel = !state.isPlaying ? 'Play' : state.isPaused ? 'Resume' : 'Pause';
  const hasQueue = state.queueSize > 0;

  if (isClosed) {
    return (
      <button
        onClick={() => setIsClosed(false)}
        className="fixed right-4 bottom-4 z-50 h-11 w-11 rounded-full border border-gray-200 bg-white/95 text-lg shadow-lg backdrop-blur-sm hover:bg-white"
        title="Open audio player"
        aria-label="Open audio player"
      >
        🎧
      </button>
    );
  }

  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="fixed right-4 bottom-4 z-50 h-11 w-11 rounded-full border border-gray-200 bg-white/95 text-lg shadow-lg backdrop-blur-sm hover:bg-white"
        title="Expand audio player"
        aria-label="Expand audio player"
      >
        {state.isPlaying && !state.isPaused ? '🔊' : '🎧'}
      </button>
    );
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 w-72 rounded-xl border border-gray-200 bg-white/95 shadow-lg backdrop-blur-sm">
      <div className="px-3 py-2 border-b border-gray-100 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-gray-700">Audio Player</p>
          {state.currentProvider && <p className="text-[11px] text-gray-500">Provider: {state.currentProvider}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized((prev) => !prev)}
            className="h-6 w-6 rounded text-xs text-gray-600 hover:bg-gray-100"
            title={isMinimized ? 'Expand' : 'Minimize'}
            aria-label={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? '▢' : '—'}
          </button>
          <button
            onClick={() => setIsClosed(true)}
            className="h-6 w-6 rounded text-sm text-gray-600 hover:bg-gray-100"
            title="Close"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>
      {!isMinimized && (
        <>
          <div className="px-3 py-2">
            <p className="text-xs text-gray-700 line-clamp-2 min-h-[2rem]">
              {state.currentSentence || (hasQueue ? 'Ready to play' : 'No readable sentence found')}
            </p>
            {state.error && <p className="mt-1 text-[11px] text-red-600 line-clamp-2">{state.error}</p>}
          </div>
          <div className="px-3 pb-3 flex gap-2">
            <button
              onClick={handleMainAction}
              disabled={!hasQueue}
              className="flex-1 px-3 py-2 text-xs text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {mainLabel}
            </button>
            <button
              onClick={() => sendControl('stop')}
              disabled={!state.isPlaying}
              className="px-3 py-2 text-xs text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:text-gray-400 disabled:bg-gray-100"
            >
              Stop
            </button>
          </div>
        </>
      )}
    </div>
  );
};
