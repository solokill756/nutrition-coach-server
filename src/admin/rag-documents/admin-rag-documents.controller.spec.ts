import { Readable } from "stream";
import { RAG_UPLOAD_OPTIONS } from "./admin-rag-documents.controller";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const multer = require("multer");

function parseUpload(options: Record<string, unknown>, filenameUtf8: string): Promise<{ originalname: string }> {
  const boundary = "XBOUNDARY";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="`),
    Buffer.from(filenameUtf8, "utf8"), // browsers send raw UTF-8 bytes
    Buffer.from(`"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\r\n--${boundary}--\r\n`),
  ]);
  const req: any = Readable.from([body]);
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.length) };
  return new Promise((resolve, reject) => {
    multer(options).single("file")(req, {} as any, (err: unknown) => (err ? reject(err) : resolve(req.file)));
  });
}

describe("RAG_UPLOAD_OPTIONS", () => {
  const name = "Hướng dẫn dinh dưỡng.pdf";

  it("decodes a raw UTF-8 multipart filename correctly", async () => {
    expect((await parseUpload(RAG_UPLOAD_OPTIONS, name)).originalname).toBe(name);
  });

  it("(control) multer's default latin1 would mangle it", async () => {
    const file = await parseUpload({ limits: RAG_UPLOAD_OPTIONS.limits }, name);
    expect(file.originalname).not.toBe(name);
  });
});
