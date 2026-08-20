import { describe, expect, it, vi } from 'vitest';
import {
  openTauriEpubBookSession,
  type FoliatePublicationBook,
  type TauriEpubBookSessionDependencies,
} from './TauriEpubBookSession';

const makeLoader = () => ({
  loadText: vi.fn(async () => '<xml />'),
  loadBlob: vi.fn(async () => new Blob()),
  getSize: vi.fn(() => 12),
  close: vi.fn(async () => undefined),
});

describe('openTauriEpubBookSession', () => {
  it('initializes a foliate book from the scoped loader and closes both exactly once', async () => {
    const loader = makeLoader();
    const book: FoliatePublicationBook = { destroy: vi.fn() };
    const openLoader = vi.fn(async () => loader);
    const initializeBook = vi.fn(async () => book);

    const session = await openTauriEpubBookSession('document-1', {
      openLoader,
      initializeBook,
    });
    expect(openLoader).toHaveBeenCalledWith('document-1');
    expect(initializeBook).toHaveBeenCalledWith(loader);
    expect(session.book).toBe(book);

    await Promise.all([session.close(), session.close()]);
    expect(book.destroy).toHaveBeenCalledTimes(1);
    expect(loader.close).toHaveBeenCalledTimes(1);
  });

  it('blocks publication script resources before foliate loads them', async () => {
    const loader = makeLoader();
    const transformTarget = new EventTarget();
    const session = await openTauriEpubBookSession('document-1', {
      openLoader: async () => loader,
      initializeBook: async () => ({ transformTarget }),
    });
    const scriptLoad = new Event('load') as Event & {
      detail: { isScript: boolean; allow: boolean };
    };
    Object.defineProperty(scriptLoad, 'detail', {
      value: { isScript: true, allow: true },
    });

    transformTarget.dispatchEvent(scriptLoad);
    expect(scriptLoad.detail.allow).toBe(false);

    await session.close();
    scriptLoad.detail.allow = true;
    transformTarget.dispatchEvent(scriptLoad);
    expect(scriptLoad.detail.allow).toBe(true);
  });

  it('closes the publication loader when foliate EPUB initialization fails', async () => {
    const loader = makeLoader();
    const failure = new Error('invalid package document');
    const dependencies: TauriEpubBookSessionDependencies = {
      openLoader: async () => loader,
      initializeBook: async () => {
        throw failure;
      },
    };

    await expect(openTauriEpubBookSession('document-1', dependencies)).rejects.toBe(failure);
    expect(loader.close).toHaveBeenCalledTimes(1);
  });

  it('still closes the opaque loader session when book destruction throws', async () => {
    const loader = makeLoader();
    const destroyFailure = new Error('destroy failed');
    const session = await openTauriEpubBookSession('document-1', {
      openLoader: async () => loader,
      initializeBook: async () => ({
        destroy: () => {
          throw destroyFailure;
        },
      }),
    });

    await expect(session.close()).rejects.toBe(destroyFailure);
    expect(loader.close).toHaveBeenCalledTimes(1);
  });
});
