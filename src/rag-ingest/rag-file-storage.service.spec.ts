import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { RagFileStorageService } from "./rag-file-storage.service";

describe("RagFileStorageService", () => {
  let dir: string;
  let service: RagFileStorageService;
  const prev = process.env.RAG_STORAGE_DIR;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-storage-"));
    process.env.RAG_STORAGE_DIR = dir;
    service = new RagFileStorageService();
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env.RAG_STORAGE_DIR;
    else process.env.RAG_STORAGE_DIR = prev;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("saves and reads a source pdf", async () => {
    const rel = await service.saveSourcePdf("doc1", Buffer.from("pdf-bytes"));
    expect(rel).toBe("documents/doc1/source.pdf");
    expect((await service.readFile(rel)).toString()).toBe("pdf-bytes");
  });

  it("saves images with extension from mime type", async () => {
    const png = await service.saveImage("doc1", "img-1", { base64: Buffer.from("x").toString("base64"), mimeType: "image/png" });
    const jpg = await service.saveImage("doc1", "img-2", { base64: Buffer.from("y").toString("base64"), mimeType: "image/jpeg" });
    const odd = await service.saveImage("doc1", "img-3", { base64: Buffer.from("z").toString("base64"), mimeType: "image/tiff" });
    expect(png).toBe("documents/doc1/images/img-1.png");
    expect(jpg).toBe("documents/doc1/images/img-2.jpg");
    expect(odd).toBe("documents/doc1/images/img-3.bin");
    expect((await service.readFile(png)).toString()).toBe("x");
  });

  it("rejects path traversal", async () => {
    await expect(service.readFile("../../etc/passwd")).rejects.toThrow();
    await expect(service.readFile("/etc/passwd")).rejects.toThrow();
  });

  it("deleteDocumentDir works with or without the directory", async () => {
    await service.saveSourcePdf("doc1", Buffer.from("a"));
    await service.deleteDocumentDir("doc1");
    await expect(fs.stat(path.join(dir, "documents", "doc1"))).rejects.toThrow();
    await expect(service.deleteDocumentDir("never-existed")).resolves.toBeUndefined();
  });
});
