const crypto = require("crypto");

// Excludes 0/O and 1/I to avoid confusion when a candidate retypes a code from WhatsApp.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomString(alphabet, length) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
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
