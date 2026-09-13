import { describe, expect, it } from 'vitest';
import { isSupportedImportExtension, SUPPORTED_IMPORT_EXTENSIONS } from './useLibraryImport';

describe('Markdown removal import boundary', () => {
  it('accepts EPUB only for document imports', () => {
    expect(SUPPORTED_IMPORT_EXTENSIONS).toEqual(['epub']);
    expect(isSupportedImportExtension('book.epub')).toBe(true);
    expect(isSupportedImportExtension('notes.md')).toBe(false);
    expect(isSupportedImportExtension('notes.markdown')).toBe(false);
  });
});
