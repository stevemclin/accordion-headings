# Accordion Headings

Website-style accordion folding for Obsidian headings. One chevron that stays in
the same place in both states, and a full-width heading row you can click anywhere.

Obsidian's built-in heading fold puts a chevron on the left that disappears when
the section is expanded, plus a separate `…` on the right when it is collapsed:
two affordances for one control, in two different places. This plugin replaces
that with the standard accordion pattern used across the web:

- **One chevron**, inline after the heading text — right where the `…` used to be.
- **The same control in both states.** It rotates in place: `▾` expanded,
  `▸` collapsed. Nothing appears or disappears.
- **Full-row click target.** In Reading view the whole heading row clicks.
  In Live Preview and Source the empty area to the right of the heading clicks,
  while the heading text itself stays editable.
- **Configurable** — icon style, visibility, and which heading levels are affected.

## Install

### Community plugins

Once the plugin is listed in the directory: **Settings → Community plugins →
Browse**, search for **Accordion Headings**, install, enable.

### Beta (via BRAT)

1. Install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Run **BRAT: Add a beta plugin for testing** and enter
   `stevemclin/accordion-headings`.
3. Enable **Accordion Headings** in **Settings → Community plugins**.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](https://github.com/stevemclin/accordion-headings/releases/latest)
and copy them into `<your-vault>/.obsidian/plugins/accordion-headings/`. Then
enable the plugin in **Settings → Community plugins**.

## Settings

| Setting | Options | Default |
|---|---|---|
| Icon style | Chevron, Plus / minus | Chevron |
| Visibility | Always visible, On hover | Always visible |
| Heading levels | H1 – H6, one toggle each | All enabled |

## How it works

The plugin does not implement folding. It drives Obsidian's own fold state and
changes only the visual affordance, so the Outline panel and **Fold all /
Unfold all** stay in sync — there is a single source of truth for whether a
section is collapsed.

| Mode | Mechanism |
|---|---|
| Reading view | Obsidian already renders a `.heading-collapse-indicator` inside each heading that owns the fold click. The plugin stretches that hit area to cover the whole row, hides its default icon, and draws the indicator on the heading's `::after` as an SVG mask, so it stays crisp and picks up the theme's text colour. Collapsed state is read from the `is-collapsed` class Obsidian sets on the heading's section container. |
| Live Preview / Source | A CodeMirror 6 `ViewPlugin` places a chevron widget at the end of each heading line. Toggling reads the section range from `@codemirror/language`'s `foldable()`, tests it against `foldedRanges()`, then dispatches `foldEffect` or `unfoldEffect` — the same fold state Obsidian's own `.cm-fold-indicator` writes. |

All styling lives in `styles.css` — the plugin never injects CSS. Your settings are
applied by toggling classes on `<body>` (`ah-h1`…`ah-h6`, `ah-icon-plus`,
`ah-vis-hover`), so a change takes effect immediately without a reload.

## Limitations

- **ATX headings only** (`#`–`######`). Setext headings (`===` / `---` underlines)
  keep Obsidian's default behaviour.
- **Live Preview:** clicking the heading *text* places the cursor instead of
  folding. This is deliberate — the plugin lives inside an editor, and stealing
  text clicks would make headings awkward to edit. Use the chevron, or the empty
  space to its right.
- **Reading view** draws its indicator with a CSS mask. `-webkit-mask` is
  supported by every Chromium that ships in Obsidian 1.5.0 and later, which is
  this plugin's minimum, so the icons render on every version it installs on.

## Development

```bash
npm install
npm run build                                        # typecheck + bundle main.js
OBSIDIAN_VAULT="/path/to/your/vault" npm run deploy  # copy build into a test vault
```

`main.js` is a build artifact and is not committed. Releases are produced by
`.github/workflows/release.yml` when a version tag is pushed.

## License

[MIT](LICENSE)
