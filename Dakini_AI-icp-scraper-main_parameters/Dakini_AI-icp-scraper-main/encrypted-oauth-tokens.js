const crypto = require("node:crypto");

const ENVELOPE_VERSION = 1;

function parseEncryptionKey(value) {
  if (typeof value !== "string" || !/^[\da-f]{64}$/i.test(value)) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes).");
  }
  return Buffer.from(value, "hex");
}

function encryptOAuthTokens(tokens, encryptionKey) {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    throw new TypeError("Google OAuth tokens must be an object.");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", parseEncryptionKey(encryptionKey), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final()
  ]);
  return {
    version: ENVELOPE_VERSION,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptOAuthTokens(envelope, encryptionKey) {
  if (!envelope || envelope.version !== ENVELOPE_VERSION ||
      typeof envelope.iv !== "string" ||
      typeof envelope.authTag !== "string" ||
      typeof envelope.ciphertext !== "string") {
    throw new Error("Stored Google OAuth credentials have an unsupported encryption envelope.");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      parseEncryptionKey(encryptionKey),
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
    const tokens = JSON.parse(plaintext);
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
      throw new Error("Stored Google OAuth credentials are invalid.");
    }
    return tokens;
  } catch (error) {
    throw new Error(`Could not decrypt stored Google OAuth credentials: ${error.message}`);
  }
}

module.exports = { decryptOAuthTokens, encryptOAuthTokens, parseEncryptionKey };
