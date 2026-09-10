import { useMemo } from 'react';
import type { Paragraph } from '../../types';

type DocumentType = 'epub' | 'pdf' | 'markdown';
type MarkdownParagraphMeta = { heading: string | null; inMediaLinks: boolean };
type MarkdownFilterOptions = {
  dropLeadingBeforeFirstH1?: boolean;
  dropLeadingSummarySection?: boolean;
  hideMediaLinksSection?: boolean;
};
type PdfTableGrouping = {
  paragraphs: Paragraph[];
  memberIdsByLeaderId: Map<string, string[]>;
};
type RemoteArticleImage = { src: string; alt: string };

export function useReaderRenderModel({
  currentDocumentType,
  paragraphs,
  supplementalReferences,
  isWebSourceDocument,
  isMultimediaMode,
  remoteArticleImages,
  buildMarkdownParagraphMeta,
  filterVisibleMarkdownParagraphs,
  injectSupplementalReferencesParagraph,
  filterVisiblePdfParagraphs,
  filterLeadingSummaryParagraphs,
  groupPdfTableParagraphs,
  isReaderImagePlaceholderLine,
  normalizeMarkdownForReader,
}: {
  currentDocumentType: DocumentType;
  paragraphs: Paragraph[];
  supplementalReferences: string[];
  isWebSourceDocument: boolean;
  isMultimediaMode: boolean;
  remoteArticleImages: RemoteArticleImage[];
  buildMarkdownParagraphMeta: (paragraphs: Paragraph[]) => Record<string, MarkdownParagraphMeta>;
  filterVisibleMarkdownParagraphs: (paragraphs: Paragraph[], meta: Record<string, MarkdownParagraphMeta>, options: MarkdownFilterOptions) => Paragraph[];
  injectSupplementalReferencesParagraph: (paragraphs: Paragraph[], references: string[]) => Paragraph[];
  filterVisiblePdfParagraphs: (paragraphs: Paragraph[]) => Paragraph[];
  filterLeadingSummaryParagraphs: (paragraphs: Paragraph[]) => Paragraph[];
  groupPdfTableParagraphs: (paragraphs: Paragraph[]) => PdfTableGrouping;
  isReaderImagePlaceholderLine: (line: string) => boolean;
  normalizeMarkdownForReader: (text: string, images: RemoteArticleImage[], cursor?: { current: number }, hasInlineImagePlaceholders?: boolean) => string;
}) {
  const markdownParagraphMeta = useMemo(
    () => currentDocumentType === 'markdown' ? buildMarkdownParagraphMeta(paragraphs) : {},
    [buildMarkdownParagraphMeta, currentDocumentType, paragraphs],
  );
  const markdownFilterOptions = useMemo<MarkdownFilterOptions>(
    () => ({
      dropLeadingBeforeFirstH1: isWebSourceDocument,
      dropLeadingSummarySection: true,
      hideMediaLinksSection: !isMultimediaMode,
    }),
    [isMultimediaMode, isWebSourceDocument],
  );
  const visibleParagraphs = useMemo(() => {
    if (currentDocumentType === 'markdown') {
      return injectSupplementalReferencesParagraph(
        filterVisibleMarkdownParagraphs(paragraphs, markdownParagraphMeta, markdownFilterOptions),
        supplementalReferences,
      );
    }
    if (currentDocumentType === 'pdf') return filterVisiblePdfParagraphs(filterLeadingSummaryParagraphs(paragraphs));
    return filterLeadingSummaryParagraphs(paragraphs);
  }, [currentDocumentType, filterLeadingSummaryParagraphs, filterVisibleMarkdownParagraphs, injectSupplementalReferencesParagraph, markdownFilterOptions, markdownParagraphMeta, paragraphs, supplementalReferences, filterVisiblePdfParagraphs]);

  const { paragraphs: renderParagraphs, memberIdsByLeaderId: pdfTableMemberIdsByLeader } = useMemo(
    () => currentDocumentType === 'pdf'
      ? groupPdfTableParagraphs(visibleParagraphs)
      : { paragraphs: visibleParagraphs, memberIdsByLeaderId: new Map<string, string[]>() },
    [currentDocumentType, groupPdfTableParagraphs, visibleParagraphs],
  );

  const normalizedMarkdownTexts = useMemo(() => {
    const cursor = { current: 0 };
    const normalized: Record<string, string> = {};
    const hasInlineImagePlaceholders = visibleParagraphs.some((paragraph) =>
      paragraph.text.split('\n').some((line) => isReaderImagePlaceholderLine(line)),
    );
    visibleParagraphs.forEach((paragraph) => {
      normalized[paragraph.id] = currentDocumentType === 'markdown'
        ? normalizeMarkdownForReader(
            paragraph.text,
            isMultimediaMode ? remoteArticleImages : [],
            isMultimediaMode ? cursor : undefined,
            isMultimediaMode ? hasInlineImagePlaceholders : false,
          )
        : paragraph.text;
    });
    return normalized;
  }, [currentDocumentType, isMultimediaMode, isReaderImagePlaceholderLine, normalizeMarkdownForReader, remoteArticleImages, visibleParagraphs]);

  return { markdownParagraphMeta, visibleParagraphs, renderParagraphs, pdfTableMemberIdsByLeader, normalizedMarkdownTexts };
}
