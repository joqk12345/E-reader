import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Document, Section, Paragraph } from '../types';

export type TranslationMode = 'off' | 'en-zh' | 'zh-en';

type AppConfig = {
  provider: 'lmstudio' | 'openai';
  lm_studio_url: string;
  embedding_model: string;
  chat_model: string;
  openai_api_key?: string;
  openai_base_url?: string;
  translation_mode?: TranslationMode;
  translation_direction?: 'en-zh' | 'zh-en';
  reader_background_color?: string;
  reader_font_size?: number;
};

const normalizeTranslationMode = (mode?: string): TranslationMode => {
  if (mode === 'en-zh' || mode === 'zh-en' || mode === 'off') {
    return mode;
  }
  return 'off';
};

interface ReaderState {
  documents: Document[];
  selectedDocumentId: string | null;
  isLoading: boolean;

  // Reader state
  sections: Section[];
  currentSectionId: string | null;
  paragraphs: Paragraph[];
  currentParagraph: Paragraph | null;

  // Translation mode state
  translationMode: TranslationMode;
  readerBackgroundColor: string;
  readerFontSize: number;

  // UI cache
  summaryCache: Record<string, string>;

  // Actions
  loadConfig: () => Promise<void>;
  loadDocuments: () => Promise<void>;
  selectDocument: (id: string) => void;
  importEpub: (filePath: string) => Promise<string>;
  importPdf: (filePath: string) => Promise<string>;
  importMarkdown: (filePath: string) => Promise<string>;
  deleteDocument: (id: string) => Promise<void>;

  // Reader actions
  loadSections: (docId: string) => Promise<void>;
  loadParagraphs: (sectionId: string) => Promise<void>;
  selectSection: (sectionId: string) => void;
  goBack: () => void;

  // AI actions
  search: (query: string, topK?: number) => Promise<any[]>;
  translate: (text: string, targetLang: 'zh' | 'en') => Promise<string>;
  translateParagraph: (paragraphId: string, targetLang: 'zh' | 'en') => Promise<string>;
  summarize: (targetId: string, type: 'document' | 'section' | 'paragraph', style?: 'brief' | 'detailed' | 'bullet') => Promise<string>;

  // Translation mode actions
  cycleTranslationMode: () => Promise<void>;
  setTranslationMode: (mode: TranslationMode) => void;
  persistTranslationMode: (mode: TranslationMode) => Promise<void>;
  setReaderBackgroundColor: (color: string) => void;
  persistReaderBackgroundColor: (color: string) => Promise<void>;
  setReaderFontSize: (size: number) => void;
  persistReaderFontSize: (size: number) => Promise<void>;

  // UI cache actions
  setSummaryCache: (key: string, summary: string) => void;
}

export const useStore = create<ReaderState>((set, get) => ({
  documents: [],
  selectedDocumentId: null,
  isLoading: false,

  // Reader state
  sections: [],
  currentSectionId: null,
  paragraphs: [],
  currentParagraph: null,

  // Translation mode state
  translationMode: 'off',
  readerBackgroundColor: '#F4F8EE',
  readerFontSize: 18,

  // Load config
  loadConfig: async () => {
    try {
      const config = await invoke<AppConfig>('get_config');
      set({
        translationMode: normalizeTranslationMode(config.translation_mode || config.translation_direction),
        readerBackgroundColor: config.reader_background_color || '#F4F8EE',
        readerFontSize: config.reader_font_size || 18,
      });
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  },

  // UI cache
  summaryCache: {},

  loadDocuments: async () => {
    set({ isLoading: true });
    try {
      const docs = await invoke<Document[]>('list_documents');
      set({ documents: docs, isLoading: false });
    } catch (error) {
      console.error('Failed to load documents:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  selectDocument: (id: string) => {
    set({ selectedDocumentId: id });
  },

  importEpub: async (filePath: string) => {
    set({ isLoading: true });
    try {
      const docId = await invoke<string>('import_epub', { filePath });
      await get().loadDocuments();
      set({ isLoading: false });
      return docId;
    } catch (error) {
      console.error('Failed to import EPUB:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  importPdf: async (filePath: string) => {
    set({ isLoading: true });
    try {
      const docId = await invoke<string>('import_pdf', { filePath });
      await get().loadDocuments();
      set({ isLoading: false });
      return docId;
    } catch (error) {
      console.error('Failed to import PDF:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  importMarkdown: async (filePath: string) => {
    set({ isLoading: true });
    try {
      const docId = await invoke<string>('import_markdown', { filePath });
      await get().loadDocuments();
      set({ isLoading: false });
      return docId;
    } catch (error) {
      console.error('Failed to import Markdown:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  deleteDocument: async (id: string) => {
    set({ isLoading: true });
    try {
      await invoke('delete_document', { id });
      await get().loadDocuments();
      set({ isLoading: false });
    } catch (error) {
      console.error('Failed to delete document:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  // Reader actions
  loadSections: async (docId: string) => {
    set({ isLoading: true });
    try {
      const sections = await invoke<Section[]>('get_document_sections', { docId });
      set({ sections, isLoading: false });
    } catch (error) {
      console.error('Failed to load sections:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  loadParagraphs: async (sectionId: string) => {
    set({ isLoading: true });
    try {
      const paragraphs = await invoke<Paragraph[]>('get_section_paragraphs', { sectionId });
      if (paragraphs.length === 0) {
        console.warn('No paragraphs found for section:', sectionId);
      }
      set({ paragraphs, currentParagraph: paragraphs[0] || null, isLoading: false });
    } catch (error) {
      console.error('Failed to load paragraphs:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  selectSection: (sectionId: string) => {
    set({ currentSectionId: sectionId });
  },

  goBack: () => {
    set({ selectedDocumentId: null, currentSectionId: null, sections: [], paragraphs: [], currentParagraph: null });
  },

  // AI actions
  search: async (query: string, topK: number = 10) => {
    try {
      const results = await invoke('search', {
        options: { query, top_k: topK }
      });
      return results as any[];
    } catch (error) {
      console.error('Search failed:', error);
      throw error;
    }
  },

  translate: async (text: string, targetLang: 'zh' | 'en') => {
    try {
      const translation = await invoke<string>('translate', {
        text,
        targetLang,
      });
      return translation;
    } catch (error) {
      console.error('Translate failed:', error);
      throw error;
    }
  },

  translateParagraph: async (paragraphId: string, targetLang: 'zh' | 'en') => {
    try {
      const translation = await invoke<string>('translate', {
        paragraphId,
        targetLang,
      });
      return translation;
    } catch (error) {
      console.error('Translate paragraph failed:', error);
      throw error;
    }
  },

  summarize: async (targetId: string, type: 'document' | 'section' | 'paragraph', style: 'brief' | 'detailed' | 'bullet' = 'brief') => {
    try {
      const summary = await invoke<string>('summarize', {
        docId: type === 'document' ? targetId : undefined,
        sectionId: type === 'section' ? targetId : undefined,
        paragraphId: type === 'paragraph' ? targetId : undefined,
        style,
      });
      return summary;
    } catch (error) {
      console.error('Summarize failed:', error);
      throw error;
    }
  },

  // Translation mode actions
  cycleTranslationMode: async () => {
    const current = get().translationMode;
    const next: TranslationMode = current === 'off' ? 'en-zh' : current === 'en-zh' ? 'zh-en' : 'off';
    await get().persistTranslationMode(next);
  },
  setTranslationMode: (mode: TranslationMode) => {
    set({ translationMode: mode });
  },
  persistTranslationMode: async (mode: TranslationMode) => {
    const previousMode = get().translationMode;
    set({ translationMode: mode });

    try {
      const config = await invoke<AppConfig>('get_config');
      await invoke('update_config', {
        config: {
          ...config,
          translation_mode: mode,
        },
      });
    } catch (error) {
      set({ translationMode: previousMode });
      console.error('Failed to persist translation mode:', error);
      throw error;
    }
  },
  setReaderBackgroundColor: (color: string) => {
    set({ readerBackgroundColor: color });
  },
  persistReaderBackgroundColor: async (color: string) => {
    const previousColor = get().readerBackgroundColor;
    set({ readerBackgroundColor: color });

    try {
      const config = await invoke<AppConfig>('get_config');
      await invoke('update_config', {
        config: {
          ...config,
          reader_background_color: color,
        },
      });
    } catch (error) {
      set({ readerBackgroundColor: previousColor });
      console.error('Failed to persist reader background color:', error);
      throw error;
    }
  },
  setReaderFontSize: (size: number) => {
    set({ readerFontSize: size });
  },
  persistReaderFontSize: async (size: number) => {
    const previousSize = get().readerFontSize;
    set({ readerFontSize: size });

    try {
      const config = await invoke<AppConfig>('get_config');
      await invoke('update_config', {
        config: {
          ...config,
          reader_font_size: size,
        },
      });
    } catch (error) {
      set({ readerFontSize: previousSize });
      console.error('Failed to persist reader font size:', error);
      throw error;
    }
  },

  setSummaryCache: (key: string, summary: string) => {
    set((state) => ({
      summaryCache: { ...state.summaryCache, [key]: summary },
    }));
  },
}));
