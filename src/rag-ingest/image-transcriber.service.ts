import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { GeminiVisionClient } from '../ollama/gemini-vision.client';
import { RAG_INGEST_PROMPTS } from './constants/rag-ingest-prompts';
import { ExtractedBlock } from './rag-ingest.types';
import { normalizeMultiline } from './text-normalize';

export const MIN_IMAGE_SIDE_PX = 120;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

type ImageBlock = Extract<ExtractedBlock, { kind: 'image' }>;

/**
 * Indexes of image blocks worth sending to the vision model: drops images with
 * a side below MIN_IMAGE_SIDE_PX and repeated logos (same sha256 on >= 2
 * distinct pages, or >= 2 occurrences when pages are unknown).
 */
export function selectImagesToTranscribe(blocks: ExtractedBlock[]): number[] {
  const candidates: { index: number; hash: string; page?: number }[] = [];
  blocks.forEach((b, index) => {
    if (b.kind !== 'image') return;
    if (b.image.width < MIN_IMAGE_SIDE_PX || b.image.height < MIN_IMAGE_SIDE_PX) {
      return;
    }
    candidates.push({
      index,
      hash: createHash('sha256').update(b.image.base64).digest('hex'),
      page: b.page,
    });
  });

  const pagesByHash = new Map<string, Set<number>>();
  const countByHash = new Map<string, number>();
  for (const c of candidates) {
    countByHash.set(c.hash, (countByHash.get(c.hash) ?? 0) + 1);
    if (c.page !== undefined) {
      const pages = pagesByHash.get(c.hash) ?? new Set<number>();
      pages.add(c.page);
      pagesByHash.set(c.hash, pages);
    }
  }

  return candidates
    .filter((c) => {
      if (c.page === undefined) return (countByHash.get(c.hash) ?? 0) < 2;
      return (pagesByHash.get(c.hash)?.size ?? 0) < 2;
    })
    .map((c) => c.index);
}

function parseTranscription(raw: string): string | null {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in response');
  const parsed = JSON.parse(unfenced.slice(start, end + 1)) as {
    has_information?: unknown;
    transcription?: unknown;
  };
  if (
    typeof parsed.has_information !== 'boolean' ||
    typeof parsed.transcription !== 'string'
  ) {
    throw new Error('Unexpected JSON shape');
  }
  if (!parsed.has_information) return null;
  const text = normalizeMultiline(parsed.transcription);
  return text === '' ? null : text;
}

@Injectable()
export class ImageTranscriberService {
  private readonly logger = new Logger(ImageTranscriberService.name);

  constructor(private readonly vision: GeminiVisionClient) {}

  async transcribeAll(
    blocks: ExtractedBlock[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ texts: Map<number, string>; skippedErrors: number }> {
    const selected = selectImagesToTranscribe(blocks);
    const texts = new Map<number, string>();
    let skippedErrors = 0;
    let done = 0;

    for (const index of selected) {
      const block = blocks[index] as ImageBlock;
      try {
        const text = await this.transcribeOne(block);
        if (text !== null) texts.set(index, text);
      } catch (err) {
        skippedErrors++;
        this.logger.warn(
          `Skipping image block ${index}: ${(err as Error).message}`,
        );
      }
      done++;
      onProgress?.(done, selected.length);
    }
    return { texts, skippedErrors };
  }

  private async transcribeOne(block: ImageBlock): Promise<string | null> {
    const prompt = RAG_INGEST_PROMPTS.IMAGE_TRANSCRIBE(
      block.caption,
      block.contextText,
    );
    const image = {
      base64: block.image.base64,
      mimeType: block.image.mimeType,
    };
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const raw = await this.vision.generateWithImage(prompt, image);
        return parseTranscription(raw);
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS) await this.wait(RETRY_DELAY_MS);
      }
    }
    throw lastError;
  }

  /** Overridable in tests to avoid real delays. */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
