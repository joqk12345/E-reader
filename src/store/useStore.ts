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

  // Actions
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
}));
