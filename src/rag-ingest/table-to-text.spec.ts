import { ExtractedBlock } from './rag-ingest.types';
import { tableToTexts } from './table-to-text';

type Table = Extract<ExtractedBlock, { kind: 'table' }>;

describe('tableToTexts', () => {
  it('turns each row into a sentence with caption and column names', () => {
    const out = tableToTexts(
      {
        kind: 'table',
        caption: 'Bảng 5 – Nhu cầu năng lượng',
        header: [['Nhóm', 'Lao động', 'Năng lượng (kcal/ngày)']],
        rows: [['Nam 19–30', 'vừa', '2.500']],
      },
      800,
    );
    expect(out).toEqual([
      'Bảng 5 – Nhu cầu năng lượng. Nhóm: Nam 19–30; Lao động: vừa; Năng lượng (kcal/ngày): 2.500',
    ]);
  });

  it("joins multi-level headers with ' › '", () => {
    const out = tableToTexts(
      {
        kind: 'table',
        header: [
          ['Vitamin', 'Vitamin'],
          ['A (µg)', 'C (mg)'],
        ],
        rows: [['700', '90']],
      },
      800,
    );
    expect(out).toEqual(['Vitamin › A (µg): 700; Vitamin › C (mg): 90']);
  });

  it('does not repeat identical header levels', () => {
    const out = tableToTexts(
      { kind: 'table', header: [['Tên', 'Tên'], ['Tên', 'Giá']], rows: [['a', 'b']] },
      800,
    );
    expect(out).toEqual(['Tên: a; Tên › Giá: b']);
  });

  it('skips empty rows and repeated header rows (page breaks)', () => {
    const out = tableToTexts(
      {
        kind: 'table',
        header: [['A', 'B', 'C']],
        rows: [
          ['1', '2', '3'],
          ['', '', ''],
          ['A', 'B', 'C'],
          ['4', '5', '6'],
        ],
      },
      800,
    );
    expect(out).toEqual(['A: 1; B: 2; C: 3\nA: 4; B: 5; C: 6']);
  });

  it('skips a row equal to the joined effective column names', () => {
    const out = tableToTexts(
      {
        kind: 'table',
        header: [['V', 'V'], ['A', 'C']],
        rows: [['V › A', 'V › C'], ['1', '2']],
      },
      800,
    );
    expect(out).toEqual(['V › A: 1; V › C: 2']);
  });

  it('drops empty cells but keeps numbers exactly as written', () => {
    const out = tableToTexts(
      {
        kind: 'table',
        header: [['Tên', 'Ghi chú', 'Lượng', 'Mức']],
        rows: [['Muối', '', '60–70', '< 5']],
      },
      800,
    );
    expect(out).toEqual(['Tên: Muối; Lượng: 60–70; Mức: < 5']);
  });

  it('uses Column N when there are no header rows', () => {
    const out = tableToTexts(
      { kind: 'table', header: [], rows: [['x', 'y']] },
      800,
    );
    expect(out).toEqual(['Column 1: x; Column 2: y']);
  });

  it('normalizes NFD cell text', () => {
    const out = tableToTexts(
      { kind: 'table', header: [['Tên']], rows: [['tiểu  đường'.normalize('NFD')]] },
      800,
    );
    expect(out).toEqual(['Tên: tiểu đường']);
  });

  it('returns [] for a table with no data rows', () => {
    expect(tableToTexts({ kind: 'table', header: [['A']], rows: [['']] }, 100)).toEqual([]);
  });

  it('splits long tables into several texts, each repeating the caption', () => {
    const rows = Array.from({ length: 200 }, (_, i) => [`item${i}`, `${i}`]);
    const table: Table = {
      kind: 'table',
      caption: 'Bảng dài',
      header: [['Tên', 'Giá trị']],
      rows,
    };
    const out = tableToTexts(table, 100);
    expect(out.length).toBeGreaterThan(1);
    for (const t of out) expect(t.startsWith('Bảng dài. ')).toBe(true);
    const all = out.join('\n');
    for (let i = 0; i < 200; i++) expect(all).toContain(`Tên: item${i};`);
  });

  it('never drops a single row longer than maxWords', () => {
    const out = tableToTexts(
      {
        kind: 'table',
        caption: 'C',
        header: [['A', 'B']],
        rows: [['một hai ba bốn năm sáu bảy tám', 'x'], ['y', 'z']],
      },
      3,
    );
    expect(out).toEqual([
      'C. A: một hai ba bốn năm sáu bảy tám; B: x',
      'C. A: y; B: z',
    ]);
  });
});
