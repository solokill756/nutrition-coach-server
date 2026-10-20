import { ExtractedBlock } from './rag-ingest.types';
import { countWords, normalizeText } from './text-normalize';

type Table = Extract<ExtractedBlock, { kind: 'table' }>;

const LEVEL_SEPARATOR = ' › ';

function effectiveColumnNames(header: string[][], width: number): string[] {
  const names: string[] = [];
  for (let c = 0; c < width; c++) {
    const parts: string[] = [];
    for (const level of header) {
      const part = normalizeText(level[c] ?? '');
      if (part !== '' && parts[parts.length - 1] !== part) parts.push(part);
    }
    names.push(parts.length > 0 ? parts.join(LEVEL_SEPARATOR) : `Column ${c + 1}`);
  }
  return names;
}

function sameCells(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Converts a table into retrieval-friendly texts. Each data row becomes
 * "Col: val; Col: val"; rows are grouped (joined by "\n") into texts of at most
 * `maxWords` words (a single oversized row still gets its own text), and every
 * text repeats the caption prefix when there is one.
 */
export function tableToTexts(table: Table, maxWords: number): string[] {
  const header = table.header.map((level) => level.map(normalizeText));
  const width = Math.max(
    0,
    ...header.map((l) => l.length),
    ...table.rows.map((r) => r.length),
  );
  const names = effectiveColumnNames(header, width);
  const caption = normalizeText(table.caption ?? '');
  const prefix = caption === '' ? '' : `${caption}. `;

  const lines: string[] = [];
  for (const row of table.rows) {
    const cells = row.map(normalizeText);
    if (cells.every((c) => c === '')) continue;
    if (sameCells(cells, names.slice(0, cells.length))) continue;
    if (header.some((h) => sameCells(cells, h))) continue;
    const pairs: string[] = [];
    cells.forEach((value, i) => {
      if (value !== '') pairs.push(`${names[i] ?? `Column ${i + 1}`}: ${value}`);
    });
    lines.push(pairs.join('; '));
  }

  const texts: string[] = [];
  let current: string[] = [];
  let currentWords = countWords(prefix);
  const flush = () => {
    if (current.length > 0) texts.push(prefix + current.join('\n'));
    current = [];
    currentWords = countWords(prefix);
  };
  for (const line of lines) {
    const words = countWords(line);
    if (current.length > 0 && currentWords + words > maxWords) flush();
    current.push(line);
    currentWords += words;
  }
  flush();
  return texts;
}
