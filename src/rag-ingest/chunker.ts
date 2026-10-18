import { createHash } from 'crypto';
import {
  BlockKind,
  DraftChunk,
  ExtractedDocument,
} from './rag-ingest.types';
import { tableToTexts } from './table-to-text';
import {
  countWords,
  detectLanguage,
  normalizeMultiline,
  normalizeText,
} from './text-normalize';

export const CHUNK_MIN_WORDS = 300;
export const CHUNK_MAX_WORDS = 800;

const PATH_SEPARATOR = ' › ';
const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+/;

type Piece = {
  kind: BlockKind;
  /** Full heading path of the chunk. */
  path: string;
  /** Heading path of the parent heading (used to decide merges). */
  parentPath: string;
  text: string;
  words: number;
  pages: number[];
  imageBlockIndex?: number;
};

type Para = { text: string; words: number; pages: number[] };

const pagesOf = (page: number | undefined): number[] =>
  page === undefined ? [] : [page];

function hardSplitByWords(text: string, max: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  for (let i = 0; i < words.length; i += max) {
    out.push(words.slice(i, i + max).join(' '));
  }
  return out;
}

/** Splits an oversized paragraph into pieces of at most `max` words, by sentence. */
function splitLongParagraph(text: string, max: number): string[] {
  const sentences = text.split(SENTENCE_BOUNDARY).filter((s) => s !== '');
  const out: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  const flush = () => {
    if (current.length > 0) out.push(current.join(' '));
    current = [];
    currentWords = 0;
  };
  for (const sentence of sentences) {
    const w = countWords(sentence);
    if (w > max) {
      flush();
      out.push(...hardSplitByWords(sentence, max));
      continue;
    }
    if (currentWords + w > max) flush();
    current.push(sentence);
    currentWords += w;
  }
  flush();
  return out;
}

/** Packs a section's paragraphs into pieces of at most `max` words. */
function splitSection(
  paras: Para[],
  max: number,
): { text: string; pages: number[] }[] {
  const out: { text: string; pages: number[] }[] = [];
  let current: Para[] = [];
  let currentWords = 0;
  const flush = () => {
    if (current.length > 0) {
      out.push({
        text: current.map((p) => p.text).join('\n\n'),
        pages: current.flatMap((p) => p.pages),
      });
    }
    current = [];
    currentWords = 0;
  };
  for (const para of paras) {
    if (para.words > max) {
      flush();
      for (const part of splitLongParagraph(para.text, max)) {
        out.push({ text: part, pages: para.pages });
      }
      continue;
    }
    if (current.length > 0 && currentWords + para.words > max) flush();
    current.push(para);
    currentWords += para.words;
  }
  flush();
  return out;
}

function pageRange(pages: number[]): { from: number | null; to: number | null } {
  if (pages.length === 0) return { from: null, to: null };
  return { from: Math.min(...pages), to: Math.max(...pages) };
}

function mergeSmallTextPieces(pieces: Piece[], min: number, max: number): Piece[] {
  const out: Piece[] = [];
  for (const piece of pieces) {
    const last = out[out.length - 1];
    if (
      last &&
      last.kind === 'text' &&
      piece.kind === 'text' &&
      last.words < min &&
      last.parentPath === piece.parentPath &&
      last.words + piece.words <= max
    ) {
      out[out.length - 1] = {
        ...last,
        path: last.path === piece.path ? last.path : last.parentPath,
        text: `${last.text}\n\n${piece.text}`,
        words: last.words + piece.words,
        pages: [...last.pages, ...piece.pages],
      };
    } else {
      out.push(piece);
    }
  }
  return out;
}

export function chunkDocument(
  doc: ExtractedDocument,
  imageTexts: Map<number, string>,
): DraftChunk[] {
  const pieces: Piece[] = [];
  const stack: { level: number; text: string }[] = [];
  let paras: Para[] = [];

  const currentPath = () => stack.map((h) => h.text).join(PATH_SEPARATOR);
  const parentPath = () =>
    stack
      .slice(0, -1)
      .map((h) => h.text)
      .join(PATH_SEPARATOR);

  const flushParas = () => {
    if (paras.length === 0) return;
    const path = currentPath();
    const parent = parentPath();
    for (const part of splitSection(paras, CHUNK_MAX_WORDS)) {
      pieces.push({
        kind: 'text',
        path,
        parentPath: parent,
        text: part.text,
        words: countWords(part.text),
        pages: part.pages,
      });
    }
    paras = [];
  };

  doc.blocks.forEach((block, index) => {
    switch (block.kind) {
      case 'heading': {
        flushParas();
        const text = normalizeText(block.text);
        if (text === '') return;
        while (stack.length > 0 && stack[stack.length - 1].level >= block.level) {
          stack.pop();
        }
        stack.push({ level: block.level, text });
        return;
      }
      case 'paragraph': {
        const text = normalizeMultiline(block.text);
        if (text === '') return;
        paras.push({ text, words: countWords(text), pages: pagesOf(block.page) });
        return;
      }
      case 'table': {
        flushParas();
        for (const raw of tableToTexts(block, CHUNK_MAX_WORDS)) {
          const text = normalizeMultiline(raw);
          if (text === '') continue;
          pieces.push({
            kind: 'table',
            path: currentPath(),
            parentPath: parentPath(),
            text,
            words: countWords(text),
            pages: pagesOf(block.page),
          });
        }
        return;
      }
      case 'image': {
        flushParas();
        const transcription = imageTexts.get(index);
        if (transcription === undefined) return;
        const body = normalizeMultiline(transcription);
        if (body === '') return;
        const caption = normalizeText(block.caption ?? '');
        const text = caption === '' ? body : `${caption}\n${body}`;
        pieces.push({
          kind: 'image',
          path: currentPath(),
          parentPath: parentPath(),
          text,
          words: countWords(text),
          pages: pagesOf(block.page),
          imageBlockIndex: index,
        });
        return;
      }
    }
  });
  flushParas();

  const merged = mergeSmallTextPieces(pieces, CHUNK_MIN_WORDS, CHUNK_MAX_WORDS);

  const ordinals = new Map<string, number>();
  return merged.map((piece) => {
    const counterKey = `${piece.path}|${piece.kind}`;
    const ordinal = ordinals.get(counterKey) ?? 0;
    ordinals.set(counterKey, ordinal + 1);
    const content = normalizeMultiline(piece.text);
    const { from, to } = pageRange(piece.pages);
    const chunk: DraftChunk = {
      chunkKey: createHash('sha1')
        .update(`${piece.path}|${piece.kind}|${ordinal}`)
        .digest('hex')
        .slice(0, 16),
      headingPath: piece.path,
      pageFrom: from,
      pageTo: to,
      blockKind: piece.kind,
      content,
      language: detectLanguage(content),
      sourceContentHash: createHash('sha256').update(content).digest('hex'),
    };
    if (piece.imageBlockIndex !== undefined) {
      chunk.imageBlockIndex = piece.imageBlockIndex;
    }
    return chunk;
  });
}

export function buildEmbeddingText(
  docTitle: string,
  chunk: { headingPath: string; content: string },
): string {
  return [docTitle, chunk.headingPath, chunk.content]
    .filter((part) => part !== '')
    .join('\n');
}
