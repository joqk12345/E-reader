import { useStore } from '../store/useStore';

export function TOCPanel() {
  const { sections, currentSectionId, selectSection, loadParagraphs } = useStore();

  const handleSectionClick = async (sectionId: string) => {
    selectSection(sectionId);
    await loadParagraphs(sectionId);
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Table of Contents</h2>
      </div>
      <nav className="p-2">
        {sections.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No sections available</p>
        ) : (
          <ul className="space-y-1">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  onClick={() => handleSectionClick(section.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    currentSectionId === section.id
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {section.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}
