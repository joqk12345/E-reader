declare module 'foliate-js/view.js';

declare module 'foliate-js/epub.js' {
  type EpubLoader = {
    loadText: (href: string) => Promise<string | null>;
    loadBlob: (href: string, mediaType?: string) => Promise<Blob | null>;
    getSize: (href: string) => number;
  };

  export class EPUB {
    constructor(loader: EpubLoader);
    init(): Promise<unknown>;
  }
}
