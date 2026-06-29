/**
 * End-to-end encryption for the Cato link (NaCl: X25519 + XSalsa20-Poly1305 via tweetnacl,
 * pure-JS so it runs identically in Node and React Native).
 *
 * Model: the desktop agent owns a long-term key pair; its public key is pinned by the phone
 * during QR pairing. To connect, the phone seals a handshake (carrying the pairing token)
 * to the agent's public key using an EPHEMERAL key pair — so the token is never on the wire
 * in clear, the agent is authenticated (pinned key), and a per-session shared key is derived
 * for all subsequent frames. No `any`; everything base64 strings at the boundary.
 */
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

const { encodeBase64: b64, decodeBase64: unb64, decodeUTF8: toBytes, encodeUTF8: fromBytes } = naclUtil;

export interface KeyPairB64 {
  publicKey: string;
  secretKey: string;
}

/** Sealed handshake blob: ephemeral public key + nonce + ciphertext (all base64). */
export interface Sealed {
  epk: string;
  nonce: string;
  box: string;
}

/** An encrypted session frame: nonce + ciphertext (base64). */
export interface Enc {
  nonce: string;
  box: string;
}

/** Pairing payload encoded into the QR the desktop shows (scanned by the phone). */
export interface PairingPayload {
  v: 1;
  addr: string; // ws URL, e.g. ws://192.168.1.24:8787/v1
  id: string; // stable machine id
  host: string; // friendly name
  pub: string; // agent long-term public key (base64) — pinned by the phone
  token: string; // pairing token
}

export function generateKeyPair(): KeyPairB64 {
  const kp = nacl.box.keyPair();
  return { publicKey: b64(kp.publicKey), secretKey: b64(kp.secretKey) };
}

/**
 * Phone side: seal a handshake to the agent's public key with a fresh ephemeral key pair.
 * Returns the blob to send AND the derived session key to keep for the rest of the session.
 */
export function sealHandshake(payload: unknown, agentPublicKey: string): { sealed: Sealed; sessionKey: string } {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const agentPub = unb64(agentPublicKey);
  const box = nacl.box(toBytes(JSON.stringify(payload)), nonce, agentPub, eph.secretKey);
  const sessionKey = nacl.box.before(agentPub, eph.secretKey);
  return { sealed: { epk: b64(eph.publicKey), nonce: b64(nonce), box: b64(box) }, sessionKey: b64(sessionKey) };
}

/**
 * Agent side: open the handshake with the agent's secret key. Returns the payload and the
 * matching session key, or null if it doesn't authenticate.
 */
export function openHandshake<T>(sealed: Sealed, agentSecretKey: string): { payload: T; sessionKey: string } | null {
  try {
    const epk = unb64(sealed.epk);
    const sec = unb64(agentSecretKey);
    const opened = nacl.box.open(unb64(sealed.box), unb64(sealed.nonce), epk, sec);
    if (!opened) return null;
    const sessionKey = nacl.box.before(epk, sec);
    return { payload: JSON.parse(fromBytes(opened)) as T, sessionKey: b64(sessionKey) };
  } catch {
    return null;
  }
}

/** Encrypt a frame with the session key (both sides hold the same key). */
export function encrypt(payload: unknown, sessionKey: string): Enc {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box.after(toBytes(JSON.stringify(payload)), nonce, unb64(sessionKey));
  return { nonce: b64(nonce), box: b64(box) };
}

/** Decrypt a frame; returns null on any tamper / wrong key. */
export function decrypt<T>(enc: Enc, sessionKey: string): T | null {
  try {
    const opened = nacl.box.open.after(unb64(enc.box), unb64(enc.nonce), unb64(sessionKey));
    if (!opened) return null;
    return JSON.parse(fromBytes(opened)) as T;
  } catch {
    return null;
  }
}

/** Encode a pairing payload as a `cato://pair?d=…` deep link for the QR code. */
export function encodePairing(p: PairingPayload): string {
  return `cato://pair?d=${b64(toBytes(JSON.stringify(p)))}`;
}

/** Decode a scanned `cato://pair?d=…` link (or bare base64) back to a payload. */
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
