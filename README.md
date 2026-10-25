# Accordion Headings

Website-style accordion folding for Obsidian headings, in all three view modes.

- **One chevron** inline after the heading text (where the `…` used to be).
- **Same button for both states** — it rotates in place (`▾` expanded, `▸` collapsed).
- **Full-row click target** in Reading view; the empty area of the row is
  clickable in Live Preview/Source (heading text stays editable).

Folding is driven by Obsidian's own fold engine (`getFoldInfo` / `setFoldInfo`),
so the Outline panel and "Fold all / Unfold all" remain in sync.

## How it works

| Mode | Mechanism |
|------|-----------|
| Reading view | Pure CSS — Obsidian's `.heading-collapse-indicator` owns the click; we stretch it full-width and draw our own chevron. |
| Live Preview / Source | A CodeMirror view plugin renders the chevron and toggles Obsidian's fold state. |

## Development

```bash
npm install
npm run build     # typecheck + bundle main.js
npm run deploy    # copy main.js/manifest.json/styles.css into the GTD vault
```

Enable the plugin in **Settings → Community plugins**, then disable the older
CSS snippet (`accordion-headings.css`) if you had enabled it — the plugin's
stylesheet now covers Reading view too.

## Notes / limitations

- Live Preview: clicking the **heading text** still places the cursor to edit;
  click the chevron or the empty area to the right to fold.
- ATX headings (`#`–`######`) are enhanced; setext headings keep Obsidian's
  default behaviour.
