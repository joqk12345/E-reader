export interface Document {
  id: string;
  title: string;
  author?: string;
  language?: string;
  file_path: string;
  file_type: 'epub' | 'pdf' | 'markdown';
  created_at: number;
  updated_at: number;
}

export interface Section {
  id: string;
  doc_id: string;
  title: string;
  order_index: number;
  href: string;
}

export interface Paragraph {
  id: string;
  doc_id: string;
  section_id: string;
  order_index: number;
  text: string;
  location: string;
}

export interface ImportResult {
  docId: string;
}

export type AnnotationStyle =
  | 'single_underline'
  | 'double_underline'
  | 'wavy_strikethrough';

export interface Annotation {
  id: string;
  paragraph_id: string;
  selected_text: string;
  style: AnnotationStyle;
  note?: string | null;
  created_at: number;
  updated_at: number;
}

export interface TagAlias {
  id: string;
  tag_id: string;
  alias: string;
  normalized_alias: string;
  created_at: number;
  updated_at: number;
}

export interface TagRecord {
  id: string;
  name: string;
  normalized_name: string;
  is_temporary: boolean;
  created_at: number;
  updated_at: number;
  usage_count: number;
  pending_suggestion_count: number;
  aliases: TagAlias[];
}

export interface DocumentTagAssignment {
  doc_id: string;
  tag_id: string;
  tag_name: string;
  normalized_name: string;
  is_temporary: boolean;
  source: string;
  applied_at: number;
}

export interface TagSuggestion {
  id: string;
  doc_id: string;
  proposed_name: string;
  normalized_name: string;
  matched_tag_id?: string | null;
  matched_tag_name?: string | null;
  source: string;
  status: string;
  reason?: string | null;
  confidence?: number | null;
  created_at: number;
  updated_at: number;
}

export interface TagFacet {
  tag_id: string;
  name: string;
  normalized_name: string;
  count: number;
  is_temporary: boolean;
}

export interface RelatedDocument {
  doc_id: string;
  title: string;
  file_type: 'epub' | 'pdf' | 'markdown' | string;
  updated_at: number;
  shared_tag_count: number;
  shared_tags: string[];
}

export interface BatchTagReviewDoc {
  doc_id: string;
  title: string;
}

export interface BatchTagReviewItem {
  normalized_name: string;
  proposed_name: string;
  matched_tag_id?: string | null;
  matched_tag_name?: string | null;
  doc_count: number;
  suggestion_ids: string[];
  sample_docs: BatchTagReviewDoc[];
  reasons: string[];
}

export interface ReviewTagSuggestionsAction {
  suggestion_ids: string[];
  action: 'reject' | 'accept' | 'map_to_existing_tag' | 'create_tag';
  tag_id?: string;
  new_tag_name?: string;
}

export interface ReviewTagSuggestionsRequest {
  actions: ReviewTagSuggestionsAction[];
}

export interface ReviewTagSuggestionsResult {
  accepted: number;
  rejected: number;
  created_tags: number;
  mapped_to_existing: number;
}

export interface ApplyDocumentTagsResponse {
  applied: number;
  tags: TagRecord[];
}

export interface SuggestTagsForDocumentsResponse {
  processed_docs: number;
  created_suggestions: number;
  matched_pending: number;
  new_candidate_pending: number;
}

export interface CleanupUnusedTagsResponse {
  deleted: number;
}
