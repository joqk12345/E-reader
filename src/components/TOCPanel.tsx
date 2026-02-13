import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

type TOCPanelProps = {
  collapsed: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onToggleCollapse: () => void;
  onWidthChange: (width: number) => void;
};

export function TOCPanel({
  collapsed,
  width,
  minWidth,
  maxWidth,
  onToggleCollapse,
  onWidthChange,
}: TOCPanelProps) {
  const {
    sections,
    currentSectionId,
    currentDocumentType,
    paragraphs,
    selectSection,
    loadParagraphs,
    setFocusedParagraphId,
  } = useStore();
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleSectionClick = async (sectionId: string) => {
    selectSection(sectionId);
    if (currentDocumentType === 'markdown') {
      const firstParagraph = paragraphs.find((p) => p.section_id === sectionId);
      if (firstParagraph) {
        setFocusedParagraphId(firstParagraph.id);
      }
      return;
    }
    await loadParagraphs(sectionId);
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      const delta = event.clientX - dragStateRef.current.startX;
      const nextWidth = Math.min(
        maxWidth,
        Math.max(minWidth, dragStateRef.current.startWidth + delta)
      );
      onWidthChange(nextWidth);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [maxWidth, minWidth, onWidthChange]);

  return (
    <aside
      className="relative bg-white border-r border-gray-200 flex flex-col overflow-hidden flex-shrink-0"
      style={{ width: collapsed ? 48 : width }}
    >
      {collapsed ? (
        <div className="flex items-center justify-center border-b border-gray-200 p-2 flex-shrink-0">
          <button
            onClick={onToggleCollapse}
            className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-gray-100 text-gray-600"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 4l6 6-6 6" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-gray-200 p-4 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Table of Contents</h2>
          <button
            onClick={onToggleCollapse}
            className="ml-2 inline-flex items-center justify-center h-6 w-6 rounded hover:bg-gray-100 text-gray-600"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 4l-6 6 6 6" />
            </svg>
          </button>
        </div>
      )}
      <nav className={`flex-1 overflow-y-auto ${collapsed ? 'p-1' : 'p-2'}`}>
        {sections.length === 0 ? (
          <p className={`text-sm text-gray-500 text-center ${collapsed ? 'py-2' : 'py-4'}`}>
            No sections
          </p>
        ) : (
          <ul className="space-y-1">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  onClick={() => handleSectionClick(section.id)}
                  title={section.title}
                  className={`w-full rounded-md text-sm transition-colors ${
                    collapsed ? 'px-0 py-2 text-center' : 'px-3 py-2 text-left'
                  } ${
                    currentSectionId === section.id
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {collapsed ? section.title.slice(0, 1).toUpperCase() : section.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      {!collapsed && (
        <div
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-gray-200"
          onPointerDown={(event) => {
            dragStateRef.current = { startX: event.clientX, startWidth: width };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />
      )}
    </aside>
  );
}
