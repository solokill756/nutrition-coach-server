import { createHash } from 'crypto';
import {
  buildEmbeddingText,
  CHUNK_MAX_WORDS,
  chunkDocument,
} from './chunker';
import { ExtractedBlock, ExtractedDocument } from './rag-ingest.types';
import { countWords } from './text-normalize';

const words = (n: number, prefix = 'w'): string =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
const h = (level: number, text: string, page?: number): ExtractedBlock => ({
  kind: 'heading',
  level,
  text,
  page,
});
const p = (text: string, page?: number): ExtractedBlock => ({
  kind: 'paragraph',
  text,
  page,
});
const doc = (blocks: ExtractedBlock[]): ExtractedDocument => ({
  title: 'T',
  blocks,
});
const image = (caption?: string, page?: number): ExtractedBlock => ({
  kind: 'image',
  caption,
  page,
  image: { base64: '', mimeType: 'image/png', width: 1, height: 1 },
});

describe('chunker', () => {
  it('(a) merges small sibling sections under the same parent', () => {
    const chunks = chunkDocument(
      doc([h(1, 'H1'), h(2, 'A'), p(words(100)), h(2, 'B'), p(words(100, 'v'))]),
      new Map(),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('H1');
    expect(chunks[0].content).toContain('\n\n');
    expect(countWords(chunks[0].content)).toBe(200);
  });

  it('does not merge across a table or across different parents', () => {
    const table: ExtractedBlock = {
      kind: 'table',
      header: [['A', 'B']],
      rows: [['1', '2']],
    };
    const chunks = chunkDocument(
      doc([h(1, 'H'), p(words(50)), table, p(words(50, 'v'))]),
      new Map(),
    );
    expect(chunks.map((c) => c.blockKind)).toEqual(['text', 'table', 'text']);
    expect(chunks[0].headingPath).toBe('H');
    const nested = chunkDocument(
      doc([h(1, 'X'), p(words(10)), h(2, 'Y'), p(words(10, 'v'))]),
      new Map(),
    );
    expect(nested.map((c) => c.headingPath)).toEqual(['X', 'X › Y']);
  });

  it('text before any heading has an empty headingPath', () => {
    const chunks = chunkDocument(doc([p('hello world')]), new Map());
    expect(chunks[0].headingPath).toBe('');
  });

  it('(b) splits a 2000-word section at paragraph boundaries', () => {
    const paras = Array.from({ length: 10 }, (_, i) => p(words(200, `p${i}_`)));
    const chunks = chunkDocument(doc([h(1, 'Big'), ...paras]), new Map());
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      expect(countWords(c.content)).toBeLessThanOrEqual(CHUNK_MAX_WORDS);
      expect(c.headingPath).toBe('Big');
    }
  });

  it('(c) splits a 1700-word paragraph by sentence', () => {
    const sentences = Array.from({ length: 85 }, (_, i) => `${words(20, `s${i}_`)}.`);
    const chunks = chunkDocument(doc([p(sentences.join(' '))]), new Map());
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      expect(countWords(c.content)).toBeLessThanOrEqual(CHUNK_MAX_WORDS);
      expect(c.content.endsWith('.')).toBe(true);
    }
  });

  it('hard-splits a single sentence longer than the max', () => {
    const chunks = chunkDocument(doc([p(words(1700))]), new Map());
    expect(chunks).toHaveLength(3);
    for (const c of chunks) {
      expect(countWords(c.content)).toBeLessThanOrEqual(CHUNK_MAX_WORDS);
    }
  });

  it('(d) emits table and image chunks; images missing from the map are dropped', () => {
    const blocks: ExtractedBlock[] = [
      h(1, 'S'),
      {
        kind: 'table',
        caption: 'Cap',
        header: [['Food', 'Salt']],
        rows: [
          ['Soy', '5 g'],
          ['Fish', '3 g'],
        ],
        page: 2,
      },
      image('Fig 1', 3), // index 2
      image(undefined, 3), // index 3, not transcribed
      image(undefined, 4), // index 4
    ];
    const chunks = chunkDocument(
      doc(blocks),
      new Map([
        [2, 'text  in image'],
        [4, 'other'],
      ]),
    );
    expect(chunks.map((c) => c.blockKind)).toEqual(['table', 'image', 'image']);
    expect(chunks[0].content).toBe('Cap. Food: Soy; Salt: 5 g\nFood: Fish; Salt: 3 g');
    expect(chunks[1].content).toBe('Fig 1\ntext in image');
    expect(chunks[1].imageBlockIndex).toBe(2);
    expect(chunks[2].content).toBe('other');
    expect(chunks[2].imageBlockIndex).toBe(4);
    expect(chunks[0].pageFrom).toBe(2);
  });

  it('(e) chunkKey is deterministic and local to a section', () => {
    const build = (bText: string) =>
      doc([
        h(1, 'A'),
        p(words(500)),
        h(1, 'B'),
        p(bText),
        h(1, 'C'),
        p(words(500, 'c')),
      ]);
    const first = chunkDocument(build(words(500, 'b')), new Map());
    const again = chunkDocument(build(words(500, 'b')), new Map());
    expect(again.map((c) => c.chunkKey)).toEqual(first.map((c) => c.chunkKey));
    expect(first.map((c) => c.chunkKey)).toHaveLength(3);
    const edited = chunkDocument(build(words(500, 'edited')), new Map());
    expect(edited[0].chunkKey).toBe(first[0].chunkKey);
    expect(edited[1].chunkKey).toBe(first[1].chunkKey);
    expect(edited[1].sourceContentHash).not.toBe(first[1].sourceContentHash);
    expect(first[0].chunkKey).toBe(
      createHash('sha1').update('A|text|0').digest('hex').slice(0, 16),
    );
    expect(first[0].sourceContentHash).toBe(
      createHash('sha256').update(first[0].content).digest('hex'),
    );
  });

  it('counts the ordinal per heading path and kind', () => {
    const chunks = chunkDocument(
      doc([
        h(1, 'S'),
        p(words(500)),
        {
          kind: 'table',
          header: [['A']],
          rows: [['1']],
        },
        p(words(500, 'v')),
      ]),
      new Map(),
    );
    const key = (ord: number) =>
      createHash('sha1').update(`S|text|${ord}`).digest('hex').slice(0, 16);
    expect(chunks.map((c) => c.blockKind)).toEqual(['text', 'table', 'text']);
    expect(chunks[0].chunkKey).toBe(key(0));
    expect(chunks[2].chunkKey).toBe(key(1));
  });

  it('(f) converts NFD input to NFC content and keeps line breaks', () => {
    const nfc = 'tiểu đường\n\nhạn chế đường';
    const chunks = chunkDocument(
      doc([p('tiểu đường'.normalize('NFD')), p('hạn chế đường'.normalize('NFD'))]),
      new Map(),
    );
    expect(chunks[0].content).toBe(nfc);
    expect(chunks[0].language).toBe('vi');
  });

  it('(g) page range spans contributing blocks, null without pages', () => {
    const chunks = chunkDocument(
      doc([h(1, 'H', 3), p(words(100), 3), p(words(100, 'v'), 4)]),
      new Map(),
    );
    expect(chunks[0].pageFrom).toBe(3);
    expect(chunks[0].pageTo).toBe(4);
    const none = chunkDocument(doc([p('abc def')]), new Map());
    expect(none[0].pageFrom).toBeNull();
    expect(none[0].pageTo).toBeNull();
  });

  it('(h) buildEmbeddingText joins non-empty parts', () => {
    expect(
      buildEmbeddingText('Healthy diet', { headingPath: 'Salt', content: 'x' }),
    ).toBe('Healthy diet\nSalt\nx');
    expect(buildEmbeddingText('T', { headingPath: '', content: 'x' })).toBe('T\nx');
  });
});
