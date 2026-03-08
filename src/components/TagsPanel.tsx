import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import type { DocumentTagAssignment, RelatedDocument, TagRecord, TagSuggestion } from '../types';
import {
  applyDocumentTags,
  getRelatedDocumentsByTags,
  listDocumentTags,
  listTagLibrary,
  listTagSuggestions,
  removeDocumentTag,
  reviewTagSuggestions,
  suggestDocumentTags,
} from '../services/tagService';
import { TagNameDialog } from './TagNameDialog';

const findTagByNameOrAlias = (tags: TagRecord[], raw: string) => {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  return (
    tags.find(
      (tag) =>
        tag.name.trim().toLowerCase() === normalized ||
        tag.aliases.some((alias) => alias.alias.trim().toLowerCase() === normalized)
    ) || null
  );
};

export const TagsPanel: React.FC = () => {
  const { selectedDocumentId, documents, selectDocument } = useStore();
  const [appliedTags, setAppliedTags] = useState<DocumentTagAssignment[]>([]);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [tagLibrary, setTagLibrary] = useState<TagRecord[]>([]);
  const [relatedDocs, setRelatedDocs] = useState<RelatedDocument[]>([]);
  const [manualTagDraft, setManualTagDraft] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [createTempDraft, setCreateTempDraft] = useState<{ suggestionId: string; value: string } | null>(null);
  const [mapDraft, setMapDraft] = useState<{ suggestionId: string; value: string } | null>(null);
  const [relatedOriginDocId, setRelatedOriginDocId] = useState<string | null>(null);
  const relatedNavigationRef = useRef<'related' | 'back' | null>(null);

  const selectedDocument = useMemo(
    () => documents.find((item) => item.id === selectedDocumentId) || null,
    [documents, selectedDocumentId]
  );

  const relatedOriginDoc = useMemo(
    () => documents.find((item) => item.id === relatedOriginDocId) || null,
    [documents, relatedOriginDocId]
  );

  const refresh = useCallback(async () => {
    if (!selectedDocumentId) {
      setAppliedTags([]);
      setSuggestions([]);
      setTagLibrary([]);
      setRelatedDocs([]);
      return;
    }
    setIsLoading(true);
    try {
      const [nextTags, nextSuggestions, nextLibrary, nextRelated] = await Promise.all([
        listDocumentTags(selectedDocumentId),
        listTagSuggestions(selectedDocumentId, 'pending'),
        listTagLibrary(),
        getRelatedDocumentsByTags(selectedDocumentId, 8),
      ]);
      setAppliedTags(nextTags);
      setSuggestions(nextSuggestions);
      setTagLibrary(nextLibrary);
      setRelatedDocs(nextRelated);
    } catch (error) {
      console.error('Failed to load tags panel data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDocumentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setRelatedOriginDocId(null);
      relatedNavigationRef.current = null;
      return;
    }
    if (relatedNavigationRef.current) {
      relatedNavigationRef.current = null;
      return;
    }
    setRelatedOriginDocId(null);
  }, [selectedDocumentId]);

  const appliedTagIds = useMemo(() => new Set(appliedTags.map((item) => item.tag_id)), [appliedTags]);

  const filteredLibrary = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    return tagLibrary.filter((tag) => {
      if (appliedTagIds.has(tag.id)) return false;
      if (!query) return true;
      return (
        tag.name.toLowerCase().includes(query) ||
        tag.aliases.some((alias) => alias.alias.toLowerCase().includes(query))
      );
    });
  }, [appliedTagIds, librarySearch, tagLibrary]);

  const handleAddManualTag = async () => {
    const value = manualTagDraft.trim();
    if (!selectedDocumentId || !value) return;
    try {
      await applyDocumentTags({
        doc_ids: [selectedDocumentId],
        tag_names: [value],
        source: 'manual',
        create_as_temporary: false,
      });
      setManualTagDraft('');
      await refresh();
    } catch (error) {
      console.error('Failed to add manual tag:', error);
      alert(`添加标签失败：${String(error)}`);
    }
  };

  const handleApplyExistingTag = async (tagId: string) => {
    if (!selectedDocumentId) return;
    try {
      await applyDocumentTags({
        doc_ids: [selectedDocumentId],
        tag_ids: [tagId],
        source: 'manual',
      });
      await refresh();
    } catch (error) {
      console.error('Failed to apply existing tag:', error);
      alert(`应用标签失败：${String(error)}`);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    if (!selectedDocumentId) return;
    try {
      await removeDocumentTag(selectedDocumentId, tagId);
      await refresh();
    } catch (error) {
      console.error('Failed to remove document tag:', error);
      alert(`移除标签失败：${String(error)}`);
    }
  };

  const handleRefreshSuggestions = async () => {
    if (!selectedDocumentId) return;
    setIsSuggesting(true);
    try {
      await suggestDocumentTags({ doc_id: selectedDocumentId, refresh: true });
      await refresh();
    } catch (error) {
      console.error('Failed to refresh tag suggestions:', error);
      alert(`推荐标签失败：${String(error)}`);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleRejectSuggestion = async (suggestionId: string) => {
    try {
      await reviewTagSuggestions({
        actions: [{ suggestion_ids: [suggestionId], action: 'reject' }],
      });
      await refresh();
    } catch (error) {
      console.error('Failed to reject tag suggestion:', error);
      alert(`拒绝提议失败：${String(error)}`);
    }
  };

  const handleAcceptMatchedSuggestion = async (suggestionId: string) => {
    try {
      await reviewTagSuggestions({
        actions: [{ suggestion_ids: [suggestionId], action: 'accept' }],
      });
      await refresh();
    } catch (error) {
      console.error('Failed to accept matched suggestion:', error);
      alert(`接受提议失败：${String(error)}`);
    }
  };

  const handleCreateTemporaryFromSuggestion = (suggestion: TagSuggestion) => {
    setCreateTempDraft({
      suggestionId: suggestion.id,
      value: suggestion.proposed_name,
    });
  };

  const handleConfirmCreateTemporary = async () => {
    if (!createTempDraft) return;
    try {
      await reviewTagSuggestions({
        actions: [
          {
            suggestion_ids: [createTempDraft.suggestionId],
            action: 'create_tag',
            new_tag_name: createTempDraft.value.trim(),
          },
        ],
      });
      setCreateTempDraft(null);
      await refresh();
    } catch (error) {
      console.error('Failed to create tag from suggestion:', error);
      alert(`创建标签失败：${String(error)}`);
    }
  };

  const handleMapSuggestion = (suggestion: TagSuggestion) => {
    setMapDraft({
      suggestionId: suggestion.id,
      value: suggestion.proposed_name,
    });
  };

  const handleConfirmMapSuggestion = async () => {
    if (!mapDraft) return;
    const matched = findTagByNameOrAlias(tagLibrary, mapDraft.value);
    if (!matched) {
      alert('未找到对应的现有标签。');
      return;
    }
    try {
      await reviewTagSuggestions({
        actions: [
          {
            suggestion_ids: [mapDraft.suggestionId],
            action: 'map_to_existing_tag',
            tag_id: matched.id,
          },
        ],
      });
      setMapDraft(null);
      await refresh();
    } catch (error) {
      console.error('Failed to map tag suggestion:', error);
      alert(`映射标签失败：${String(error)}`);
    }
  };

  const handleOpenRelatedDocument = (docId: string) => {
    if (!selectedDocumentId || docId === selectedDocumentId) return;
    relatedNavigationRef.current = 'related';
    setRelatedOriginDocId((prev) => prev ?? selectedDocumentId);
    selectDocument(docId);
  };

  const handleReturnToOriginalDocument = () => {
    if (!relatedOriginDocId) return;
    relatedNavigationRef.current = 'back';
    const originId = relatedOriginDocId;
    setRelatedOriginDocId(null);
    selectDocument(originId);
  };

  if (!selectedDocumentId || !selectedDocument) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
        No document selected.
      </div>
    );
  }

  return (
    <>
      <TagNameDialog
        open={Boolean(createTempDraft)}
        title="Create Temporary Tag"
        description="Edit the suggested name before creating the temporary tag."
        value={createTempDraft?.value || ''}
        confirmLabel="Create Temp"
        onChange={(value) =>
          setCreateTempDraft((prev) => (prev ? { ...prev, value } : prev))
        }
        onClose={() => setCreateTempDraft(null)}
        onConfirm={() => void handleConfirmCreateTemporary()}
      />
      <TagNameDialog
        open={Boolean(mapDraft)}
        title="Map To Existing Tag"
        description="Enter an existing tag name or alias. This will attach the suggestion to that existing tag instead of creating a new one."
        value={mapDraft?.value || ''}
        confirmLabel="Map"
        onChange={(value) =>
          setMapDraft((prev) => (prev ? { ...prev, value } : prev))
        }
        onClose={() => setMapDraft(null)}
        onConfirm={() => void handleConfirmMapSuggestion()}
      />

      <div className="space-y-4 p-1">
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Applied Tags</h3>
            <p className="text-xs text-gray-500">{selectedDocument.title}</p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={manualTagDraft}
            onChange={(event) => setManualTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleAddManualTag();
              }
            }}
            placeholder="Add manual tag"
            className="h-9 flex-1 rounded-md border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleAddManualTag()}
            disabled={!manualTagDraft.trim()}
            className="rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            Add
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {appliedTags.length === 0 ? (
            <span className="text-xs text-gray-500">No tags applied yet.</span>
          ) : (
            appliedTags.map((tag) => (
              <span
                key={tag.tag_id}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
              >
                #{tag.tag_name}
                {tag.is_temporary && (
                  <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">temp</span>
                )}
                <button
                  type="button"
                  onClick={() => void handleRemoveTag(tag.tag_id)}
                  className="text-slate-500 hover:text-red-600"
                  aria-label={`Remove ${tag.tag_name}`}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Recommended Tags</h3>
            <p className="text-xs text-gray-500">AI first, heuristic fallback. New candidates require review.</p>
          </div>
          <button
            type="button"
            onClick={() => void handleRefreshSuggestions()}
            disabled={isSuggesting}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black disabled:bg-gray-400"
          >
            {isSuggesting ? 'Generating...' : 'Refresh Suggestions'}
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {suggestions.length === 0 ? (
            <div className="text-xs text-gray-500">{isLoading ? 'Loading...' : 'No pending suggestions.'}</div>
          ) : (
            suggestions.map((suggestion) => {
              const matched = Boolean(suggestion.matched_tag_id);
              return (
                <div key={suggestion.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-words text-sm font-semibold text-gray-900">
                          #{suggestion.proposed_name}
                        </span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
                          {suggestion.source}
                        </span>
                        {matched && suggestion.matched_tag_name && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                            match: {suggestion.matched_tag_name}
                          </span>
                        )}
                      </div>
                      {suggestion.reason && <p className="mt-1 text-xs text-gray-600">{suggestion.reason}</p>}
                      {typeof suggestion.confidence === 'number' && (
                        <p className="mt-1 text-[11px] text-gray-500">
                          Confidence: {(suggestion.confidence * 100).toFixed(0)}%
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 sm:max-w-[44%] sm:justify-end">
                      {matched ? (
                        <button
                          type="button"
                          onClick={() => void handleAcceptMatchedSuggestion(suggestion.id)}
                          className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                        >
                          Accept
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleCreateTemporaryFromSuggestion(suggestion)}
                            className="rounded-md bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
                          >
                            Create Temp
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleMapSuggestion(suggestion)}
                            className="rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Map
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleRejectSuggestion(suggestion.id)}
                        className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <h3 className="text-sm font-semibold text-gray-900">Tag Library</h3>
        <input
          value={librarySearch}
          onChange={(event) => setLibrarySearch(event.target.value)}
          placeholder="Search existing tags..."
          className="mt-3 h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
        />
        <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
          {filteredLibrary.length === 0 ? (
            <span className="text-xs text-gray-500">No matching reusable tags.</span>
          ) : (
            filteredLibrary.slice(0, 40).map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => void handleApplyExistingTag(tag.id)}
                className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:border-blue-300 hover:bg-blue-50"
              >
                <span>#{tag.name}</span>
                <span className="text-[10px] text-gray-400">{tag.usage_count}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <h3 className="text-sm font-semibold text-gray-900">Related Articles</h3>
        {relatedOriginDoc && selectedDocumentId !== relatedOriginDoc.id && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Original Article</div>
                <div className="mt-1 truncate text-sm text-blue-900">{relatedOriginDoc.title}</div>
              </div>
              <button
                type="button"
                onClick={handleReturnToOriginalDocument}
                className="shrink-0 rounded-md border border-blue-300 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
              >
                Back
              </button>
            </div>
          </div>
        )}
        <div className="mt-3 space-y-2">
          {relatedDocs.length === 0 ? (
            <div className="text-xs text-gray-500">No related documents with shared tags yet.</div>
          ) : (
            relatedDocs.map((doc) => (
              <button
                key={doc.doc_id}
                type="button"
                onClick={() => handleOpenRelatedDocument(doc.doc_id)}
                className="w-full rounded-lg border border-gray-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">{doc.title}</div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      {doc.shared_tag_count} shared tags · {new Date(doc.updated_at * 1000).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-600">
                    {doc.file_type}
                  </span>
                </div>
                {doc.shared_tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {doc.shared_tags.slice(0, 5).map((tag) => (
                      <span
                        key={`${doc.doc_id}-${tag}`}
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
      </div>
    </>
  );
};
