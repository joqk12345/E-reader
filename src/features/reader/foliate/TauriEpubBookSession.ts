import {
  TauriPublicationLoader,
  type PublicationLoadMetrics,
} from './TauriPublicationLoader';

export type FoliatePublicationBook = {
  toc?: unknown[];
  dir?: 'ltr' | 'rtl';
  rendition?: { layout?: string };
  transformTarget?: EventTarget;
  destroy?: () => void;
};

type FoliateLoader = Pick<TauriPublicationLoader, 'loadText' | 'loadBlob' | 'getSize' | 'close'> &
  Partial<Pick<TauriPublicationLoader, 'getMetrics'>>;

export type TauriEpubBookSessionDependencies = {
  openLoader?: (documentId: string) => Promise<FoliateLoader>;
  initializeBook?: (loader: FoliateLoader) => Promise<FoliatePublicationBook>;
};

export type TauriEpubBookSession = {
  book: FoliatePublicationBook;
  getMetrics: () => PublicationLoadMetrics | null;
  close: () => Promise<void>;
};

class PublicationCleanupError extends Error {
  constructor(message: string, readonly errors: readonly unknown[]) {
    super(message);
    this.name = 'PublicationCleanupError';
  }
}

const openDefaultLoader = (documentId: string): Promise<TauriPublicationLoader> =>
  TauriPublicationLoader.open(documentId);

const initializeDefaultBook = async (
  loader: FoliateLoader
): Promise<FoliatePublicationBook> => {
  const { EPUB } = await import('foliate-js/epub.js');
  return new EPUB(loader).init() as Promise<FoliatePublicationBook>;
};

const closeAfterInitializationFailure = async (
  loader: FoliateLoader,
  initializationError: unknown
): Promise<never> => {
  try {
    await loader.close();
  } catch (closeError) {
    throw new PublicationCleanupError(
      'EPUB initialization and publication session cleanup both failed',
      [initializationError, closeError]
    );
  }
  throw initializationError;
};

export async function openTauriEpubBookSession(
  documentId: string,
  dependencies: TauriEpubBookSessionDependencies = {}
): Promise<TauriEpubBookSession> {
  const openLoader = dependencies.openLoader ?? openDefaultLoader;
  const initializeBook = dependencies.initializeBook ?? initializeDefaultBook;
  const loader = await openLoader(documentId);

  let book: FoliatePublicationBook;
  try {
    book = await initializeBook(loader);
  } catch (error) {
    return closeAfterInitializationFailure(loader, error);
  }

  const blockScriptResource = (event: Event): void => {
    const detail = (event as Event & {
      detail?: { isScript?: boolean; allow?: boolean };
    }).detail;
    if (detail?.isScript) detail.allow = false;
  };
  book.transformTarget?.addEventListener('load', blockScriptResource);

  let closePromise: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      let destroyError: unknown;
      book.transformTarget?.removeEventListener('load', blockScriptResource);
      try {
        book.destroy?.();
      } catch (error) {
        destroyError = error;
      }

      try {
        await loader.close();
      } catch (closeError) {
        if (destroyError) {
          throw new PublicationCleanupError(
            'Foliate book destruction and publication session cleanup both failed',
            [destroyError, closeError]
          );
        }
        throw closeError;
      }
      if (destroyError) throw destroyError;
    })();
    return closePromise;
  };

  return {
    book,
    getMetrics: () => loader.getMetrics?.() ?? null,
    close,
  };
}
