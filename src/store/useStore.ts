import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Document, Section, Paragraph } from '../types';

interface ReaderState {
  documents: Document[];
  selectedDocumentId: string | null;
  isLoading: boolean;

  // Reader state
  sections: Section[];
  currentSectionId: string | null;
  paragraphs: Paragraph[];
  currentParagraph: Paragraph | null;

  // Bilingual mode state
  bilingualMode: boolean;
  translationDirection: 'en-zh' | 'zh-en';

  // UI cache
  summaryCache: Record<string, string>;

  // Actions
  loadConfig: () => Promise<void>;
  loadDocuments: () => Promise<void>;
  selectDocument: (id: string) => void;
  importEpub: (filePath: string) => Promise<string>;
  importPdf: (filePath: string) => Promise<string>;
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

  // Bilingual mode actions
  toggleBilingualMode: () => void;
  setTranslationDirection: (direction: 'en-zh' | 'zh-en') => void;

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

  // Bilingual mode state
  bilingualMode: false,
  translationDirection: 'en-zh',

  // Load config
  loadConfig: async () => {
    try {
      const config = await invoke<{ translation_direction: 'en-zh' | 'zh-en' }>('get_config');
      set({ translationDirection: config.translation_direction });
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

  // Bilingual mode actions
  toggleBilingualMode: () => {
    set((state) => ({ bilingualMode: !state.bilingualMode }));
  },
  setTranslationDirection: (direction: 'en-zh' | 'zh-en') => {
    set({ translationDirection: direction });
  },

  setSummaryCache: (key: string, summary: string) => {
    set((state) => ({
      summaryCache: { ...state.summaryCache, [key]: summary },
    }));
  },
}));
