import { useCallback, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

type LibraryImportDependencies = {
  loadDocuments: () => Promise<unknown>;
  importEpub: (path: string) => Promise<unknown>;
  importPdf: (path: string) => Promise<string>;
  importMarkdown: (path: string) => Promise<unknown>;
  selectDocument: (id: string) => void;
};

const formatImportErrorMessage = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const normalized = raw.toLowerCase();
  const isDuplicateFile =
    normalized.includes('unique constraint failed: documents.file_path') ||
    (normalized.includes('documents.file_path') && normalized.includes('unique'));

  if (isDuplicateFile) {
    return '该文件已导入到 Library，无需重复导入。';
  }
  return `导入失败：${raw}`;
};

const normalizeUrl = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
};

export function useLibraryImport({
  loadDocuments,
  importEpub,
  importPdf,
  importMarkdown,
  selectDocument,
}: LibraryImportDependencies) {
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [isImportingUrl, setIsImportingUrl] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importUrlDraft, setImportUrlDraft] = useState('');

  const handleImportFile = useCallback(async () => {
    setIsImportingFile(true);
    let importedSuccessfully = false;
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Documents', extensions: ['epub', 'pdf', 'md'] }],
      });

      if (selected && typeof selected === 'string') {
        const ext = selected.split('.').pop()?.toLowerCase();
        if (ext === 'epub') {
          await importEpub(selected);
          importedSuccessfully = true;
        } else if (ext === 'pdf') {
          const docId = await importPdf(selected);
          selectDocument(docId);
          importedSuccessfully = true;
        } else if (ext === 'md') {
          await importMarkdown(selected);
          importedSuccessfully = true;
        }
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert(formatImportErrorMessage(error));
    } finally {
      setIsImportingFile(false);
      if (importedSuccessfully) setShowImportDialog(false);
    }
  }, [importEpub, importMarkdown, importPdf, selectDocument]);

  const handleImportUrlBeta = useCallback(async () => {
    const url = normalizeUrl(importUrlDraft);
    if (!url) return;
    setIsImportingUrl(true);
    let importedSuccessfully = false;
    try {
      const docId = await invoke<string>('import_url', { url });
      await loadDocuments();
      selectDocument(docId);
      importedSuccessfully = true;
    } catch (error) {
      console.error('Import URL failed:', error);
      alert(formatImportErrorMessage(error));
    } finally {
      setIsImportingUrl(false);
      if (importedSuccessfully) {
        setImportUrlDraft('');
        setShowImportDialog(false);
      }
    }
  }, [importUrlDraft, loadDocuments, selectDocument]);

  return {
    isImportingFile,
    isImportingUrl,
    showImportDialog,
    setShowImportDialog,
    importUrlDraft,
    setImportUrlDraft,
    handleImportFile,
    handleImportUrlBeta,
  };
}
