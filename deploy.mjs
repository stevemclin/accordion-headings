// deploy.mjs — copy the build output into a vault's plugin folder, for testing.
// Usage: OBSIDIAN_VAULT="/path/to/your/vault" npm run deploy
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VAULT = process.env.OBSIDIAN_VAULT;

if (!VAULT) {
  console.error(
    "OBSIDIAN_VAULT is not set.\n" +
      'Usage: OBSIDIAN_VAULT="/path/to/your/vault" npm run deploy',
  );
  process.exit(1);
}

const dest = path.join(VAULT, ".obsidian", "plugins", "accordion-headings");

await mkdir(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) {
  await cp(path.join(__dirname, f), path.join(dest, f));
  console.log("copied", f);
}
console.log("Deployed to", dest);
