/**
 * Client for docling-serve.
 *
 * Pinned image: quay.io/docling-project/docling-serve-cpu:v1.37.0
 * (DoclingDocument schema version 1.10.0). Contract below was read from that
 * container's /openapi.json and verified against real conversions.
 *
 * The ASYNC API is used (the sync endpoints give up after ~120 s with a 504):
 *   1. submit  POST /v1/convert/source/async  application/json
 *                { sources: [{ kind: "http", url }], options: {...} }
 *              POST /v1/convert/file/async    multipart/form-data
 *                field `files` (the PDF) + one form field per option below
 *              -> TaskStatusResponse { task_id, task_status, ... }
 *   2. poll    GET /v1/status/poll/{task_id}  every 3 s until task_status is
 *              success | partial_success (-> step 3) or failure | skipped
 *              (-> error). task_status is also "success" when the conversion
 *              itself failed; that failure is in the result body.
 *   3. result  GET /v1/result/{task_id} -> same body as the sync endpoints.
 * Overall deadline: DOCLING_TIMEOUT_MS (default 60 min), then CONVERT_FAILED.
 * Only connection-level errors (ECONNREFUSED/ENOTFOUND/ECONNRESET/EAI_AGAIN)
 * are UNAVAILABLE; 504, axios timeouts and the rest are CONVERT_FAILED.
 *
 * Result body (HTTP 200 even when the conversion failed; check `status` / `errors[]`):
 *
 * Options used on both endpoints:
 *   - to_formats: ["json"]  (multipart: to_formats=json) -> DoclingDocument is
 *     returned in `document.json_content`
 *   - image_export_mode: "embedded"  -> picture `image.uri` is a base64 data URI
 *   - include_images: true  (picture crops are generated; default already true)
 *   - do_ocr: false  (no server-side env switch exists for this default, so the
 *     client sends it on every request)
 *
 * Response: { status: "success" | "partial_success" | "failure",
 *   document: { filename, json_content }, errors: [{ error_message, category,
 *   ... }], processing_time }. Failure examples seen live:
 *   unreachable host -> category "source_unavailable", "URL is not allowed: ..."
 *   remote 404       -> category "policy", "404 Client Error: Not Found for url: ..."
 *   corrupt file     -> category "backend_failure"
 *
 * DoclingDocument shape facts the mapper relies on (real responses, not docs):
 *   - `body` is a TREE, not a flat list: groups (label list/inline/...) and
 *     texts (section_header) carry nested `children` refs ("#/texts/N").
 *   - Web pages put site chrome (nav, language menus) on content_layer
 *     "furniture"; PDFs put page_header/page_footer there. All furniture is skipped.
 *   - Pictures own child texts (OCR-like text inside a figure); those are not
 *     document paragraphs and are not walked.
 *   - List items from inline markup have empty `text` and an `inline` group child.
 *   - Web pictures are not fetched: `image` has no `uri`, so no image block.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { normalizeText } from './text-normalize';
import type { ExtractedBlock, ExtractedDocument } from './rag-ingest.types';

export type DoclingErrorCode = 'FETCH_FAILED' | 'CONVERT_FAILED' | 'UNAVAILABLE';

export class DoclingError extends Error {
  constructor(
    public readonly code: DoclingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DoclingError';
  }
}

const DEFAULT_DEADLINE_MS = 3_600_000; // DOCLING_TIMEOUT_MS: whole conversion, 60 min
const POLL_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // a single submit / poll / result HTTP call
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN']);
const CONTEXT_MAX_CHARS = 300;
const DEFAULT_DOCLING_URL = 'http://localhost:5001';

type Json = Record<string, any>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null;

const FURNITURE_LABELS = new Set(['page_header', 'page_footer']);
const PARAGRAPH_LABELS = new Set(['text', 'list_item', 'paragraph']);
const TABLE_LABELS = new Set(['table', 'document_index']);

const DATA_URI = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/s;

/**
 * Pure, tolerant mapping of a docling `DoclingDocument` JSON to ExtractedDocument.
 * Never throws: missing prov / captions, empty tables, unknown labels,
 * dangling refs and reference cycles are skipped.
 */
export function mapDoclingDocument(
  json: unknown,
  fallbackTitle?: string,
): ExtractedDocument {
  const doc: Json = isObj(json) ? json : {};
  const blocks: ExtractedBlock[] = [];
  const seen = new Set<unknown>();
  let title: string | undefined;

  const resolve = (ref: unknown): Json | undefined => {
    const raw = isObj(ref) ? ref['$ref'] : undefined;
    if (typeof raw !== 'string') return undefined;
    const parts = raw.split('/').slice(1);
    if (parts.length === 1 && parts[0] === 'body') {
      return isObj(doc.body) ? doc.body : undefined;
    }
    if (parts.length !== 2) return undefined;
    const coll = doc[parts[0]];
    const node = Array.isArray(coll) ? coll[Number(parts[1])] : undefined;
    return isObj(node) ? node : undefined;
  };

  const childrenOf = (node: Json): Json[] =>
    (Array.isArray(node.children) ? node.children : [])
      .map(resolve)
      .filter((n): n is Json => n !== undefined);

  const pageOf = (node: Json): number | undefined => {
    const p = Array.isArray(node.prov) ? node.prov[0]?.page_no : undefined;
    return typeof p === 'number' && Number.isFinite(p) ? p : undefined;
  };

  const withPage = <T extends object>(block: T, node: Json): T => {
    const page = pageOf(node);
    return page === undefined ? block : { ...block, page };
  };

  const captionOf = (node: Json): string | undefined => {
    const refs = Array.isArray(node.captions) ? node.captions : [];
    const text = normalizeText(
      refs
        .map(resolve)
        .map((n) => (n && typeof n.text === 'string' ? n.text : ''))
        .join(' '),
    );
    return text === '' ? undefined : text;
  };

  /** All text below an inline group, joined into one flowing string. */
  const inlineText = (node: Json, depth = 0): string => {
    if (depth > 20) return '';
    const parts: string[] = [];
    if (typeof node.text === 'string' && node.text !== '') parts.push(node.text);
    for (const c of childrenOf(node)) {
      if (seen.has(c)) continue;
      seen.add(c);
      parts.push(inlineText(c, depth + 1));
    }
    return parts
      .map(normalizeText)
      .filter((p) => p !== '')
      .join(' ')
      .replace(/ ([:;,.!?)])/g, '$1');
  };

  const contextBefore = (): string | undefined => {
    const parts: string[] = [];
    let len = 0;
    for (let i = blocks.length - 1; i >= 0 && len < CONTEXT_MAX_CHARS; i--) {
      const b = blocks[i];
      if (b.kind !== 'paragraph') break;
      parts.unshift(b.text);
      len += b.text.length + 1;
    }
    if (parts.length === 0) return undefined;
    return parts.join(' ').slice(-CONTEXT_MAX_CHARS).trim();
  };

  const emitPicture = (node: Json) => {
    const uri = isObj(node.image) ? node.image.uri : undefined;
    const m = typeof uri === 'string' ? DATA_URI.exec(uri) : null;
    if (!m) return;
    const size = isObj(node.image.size) ? node.image.size : {};
    const width = Math.round(Number(size.width));
    const height = Math.round(Number(size.height));
    if (!(width > 0) || !(height > 0)) return;
    const caption = captionOf(node);
    const contextText = contextBefore();
    blocks.push(
      withPage(
        {
          kind: 'image' as const,
          ...(caption !== undefined ? { caption } : {}),
          ...(contextText !== undefined ? { contextText } : {}),
          image: { base64: m[2], mimeType: m[1], width, height },
        },
        node,
      ),
    );
  };

  const emitTable = (node: Json) => {
    const grid = isObj(node.data) && Array.isArray(node.data.grid) ? node.data.grid : [];
    const rows: { text: string; header: boolean }[][] = grid
      .filter((r: unknown) => Array.isArray(r) && r.length > 0)
      .map((r: unknown[]) =>
        r.map((c) => ({
          text: isObj(c) && typeof c.text === 'string' ? normalizeText(c.text) : '',
          header: isObj(c) && c.column_header === true,
        })),
      );
    if (rows.length === 0) return;
    let headerCount = 0;
    while (headerCount < rows.length && rows[headerCount].some((c) => c.header)) {
      headerCount++;
    }
    const caption = captionOf(node);
    blocks.push(
      withPage(
        {
          kind: 'table' as const,
          ...(caption !== undefined ? { caption } : {}),
          header: rows.slice(0, headerCount).map((r) => r.map((c) => c.text)),
          rows: rows.slice(headerCount).map((r) => r.map((c) => c.text)),
        },
        node,
      ),
    );
  };

  const visit = (node: Json, depth: number): void => {
    if (depth > 60 || seen.has(node)) return;
    seen.add(node);
    if (node.content_layer === 'furniture') return;
    const label: string = typeof node.label === 'string' ? node.label : '';
    if (FURNITURE_LABELS.has(label)) return;

    if (label === 'picture') return emitPicture(node);
    if (TABLE_LABELS.has(label)) return emitTable(node);

    if (label === 'inline') {
      const text = inlineText(node);
      if (text !== '') blocks.push({ kind: 'paragraph', text });
      return;
    }

    const text = typeof node.text === 'string' ? normalizeText(node.text) : '';
    if (label === 'title' && text !== '') {
      title ??= text;
      blocks.push(withPage({ kind: 'heading' as const, level: 1, text }, node));
    } else if (label === 'section_header' && text !== '') {
      const level = Number.isFinite(node.level) ? Math.max(1, Math.round(node.level)) : 1;
      blocks.push(withPage({ kind: 'heading' as const, level, text }, node));
    } else if (PARAGRAPH_LABELS.has(label) && text !== '') {
      blocks.push(withPage({ kind: 'paragraph' as const, text }, node));
    }

    for (const child of childrenOf(node)) visit(child, depth + 1);
  };

  if (isObj(doc.body)) {
    for (const child of childrenOf(doc.body)) visit(child, 0);
  }

  const pageKeys = isObj(doc.pages) ? Object.keys(doc.pages) : [];
  const result: ExtractedDocument = {
    title: title ?? fallbackTitle ?? (typeof doc.name === 'string' ? doc.name : ''),
    blocks,
  };
  if (pageKeys.length > 0) result.pageCount = pageKeys.length;
  return result;
}

const FETCH_MESSAGE =
  /\b[45]\d\d (Client|Server) Error\b|URL is not allowed|Max retries exceeded|Name or service not known|Failed to resolve|Connection (refused|aborted|reset)|timed out/i;

@Injectable()
export class DoclingClient {
  private readonly baseUrl: string;

  private readonly deadlineMs: number;

  constructor(config: ConfigService) {
    const url = config.get<string>('DOCLING_URL') || DEFAULT_DOCLING_URL;
    this.baseUrl = url.replace(/\/+$/, '');
    const t = Number(config.get<string>('DOCLING_TIMEOUT_MS'));
    this.deadlineMs = Number.isFinite(t) && t > 0 ? t : DEFAULT_DEADLINE_MS;
  }

  async convertUrl(url: string): Promise<ExtractedDocument> {
    const data = await this.runTask('/v1/convert/source/async', {
      sources: [{ kind: 'http', url }],
      options: {
        to_formats: ['json'],
        image_export_mode: 'embedded',
        include_images: true,
        do_ocr: false,
      },
    }, true);
    return mapDoclingDocument(this.jsonContent(data, true), url);
  }

  async convertPdf(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), filename);
    form.append('to_formats', 'json');
    form.append('image_export_mode', 'embedded');
    form.append('include_images', 'true');
    form.append('do_ocr', 'false');
    const data = await this.runTask('/v1/convert/file/async', form, false);
    return mapDoclingDocument(this.jsonContent(data, false), filename);
  }

  /** Submit an async job, poll until it finishes, return the result body. */
  private async runTask(submitPath: string, body: unknown, isUrlSource: boolean): Promise<unknown> {
    const startedAt = Date.now();
    const submitted = await this.request('post', submitPath, body);
    const taskId = isObj(submitted) ? submitted.task_id : undefined;
    if (typeof taskId !== 'string' || taskId === '') {
      throw new DoclingError('CONVERT_FAILED', 'docling-serve did not return a task id');
    }
    for (;;) {
      const status = await this.request('get', `/v1/status/poll/${encodeURIComponent(taskId)}`);
      const s = isObj(status) ? status.task_status : undefined;
      if (s === 'success' || s === 'partial_success') {
        return this.request('get', `/v1/result/${encodeURIComponent(taskId)}`);
      }
      if (s === 'failure' || s === 'skipped') {
        const message = String(
          (isObj(status) && (status.error_message ?? status.failure?.message)) ||
            `docling-serve task ${s}`,
        );
        throw new DoclingError(
          isUrlSource && FETCH_MESSAGE.test(message) ? 'FETCH_FAILED' : 'CONVERT_FAILED',
          message,
        );
      }
      if (Date.now() - startedAt + POLL_INTERVAL_MS >= this.deadlineMs) {
        throw new DoclingError(
          'CONVERT_FAILED',
          `Document conversion timed out after ${Math.round(this.deadlineMs / 60000)} minutes`,
        );
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  private async request(method: 'get' | 'post', path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const opts = {
      timeout: REQUEST_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    };
    try {
      const res = method === 'post' ? await axios.post(url, body, opts) : await axios.get(url, opts);
      return res.data;
    } catch (err) {
      const e = err as { message?: string; code?: string; response?: { status?: number } };
      if (e.code && CONNECTION_ERROR_CODES.has(e.code)) {
        throw new DoclingError(
          'UNAVAILABLE',
          `docling-serve unavailable at ${this.baseUrl}: ${e.message ?? e.code}`,
        );
      }
      const status = e.response?.status;
      throw new DoclingError(
        'CONVERT_FAILED',
        status ? `docling-serve HTTP ${status}: ${e.message ?? ''}` : `docling-serve request failed: ${e.message ?? ''}`,
      );
    }
  }

  private jsonContent(data: unknown, isUrlSource: boolean): unknown {
    const body: Json = isObj(data) ? data : {};
    const json = isObj(body.document) ? body.document.json_content : undefined;
    const errors: Json[] = Array.isArray(body.errors) ? body.errors.filter(isObj) : [];
    if (body.status === 'failure' || !isObj(json)) {
      const message = errors
        .map((e) => String(e.error_message ?? ''))
        .filter(Boolean)
        .join('; ');
      const fetchFailed =
        isUrlSource &&
        errors.some(
          (e) =>
            e.category === 'source_unavailable' ||
            FETCH_MESSAGE.test(String(e.error_message ?? '')),
        );
      throw new DoclingError(
        fetchFailed ? 'FETCH_FAILED' : 'CONVERT_FAILED',
        message || 'docling-serve returned no document',
      );
    }
    return json;
  }
}
