import { lookup } from "node:dns/promises";
import axios, { AxiosRequestConfig } from "axios";
import { downloadSource } from "./source-download";

jest.mock("node:dns/promises");
jest.mock("axios");

const resolve = jest.mocked(lookup);
const get = jest.mocked(axios.get);

function publicAddress(address = "93.184.216.34") {
  return { address, family: 4 };
}

describe("RAG source download", () => {
  beforeEach(() => jest.resetAllMocks());

  it.each(["127.0.0.1", "10.0.0.1", "169.254.1.1", "100.64.0.1", "[::1]", "[fd00::1]", "[::ffff:a00:1]"])(
    "rejects the non-public address %s before submitting a request",
    async (host) => {
      await expect(downloadSource(`http://${host}/document.pdf`)).rejects.toThrow("not public");
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("uses checked DNS results for the connection and refuses a mixed public/private answer", async () => {
    resolve.mockResolvedValue([publicAddress(), publicAddress("192.168.0.1")]);
    get.mockImplementation(async (_url, config) => {
      const socketLookup = config?.lookup as (host: string, options: object) => Promise<unknown>;
      await socketLookup("source.example", { all: true });
      throw new Error("Unexpected connection");
    });

    await expect(downloadSource("https://source.example/file.pdf")).rejects.toThrow("not public");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("checks the destination of each redirect and uploads the public PDF bytes", async () => {
    const bytes = Buffer.from("%PDF-1.7");
    resolve.mockResolvedValue([publicAddress()]);
    get.mockImplementation(async (url: string, config?: AxiosRequestConfig) => {
      expect(config).toMatchObject({ adapter: "http", maxRedirects: 0, proxy: false });
      const socketLookup = config?.lookup as (host: string, options: object) => Promise<unknown>;
      expect(await socketLookup(new URL(url).hostname, { all: true })).toEqual([[publicAddress()]]);
      return url === "https://source.example/start"
        ? { status: 302, headers: { location: "https://cdn.example/final.pdf" } }
        : { status: 200, headers: {}, data: bytes };
    });

    await expect(downloadSource("https://source.example/start")).resolves.toEqual({
      bytes, filename: "final.pdf", contentType: "application/pdf",
    });
    expect(resolve.mock.calls.map(([name]) => name)).toEqual(["source.example", "cdn.example"]);
  });

  it("rejects a redirect to a non-public destination", async () => {
    get.mockResolvedValue({ status: 302, headers: { location: "http://127.0.0.1/document.pdf" } });
    await expect(downloadSource("https://source.example/start")).rejects.toThrow("not public");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("returns public HTML as an HTML file when the source has no extension", async () => {
    const bytes = Buffer.from("<html lang='vi'>Nội dung</html>");
    get.mockResolvedValue({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, data: bytes });
    await expect(downloadSource("https://source.example/healthy-diet")).resolves.toEqual({
      bytes, filename: "healthy-diet.html", contentType: "text/html; charset=utf-8",
    });
  });

  it("recognizes HTML served without an accurate Content-Type", async () => {
    const bytes = Buffer.from("\uFEFF  <!doctype html><html>Document</html>");
    get.mockResolvedValue({ status: 200, headers: { "content-type": "application/octet-stream" }, data: bytes });
    await expect(downloadSource("https://source.example/document")).resolves.toEqual({
      bytes, filename: "document.html", contentType: "text/html",
    });
  });
});
