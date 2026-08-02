const crypto = require("crypto");

// Excludes 0/O and 1/I to avoid confusion when a candidate retypes a code from WhatsApp.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomString(alphabet, length) {
  // Rejection sampling rather than a plain `byte % alphabet.length`, so this
  // stays unbiased even if the alphabet is ever resized to a length that
  // doesn't evenly divide 256 (32 does, so there's no active bias today).
  const n = alphabet.length;
  const cutoff = 256 - (256 % n);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.randomBytes(length - out.length);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      if (bytes[i] < cutoff) out += alphabet[bytes[i] % n];
    }
  }
  return out;
}

function generateCode() {
  return randomString(CODE_ALPHABET, 8);
}

function generateRef() {
  return randomString(REF_ALPHABET, 6);
}

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code).trim().toUpperCase()).digest("hex");
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { generateCode, generateRef, hashCode, safeEqual };
