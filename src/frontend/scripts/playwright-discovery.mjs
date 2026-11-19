#!/usr/bin/env node
// #177: parse the REAL installed Playwright config/specs without booting
// Chromium, Vite or the .NET API. 'tsc -b' does not parse e2e/*.spec.ts.
// An empty suite or invalid configuration must never pass preflight.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function parseDiscoveredTestCount(output) {
  if (typeof output !== "string") return null;
  const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
  const match = /\bTotal:\s*([\d,]+)\s+tests?\s+in\s+([\d,]+)\s+files?\b/.exec(plain);
  if (!match) return null;
  const tests = Number(match[1].replaceAll(",", ""));
  const files = Number(match[2].replaceAll(",", ""));
  if (!Number.isSafeInteger(tests) || !Number.isSafeInteger(files)
    || tests < 1 || files < 1) return null;
  return { tests, files };
}

export function verifyDiscovery(mode, spawn = spawnSync) {
  if (mode !== "mocked" && mode !== "live")
    throw new Error("Choose exactly 'mocked' or 'live' Playwright suite");

  const args = ["test", "--list"];
  if (mode === "live") args.push("--config", "playwright.live.config.ts");
  const executable = process.platform === "win32" ? "playwright.cmd" : "playwright";
  const result = spawn(executable, args, {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`Playwright ${mode} discovery failed (exit ${result.status}):\n${details}`);
  }
  const count = parseDiscoveredTestCount(result.stdout);
  if (!count) throw new Error(
    `Playwright ${mode} suite has no discoverable tests or invalid --list output:\n${result.stdout}`);
  console.log(`Playwright ${mode} discovery OK: ${count.tests} tests across ${count.files} files.`);
  return count;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    verifyDiscovery(process.argv[2]);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
