import axios from 'axios';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DoclingClient,
  DoclingError,
  mapDoclingDocument,
} from './docling.client';
import type { ExtractedBlock } from './rag-ingest.types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function fixture(name: string): any {
  return JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', name), 'utf8'),
  );
}

const pdfResponse = fixture('docling-pdf-response.json');
const htmlResponse = fixture('docling-html-response.json');
const pdfJson = pdfResponse.document.json_content;
const htmlJson = htmlResponse.document.json_content;

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const byKind = <K extends ExtractedBlock['kind']>(
  blocks: ExtractedBlock[],
  kind: K,
) => blocks.filter((b) => b.kind === kind) as Extract<ExtractedBlock, { kind: K }>[];

describe('mapDoclingDocument (PDF fixture)', () => {
  const doc = mapDoclingDocument(pdfJson);

  it('keeps blocks in document order, starting with the first section header', () => {
    expect(doc.blocks[0]).toMatchObject({
      kind: 'heading',
      level: 1,
      page: 12,
      text: '2.1.1 Daily energy requirements and daily energy intakes',
    });
    expect(doc.blocks[1].kind).toBe('paragraph');
    const pages = doc.blocks.map((b) => b.page ?? 0);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
  });

  it('drops page headers and footers', () => {
    const texts = doc.blocks
      .filter((b) => b.kind === 'heading' || b.kind === 'paragraph')
      .map((b) => (b as { text: string }).text);
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const bodyTexts = new Set(
      pdfJson.texts
        .filter((t: any) => t.content_layer === 'body')
        .map((t: any) => norm(t.text)),
    );
    // furniture texts that docling did not also emit as a body text elsewhere
    const furniture = pdfJson.texts
      .filter((t: any) => t.label === 'page_header' || t.label === 'page_footer')
      .map((t: any) => norm(t.text))
      .filter((t: string) => !bodyTexts.has(t));
    expect(furniture.length).toBeGreaterThan(0);
    for (const f of furniture) expect(texts).not.toContain(f);
  });

  it('skips unknown labels such as footnote and code', () => {
    const texts = doc.blocks.map((b) => JSON.stringify(b));
    expect(texts.some((t) => t.includes('TEE (MJ/day) = - 0.416'))).toBe(false);
  });

  it('turns list items into paragraphs', () => {
    expect(
      byKind(doc.blocks, 'paragraph').some((b) =>
        b.text.startsWith('x Basal metabolism.'),
      ),
    ).toBe(true);
  });

  it('does not emit text that lives inside pictures', () => {
    expect(
      byKind(doc.blocks, 'paragraph').filter((b) => b.text === 'J'),
    ).toHaveLength(0);
  });

  it('builds tables with header rows and body rows from data.grid', () => {
    const tables = byKind(doc.blocks, 'table');
    expect(tables).toHaveLength(4);
    const [t0, t1, t2, t3] = tables;
    expect([t0.header.length, t0.rows.length, t0.page]).toEqual([2, 10, 20]);
    expect(t0.header[0]).toHaveLength(6);
    expect(t0.header[0][0]).toBe('Age months');
    expect(t0.rows[0]).toHaveLength(6);
    expect(t0.rows[0][0]).toBe('Boys');
    // no column_header cells at all -> everything is a body row
    expect([t1.header.length, t1.rows.length]).toEqual([0, 11]);
    expect(t1.caption).toBe(
      'Energy requirements of infants during the first year of life*',
    );
    expect([t2.header.length, t2.rows.length]).toEqual([2, 26]);
    expect(t2.header[1].slice(0, 4)).toEqual(['Months', 'Boys', 'Girls', 'Mean']);
    expect(t2.caption).toMatch(/^TABLE 3\.3 Energy requirements of breastfed/);
    expect(t3.rows[0].slice(0, 3)).toEqual(['0-1', '460', '430']);
    expect(t3.caption).toBeUndefined();
  });

  it('maps pictures to image blocks with base64, size, caption and context', () => {
    const images = byKind(doc.blocks, 'image');
    expect(images).toHaveLength(4);
    const first = images[0];
    expect(first.page).toBe(12);
    expect(first.image).toEqual({
      base64: TINY_PNG_BASE64,
      mimeType: 'image/png',
      width: 689,
      height: 366,
    });
    expect(first.caption).toBe(
      'FIGURE 2.1 Distribution of energy requirements of a population group or class of individuals*',
    );
    expect(first.contextText).toBeDefined();
    expect(first.contextText!.length).toBeLessThanOrEqual(300);
    // the paragraph right before the figure, cut to its last 300 characters
    expect(first.contextText!.endsWith('(WHO, 1985) (Figure 2.1).')).toBe(true);
    // a picture without caption is still emitted, without a caption
    const noCaption = images.find((i) => i.page === 19)!;
    expect(noCaption.caption).toBeUndefined();
    expect(noCaption.image.width).toBe(760);
    expect(noCaption.image.height).toBe(376);
  });

  it('has no title block, so the title falls back to the supplied name', () => {
    expect(doc.title).toBe(pdfJson.name);
    expect(mapDoclingDocument(pdfJson, 'energy.pdf').title).toBe('energy.pdf');
  });

  it('reports pageCount from the pages map', () => {
    expect(doc.pageCount).toBe(Object.keys(pdfJson.pages).length);
  });
});

describe('mapDoclingDocument (HTML fixture)', () => {
  const doc = mapDoclingDocument(htmlJson, 'https://example.org/healthy-diet');

  it('skips furniture (navigation chrome) and takes the first title as document title', () => {
    expect(doc.title).toBe('Healthy diet');
    const texts = doc.blocks
      .filter((b) => b.kind === 'heading' || b.kind === 'paragraph')
      .map((b) => (b as { text: string }).text);
    expect(texts).not.toContain('Skip to main content');
    expect(texts).not.toContain('Select language');
    expect(doc.blocks[0]).toEqual({
      kind: 'heading',
      level: 1,
      text: 'Healthy diet',
    });
    expect(doc.pageCount).toBeUndefined();
  });

  it('walks nested sections and keeps headings with their levels', () => {
    const headings = byKind(doc.blocks, 'heading').map((h) => [h.level, h.text]);
    expect(headings).toContainEqual([1, 'Key facts']);
    expect(headings).toContainEqual([2, 'Carbohydrates']);
    const idx = (t: string) =>
      doc.blocks.findIndex((b) => b.kind === 'heading' && b.text === t);
    expect(idx('Key facts')).toBeLessThan(idx('Overview'));
    expect(idx('Carbohydrates')).toBeLessThan(idx('Sugars'));
    expect(idx('Sugars')).toBeLessThan(idx('Fats'));
  });

  it('joins inline groups into a single paragraph', () => {
    const paragraphs = byKind(doc.blocks, 'paragraph').map((p) => p.text);
    expect(paragraphs.some((t) => t.startsWith('adequacy: meets'))).toBe(true);
  });

  it('skips pictures that carry no embedded image data', () => {
    expect(byKind(doc.blocks, 'image')).toHaveLength(0);
  });
});

describe('mapDoclingDocument tolerance', () => {
  const base = (over: any) => ({
    name: 'x',
    body: { children: [] },
    texts: [],
    tables: [],
    pictures: [],
    groups: [],
    pages: {},
    ...over,
  });

  it('returns an empty document for garbage input', () => {
    expect(mapDoclingDocument(null, 'f.pdf')).toEqual({
      title: 'f.pdf',
      blocks: [],
    });
    expect(mapDoclingDocument('nope', 'f.pdf').blocks).toEqual([]);
    expect(mapDoclingDocument({}, 'f.pdf').blocks).toEqual([]);
  });

  it('tolerates missing prov, missing captions, empty tables, unknown labels and dangling refs', () => {
    const json = base({
      body: {
        children: [
          { $ref: '#/texts/0' },
          { $ref: '#/texts/1' },
          { $ref: '#/tables/0' },
          { $ref: '#/tables/1' },
          { $ref: '#/pictures/0' },
          { $ref: '#/texts/99' },
          { $ref: '#/texts/2' },
        ],
      },
      texts: [
        { label: 'text', text: '  Hello\n  world ', content_layer: 'body' },
        { label: 'mystery_label', text: 'ignored', content_layer: 'body' },
        { label: 'section_header', text: 'Intro', content_layer: 'body' },
      ],
      tables: [
        { label: 'table', data: { grid: [] } },
        {
          label: 'table',
          captions: [{ $ref: '#/texts/77' }],
          data: { grid: [[{ text: 'a', column_header: false }]] },
        },
      ],
      pictures: [{ label: 'picture', image: { uri: 'not-a-data-uri' } }],
    });
    const doc = mapDoclingDocument(json, 'f.pdf');
    expect(doc.blocks).toEqual([
      { kind: 'paragraph', text: 'Hello world' },
      { kind: 'table', header: [], rows: [['a']] },
      { kind: 'heading', level: 1, text: 'Intro' },
    ]);
  });

  it('survives reference cycles', () => {
    const json = base({
      body: { children: [{ $ref: '#/texts/0' }] },
      texts: [
        { label: 'text', text: 'loop', children: [{ $ref: '#/texts/0' }] },
      ],
    });
    expect(mapDoclingDocument(json, 'f').blocks).toEqual([
      { kind: 'paragraph', text: 'loop' },
    ]);
  });

  it('takes mimeType from the data URI and falls back to jpeg-less safe defaults', () => {
    const json = base({
      body: { children: [{ $ref: '#/pictures/0' }] },
      pictures: [
        {
          label: 'picture',
          prov: [{ page_no: 3 }],
          image: {
            uri: 'data:image/jpeg;base64,/9j/4AAQ',
            size: { width: 10.4, height: 20.6 },
          },
        },
      ],
    });
    expect(mapDoclingDocument(json, 'f').blocks).toEqual([
      {
        kind: 'image',
        page: 3,
        image: { base64: '/9j/4AAQ', mimeType: 'image/jpeg', width: 10, height: 21 },
      },
    ]);
  });

  it('limits contextText to 300 characters of the immediately preceding paragraphs', () => {
    const long = 'word '.repeat(100).trim();
    const json = base({
      body: {
        children: [
          { $ref: '#/texts/0' },
          { $ref: '#/texts/1' },
          { $ref: '#/texts/2' },
          { $ref: '#/pictures/0' },
        ],
      },
      texts: [
        { label: 'section_header', text: 'Not context', level: 2 },
        { label: 'text', text: long },
        { label: 'text', text: 'Last paragraph before the figure.' },
      ],
      pictures: [
        { label: 'picture', image: { uri: 'data:image/png;base64,AAAA', size: { width: 1, height: 1 } } },
      ],
    });
    const img = byKind(mapDoclingDocument(json, 'f').blocks, 'image')[0];
    expect(img.contextText!.length).toBeLessThanOrEqual(300);
    expect(img.contextText!.endsWith('Last paragraph before the figure.')).toBe(true);
    expect(img.contextText).not.toContain('Not context');
  });
});

describe('DoclingClient', () => {
  const config = { get: (_k: string) => undefined } as any;
  const client = new DoclingClient(config);

  beforeEach(() => jest.resetAllMocks());

  it('convertUrl posts an http source with OCR off and embedded images, and maps the result', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: htmlResponse });
    const doc = await client.convertUrl(
      'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
    );
    expect(doc.title).toBe('Healthy diet');
    const [url, body, opts] = mockedAxios.post.mock.calls[0] as any[];
    expect(url).toBe('http://localhost:5001/v1/convert/source');
    expect(body.sources).toEqual([
      {
        kind: 'http',
        url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
      },
    ]);
    expect(body.options).toMatchObject({
      to_formats: ['json'],
      image_export_mode: 'embedded',
      do_ocr: false,
    });
    expect(opts.timeout).toBe(2 * 60 * 1000);
  });

  it('convertPdf uploads multipart with OCR off and uses the filename as fallback title', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: pdfResponse });
    const doc = await client.convertPdf(Buffer.from('%PDF-1.4'), 'energy.pdf');
    expect(doc.title).toBe('energy.pdf');
    const [url, form, opts] = mockedAxios.post.mock.calls[0] as any[];
    expect(url).toBe('http://localhost:5001/v1/convert/file');
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('do_ocr')).toBe('false');
    expect(form.get('image_export_mode')).toBe('embedded');
    expect(form.get('to_formats')).toBe('json');
    expect((form.get('files') as File).name).toBe('energy.pdf');
    expect(opts.timeout).toBe(10 * 60 * 1000);
  });

  it('honours DOCLING_URL and strips a trailing slash', async () => {
    const c = new DoclingClient({
      get: (k: string) => (k === 'DOCLING_URL' ? 'http://docling:5001/' : undefined),
    } as any);
    mockedAxios.post.mockResolvedValue({ status: 200, data: htmlResponse });
    await c.convertUrl('https://example.org');
    expect(mockedAxios.post.mock.calls[0][0]).toBe(
      'http://docling:5001/v1/convert/source',
    );
  });

  it('maps a refused connection to UNAVAILABLE', async () => {
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5001'), {
        code: 'ECONNREFUSED',
      }),
    );
    const err = await client.convertUrl('https://example.org').catch((e) => e);
    expect(err).toBeInstanceOf(DoclingError);
    expect(err.code).toBe('UNAVAILABLE');
  });

  it('maps a timeout to UNAVAILABLE', async () => {
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('timeout of 120000ms exceeded'), {
        code: 'ECONNABORTED',
      }),
    );
    await expect(client.convertUrl('https://example.org')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('maps docling reporting a URL download failure to FETCH_FAILED', async () => {
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: {
        status: 'failure',
        document: { json_content: null },
        errors: [
          {
            error_message:
              '404 Client Error: Not Found for url: https://www.who.int/nope',
            category: 'policy',
          },
        ],
      },
    });
    await expect(client.convertUrl('https://www.who.int/nope')).rejects.toMatchObject({
      code: 'FETCH_FAILED',
    });
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: {
        status: 'failure',
        document: { json_content: null },
        errors: [
          {
            error_message: 'URL is not allowed: https://nonexistent.invalid/x.pdf',
            category: 'source_unavailable',
          },
        ],
      },
    });
    await expect(client.convertUrl('https://nonexistent.invalid/x.pdf')).rejects.toMatchObject({
      code: 'FETCH_FAILED',
    });
  });

  it('maps a conversion failure on an uploaded file to CONVERT_FAILED', async () => {
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: {
        status: 'failure',
        document: { json_content: null },
        errors: [
          { error_message: 'docling-parse could not load document', category: 'backend_failure' },
        ],
      },
    });
    await expect(client.convertPdf(Buffer.from('x'), 'bad.pdf')).rejects.toMatchObject({
      code: 'CONVERT_FAILED',
    });
  });

  it('maps HTTP 5xx and a missing json_content to CONVERT_FAILED', async () => {
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 500'), {
        isAxiosError: true,
        response: { status: 500, data: { detail: 'boom' } },
      }),
    );
    await expect(client.convertUrl('https://example.org')).rejects.toMatchObject({
      code: 'CONVERT_FAILED',
    });
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: { status: 'success', document: { json_content: null }, errors: [] },
    });
    await expect(client.convertUrl('https://example.org')).rejects.toMatchObject({
      code: 'CONVERT_FAILED',
    });
  });
});
