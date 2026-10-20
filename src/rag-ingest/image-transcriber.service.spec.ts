import {
  ImageTranscriberService,
  MIN_IMAGE_SIDE_PX,
  selectImagesToTranscribe,
} from './image-transcriber.service';
import { RAG_INGEST_PROMPTS } from './constants/rag-ingest-prompts';
import { ExtractedBlock } from './rag-ingest.types';

function img(
  base64: string,
  opts: { page?: number; width?: number; height?: number } = {},
): ExtractedBlock {
  return {
    kind: 'image',
    page: opts.page,
    image: {
      base64,
      mimeType: 'image/png',
      width: opts.width ?? 400,
      height: opts.height ?? 400,
    },
  };
}

const para: ExtractedBlock = { kind: 'paragraph', text: 'hello' };

describe('selectImagesToTranscribe', () => {
  it('exposes the minimum side constant', () => {
    expect(MIN_IMAGE_SIDE_PX).toBe(120);
  });

  it('skips small images and logos repeated across pages', () => {
    const blocks = [
      para,
      img('small', { page: 1, width: 100, height: 400 }),
      img('logo', { page: 1 }),
      img('logo', { page: 2 }),
      img('chart', { page: 2 }),
      img('flat', { page: 3, width: 400, height: 119 }),
    ];
    expect(selectImagesToTranscribe(blocks)).toEqual([4]);
  });

  it('keeps a hash repeated on the same page', () => {
    const blocks = [img('a', { page: 1 }), img('a', { page: 1 })];
    expect(selectImagesToTranscribe(blocks)).toEqual([0, 1]);
  });

  it('skips repeated hashes when pages are unknown', () => {
    const blocks = [img('a'), img('b'), img('a')];
    expect(selectImagesToTranscribe(blocks)).toEqual([1]);
  });

  it('keeps images at exactly the minimum side', () => {
    expect(
      selectImagesToTranscribe([img('a', { width: 120, height: 120 })]),
    ).toEqual([0]);
  });
});

describe('RAG_INGEST_PROMPTS.IMAGE_TRANSCRIBE', () => {
  it('asks for the JSON contract and includes caption/context', () => {
    const p = RAG_INGEST_PROMPTS.IMAGE_TRANSCRIBE('Fig 1', 'around text');
    expect(p).toContain('has_information');
    expect(p).toContain('transcription');
    expect(p).toContain('Fig 1');
    expect(p).toContain('around text');
  });

  it('asks for [unclear] instead of guessing, and never completing or estimating a number', () => {
    const p = RAG_INGEST_PROMPTS.IMAGE_TRANSCRIBE();
    expect(p).toContain('[unclear]');
    expect(p).toMatch(/never complete or estimate a number/i);
  });

  it('asks for every table, panel and inset to be transcribed completely', () => {
    const p = RAG_INGEST_PROMPTS.IMAGE_TRANSCRIBE();
    expect(p).toMatch(/every table, panel and inset/i);
    expect(p).toMatch(/never summari[sz]e or skip a sub-table/i);
  });

  it('fences the surrounding text and forbids copying numbers that appear only in the context', () => {
    const p = RAG_INGEST_PROMPTS.IMAGE_TRANSCRIBE('Fig 1', 'Rice 55 g per serving');
    expect(p).toContain('<context>\nRice 55 g per serving\n</context>');
    expect(p).toMatch(/context only/i);
    expect(p).toMatch(/numbers that appear only in the context must never be copied/i);
    // Without context there is no fence.
    expect(RAG_INGEST_PROMPTS.IMAGE_TRANSCRIBE('Fig 1')).not.toContain('<context>');
  });
});

describe('ImageTranscriberService', () => {
  let generate: jest.Mock;
  let service: ImageTranscriberService;
  let waits: number[];

  beforeEach(() => {
    generate = jest.fn();
    service = new ImageTranscriberService({
      generateWithImage: generate,
    } as any);
    waits = [];
    jest
      .spyOn(service as any, 'wait')
      .mockImplementation(async (ms: number) => {
        waits.push(ms);
      });
  });

  const ok = (t: string) =>
    JSON.stringify({ has_information: true, transcription: t });

  it('returns transcription in the map, normalized', async () => {
    generate.mockResolvedValue(ok('Muối:  < 5 g'));
    const r = await service.transcribeAll([para, img('a')]);
    expect(r.texts.get(1)).toBe('Muối: < 5 g');
    expect(r.skippedErrors).toBe(0);
  });

  it('handles fenced JSON with surrounding text', async () => {
    generate.mockResolvedValue('```json\n' + ok('X: 1') + '\n```');
    const r = await service.transcribeAll([img('a')]);
    expect(r.texts.get(0)).toBe('X: 1');
  });

  it('omits has_information=false and empty transcriptions', async () => {
    generate
      .mockResolvedValueOnce(
        JSON.stringify({ has_information: false, transcription: '' }),
      )
      .mockResolvedValueOnce(ok('   '));
    const r = await service.transcribeAll([img('a'), img('b')]);
    expect(r.texts.size).toBe(0);
    expect(r.skippedErrors).toBe(0);
  });

  it('retries up to 3 attempts then counts one skipped error and continues', async () => {
    generate
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(ok('second'));
    const r = await service.transcribeAll([img('a'), img('b')]);
    expect(generate).toHaveBeenCalledTimes(4);
    expect(r.skippedErrors).toBe(1);
    expect(r.texts.get(1)).toBe('second');
    expect(waits).toEqual([1000, 1000]);
  });

  it('succeeds on a retry', async () => {
    generate
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(ok('fine'));
    const r = await service.transcribeAll([img('a')]);
    expect(r.texts.get(0)).toBe('fine');
    expect(r.skippedErrors).toBe(0);
  });

  it('treats malformed JSON and wrong types as failed attempts', async () => {
    generate
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('{"has_information":"yes","transcription":"x"}')
      .mockResolvedValueOnce('{"has_information":true,"transcription":5}');
    const r = await service.transcribeAll([img('a')]);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(r.skippedErrors).toBe(1);
    expect(r.texts.size).toBe(0);
  });

  it('calls sequentially', async () => {
    const events: string[] = [];
    let n = 0;
    generate.mockImplementation(async () => {
      const id = ++n;
      events.push(`start${id}`);
      await new Promise((res) => setTimeout(res, 5));
      events.push(`end${id}`);
      return ok(`t${id}`);
    });
    await service.transcribeAll([img('a'), img('b')]);
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2']);
  });

  it('reports progress per selected image', async () => {
    generate.mockResolvedValue(ok('t'));
    const onProgress = jest.fn();
    await service.transcribeAll(
      [img('a'), img('tiny', { width: 10 }), img('b')],
      onProgress,
    );
    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('sends the prompt with caption and context plus the image', async () => {
    generate.mockResolvedValue(ok('t'));
    const b = img('abc') as Extract<ExtractedBlock, { kind: 'image' }>;
    b.caption = 'Cap';
    b.contextText = 'Ctx';
    await service.transcribeAll([b]);
    expect(generate).toHaveBeenCalledWith(
      RAG_INGEST_PROMPTS.IMAGE_TRANSCRIBE('Cap', 'Ctx'),
      { base64: 'abc', mimeType: 'image/png' },
    );
  });
});
