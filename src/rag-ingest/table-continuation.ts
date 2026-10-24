import { ExtractedBlock } from './rag-ingest.types';

type Table = Extract<ExtractedBlock, { kind: 'table' }>;

/** A number, a range ("56-69%") or a bound ("≥70 tuổi", "< 40%"): starts with a digit or ≥ ≤ < >. */
const DATA_LIKE_CELL = /^[0-9≥≤<>]/;

/** True when at least half of the row's non-empty cells look like data rather than column names. */
export function isDataLikeRow(row: string[]): boolean {
  const cells = row.map((c) => c.trim()).filter((c) => c !== '');
  if (cells.length === 0) return false;
  const dataLike = cells.filter((c) => DATA_LIKE_CELL.test(c)).length;
  return dataLike * 2 >= cells.length;
}

function tableWidth(t: Table): number {
  return Math.max(0, ...t.header.map((r) => r.length), ...t.rows.map((r) => r.length));
}

/** True when `block` is on a later page than `previous`. Without page numbers (e.g. a web page) there is no page break. */
function startsOnLaterPage(block: Table, previous: Table): boolean {
  return block.page !== undefined && previous.page !== undefined && block.page > previous.page;
}

/**
 * Repairs table headers that Docling gets wrong, so numbers are never labelled with other numbers.
 *
 * 1. Continuation: a table that directly follows another table (no heading or paragraph between
 *    them), starts on a later page, has the same column count and no caption is the rest of that
 *    table after a page break. Tables without a page number are never continuations.
 *    It inherits the previous table's caption and header; the rows Docling flagged as its header
 *    (the first rows on the new page) become data rows.
 * 2. Otherwise, the first header row that is data-like ({@link isDataLikeRow}) and every header row
 *    below it become data rows. With no header left, tableToTexts falls back to "Column N".
 *
 * Pure. Returns exactly one block per input block, so block indexes (image blocks) stay valid.
 */
export function repairTableHeaders(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = [];
  let previous: Table | undefined;
  for (const block of blocks) {
    if (block.kind === 'heading' || block.kind === 'paragraph') {
      previous = undefined;
      out.push(block);
      continue;
    }
    if (block.kind !== 'table') {
      out.push(block);
      continue;
    }
    let fixed: Table;
    if (
      previous &&
      startsOnLaterPage(block, previous) &&
      !block.caption &&
      tableWidth(block) === tableWidth(previous)
    ) {
      fixed = {
        kind: 'table',
        ...(previous.caption ? { caption: previous.caption } : {}),
        header: previous.header,
        rows: [...block.header, ...block.rows],
        ...(block.page !== undefined ? { page: block.page } : {}),
      };
    } else {
      const firstDataLike = block.header.findIndex(isDataLikeRow);
      fixed =
        firstDataLike === -1
          ? block
          : {
              ...block,
              header: block.header.slice(0, firstDataLike),
              rows: [...block.header.slice(firstDataLike), ...block.rows],
            };
    }
    out.push(fixed);
    previous = fixed;
  }
  return out;
}
