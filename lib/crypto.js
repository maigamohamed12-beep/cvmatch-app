const crypto = require("crypto");

// Excludes 0/O and 1/I to avoid confusion when a candidate retypes a code from WhatsApp.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomString(alphabet, length) {
  // Rejection sampling: alphabet.length (33) doesn't evenly divide 256, so a
  // plain `byte % alphabet.length` would make the first few characters
  // slightly more likely to be picked. Discard the bytes that would land in
  // that uneven remainder instead.
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
