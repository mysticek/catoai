import { test } from "node:test";
import assert from "node:assert/strict";
import { sayNoWorker, sayUnknown, sayStatus, sayTold } from "../src/orchestrator/phrasing.js";

test("canned replies are localized (en/sk/cs)", () => {
  assert.equal(sayNoWorker("en"), "No active worker.");
  assert.equal(sayNoWorker("sk"), "Nemám žiadneho aktívneho workera.");
  assert.equal(sayNoWorker("cs"), "Nemám žádného aktivního workera.");
  // unknown locale falls back to English
  assert.equal(sayUnknown("de"), "I didn't get that. Try saying it differently.");
});

test("sayStatus: empty → 'nothing' line per language", () => {
  assert.equal(sayStatus([], "sk"), "Zatiaľ sa nič nedeje.");
  assert.equal(sayStatus([], "en"), "Nothing is happening yet.");
});

test("sayTold mentions context only when present", () => {
  assert.ok(sayTold("shopapp", true, "sk").includes("kontextom"));
  assert.ok(!sayTold("shopapp", false, "sk").includes("kontextom"));
});
