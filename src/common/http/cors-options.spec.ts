import { buildCorsOptions, parseOrigins } from "./cors-options";

describe("parseOrigins", () => {
  it("splits on commas, trims and drops empty entries", () => {
    expect(parseOrigins(" http://a.test , https://b.test,, ")).toEqual([
      "http://a.test",
      "https://b.test",
    ]);
  });

  it("drops a trailing slash so it matches the Origin header", () => {
    expect(parseOrigins("http://localhost:5173/")).toEqual(["http://localhost:5173"]);
  });

  it("returns an empty list when unset", () => {
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins("")).toEqual([]);
  });
});

describe("buildCorsOptions", () => {
  it("allows credentials for the configured origins only", () => {
    expect(buildCorsOptions("http://localhost:5173")).toEqual({
      origin: ["http://localhost:5173"],
      credentials: true,
    });
  });

  it("keeps the old open CORS when nothing is configured", () => {
    expect(buildCorsOptions(undefined)).toEqual({});
  });
});
