import { useCallback, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export const SUPPORTED_IMPORT_EXTENSIONS = ['epub'] as const;

export const isSupportedImportExtension = (filePath: string): boolean =>
  SUPPORTED_IMPORT_EXTENSIONS.includes(
    filePath.split('.').pop()?.toLowerCase() as (typeof SUPPORTED_IMPORT_EXTENSIONS)[number]
  );

type LibraryImportDependencies = {
  loadDocuments: () => Promise<unknown>;
  importEpub: (path: string) => Promise<unknown>;
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
        filters: [{ name: 'EPUB books', extensions: [...SUPPORTED_IMPORT_EXTENSIONS] }],
      });

      if (selected && typeof selected === 'string') {
        const ext = selected.split('.').pop()?.toLowerCase();
        if (ext === 'epub') {
          await importEpub(selected);
          importedSuccessfully = true;
        } else if (isSupportedImportExtension(selected)) {
          await importEpub(selected);
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
  }, [importEpub]);

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
