/**
 * Runs the behaviour harness in a headless Chromium and exits non-zero if any
 * check fails. This is the gate CI runs on every pull request.
 *
 * Uses the Chrome/Edge already installed on the machine (or CHROME_PATH) rather
 * than downloading a browser, so it stays fast.
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error("No Chrome or Edge found. Set CHROME_PATH to a Chromium binary.");
  process.exit(2);
}

const harness = path.resolve("test/index.html");
if (!existsSync(harness)) {
  console.error("test/index.html missing — run `npm run test:build` first.");
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"],
});

let failed = true;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 900 });

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(pathToFileURL(harness).href, { waitUntil: "load" });
  await page.waitForFunction("window.__results !== undefined", { timeout: 20000 });
  const results = await page.evaluate(() => window.__results);

  for (const r of results.results ?? []) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  —  ${r.detail}`);
  }
  for (const e of pageErrors) console.log("page error:", e);

  console.log(`\n${results.passed} passed, ${results.failed} failed`);
  failed = results.failed !== 0 || pageErrors.length > 0;
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
