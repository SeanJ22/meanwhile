import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const KEYS_MASTER_ENV = "WTP_KEYS_ENCRYPTION_KEY";

function master(value: string | undefined): Buffer {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error("The Keys box needs its encryption setting.");
  return Buffer.from(value, "hex");
}

/** A fresh nonce for every save. The name is authenticated so ciphertext cannot move between keys. */
export function lockKey(name: string, value: string, encryptionKey: string | undefined): string {
  if (!value.trim() || Buffer.byteLength(value, "utf8") > 16_384) throw new Error("Paste a key of up to 16,384 bytes.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", master(encryptionKey), nonce);
  cipher.setAAD(Buffer.from(name));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function unlockKey(name: string, locked: string, encryptionKey: string | undefined): string {
  const [version, nonce, tag, ciphertext, extra] = locked.split(".");
  if (version !== "v1" || !nonce || !tag || !ciphertext || extra !== undefined) throw new Error("The saved key could not be opened.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", master(encryptionKey), Buffer.from(nonce, "base64url"));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("The saved key could not be opened."); }
}
