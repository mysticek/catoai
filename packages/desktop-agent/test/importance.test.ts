import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, scoreLine, detect } from "../src/memory/importance.js";

test("clean strips ANSI/OSC/control sequences", () => {
  assert.equal(clean("\x1b[31mred\x1b[0m"), "red");
  assert.equal(clean("plain text"), "plain text");
  assert.equal(clean("done\r"), "done");
});

test("scoreLine: noise is 0, errors rank high", () => {
  assert.equal(scoreLine("   "), 0);
  assert.ok(scoreLine("Error: boom") > scoreLine("just some output"));
  assert.ok(scoreLine("Do you want to proceed?") > 0.2);
});

test("detect: tests-failed / error / approval prompts", () => {
  assert.equal(detect("3 tests failed", "shopapp")[0]?.type, "TestsFailed");
  assert.equal(detect("Error: cannot find module", "shopapp")[0]?.type, "WorkerError");
  assert.equal(detect("Do you want to proceed? (y/n)", "shopapp")[0]?.type, "ApprovalRequested");
  assert.equal(detect("hello world", "shopapp").length, 0);
});
