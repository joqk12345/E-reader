import { useEffect, useState } from 'react';

const MIN_SIDEBAR_WIDTH = 196;
const MAX_SIDEBAR_WIDTH = 320;

export function useLibrarySidebarResize(initialWidth = 224) {
  const [sidebarWidth, setSidebarWidth] = useState(initialWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const onPointerMove = (event: PointerEvent) => {
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, event.clientX)));
    };
    const onPointerUp = () => setIsResizingSidebar(false);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isResizingSidebar]);

  return {
    sidebarWidth,
    isResizingSidebar,
    beginResize: () => setIsResizingSidebar(true),
  };
}
