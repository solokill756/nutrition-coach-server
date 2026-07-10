import * as fs from "fs";
import * as path from "path";

function collectTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__mocks__") continue;
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".spec.ts")) continue;
    out.push(full);
  }
  return out;
}

describe("Backend source smoke load", () => {
  it("loads source files without throwing", () => {
    const root = path.join(process.cwd(), "src");
    const files = collectTsFiles(root).filter((file) => {
      const normalized = file.replace(/\\/g, "/");
      if (normalized.endsWith("/main.ts")) return false;
      if (normalized.endsWith("/seed-data.ts")) return false;
      if (normalized.endsWith("/app.module.ts")) return false;
      return true;
    });

    for (const file of files) {
      expect(() => {
        require(file);
      }).not.toThrow();
    }
  });
});

