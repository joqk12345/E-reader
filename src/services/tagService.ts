import { invoke } from '@tauri-apps/api/core';
import type {
  ApplyDocumentTagsResponse,
  BatchTagReviewItem,
  CleanupUnusedTagsResponse,
  DocumentTagAssignment,
  RelatedDocument,
  ReviewTagSuggestionsRequest,
  ReviewTagSuggestionsResult,
  SuggestTagsForDocumentsResponse,
  TagAlias,
  TagFacet,
  TagRecord,
  TagSuggestion,
} from '../types';

export type ListTagLibraryRequest = {
  search?: string;
  only_temporary?: boolean;
  only_unused?: boolean;
};

export type ApplyDocumentTagsRequest = {
  doc_ids: string[];
  tag_ids?: string[];
  tag_names?: string[];
  source?: string;
  create_as_temporary?: boolean;
};

export type SuggestDocumentTagsRequest = {
  doc_id: string;
  refresh?: boolean;
};

export type SuggestTagsForDocumentsRequest = {
  doc_ids: string[];
  refresh?: boolean;
};

export type RenameTagRequest = {
  tag_id: string;
  new_name: string;
};

export type MergeTagsRequest = {
  source_tag_id: string;
  target_tag_id: string;
};

export type AddTagAliasRequest = {
  tag_id: string;
  alias: string;
};

export type RemoveTagAliasRequest = {
  alias_id: string;
};

export type PromoteTemporaryTagRequest = {
  tag_id: string;
};

export const listDocumentTags = (docId?: string | null) =>
  invoke<DocumentTagAssignment[]>('list_document_tags', { docId: docId ?? null });

export const listTagLibrary = (request?: ListTagLibraryRequest) =>
  invoke<TagRecord[]>('list_tag_library', { request: request ?? null });

export const listTagFacets = (search?: string) =>
  invoke<TagFacet[]>('list_tag_facets', { search: search ?? null });

export const listTagSuggestions = (docId?: string | null, status?: string | null) =>
  invoke<TagSuggestion[]>('list_tag_suggestions', {
    docId: docId ?? null,
    status: status ?? null,
  });

export const listBatchTagReviewItems = () =>
  invoke<BatchTagReviewItem[]>('list_batch_tag_review_items');

export const getRelatedDocumentsByTags = (docId: string, limit = 8) =>
  invoke<RelatedDocument[]>('get_related_documents_by_tags', { docId, limit });

export const applyDocumentTags = (request: ApplyDocumentTagsRequest) =>
  invoke<ApplyDocumentTagsResponse>('apply_document_tags', { request });

export const removeDocumentTag = (docId: string, tagId: string) =>
  invoke<void>('remove_document_tag', { docId, tagId });

export const suggestDocumentTags = (request: SuggestDocumentTagsRequest) =>
  invoke<TagSuggestion[]>('suggest_document_tags', { request });

export const suggestTagsForDocuments = (request: SuggestTagsForDocumentsRequest) =>
  invoke<SuggestTagsForDocumentsResponse>('suggest_tags_for_documents', { request });

export const reviewTagSuggestions = (request: ReviewTagSuggestionsRequest) =>
  invoke<ReviewTagSuggestionsResult>('review_tag_suggestions', { request });

export const renameTag = (request: RenameTagRequest) =>
  invoke<TagRecord>('rename_tag', { request });

export const mergeTags = (request: MergeTagsRequest) =>
  invoke<TagRecord>('merge_tags', { request });

export const addTagAlias = (request: AddTagAliasRequest) =>
  invoke<TagAlias>('add_tag_alias', { request });

export const removeTagAlias = (request: RemoveTagAliasRequest) =>
  invoke<void>('remove_tag_alias', { request });

export const promoteTemporaryTag = (request: PromoteTemporaryTagRequest) =>
  invoke<TagRecord>('promote_temporary_tag', { request });

export const cleanupUnusedTags = () =>
  invoke<CleanupUnusedTagsResponse>('cleanup_unused_tags');
