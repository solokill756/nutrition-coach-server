export const RAG_INGEST_PROMPTS = {
  IMAGE_TRANSCRIBE: (caption?: string, context?: string): string => {
    const lines = [
      'You are transcribing an image taken from a nutrition document so it can be indexed for search.',
      '',
      'Rules:',
      '- Copy ALL text and numbers in the image VERBATIM, exactly as written.',
      '- Preserve label-to-number relationships, one item per line, for example "Tier 2 - Vegetables: 300-400 g/day".',
      '- Do NOT guess, infer, interpret or add any number or fact that is not visible in the image.',
      '- Answer in the original language of the image. Do not translate.',
      '- If the image is purely decorative, a photo of food or a dish, a logo, or contains no readable text, set has_information to false and transcription to an empty string.',
      '',
      'Return ONLY a JSON object of this exact shape:',
      '{ "has_information": boolean, "transcription": string }',
    ];
    if (caption?.trim()) {
      lines.push('', `Image caption: ${caption.trim()}`);
    }
    if (context?.trim()) {
      lines.push('', `Surrounding text (for context only, do not copy it): ${context.trim()}`);
    }
    return lines.join('\n');
  },
};
