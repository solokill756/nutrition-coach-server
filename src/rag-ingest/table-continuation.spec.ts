import { isDataLikeRow, repairTableHeaders } from './table-continuation';
import { tableToTexts } from './table-to-text';
import type { ExtractedBlock } from './rag-ingest.types';

type Table = Extract<ExtractedBlock, { kind: 'table' }>;

const table = (over: Partial<Table>): Table => ({ kind: 'table', header: [], rows: [], ...over });
const para = (text: string): ExtractedBlock => ({ kind: 'paragraph', text });

// Shapes taken from the live Docling output of the NIN PDF "Hướng dẫn dinh dưỡng" (pages 15-16):
// Bảng 2 ends on page 15, its last rows continue on page 16 without a caption, and Docling flags
// the first continuation row as the column header.
const bang2 = table({
  caption: 'Bảng 2: Nhu cầu canxi',
  page: 15,
  header: [
    ['Nhóm', 'Nam', 'Nam', 'Nữ', 'Nữ'],
    ['tuổi', 'RDA', 'UL', 'RDA', 'UL'],
  ],
  rows: [['50-69 tuổi', '800', '2000', '900', '2000']],
});
const continuation = table({
  page: 16,
  header: [['≥70 tuổi', '1000', '2000', '1000', '2000']],
  rows: [['Phụ nữ có thai', '1200', '2500', '', '']],
});

describe('isDataLikeRow', () => {
  it('is true when at least half of the non-empty cells are numbers, ranges or start with a digit or ≥ ≤ < >', () => {
    expect(isDataLikeRow(['≥70 tuổi', '1000', '2000'])).toBe(true);
    expect(isDataLikeRow(['Tuổi', '< 40%', '56-69%', ''])).toBe(true);
    expect(isDataLikeRow(['Nhóm', 'Nam', 'Nữ'])).toBe(false);
    expect(isDataLikeRow(['Tuổi', 'Nam', '200mg'])).toBe(false);
    expect(isDataLikeRow(['', ''])).toBe(false);
  });
});

describe('repairTableHeaders', () => {
  it('rule 1: a caption-less table right after a same-width table inherits its caption and header; its flagged header rows become data', () => {
    const out = repairTableHeaders([bang2, continuation]);
    expect(out[1]).toEqual({
      kind: 'table',
      caption: 'Bảng 2: Nhu cầu canxi',
      page: 16,
      header: bang2.header,
      rows: [
        ['≥70 tuổi', '1000', '2000', '1000', '2000'],
        ['Phụ nữ có thai', '1200', '2500', '', ''],
      ],
    });
    const texts = tableToTexts(out[1] as Table, 400);
    expect(texts[0].split('\n')[0]).toBe(
      'Bảng 2: Nhu cầu canxi. Nhóm › tuổi: ≥70 tuổi; Nam › RDA: 1000; Nam › UL: 2000; Nữ › RDA: 1000; Nữ › UL: 2000',
    );
  });

  it('rule 1: an image between the two tables does not break the continuation, and chains carry over', () => {
    const image: ExtractedBlock = {
      kind: 'image',
      image: { base64: 'AA', mimeType: 'image/png', width: 200, height: 200 },
    };
    const third = table({ header: [['80 tuổi', '1', '2', '3', '4']], rows: [] });
    const out = repairTableHeaders([bang2, image, continuation, third]);
    expect((out[2] as Table).caption).toBe('Bảng 2: Nhu cầu canxi');
    expect((out[3] as Table).header).toEqual(bang2.header);
    expect((out[3] as Table).rows).toEqual([['80 tuổi', '1', '2', '3', '4']]);
  });

  it('rule 1 does not apply across a paragraph or heading, to a table with a caption, or to a different column count', () => {
    const textHeader = table({ header: [['Tuổi', 'Nam', 'Nữ', 'Có thai', 'Cho bú']], rows: [['1', '2', '3', '4', '5']] });
    expect(repairTableHeaders([bang2, para('Ghi chú.'), textHeader])[2]).toEqual(textHeader);
    const captioned = { ...textHeader, caption: 'Bảng 3' };
    expect(repairTableHeaders([bang2, captioned])[1]).toEqual(captioned);
    const narrow = table({ header: [['Tuổi', 'Nam']], rows: [['1', '2']] });
    expect(repairTableHeaders([bang2, narrow])[1]).toEqual(narrow);
  });

  it('rule 2: a data-like header row becomes a data row; with no header left the columns fall back to "Column N"', () => {
    const out = repairTableHeaders([para('Intro.'), continuation]);
    const fixed = out[1] as Table;
    expect(fixed.header).toEqual([]);
    expect(fixed.rows[0]).toEqual(['≥70 tuổi', '1000', '2000', '1000', '2000']);
    expect(tableToTexts(fixed, 400)[0].split('\n')[0]).toBe(
      'Column 1: ≥70 tuổi; Column 2: 1000; Column 3: 2000; Column 4: 1000; Column 5: 2000',
    );
  });

  it('rule 2 keeps text header levels above the first data-like header row', () => {
    const t = table({ header: [['Nhóm', 'Năng lượng'], ['19-30 tuổi', '2500']], rows: [['31-60 tuổi', '2300']] });
    const fixed = repairTableHeaders([t])[0] as Table;
    expect(fixed.header).toEqual([['Nhóm', 'Năng lượng']]);
    expect(fixed.rows).toEqual([['19-30 tuổi', '2500'], ['31-60 tuổi', '2300']]);
  });

  it('regression: a normal table with a text header and caption is unchanged', () => {
    const normal = table({
      caption: 'Bảng 1: Nhu cầu canxi',
      header: [['Tuổi', 'Nam', 'Nữ', 'Phụ nữ có thai', 'Phụ nữ cho con bú']],
      rows: [['0-6 tháng', '200mg', '200mg', '', '']],
    });
    const blocks: ExtractedBlock[] = [para('Text.'), normal, para('More.')];
    const out = repairTableHeaders(blocks);
    expect(out).toEqual(blocks);
    expect(tableToTexts(out[1] as Table, 400)).toEqual([
      'Bảng 1: Nhu cầu canxi. Tuổi: 0-6 tháng; Nam: 200mg; Nữ: 200mg',
    ]);
  });

  it('keeps one output block per input block, so image block indexes stay valid', () => {
    const blocks: ExtractedBlock[] = [bang2, continuation, para('x'), continuation];
    expect(repairTableHeaders(blocks)).toHaveLength(blocks.length);
  });
});
