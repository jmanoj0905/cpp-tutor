import { randomBytes } from "node:crypto";

const NONCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// Backed by node:crypto rather than Math.random(): a CSP nonce that an
// attacker could predict defeats the point of the CSP, so the token needs a
// cryptographically secure source of randomness.
export function makeNonce(): string {
  const bytes = randomBytes(24);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += NONCE_ALPHABET[bytes[i] % NONCE_ALPHABET.length];
  return out;
}
