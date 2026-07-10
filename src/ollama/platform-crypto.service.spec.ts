import { createDecipheriv, pbkdf2Sync } from "crypto";
import { PlatformCryptoService } from "./platform-crypto.service";

function decryptPlatformPayload(encryptedData: string, secretKey: string): { timestamp: number; data: string } {
  const buffer = Buffer.from(encryptedData, "base64");
  const salt = buffer.subarray(0, 16);
  const iv = buffer.subarray(16, 28);
  const encrypted = buffer.subarray(28);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const authTag = encrypted.subarray(encrypted.length - 16);
  const key = pbkdf2Sync(secretKey, salt, 100000, 32, "sha256");

  const decipher = createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: 16
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(decrypted) as { timestamp: number; data: string };
}

describe("PlatformCryptoService", () => {
  it("encrypts into decrypt-compatible base64 payload", () => {
    const encrypted = PlatformCryptoService.encrypt("curl test", "secret");

    expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
    const payload = decryptPlatformPayload(encrypted, "secret");

    expect(payload.data).toBe("curl test");
    expect(typeof payload.timestamp).toBe("number");
  });

  it("uses fresh salt and iv for each encryption", () => {
    const first = PlatformCryptoService.encrypt("same plaintext", "secret");
    const second = PlatformCryptoService.encrypt("same plaintext", "secret");

    expect(first).not.toBe(second);
  });
});
