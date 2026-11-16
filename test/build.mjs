/**
 * Builds test/index.html: a self-contained page that runs the behavioural
 * harness against the real src/editor.ts and the real styles.css.
 *
 * Self-contained on purpose — browsers refuse to load sibling <script src>
 * files from file:// URLs, and the whole point is that this can be opened by
 * double-clicking.
 */
import esbuild from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const result = await esbuild.build({
  entryPoints: ["test/harness.ts"],
  bundle: true,
  format: "iife",
  write: false,
  target: "es2020",
  logLevel: "warning",
});

const js = result.outputFiles[0].text.replace(/<\/script>/gi, "<\\/script>");
const css = await readFile("styles.css", "utf8");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Accordion Headings — behaviour harness</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #1a1a1a; background: #fff; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.lead { margin: 0 0 18px; color: #555; font-size: 13px; }
  #editor { border: 1px solid #ccc; padding: 12px; width: 620px; font-size: 16px; }
  .cm-editor { font-family: Georgia, serif; }
  .cm-line { line-height: 1.7; }
  #results { margin-top: 20px; width: 620px; font-size: 13px; font-family: ui-monospace, monospace; }
  #results h2 { font-size: 15px; font-family: system-ui, sans-serif; margin: 0 0 10px; }
  .row { padding: 3px 0; border-bottom: 1px solid #eee; }
  .ok { color: #1a7f37; }
  .bad { color: #c1121f; }
  h2.ok { color: #1a7f37; } h2.bad { color: #c1121f; }
</style>
<style>
/* the real, shipped stylesheet */
${css}
</style>
</head>
<body class="ah-h1 ah-h2 ah-h3 ah-h4 ah-h5 ah-h6 ah-icon-chevron ah-vis-always">
<h1>Accordion Headings — behaviour harness</h1>
<p class="lead">Runs src/editor.ts in plain CodeMirror 6 against the shipped styles.css. No Obsidian needed.</p>
<div id="editor"></div>
<div id="results">running…</div>
<script>${js}</script>
</body>
</html>
`;

await writeFile("test/index.html", html);
console.log(`built test/index.html (${Math.round(html.length / 1024)} KB) — open it in a browser`);
