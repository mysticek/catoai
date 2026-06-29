import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPair, sealHandshake, openHandshake, encrypt, decrypt, encodePairing, decodePairing,
  type PairingPayload,
} from "@cato/shared";

test("handshake: agent opens the sealed token and both derive the same session key", () => {
  const agent = generateKeyPair();
  const { sealed, sessionKey: phoneKey } = sealHandshake({ token: "AB12-CD34", device: "phone" }, agent.publicKey);
  const opened = openHandshake<{ token: string; device: string }>(sealed, agent.secretKey);
  assert.ok(opened, "agent should open the handshake");
  assert.equal(opened!.payload.token, "AB12-CD34");
  assert.equal(opened!.sessionKey, phoneKey, "both sides derive the identical session key");
});

test("handshake: a wrong agent key cannot open it (auth)", () => {
  const agent = generateKeyPair();
  const attacker = generateKeyPair();
  const { sealed } = sealHandshake({ token: "secret" }, agent.publicKey);
  assert.equal(openHandshake(sealed, attacker.secretKey), null);
});

test("session frames round-trip and reject tampering / wrong key", () => {
  const agent = generateKeyPair();
  const { sealed, sessionKey } = sealHandshake({ token: "t" }, agent.publicKey);
  const key = openHandshake(sealed, agent.secretKey)!.sessionKey;

  const enc = encrypt({ type: "voice.command", text: "what's happening" }, key);
  const dec = decrypt<{ type: string; text: string }>(enc, key);
  assert.equal(dec!.text, "what's happening");

  // tamper: flip the ciphertext → must fail closed
  const tampered = { nonce: enc.nonce, box: enc.box.slice(0, -2) + (enc.box.endsWith("A") ? "BB" : "AA") };
  assert.equal(decrypt(tampered, key), null);

  // wrong key → null
  const other = generateKeyPair();
  const { sessionKey: wrong } = sealHandshake({ token: "t" }, other.publicKey);
  assert.equal(decrypt(enc, wrong), null);
});

test("QR pairing payload encodes to a cato:// link and decodes back", () => {
  const p: PairingPayload = { v: 1, addr: "ws://192.168.1.24:8787/v1", id: "01ABC", host: "Mac", pub: generateKeyPair().publicKey, token: "AB12-CD34" };
  const link = encodePairing(p);
  assert.match(link, /^cato:\/\/pair\?d=/);
  const back = decodePairing(link);
  assert.deepEqual(back, p);
  assert.equal(decodePairing("garbage"), null);
});
