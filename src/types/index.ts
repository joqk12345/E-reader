export interface Document {
  id: string;
  title: string;
  author?: string;
  language?: string;
  file_path: string;
  file_type: 'epub' | 'pdf';
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
