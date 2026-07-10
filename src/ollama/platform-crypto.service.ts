import { randomBytes, pbkdf2Sync, createCipheriv } from "crypto";

export class PlatformCryptoService {
  private static readonly pbkdf2Iterations = 100000;
  private static readonly keyLength = 32;
  private static readonly saltLength = 16;
  private static readonly ivLength = 12;
  private static readonly authTagLength = 16;

  static encrypt(plaintext: string, secretKey: string): string {
    const salt = randomBytes(this.saltLength);
    const key = pbkdf2Sync(secretKey, salt, this.pbkdf2Iterations, this.keyLength, "sha256");
    const iv = randomBytes(this.ivLength);
    const payload = JSON.stringify({
      timestamp: Date.now(),
      data: plaintext
    });

    const cipher = createCipheriv("aes-256-gcm", key, iv, {
      authTagLength: this.authTagLength
    });
    const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([salt, iv, ciphertext, authTag]).toString("base64");
  }
}
