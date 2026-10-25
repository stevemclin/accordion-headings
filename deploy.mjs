// deploy.mjs — copy the build output into the GTD vault's plugin folder.
// Change VAULT to target a different vault.
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT = "C:/Users/zvomu/Documents/Obsidian/GTD";
const dest = path.join(VAULT, ".obsidian", "plugins", "accordion-headings");

await mkdir(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) {
  await cp(path.join(__dirname, f), path.join(dest, f));
  console.log("copied", f);
}
console.log("Deployed to", dest);
