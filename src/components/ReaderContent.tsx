import { useStore } from '../store/useStore';

export function ReaderContent() {
  const { paragraphs, isLoading } = useStore();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-sm text-gray-600">Loading content...</p>
        </div>
      </div>
    );
  }

  if (paragraphs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Select a section from the table of contents</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-3xl mx-auto px-8 py-12">
        <article className="prose prose-lg max-w-none">
          {paragraphs.map((paragraph) => (
            <p key={paragraph.id} className="mb-4 text-gray-800 leading-relaxed">
              {paragraph.text}
            </p>
          ))}
        </article>
      </div>
    </div>
  );
}
