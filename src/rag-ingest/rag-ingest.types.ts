export type BlockKind = 'text' | 'table' | 'image';

export type ExtractedBlock =
  | { kind: 'heading'; level: number; text: string; page?: number }
  | { kind: 'paragraph'; text: string; page?: number }
  | {
      kind: 'table';
      caption?: string;
      header: string[][];
      rows: string[][];
      page?: number;
    }
  | {
      kind: 'image';
      caption?: string;
      contextText?: string;
      page?: number;
      image: { base64: string; mimeType: string; width: number; height: number };
    };

export type ExtractedDocument = {
  title: string;
  pageCount?: number;
  blocks: ExtractedBlock[];
};

export type DraftChunk = {
  chunkKey: string;
  headingPath: string;
  pageFrom: number | null;
  pageTo: number | null;
  blockKind: BlockKind;
  content: string;
  language: 'en' | 'vi';
  /** Index of the image block within ExtractedDocument.blocks. */
  imageBlockIndex?: number;
  /** sha256 of content. */
  sourceContentHash: string;
};
