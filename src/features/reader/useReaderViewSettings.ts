import { useEffect, useState } from 'react';
import {
  loadReaderViewSettings,
  persistReaderViewSettings,
  type ReaderViewSettings,
} from '../../components/readerTheme';

export function useReaderViewSettings(
  readerFontSize: number,
  setReaderFontSize: (size: number) => void,
) {
  const [viewSettings, setViewSettings] = useState<ReaderViewSettings>(() =>
    loadReaderViewSettings(readerFontSize),
  );

  useEffect(() => {
    persistReaderViewSettings(viewSettings);
  }, [viewSettings]);

  useEffect(() => {
    const refresh = () => setViewSettings(loadReaderViewSettings(readerFontSize));
    window.addEventListener('reader:view-settings-updated', refresh as EventListener);
    return () => window.removeEventListener('reader:view-settings-updated', refresh as EventListener);
  }, [readerFontSize]);

  useEffect(() => {
    if (viewSettings.fontSize !== readerFontSize) setReaderFontSize(viewSettings.fontSize);
  }, [readerFontSize, setReaderFontSize, viewSettings.fontSize]);

  return { viewSettings, setViewSettings };
}
