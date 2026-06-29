import { test } from "node:test";
import assert from "node:assert/strict";
import type { ApprovalRequest } from "@cato/shared";
import { summarizeToolCall, ruleKey, ApprovalManager } from "../src/approvals/manager.js";

test("summarizeToolCall risk heuristics", () => {
  assert.equal(summarizeToolCall("Bash", { command: "rm -rf /" }).risk, "high");
  assert.equal(summarizeToolCall("Bash", { command: "git reset --hard" }).risk, "medium");
  assert.equal(summarizeToolCall("Bash", { command: "ls -la" }).risk, "low");
  // writing a secret file is high-risk
  assert.equal(summarizeToolCall("Write", { file_path: "/x/.env", content: "K=1" }).risk, "high");
});

test("ruleKey: exact command for Bash, tool+title otherwise", () => {
  assert.equal(ruleKey("Bash", "Run command", "npm test"), "Bash:npm test");
  assert.equal(ruleKey("Edit", "Edit db.ts", "diff…"), "Edit:Edit db.ts");
});

test("ApprovalManager: scope 'command' auto-allows the same command anywhere", async () => {
  const am = new ApprovalManager(() => {});
  const info = { id: "a1", tool: "Bash", title: "Run command", risk: "low", stats: "", detail: "npm test" } as ApprovalRequest;
  const key = ruleKey("Bash", "Run command", "npm test");
  const p = am.request(info, key, "s1");
  assert.equal(am.isAutoAllowed(key, "s1"), false);
  am.resolve("a1", "allow", undefined, "command");
  assert.equal((await p).decision, "allow");
  assert.equal(am.isAutoAllowed(key, "s2"), true); // command rule is session-independent
});

test("ApprovalManager: scope 'session' auto-allows everything from that session", async () => {
  const am = new ApprovalManager(() => {});
  const info = { id: "b1", tool: "Bash", title: "Run command", risk: "low", stats: "", detail: "echo hi" } as ApprovalRequest;
  const p = am.request(info, "k", "sess");
  am.resolve("b1", "allow", undefined, "session");
  await p;
  assert.equal(am.isAutoAllowed("anything", "sess"), true);
  assert.equal(am.isAutoAllowed("k", "other"), false);
});
