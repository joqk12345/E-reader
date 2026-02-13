import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';
import { detectLang, sanitizeText, splitIntoSentences, type TargetLang } from '../utils/sentences';

type TtsProvider = 'auto' | 'edge' | 'cosyvoice';
type ReadTarget = 'source' | 'translation';

type TtsAudioResponse = {
  audio: number[];
  mime_type: string;
  provider: string;
};

type TtsVoice = {
  provider: string;
  language: string;
  id: string;
  name: string;
};

type AudiobookControlAction = 'play' | 'toggle-pause' | 'stop';

type AudiobookControlEventDetail = {
  action: AudiobookControlAction;
};

type AudiobookStartEventDetail = {
  sentenceKey?: string;
  paragraphId?: string;
};

type AudiobookStateEventDetail = {
  isPlaying: boolean;
  isPaused: boolean;
  currentSentence: string;
  currentProvider: string;
  error: string | null;
  queueSize: number;
};

const toSpeakableText = (input: string): string => {
  return sanitizeText(
    input
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/<https?:\/\/[^>\s]+>/gi, ' ')
      .replace(/\bhttps?:\/\/[^\s)\]>]+/gi, ' ')
      .replace(/\bwww\.[^\s)\]>]+/gi, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/[*_~|]/g, ' ')
  );
};

export const AudiobookPanel: React.FC = () => {
  const { paragraphs, translationMode, setCurrentReadingSentenceKey } = useStore();
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>('auto');
  const [readTarget, setReadTarget] = useState<ReadTarget>('source');
  const [voice, setVoice] = useState('');
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [rate, setRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSentence, setCurrentSentence] = useState('');
  const [currentProvider, setCurrentProvider] = useState('');
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopRequestedRef = useRef(false);
  const playingRef = useRef(false);
  const pausedRef = useRef(false);
  const playbackModeRef = useRef<'audio' | 'speech' | null>(null);
  const playbackSessionRef = useRef(0);

  const sentences = useMemo(() => {
    const isSpeakableSentence = (text: string): boolean => {
      const t = toSpeakableText(text).trim();
      if (!t) return false;
      return /[A-Za-z0-9\u4e00-\u9fff]/.test(t);
    };

    const list: Array<{ key: string; sourceText: string }> = [];
    for (const paragraph of paragraphs) {
      splitIntoSentences(paragraph.text).forEach((sentence, index) => {
        if (!isSpeakableSentence(sentence)) return;
        list.push({
          key: `${paragraph.id}_${index}`,
          sourceText: sentence,
        });
      });
    }
    return list;
  }, [paragraphs]);

  const sentenceIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    sentences.forEach((item, index) => map.set(item.key, index));
    return map;
  }, [sentences]);

  const dominantSourceLang = useMemo<TargetLang>(() => {
    let zh = 0;
    let en = 0;
    for (const item of sentences) {
      if (detectLang(item.sourceText) === 'zh') zh += 1;
      else en += 1;
    }
    return zh > en ? 'zh' : 'en';
  }, [sentences]);

  const activeVoiceLang = useMemo<TargetLang>(() => {
    if (readTarget === 'source') return dominantSourceLang;
    if (translationMode === 'en-zh') return 'zh';
    if (translationMode === 'zh-en') return 'en';
    return dominantSourceLang === 'zh' ? 'en' : 'zh';
  }, [readTarget, translationMode, dominantSourceLang]);

  const voiceProvider = ttsProvider === 'auto' ? 'edge' : ttsProvider;

  const voiceOptions = useMemo(() => {
    return voices.filter((item) => item.provider === voiceProvider && item.language === activeVoiceLang);
  }, [voices, voiceProvider, activeVoiceLang]);

  useEffect(() => {
    let cancelled = false;
    const loadVoices = async () => {
      try {
        const result = await invoke<TtsVoice[]>('list_tts_voices');
        if (cancelled) return;
        setVoices(result);
      } catch (err) {
        console.error('Failed to load TTS voices:', err);
      }
    };
    void loadVoices();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!voice) return;
    if (voiceOptions.some((item) => item.id === voice)) return;
    setVoice('');
  }, [voice, voiceOptions]);

  const stopPlayback = (invalidateSession = true) => {
    if (invalidateSession) {
      playbackSessionRef.current += 1;
    }
    stopRequestedRef.current = true;
    pausedRef.current = false;
    setIsPaused(false);
    setIsPlaying(false);
    setCurrentSentence('');
    setCurrentReadingSentenceKey(null);
    playingRef.current = false;
    playbackModeRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = '';
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  useEffect(() => {
    return () => stopPlayback();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const detail: AudiobookStateEventDetail = {
      isPlaying,
      isPaused,
      currentSentence,
      currentProvider,
      error,
      queueSize: sentences.length,
    };
    window.dispatchEvent(new CustomEvent<AudiobookStateEventDetail>('reader:audiobook-state', { detail }));
  }, [isPlaying, isPaused, currentSentence, currentProvider, error, sentences.length]);

  const resolveTargetLang = (sourceText: string): TargetLang => {
    if (translationMode === 'en-zh') return 'zh';
    if (translationMode === 'zh-en') return 'en';
    return detectLang(sourceText) === 'zh' ? 'en' : 'zh';
  };

  const resolveSentenceForReading = async (sourceSentence: string): Promise<{ text: string; lang: TargetLang }> => {
    if (readTarget === 'source') {
      const cleaned = toSpeakableText(sourceSentence);
      return { text: cleaned, lang: detectLang(cleaned || sourceSentence) };
    }

    const targetLang = resolveTargetLang(sourceSentence);
    const translated = await invoke<string>('translate', {
      text: sourceSentence,
      targetLang,
    });
    return { text: toSpeakableText(translated), lang: targetLang };
  };

  const playAudio = async (audio: number[], mimeType: string): Promise<void> => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const player = audioRef.current;
    const blob = new Blob([new Uint8Array(audio)], { type: mimeType || 'audio/mpeg' });
    const objectUrl = URL.createObjectURL(blob);

    player.src = objectUrl;
    player.playbackRate = 1;
    playbackModeRef.current = 'audio';
    await player.play();

    await new Promise<void>((resolve, reject) => {
      player.onended = () => resolve();
      player.onerror = () => {
        if (stopRequestedRef.current) {
          resolve();
          return;
        }
        reject(new Error('Audio playback failed'));
      };
    }).finally(() => {
      player.onended = null;
      player.onerror = null;
      URL.revokeObjectURL(objectUrl);
    });
  };

  const pickSpeechVoice = (lang: TargetLang): SpeechSynthesisVoice | undefined => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return undefined;
    const prefix = lang === 'zh' ? 'zh' : 'en';
    return (
      voices.find((v) => v.lang.toLowerCase().startsWith(prefix) && v.localService) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ||
      voices[0]
    );
  };

  const playSpeech = async (text: string, lang: TargetLang, speechRate: number): Promise<void> => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      throw new Error('SpeechSynthesis is not available in this environment');
    }

    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickSpeechVoice(lang);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = lang === 'zh' ? 'zh-CN' : 'en-US';
      }
      utterance.rate = Math.min(Math.max(speechRate, 0.8), 1.6);

      utterance.onend = () => resolve();
      utterance.onerror = (event) => {
        if (stopRequestedRef.current || event.error === 'canceled' || event.error === 'interrupted') {
          resolve();
          return;
        }
        reject(new Error(`Speech playback failed: ${event.error}`));
      };

      playbackModeRef.current = 'speech';
      window.speechSynthesis.speak(utterance);
    });
  };

  const startPlayback = async (startFromKey?: string) => {
    if (playingRef.current || sentences.length === 0) return;
    const startIndex = startFromKey ? sentenceIndexByKey.get(startFromKey) ?? 0 : 0;
    const sessionId = playbackSessionRef.current + 1;
    playbackSessionRef.current = sessionId;

    stopRequestedRef.current = false;
    pausedRef.current = false;
    playingRef.current = true;
    setIsPlaying(true);
    setIsPaused(false);
    setError(null);

    try {
      for (let i = startIndex; i < sentences.length; i += 1) {
        if (stopRequestedRef.current || playbackSessionRef.current !== sessionId) break;
        const sentenceItem = sentences[i];
        const sourceSentence = sentenceItem.sourceText;
        setCurrentSentence(sourceSentence);
        setCurrentReadingSentenceKey(sentenceItem.key);

        while (pausedRef.current && !stopRequestedRef.current && playbackSessionRef.current === sessionId) {
          await new Promise((r) => setTimeout(r, 120));
        }
        if (stopRequestedRef.current || playbackSessionRef.current !== sessionId) break;

        const resolved = await resolveSentenceForReading(sourceSentence);
        if (!resolved.text.trim()) {
          continue;
        }
        try {
          const tts = await invoke<TtsAudioResponse>('tts_synthesize', {
            request: {
              text: resolved.text,
              language: resolved.lang,
              provider: ttsProvider,
              voice: voice.trim() || undefined,
              rate,
            },
          });

          setCurrentProvider(tts.provider);
          await playAudio(tts.audio, tts.mime_type);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const shouldFallbackToSpeech =
            ttsProvider !== 'cosyvoice' &&
            (message.includes('No module named edge_tts') || message.includes('Failed to execute python3 edge-tts'));
          if (!shouldFallbackToSpeech) {
            throw err;
          }
          setCurrentProvider('system-webspeech');
          await playSpeech(resolved.text, resolved.lang, rate);
        }
      }
    } catch (err) {
      if (stopRequestedRef.current || playbackSessionRef.current !== sessionId) {
        return;
      }
      console.error('Audiobook playback failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      setError(`Audiobook playback failed: ${message}`);
    } finally {
      if (playbackSessionRef.current === sessionId) {
        stopPlayback(false);
      }
    }
  };

  const startFromSentenceKey = (sentenceKey: string) => {
    if (!sentenceIndexByKey.has(sentenceKey)) return;
    const launch = () => {
      setCurrentReadingSentenceKey(sentenceKey);
      void startPlayback(sentenceKey);
    };
    if (playingRef.current) {
      stopPlayback();
      window.setTimeout(launch, 80);
      return;
    }
    launch();
  };

  const togglePause = async () => {
    if (!isPlaying) return;

    if (playbackModeRef.current === 'speech') {
      if (!('speechSynthesis' in window)) return;
      if (!isPaused) {
        window.speechSynthesis.pause();
        pausedRef.current = true;
        setIsPaused(true);
        return;
      }
      pausedRef.current = false;
      setIsPaused(false);
      window.speechSynthesis.resume();
      return;
    }

    if (!audioRef.current) return;
    if (!isPaused) {
      audioRef.current.pause();
      pausedRef.current = true;
      setIsPaused(true);
      return;
    }
    pausedRef.current = false;
    setIsPaused(false);
    await audioRef.current.play();
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onControl = (event: Event) => {
      const customEvent = event as CustomEvent<AudiobookControlEventDetail>;
      if (!customEvent.detail) return;

      if (customEvent.detail.action === 'play') {
        void startPlayback();
        return;
      }
      if (customEvent.detail.action === 'toggle-pause') {
        void togglePause();
        return;
      }
      if (customEvent.detail.action === 'stop') {
        stopPlayback();
      }
    };

    const onStartFrom = (event: Event) => {
      const customEvent = event as CustomEvent<AudiobookStartEventDetail>;
      if (!customEvent.detail) return;
      const sentenceKey =
        customEvent.detail.sentenceKey ||
        (customEvent.detail.paragraphId
          ? sentences.find((item) => item.key.startsWith(`${customEvent.detail.paragraphId}_`))?.key
          : undefined);
      if (!sentenceKey) return;
      startFromSentenceKey(sentenceKey);
    };

    window.addEventListener('reader:audiobook-control', onControl as EventListener);
    window.addEventListener('reader:audiobook-start', onStartFrom as EventListener);
    return () => {
      window.removeEventListener('reader:audiobook-control', onControl as EventListener);
      window.removeEventListener('reader:audiobook-start', onStartFrom as EventListener);
    };
  }, [sentences, startPlayback, togglePause, sentenceIndexByKey]);

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
          <select
            value={ttsProvider}
            onChange={(e) => setTtsProvider(e.target.value as TtsProvider)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="auto">Auto</option>
            <option value="edge">Edge TTS</option>
            <option value="cosyvoice">CosyVoice</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Read Target</label>
          <select
            value={readTarget}
            onChange={(e) => setReadTarget(e.target.value as ReadTarget)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="source">Source Text</option>
            <option value="translation">Translation Text</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Voice ({activeVoiceLang === 'zh' ? '中文' : 'English'})
          </label>
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">Auto</option>
            {voiceOptions.map((item) => (
              <option key={`${item.provider}-${item.id}`} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Rate: {rate.toFixed(1)}x</label>
          <input
            type="range"
            min={0.8}
            max={1.5}
            step={0.1}
            value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => void startPlayback()}
          disabled={isPlaying || sentences.length === 0}
          className="px-3 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
        >
          Play
        </button>
        <button
          onClick={() => void togglePause()}
          disabled={!isPlaying}
          className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={() => stopPlayback()}
          disabled={!isPlaying}
          className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
        >
          Stop
        </button>
      </div>

      <div className="mt-4 space-y-2 text-xs text-gray-600">
        <p>Sentence queue: {sentences.length}</p>
        {currentProvider && <p>Provider in use: {currentProvider}</p>}
        {currentSentence && <p className="line-clamp-3">Now reading: {currentSentence}</p>}
        {error && <p className="text-red-600">{error}</p>}
      </div>
    </div>
  );
};
