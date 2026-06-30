import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMenu } from "../src/agents/menu.js";

test("detects a live numbered menu with a nav footer", () => {
  const screen = [
    "□ Ďalší krok", "",
    "Čo by si chcel ďalej robiť na projekte cato?", "",
    "❯ 1. Pridať novú funkciu",
    "    Naplánovať a implementovať novú feature.",
    "  2. Opraviť bug / refaktor",
    "  3. Code review / audit", "",
    "Enter to select · ↑/↓ to navigate · Esc to cancel",
  ].join("\n");
  const m = parseMenu(screen);
  assert.ok(m);
  assert.equal(m.question, "Čo by si chcel ďalej robiť na projekte cato?");
  assert.deepEqual(m.options, ["Pridať novú funkciu", "Opraviť bug / refaktor", "Code review / audit"]);
  assert.deepEqual(m.numbers, [1, 2, 3]);
});

test("no footer → not a menu (the bug: stale scrollback / declined)", () => {
  const declined = [
    "› daj mi na vyber nejake 3 volby cez tool",
    "User declined to answer questions",
    "  · Čo by si chcel ďalej robiť na projekte cato? (Pridať novú funkciu / Opraviť bug / refaktor / Code review / audit)",
    "— History 97/100",
  ].join("\n");
  assert.equal(parseMenu(declined), null);
});

test("plain idle prompt + status line → not a menu", () => {
  assert.equal(parseMenu("› ako sa mas?\n→ bossai git:(main) ctx:97% $0.1"), null);
});

test("a single numbered line is not a menu", () => {
  assert.equal(parseMenu("1. only one option\nEnter to select"), null);
});
