import { Injectable } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import { InlineImage } from "../ollama/gemini-vision.client";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

@Injectable()
export class RagFileStorageService {
  private readonly root: string;

  constructor() {
    this.root = path.resolve(process.cwd(), process.env.RAG_STORAGE_DIR || "./storage/rag");
  }

  async saveSourcePdf(documentId: string, buffer: Buffer): Promise<string> {
    const relative = `documents/${documentId}/source.pdf`;
    await this.write(relative, buffer);
    return relative;
  }

  async saveImage(documentId: string, name: string, image: InlineImage): Promise<string> {
    const ext = IMAGE_EXTENSIONS[image.mimeType] ?? "bin";
    const relative = `documents/${documentId}/images/${name}.${ext}`;
    await this.write(relative, Buffer.from(image.base64, "base64"));
    return relative;
  }

  async readFile(relativePath: string): Promise<Buffer> {
    return fs.readFile(this.resolveInside(relativePath));
  }

  async deleteDocumentDir(documentId: string): Promise<void> {
    await fs.rm(this.resolveInside(`documents/${documentId}`), { recursive: true, force: true });
  }

  private async write(relativePath: string, data: Buffer): Promise<void> {
    const target = this.resolveInside(relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }

  private resolveInside(relativePath: string): string {
    const target = path.resolve(this.root, relativePath);
    if (!target.startsWith(this.root + path.sep)) {
      throw new Error(`Path escapes RAG storage root: ${relativePath}`);
    }
    return target;
  }
}
