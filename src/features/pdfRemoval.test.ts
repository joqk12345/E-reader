import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('PDF feature removal boundary', () => {
  it('has no PDF import entry, parser registration, or PDF-only reader component', () => {
    expect(read('src/features/library/useLibraryImport.ts')).not.toContain("extensions: ['epub', 'pdf', 'md']");
    expect(read('src-tauri/src/commands/import.rs')).not.toContain('import_pdf');
    expect(read('src-tauri/src/lib.rs')).not.toContain('import_pdf');
    expect(read('src-tauri/src/parsers/mod.rs')).not.toContain('mod pdf');
    expect(existsSync(resolve(root, 'src-tauri/src/parsers/pdf.rs'))).toBe(false);
    expect(existsSync(resolve(root, 'src/components/PdfParsedFlow.tsx'))).toBe(false);
  });

  it('does not retain the direct PDF parser dependency', () => {
    expect(read('src-tauri/Cargo.toml')).not.toMatch(/^pdf\s*=/m);
  });

  it('does not expose PDF import through the reader store', () => {
    expect(read('src/store/useStore.ts')).not.toContain('importPdf');
    expect(read('src/store/useStore.ts')).not.toContain("invoke<string>('import_pdf'");
  });
});
