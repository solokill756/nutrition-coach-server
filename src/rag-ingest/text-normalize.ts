/** NFC-normalize, collapse all whitespace runs to a single space, trim. */
export function normalizeText(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function countWords(s: string): number {
  const t = normalizeText(s);
  return t === '' ? 0 : t.split(' ').length;
}

const VI_BASE_LETTERS = /[ăâđêôơư]/;
// grave, acute, tilde, hook above, dot below
const VI_TONE_MARKS = /[̣̀́̃̉]/;
const VI_THRESHOLD = 0.05;

export function detectLanguage(s: string): 'en' | 'vi' {
  let letters = 0;
  let vi = 0;
  for (const ch of s.normalize('NFC').toLowerCase()) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    if (VI_BASE_LETTERS.test(ch) || VI_TONE_MARKS.test(ch.normalize('NFD'))) {
      vi++;
    }
  }
  if (letters === 0) return 'en';
  return vi / letters >= VI_THRESHOLD ? 'vi' : 'en';
}

const MIXED_THRESHOLD = 0.3;

export function documentLanguage(
  chunks: { language: 'en' | 'vi'; content: string }[],
): 'en' | 'vi' | 'mixed' {
  let en = 0;
  let vi = 0;
  for (const c of chunks) {
    const n = countWords(c.content);
    if (c.language === 'vi') vi += n;
    else en += n;
  }
  const total = en + vi;
  if (total === 0) return 'en';
  const minority = Math.min(en, vi);
  if (minority / total >= MIXED_THRESHOLD) return 'mixed';
  return vi > en ? 'vi' : 'en';
}
