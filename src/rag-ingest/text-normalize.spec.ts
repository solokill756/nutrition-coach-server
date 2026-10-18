import {
  countWords,
  detectLanguage,
  documentLanguage,
  normalizeMultiline,
  normalizeText,
} from './text-normalize';

describe('text-normalize', () => {
  it('normalizeMultiline keeps line breaks, collapses blanks and converts to NFC', () => {
    expect(normalizeMultiline('  a \t b  \r\n\r\n\r\n\n  c  \n')).toBe('a b\n\nc');
    expect(normalizeMultiline('x\ny')).toBe('x\ny');
    const nfd = 'tiểu  đường\nhai'.normalize('NFD');
    expect(normalizeMultiline(nfd)).toBe('tiểu đường\nhai');
  });

  it('normalizeText converts NFD Vietnamese to NFC', () => {
    const nfd = 'tiểu  đường '.normalize('NFD');
    expect(nfd).not.toBe('tiểu  đường ');
    expect(normalizeText(nfd)).toBe('tiểu đường');
    expect(normalizeText('tiểu  đường ')).toBe('tiểu đường');
  });

  it('normalizeText collapses whitespace and newlines', () => {
    expect(normalizeText('  a \n\t b   c ')).toBe('a b c');
  });

  it('countWords', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords(' một  hai\nba ')).toBe(3);
  });

  it('detectLanguage', () => {
    expect(detectLanguage('Người bệnh tiểu đường nên hạn chế đường')).toBe('vi');
    expect(detectLanguage('Keep salt intake below 5 g per day')).toBe('en');
    expect(detectLanguage('')).toBe('en');
    expect(detectLanguage('123 456 !!!')).toBe('en');
  });

  it('detectLanguage works on NFD input', () => {
    expect(
      detectLanguage('Người bệnh tiểu đường nên hạn chế đường'.normalize('NFD')),
    ).toBe('vi');
  });

  it('documentLanguage returns mixed when the minority language has >=30% of words', () => {
    const w = (n: number) => Array(n).fill('word').join(' ');
    expect(
      documentLanguage([
        { language: 'en', content: w(70) },
        { language: 'vi', content: w(30) },
      ]),
    ).toBe('mixed');
    expect(
      documentLanguage([
        { language: 'en', content: w(90) },
        { language: 'vi', content: w(10) },
      ]),
    ).toBe('en');
    expect(
      documentLanguage([
        { language: 'en', content: w(10) },
        { language: 'vi', content: w(90) },
      ]),
    ).toBe('vi');
    expect(documentLanguage([])).toBe('en');
  });
});
