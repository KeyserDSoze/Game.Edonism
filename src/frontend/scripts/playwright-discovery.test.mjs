import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDiscoveredTestCount, verifyDiscovery,
} from "./playwright-discovery.mjs";

test("#177: nonempty Chromium test files and cases discovered", () => {
  assert.deepEqual(parseDiscoveredTestCount(
    "Listing tests:\n  [chromium] › some.spec.ts:11:1\nTotal: 602 tests in 37 files\n"),
  { tests: 602, files: 37 });
  assert.deepEqual(parseDiscoveredTestCount("Total: 1 test in 1 file"),
    { tests: 1, files: 1 });
  assert.deepEqual(parseDiscoveredTestCount("Total: 1,234 tests in 52 files"),
    { tests: 1234, files: 52 });
  assert.deepEqual(parseDiscoveredTestCount(
    "\x1b[32mTotal: 42 tests in 1 file\x1b[0m"),
  { tests: 42, files: 1 });
});

test("#177: fail closed if Playwright list output is empty or truncated", () => {
  for (const invalid of [
    null, undefined, "", "No tests found", "Total: 0 tests in 3 files",
    "Total: 21 tests in 0 files", "Total: 0 tests in 0 files",
    "Total: 5 tests", "Total: NaN tests in 2 files",
    "Total: 999999999999999999999999 tests in 1 file",
  ]) assert.equal(parseDiscoveredTestCount(invalid), null);
});

test("#177: mocked suite discovers actual default config, no .NET or browser", () => {
  const fake = (command, args, options) => {
    assert.equal(command, process.platform === "win32" ? "playwright.cmd" : "playwright");
    assert.deepEqual(args, ["test", "--list"]);
    assert.equal(options.encoding, "utf8");
    return { status: 0, stdout: "Total: 601 tests in 26 files", stderr: "" };
  };
  assert.deepEqual(verifyDiscovery("mocked", fake), { tests: 601, files: 26 });
});

test("#177: live suite discovers ONLY real API Playwright config", () => {
  const fake = (_command, args) => {
    assert.deepEqual(args, [
      "test", "--list", "--config", "playwright.live.config.ts",
    ]);
    return { status: 0, stdout: "Total: 42 tests in 3 files", stderr: "" };
  };
  assert.deepEqual(verifyDiscovery("live", fake), { tests: 42, files: 3 });
});

test("#177: parser, config and runner errors fail closed, not skip", () => {
  assert.throws(() => verifyDiscovery("fake", () => {
    throw new Error("should not execute");
  }), /Choose exactly/);
  assert.throws(() => verifyDiscovery("mocked", () => ({
    status: 1, stdout: "", stderr: "SyntaxError: Unexpected token",
  })), /SyntaxError/);
  assert.throws(() => verifyDiscovery("live", () => ({
    status: 0, stdout: "Total: 0 tests in 0 files", stderr: "",
  })), /no discoverable tests/);
  assert.throws(() => verifyDiscovery("mocked", () => ({
    error: new Error("Playwright missing"), status: null,
  })), /Playwright missing/);
});
