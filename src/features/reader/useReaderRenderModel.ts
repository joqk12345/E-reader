import { useMemo } from 'react';
import type { Paragraph } from '../../types';

type DocumentType = 'epub' | 'markdown';
type MarkdownParagraphMeta = { heading: string | null; inMediaLinks: boolean };
type MarkdownFilterOptions = {
  dropLeadingBeforeFirstH1?: boolean;
  dropLeadingSummarySection?: boolean;
  hideMediaLinksSection?: boolean;
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
  filterLeadingSummaryParagraphs,
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
  filterLeadingSummaryParagraphs: (paragraphs: Paragraph[]) => Paragraph[];
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
    return filterLeadingSummaryParagraphs(paragraphs);
  }, [currentDocumentType, filterLeadingSummaryParagraphs, filterVisibleMarkdownParagraphs, injectSupplementalReferencesParagraph, markdownFilterOptions, markdownParagraphMeta, paragraphs, supplementalReferences]);

  const renderParagraphs = visibleParagraphs;

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

  return { markdownParagraphMeta, visibleParagraphs, renderParagraphs, normalizedMarkdownTexts };
}
