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

describe('mapDoclingDocument table header repair', () => {
  const cell = (text: string, header = false) => ({ text, column_header: header });
  const tableNode = (rows: ReturnType<typeof cell>[][], captions: unknown[] = [], pageNo = 1) => ({
    label: 'table',
    captions,
    prov: [{ page_no: pageNo }],
    data: { grid: rows },
  });

  it('treats a caption-less same-width table right after another table, on the next page, as its continuation', () => {
    const json = {
      body: { children: [{ $ref: '#/tables/0' }, { $ref: '#/tables/1' }] },
      texts: [{ label: 'caption', text: 'Bảng 2: Canxi' }],
      tables: [
        tableNode(
          [
            [cell('Nhóm', true), cell('RDA', true)],
            [cell('50-69 tuổi'), cell('800')],
          ],
          [{ $ref: '#/texts/0' }],
        ),
        tableNode(
          [
            [cell('≥70 tuổi', true), cell('1000', true)],
            [cell('Phụ nữ có thai'), cell('1200')],
          ],
          [],
          2,
        ),
      ],
    };
    const doc = mapDoclingDocument(json);
    expect(doc.blocks[1]).toMatchObject({
      kind: 'table',
      caption: 'Bảng 2: Canxi',
      header: [['Nhóm', 'RDA']],
      rows: [
        ['≥70 tuổi', '1000'],
        ['Phụ nữ có thai', '1200'],
      ],
    });
  });
});

describe('DoclingClient (async API)', () => {
  const cfg = (env: Record<string, string> = {}) =>
    ({ get: (k: string) => env[k] }) as any;
  const client = new DoclingClient(cfg());

  const taskStatus = (task_status: string, extra: object = {}) => ({
    status: 200,
    data: { task_id: 't1', task_type: 'convert', task_status, ...extra },
  });

  /** axios.get answers: poll statuses in order (last one repeats), then the result. */
  function mockGets(polls: any[], result?: any) {
    let i = 0;
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('/v1/status/poll/')) {
        const p = polls[Math.min(i++, polls.length - 1)];
        if (p instanceof Error) throw p;
        return p;
      }
      if (url.includes('/v1/result/')) return { status: 200, data: result };
      throw new Error(`unexpected GET ${url}`);
    });
  }

  /** Run a client call under fake timers, advancing virtual time until it settles. */
  async function settle<T>(p: Promise<T>, ms = 60_000): Promise<T> {
    const guarded = p.then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    );
    await jest.advanceTimersByTimeAsync(ms);
    const r = await guarded;
    if (!r.ok) throw r.e;
    return r.v;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('convertUrl: submit -> pending -> success, polling every 3 s, then maps the result', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('pending'), taskStatus('started'), taskStatus('success')], htmlResponse);
    const doc = await settle(
      client.convertUrl('https://www.who.int/news-room/fact-sheets/detail/healthy-diet'),
    );
    expect(doc.title).toBe('Healthy diet');

    const [url, body] = mockedAxios.post.mock.calls[0] as any[];
    expect(url).toBe('http://localhost:5001/v1/convert/source/async');
    expect(body.sources).toEqual([
      { kind: 'http', url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
    ]);
    expect(body.options).toMatchObject({
      to_formats: ['json'],
      image_export_mode: 'embedded',
      do_ocr: false,
    });
    const gets = mockedAxios.get.mock.calls.map((c) => c[0]);
    expect(gets).toEqual([
      'http://localhost:5001/v1/status/poll/t1',
      'http://localhost:5001/v1/status/poll/t1',
      'http://localhost:5001/v1/status/poll/t1',
      'http://localhost:5001/v1/result/t1',
    ]);
  });

  it('polls at a 3000 ms cadence', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('pending')]);
    const p = client.convertUrl('https://example.org').catch(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2999);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    jest.clearAllTimers();
    void p;
  });

  it('convertPdf: uploads multipart to the async endpoint with OCR off, filename as fallback title', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('success')], pdfResponse);
    const doc = await settle(client.convertPdf(Buffer.from('%PDF-1.4'), 'energy.pdf'));
    // Same as the upload placeholder title (AdminRagDocumentsService): no ".pdf" suffix.
    expect(doc.title).toBe('energy');
    const [url, form] = mockedAxios.post.mock.calls[0] as any[];
    expect(url).toBe('http://localhost:5001/v1/convert/file/async');
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('do_ocr')).toBe('false');
    expect(form.get('image_export_mode')).toBe('embedded');
    expect(form.get('to_formats')).toBe('json');
    expect((form.get('files') as File).name).toBe('energy.pdf');
    expect(form.getAll('page_range')).toEqual([]);
  });

  it('convertPdf: caps the conversion at maxPages + 1 pages via page_range', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('success')], pdfResponse);
    await settle(client.convertPdf(Buffer.from('%PDF-1.4'), 'big.pdf', { maxPages: 300 }));
    const form = mockedAxios.post.mock.calls[0][1] as FormData;
    // docling-serve v1.37.0 multipart: page_range is a [from, to] pair sent as two repeated fields.
    expect(form.getAll('page_range')).toEqual(['1', '301']);
  });

  it('convertPdf: a PDF without a title item keeps the upload title (no ".pdf" appended after ingest)', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('success')], { ...pdfResponse, document: { ...pdfResponse.document, json_content: { name: 'x', texts: [] } } });
    const doc = await settle(client.convertPdf(Buffer.from('%PDF-1.4'), 'Hướng dẫn dinh dưỡng.PDF'));
    expect(doc.title).toBe('Hướng dẫn dinh dưỡng');
    expect((mockedAxios.post.mock.calls[0][1] as FormData).get('files')).toHaveProperty('name', 'Hướng dẫn dinh dưỡng.PDF');
  });

  // #39: Docling labels no title item in most PDFs, so URL-sourced PDFs were titled with their URL.
  const urlResult = (json_content: object) => ({ ...pdfResponse, document: { ...pdfResponse.document, json_content } });

  it('convertUrl: a PDF without a title item is titled from its file name, not the URL', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('success')], pdfResponse);
    const doc = await settle(
      client.convertUrl('https://www.nhlbi.nih.gov/sites/default/files/publications/Your_Guide_to_Lowering_Your_Cholesterol_with_TLC.pdf'),
    );
    expect(doc.title).toBe('Your Guide to Lowering Your Cholesterol with TLC');
  });

  it('convertUrl: decodes the file name and drops the query string', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('success')], pdfResponse);
    const doc = await settle(client.convertUrl('https://kcb.vn/upload/2021//3087_QD-BYT_Huong-dan%20chan--doan.PDF?download=1'));
    expect(doc.title).toBe('3087 QD BYT Huong dan chan doan');
  });

  it('convertUrl: a PDF title item still wins over the file name', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets(
      [taskStatus('success')],
      urlResult({
        name: 'x',
        origin: { mimetype: 'application/pdf' },
        body: { children: [{ $ref: '#/texts/0' }] },
        texts: [{ label: 'title', text: 'Why the DASH Eating Plan Works' }],
      }),
    );
    const doc = await settle(client.convertUrl('https://www.nhlbi.nih.gov/files/WhyDASHWorks_UpdateNov20.pdf'));
    expect(doc.title).toBe('Why the DASH Eating Plan Works');
  });

  it('convertUrl: falls back to the URL when the PDF URL has no file name, or the page is not a PDF', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('success')], urlResult({ name: 'x', origin: { mimetype: 'application/pdf' }, texts: [] }));
    expect((await settle(client.convertUrl('https://example.org/'))).title).toBe('https://example.org/');
    mockGets([taskStatus('success')], urlResult({ name: 'x', origin: { mimetype: 'text/html' }, texts: [] }));
    expect((await settle(client.convertUrl('https://example.org/salt-reduction'))).title).toBe('https://example.org/salt-reduction');
  });

  it('honours DOCLING_URL and strips a trailing slash', async () => {
    const c = new DoclingClient(cfg({ DOCLING_URL: 'http://docling:5001/' }));
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('success')], htmlResponse);
    await settle(c.convertUrl('https://example.org'));
    expect(mockedAxios.post.mock.calls[0][0]).toBe('http://docling:5001/v1/convert/source/async');
  });

  it('submit -> failure maps to CONVERT_FAILED', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('failure', { error_message: 'worker crashed' })]);
    await expect(settle(client.convertPdf(Buffer.from('x'), 'a.pdf'))).rejects.toMatchObject({
      code: 'CONVERT_FAILED',
      message: expect.stringContaining('worker crashed'),
    });
  });

  it('task failure for a URL whose download failed maps to FETCH_FAILED', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([
      taskStatus('failure', {
        error_message: '404 Client Error: Not Found for url: https://www.who.int/nope',
      }),
    ]);
    await expect(settle(client.convertUrl('https://www.who.int/nope'))).rejects.toMatchObject({
      code: 'FETCH_FAILED',
    });
  });

  it('a successful task whose result reports a failed conversion maps correctly', async () => {
    const failure = (message: string, category: string) => ({
      status: 200,
      data: undefined as any,
      body: {
        status: 'failure',
        document: { json_content: null },
        errors: [{ error_message: message, category }],
      },
    });
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));

    mockGets([taskStatus('success')], failure('URL is not allowed: https://x.invalid/a', 'source_unavailable').body);
    await expect(settle(client.convertUrl('https://x.invalid/a'))).rejects.toMatchObject({
      code: 'FETCH_FAILED',
    });

    mockGets([taskStatus('success')], failure('docling-parse could not load document', 'backend_failure').body);
    await expect(settle(client.convertPdf(Buffer.from('x'), 'bad.pdf'))).rejects.toMatchObject({
      code: 'CONVERT_FAILED',
    });

    mockGets([taskStatus('success')], { status: 'success', document: { json_content: null }, errors: [] });
    await expect(settle(client.convertUrl('https://example.org'))).rejects.toMatchObject({
      code: 'CONVERT_FAILED',
    });
  });

  it('deadline exceeded maps to CONVERT_FAILED with a clear message', async () => {
    const c = new DoclingClient(cfg({ DOCLING_TIMEOUT_MS: '120000' }));
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('started')]);
    const err = await settle(c.convertPdf(Buffer.from('x'), 'big.pdf'), 300_000).catch((e) => e);
    expect(err).toBeInstanceOf(DoclingError);
    expect(err.code).toBe('CONVERT_FAILED');
    expect(err.message).toBe('Document conversion timed out after 2 minutes');
    // gave up around the deadline, not long after it
    expect(mockedAxios.get.mock.calls.length).toBeLessThanOrEqual(41);
  });

  it('default deadline is 60 minutes', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('started')]);
    const p = client.convertPdf(Buffer.from('x'), 'big.pdf');
    const guarded = p.catch((e) => e);
    await jest.advanceTimersByTimeAsync(59 * 60_000);
    expect(mockedAxios.get.mock.calls.length).toBeGreaterThan(1000);
    await jest.advanceTimersByTimeAsync(2 * 60_000);
    const err = await guarded;
    expect(err.message).toBe('Document conversion timed out after 60 minutes');
  });

  it('ECONNREFUSED maps to UNAVAILABLE (on submit and while polling)', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5001'), {
      code: 'ECONNREFUSED',
    });
    mockedAxios.post.mockRejectedValue(refused);
    const err = await settle(client.convertUrl('https://example.org')).catch((e) => e);
    expect(err).toBeInstanceOf(DoclingError);
    expect(err.code).toBe('UNAVAILABLE');

    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([taskStatus('pending'), refused]);
    await expect(settle(client.convertUrl('https://example.org'))).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it.each(['ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN'])('%s maps to UNAVAILABLE', async (code) => {
    mockedAxios.post.mockRejectedValue(Object.assign(new Error(code), { code }));
    await expect(settle(client.convertUrl('https://example.org'))).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('HTTP 504 maps to CONVERT_FAILED, not UNAVAILABLE', async () => {
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 504'), {
        isAxiosError: true,
        response: { status: 504, data: {} },
      }),
    );
    await expect(settle(client.convertUrl('https://example.org'))).rejects.toMatchObject({
      code: 'CONVERT_FAILED',
    });
  });

  it('axios timeouts and other HTTP errors map to CONVERT_FAILED', async () => {
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('timeout of 300000ms exceeded'), { code: 'ECONNABORTED' }),
    );
    await expect(settle(client.convertUrl('https://example.org'))).rejects.toMatchObject({
      code: 'CONVERT_FAILED',
    });
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 500'), {
        response: { status: 500 },
      }),
    );
    await expect(settle(client.convertUrl('https://example.org'))).rejects.toMatchObject({
      code: 'CONVERT_FAILED',
    });
  });

  it('a lost task (poll returns 404) maps to CONVERT_FAILED', async () => {
    mockedAxios.post.mockResolvedValue(taskStatus('pending'));
    mockGets([
      Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }),
    ]);
    await expect(settle(client.convertUrl('https://example.org'))).rejects.toMatchObject({
      code: 'CONVERT_FAILED',
    });
  });
});
