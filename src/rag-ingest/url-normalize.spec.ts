import { normalizeSourceUrl } from "./url-normalize";

describe("normalizeSourceUrl", () => {
  it.each([
    ["https://WHO.int/news/fact-sheets/healthy-diet/", "https://who.int/news/fact-sheets/healthy-diet"],
    ["https://who.int/a?utm_source=x&b=2&a=1#top", "https://who.int/a?a=1&b=2"],
    ["https://who.int/", "https://who.int/"],
    ["https://who.int", "https://who.int/"],
    ["https://who.int/a?fbclid=1&gclid=2", "https://who.int/a"],
    ["  http://who.int/a/  ", "http://who.int/a"],
  ])("normalizes %s", (input, expected) => expect(normalizeSourceUrl(input)).toBe(expected));

  it("rejects non-http urls", () => {
    expect(normalizeSourceUrl("ftp://x")).toBeNull();
    expect(normalizeSourceUrl("not a url")).toBeNull();
    expect(normalizeSourceUrl("")).toBeNull();
  });
});
