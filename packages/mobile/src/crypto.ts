/**
 * End-to-end encryption — mirrors packages/shared/src/crypto.ts (kept local to avoid
 * cross-package Metro resolution in the standalone mobile app). NaCl box (X25519 +
 * XSalsa20-Poly1305) via tweetnacl. Secure randomness comes from expo-crypto (RN has no
 * built-in crypto.getRandomValues), wired through nacl.setPRNG.
 */
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import * as ExpoCrypto from "expo-crypto";

// tweetnacl needs a CSPRNG; RN/Hermes has none by default → use expo-crypto.
try {
  nacl.setPRNG((x: Uint8Array, n: number) => {
    const bytes = ExpoCrypto.getRandomBytes(n);
    for (let i = 0; i < n; i++) x[i] = bytes[i];
  });
} catch {
  /* if this fails, callers fall back to plaintext */
}

const { encodeBase64: b64, decodeBase64: unb64, decodeUTF8: toBytes, encodeUTF8: fromBytes } = naclUtil;

export interface Sealed { epk: string; nonce: string; box: string; }
export interface Enc { nonce: string; box: string; }
export interface PairingPayload { v: 1; addr: string; id: string; host: string; pub: string; token: string; }

export function sealHandshake(payload: unknown, agentPublicKey: string): { sealed: Sealed; sessionKey: string } {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const agentPub = unb64(agentPublicKey);
  const box = nacl.box(toBytes(JSON.stringify(payload)), nonce, agentPub, eph.secretKey);
  const sessionKey = nacl.box.before(agentPub, eph.secretKey);
  return { sealed: { epk: b64(eph.publicKey), nonce: b64(nonce), box: b64(box) }, sessionKey: b64(sessionKey) };
}

export function encrypt(payload: unknown, sessionKey: string): Enc {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box.after(toBytes(JSON.stringify(payload)), nonce, unb64(sessionKey));
  return { nonce: b64(nonce), box: b64(box) };
}

export function decrypt<T>(enc: Enc, sessionKey: string): T | null {
  try {
    const opened = nacl.box.open.after(unb64(enc.box), unb64(enc.nonce), unb64(sessionKey));
    if (!opened) return null;
    return JSON.parse(fromBytes(opened)) as T;
  } catch {
    return null;
  }
}

export function decodePairing(scanned: string): PairingPayload | null {
  try {
    const m = scanned.match(/[?&#]d=([^&]+)/);
    const data = m && m[1] ? decodeURIComponent(m[1]) : scanned;
    const p = JSON.parse(fromBytes(unb64(data))) as PairingPayload;
    return p && p.v === 1 && p.addr && p.pub && p.token ? p : null;
  } catch {
    return null;
  }
}
