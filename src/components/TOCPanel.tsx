import { useEffect, useRef } from 'react';
import { PanelButton } from './ui/Button';
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
      if (firstParagraph) setFocusedParagraphId(firstParagraph.id);
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
      data-testid="reader-toc-panel"
      aria-label="Table of contents"
      className="relative bg-surface border-r border-border flex flex-col overflow-hidden flex-shrink-0"
      style={{ width: collapsed ? 48 : width }}
    >
      {collapsed ? (
        <div className="reader-panel-header justify-center p-2">
          <PanelButton
            onClick={onToggleCollapse}
            className="reader-panel-action text-navigation hover:bg-surface-subtle"
            title="Expand sidebar"
            aria-label="Expand sidebar"
            aria-expanded={!collapsed}
            aria-controls={!collapsed ? 'reader-toc-navigation' : undefined}
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
          </PanelButton>
        </div>
      ) : (
        <div className="reader-panel-header">
          <h2 className="text-size-title font-semibold text-heading">Table of Contents</h2>
          <PanelButton
            onClick={onToggleCollapse}
            className="reader-panel-action ml-2 text-navigation hover:bg-surface-subtle"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            aria-expanded={!collapsed}
            aria-controls={!collapsed ? 'reader-toc-navigation' : undefined}
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
          </PanelButton>
        </div>
      )}
      {!collapsed && (
        <nav id="reader-toc-navigation" className="flex-1 overflow-y-auto p-2">
          {sections.length === 0 ? (
            <p className="py-4 text-center text-size-subheading text-muted">
              No sections
            </p>
          ) : (
            <ul className="space-y-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <PanelButton
                    onClick={() => handleSectionClick(section.id)}
                    title={section.title}
                    className={`w-full rounded-md px-3 py-2 text-left text-size-subheading transition-colors ${
                      currentSectionId === section.id
                        ? 'bg-action-subtle text-action-text font-medium'
                        : 'text-secondary hover:bg-surface-subtle'
                    }`}
                  >
                    {section.title}
                  </PanelButton>
                </li>
              ))}
            </ul>
          )}
        </nav>
      )}
      {!collapsed && (
        <div
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-surface-hover"
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
