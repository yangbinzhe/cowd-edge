#!/usr/bin/env node
// Playwright launcher that resolves the Chromium executable for both local
// (snap) and CI (Playwright-managed) environments without hardcoding a path.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const env = { ...process.env };
if (!env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
  if (existsSync('/snap/bin/chromium')) {
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = '/snap/bin/chromium';
  } else {
    delete env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
}

const child = spawn(
  process.execPath,
  [new URL('../node_modules/playwright/cli.js', import.meta.url).pathname, ...process.argv.slice(2)],
  { stdio: 'inherit', env },
);
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
