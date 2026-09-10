import { useCallback, useRef, useState } from 'react';

export function useReaderPanelLayout() {
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [tocWidth, setTocWidth] = useState(256);
  const [headerToolsCollapsed, setHeaderToolsCollapsed] = useState(true);
  // Keep the reading viewport primary on a fresh reader session. The tool workspace
  // remains available through its compact rail without competing with the TOC.
  const [toolCollapsed, setToolCollapsed] = useState(true);
  const [toolWidth, setToolWidth] = useState(320);
  const [readingMode, setReadingMode] = useState(false);
  const readingModeSnapshotRef = useRef<{
    headerToolsCollapsed: boolean;
    tocCollapsed: boolean;
    toolCollapsed: boolean;
  } | null>(null);

  const applyReadingMode = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        if (!readingModeSnapshotRef.current) {
          readingModeSnapshotRef.current = { headerToolsCollapsed, tocCollapsed, toolCollapsed };
        }
        setHeaderToolsCollapsed(true);
        setTocCollapsed(true);
        setToolCollapsed(true);
      } else {
        const snapshot = readingModeSnapshotRef.current;
        if (snapshot) {
          setHeaderToolsCollapsed(snapshot.headerToolsCollapsed);
          setTocCollapsed(snapshot.tocCollapsed);
          setToolCollapsed(snapshot.toolCollapsed);
          readingModeSnapshotRef.current = null;
        }
      }
      setReadingMode(enabled);
      window.dispatchEvent(new CustomEvent('reader:reading-mode-changed', { detail: { enabled } }));
    },
    [headerToolsCollapsed, tocCollapsed, toolCollapsed],
  );

  const toggleReadingMode = useCallback(() => {
    applyReadingMode(!readingMode);
  }, [applyReadingMode, readingMode]);

  return {
    tocCollapsed,
    setTocCollapsed,
    tocWidth,
    setTocWidth,
    headerToolsCollapsed,
    setHeaderToolsCollapsed,
    toolCollapsed,
    setToolCollapsed,
    toolWidth,
    setToolWidth,
    readingMode,
    applyReadingMode,
    toggleReadingMode,
    minTocWidth: 200,
    maxTocWidth: 420,
    minToolWidth: 280,
    maxToolWidth: 460,
  };
}
