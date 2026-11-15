import {
  App,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { EditorState, RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { foldEffect, foldable, foldState, unfoldEffect } from "@codemirror/language";

/** ATX headings (`#`–`######` followed by whitespace). */
const HEADING_RE = /^(#{1,6})\s/;

/** Build a masked-SVG data URI (theme-coloured via `background-color`). */
const svgMask = (body: string): string =>
  `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>")`;

const CHEVRON_RIGHT = svgMask("<polyline points='9 18 15 12 9 6'/>");
const PLUS = svgMask("<line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/>");
const MINUS = svgMask("<line x1='5' y1='12' x2='19' y2='12'/>");

export interface AccordionSettings {
  icon: "chevron" | "plus";
  visibility: "always" | "hover";
  levels: { h1: boolean; h2: boolean; h3: boolean; h4: boolean; h5: boolean; h6: boolean };
}

const DEFAULT_SETTINGS: AccordionSettings = {
  icon: "chevron",
  visibility: "always",
  levels: { h1: true, h2: true, h3: true, h4: true, h5: true, h6: true },
};

/** Dispatched when settings change, to force the view plugin to rebuild. */
const settingsChangeEffect = StateEffect.define<void>();

class ChevronWidget extends WidgetType {
  constructor(
    private readonly collapsed: boolean,
    private readonly onToggle: () => void,
  ) {
    super();
  }

  toDOM(_view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className =
      "accordion-headings-chevron" + (this.collapsed ? " is-collapsed" : "");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "-1");
    el.setAttribute("aria-label", this.collapsed ? "Expand section" : "Collapse section");

    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onToggle();
    });
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }

  eq(other: ChevronWidget): boolean {
    return other.collapsed === this.collapsed;
  }
}

/**
 * The foldable section range for an enabled ATX heading, or null otherwise.
 * `foldable()` returns `from === line.to` (the heading's newline); a `#` line
 * inside a code block yields `from < line.from` (or null).
 */
function getHeadingFoldRange(
  state: EditorState,
  lineNumber1based: number,
  settings: AccordionSettings,
): { from: number; to: number } | null {
  const line = state.doc.line(lineNumber1based);
  const m = HEADING_RE.exec(line.text);
  if (!m) return null;
  const levelKey = `h${m[1].length}` as keyof AccordionSettings["levels"];
  if (!settings.levels[levelKey]) return null;

  const range = foldable(state, line.from, line.to);
  if (!range || range.from < line.from) return null;
  return range;
}

function isRangeFolded(
  state: EditorState,
  range: { from: number; to: number },
): boolean {
  const folds = state.field(foldState, false);
  if (!folds) return false;
  let found = false;
  folds.between(range.from, range.to, (from, to) => {
    if (from <= range.from && to >= range.to) {
      found = true;
      return false;
    }
  });
  return found;
}

function toggleHeadingFold(
  view: EditorView,
  n: number,
  settings: AccordionSettings,
): void {
  const state = view.state;
  if (!state.field(foldState, false)) return;

  const range = getHeadingFoldRange(state, n, settings);
  if (!range) return;

  if (isRangeFolded(state, range)) {
    view.dispatch({ effects: unfoldEffect.of({ from: range.from, to: range.to }) });
  } else {
    view.dispatch({ effects: foldEffect.of({ from: range.from, to: range.to }) });
  }
}

/** Generate the stylesheet for the current settings. */
function buildDynamicCss(settings: AccordionSettings): string {
  const enabled = [1, 2, 3, 4, 5, 6].filter(
    (l) => settings.levels[`h${l}` as keyof AccordionSettings["levels"]],
  );
  if (enabled.length === 0) return "";

  const chevron = settings.icon === "chevron";
  const baseMask = chevron ? CHEVRON_RIGHT : MINUS;
  const collapsedMask = chevron ? CHEVRON_RIGHT : PLUS;
  const baseTransform = chevron ? "rotate(90deg)" : "none";
  const collapsedTransform = chevron ? "rotate(0deg)" : "none";
  const idleOpacity = settings.visibility === "always" ? "0.55" : "0";

  const rv = enabled.map((l) => `.markdown-preview-view h${l}`).join(",\n");
  const rvIndicator = enabled.map((l) => `.markdown-preview-view h${l} .heading-collapse-indicator`).join(",\n");
  const rvIndicatorIcon = enabled.map((l) => `.markdown-preview-view h${l} .heading-collapse-indicator .svg-icon`).join(",\n");
  const rvAfter = enabled.map((l) => `.markdown-preview-view h${l}::after`).join(",\n");
  const rvCollapsed = enabled.map((l) => `.markdown-preview-view h${l}:has(.heading-collapse-indicator.is-collapsed)::after`).join(",\n");
  const rvHover = enabled.map((l) => `.markdown-preview-view h${l}:hover::after`).join(",\n");

  const lpHide = enabled.map((l) => `.markdown-source-view.mod-cm6 .cm-line.HyperMD-header-${l} .cm-fold-indicator`).join(",\n");
  const lpHidePlaceholder = enabled.map((l) => `.markdown-source-view.mod-cm6 .cm-line.HyperMD-header-${l} .cm-foldPlaceholder`).join(",\n");

  return `
/* Reading view */
${rv} { position: relative; }
${rvIndicator} {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  margin: 0;
  padding: 0;
  cursor: pointer;
}
${rvIndicatorIcon} { display: none; }

${rvAfter} {
  content: "";
  display: inline-block;
  width: 0.85em;
  height: 0.85em;
  margin-left: 0.35em;
  vertical-align: -0.12em;
  opacity: ${idleOpacity};
  background-color: var(--text-muted);
  -webkit-mask: ${baseMask} center / contain no-repeat;
  mask: ${baseMask} center / contain no-repeat;
  transform: ${baseTransform};
  transition: transform 0.15s ease, opacity 0.1s ease;
  pointer-events: none;
}
${rvCollapsed} {
  -webkit-mask: ${collapsedMask} center / contain no-repeat;
  mask: ${collapsedMask} center / contain no-repeat;
  transform: ${collapsedTransform};
  opacity: 1;
}
${rvHover} { opacity: 1; }

/* Live Preview — hide Obsidian's default indicators on enabled levels */
${lpHide},
${lpHidePlaceholder} { display: none; }

/* Live Preview — chevron widget */
.markdown-source-view.mod-cm6 .cm-line .accordion-headings-chevron {
  display: inline-block;
  width: 0.85em;
  height: 0.85em;
  margin-left: 0.35em;
  vertical-align: -0.12em;
  opacity: ${idleOpacity};
  cursor: pointer;
  background-color: var(--text-muted);
  -webkit-mask: ${baseMask} center / contain no-repeat;
  mask: ${baseMask} center / contain no-repeat;
  transform: ${baseTransform};
  transition: transform 0.15s ease, opacity 0.1s ease;
}
.markdown-source-view.mod-cm6 .cm-line:hover .accordion-headings-chevron { opacity: 1; }
.markdown-source-view.mod-cm6 .accordion-headings-chevron.is-collapsed {
  -webkit-mask: ${collapsedMask} center / contain no-repeat;
  mask: ${collapsedMask} center / contain no-repeat;
  transform: ${collapsedTransform};
  opacity: 1;
}
`;
}

export default class AccordionHeadingsPlugin extends Plugin {
  settings: AccordionSettings = { ...DEFAULT_SETTINGS };
  private styleEl: HTMLStyleElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyStyles();

    this.registerEditorExtension([
      EditorView.domEventHandlers({
        click: (event, view) => this.onLineClick(event, view),
      }),
      this.buildViewPlugin(),
    ]);

    this.addSettingTab(new AccordionSettingTab(this.app, this));
  }

  onunload(): void {
    // The generated stylesheet lives outside Obsidian's lifecycle, so remove it
    // explicitly or it survives the plugin being disabled.
    this.styleEl?.remove();
    this.styleEl = null;
  }

  private buildViewPlugin() {
    const getSettings = () => this.settings;

    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(private view: EditorView) {
          this.decorations = this.build();
        }

        update(update: ViewUpdate): void {
          const relevant =
            update.docChanged ||
            update.viewportChanged ||
            update.transactions.some((tr) =>
              tr.effects.some(
                (e) =>
                  e.is(foldEffect) ||
                  e.is(unfoldEffect) ||
                  e.is(settingsChangeEffect),
              ),
            );
          if (relevant) this.decorations = this.build();
        }

        private build(): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          const view = this.view;
          const settings = getSettings();

          for (const range of view.visibleRanges) {
            const start = view.state.doc.lineAt(range.from).number;
            const end = view.state.doc.lineAt(range.to).number;
            for (let n = start; n <= end; n++) {
              const foldRange = getHeadingFoldRange(view.state, n, settings);
              if (!foldRange) continue;

              const line = view.state.doc.line(n);
              const collapsed = isRangeFolded(view.state, foldRange);

              builder.add(
                line.to,
                line.to,
                Decoration.widget({
                  widget: new ChevronWidget(collapsed, () =>
                    toggleHeadingFold(view, n, getSettings()),
                  ),
                  side: -1,
                }),
              );
            }
          }
          return builder.finish();
        }
      },
      { decorations: (v) => v.decorations },
    );
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<AccordionSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
    this.settings.levels = { ...DEFAULT_SETTINGS.levels, ...(data?.levels ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applyStyles();
    this.refreshEditors();
  }

  private applyStyles(): void {
    this.styleEl?.remove();
    this.styleEl = null;
    const css = buildDynamicCss(this.settings);
    if (!css) return;
    this.styleEl = document.createElement("style");
    this.styleEl.id = "accordion-headings-dynamic-styles";
    this.styleEl.textContent = css;
    document.head.appendChild(this.styleEl);
  }

  private refreshEditors(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view && view.getViewType() === "markdown") {
        const cm = (view as MarkdownView).editor as unknown as { cm?: EditorView };
        cm?.cm?.dispatch({ effects: settingsChangeEffect.of(undefined) });
      }
    });
  }

  private onLineClick(event: MouseEvent, view: EditorView): boolean {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".accordion-headings-chevron")) return false;

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    const line = view.state.doc.lineAt(pos);
    if (getHeadingFoldRange(view.state, line.number, this.settings) === null) {
      return false;
    }

    const trimmedEnd = line.from + line.text.replace(/\s+$/, "").length;
    if (pos < trimmedEnd) return false; // on the text → normal editing

    toggleHeadingFold(view, line.number, this.settings);
    return true;
  }
}

class AccordionSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AccordionHeadingsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Icon style")
      .setDesc("The fold indicator icon shown after each heading.")
      .addDropdown((d) =>
        d
          .addOption("chevron", "Chevron")
          .addOption("plus", "Plus / minus")
          .setValue(this.plugin.settings.icon)
          .onChange(async (value) => {
            this.plugin.settings.icon = value as AccordionSettings["icon"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Visibility")
      .setDesc("When to show the fold indicator.")
      .addDropdown((d) =>
        d
          .addOption("always", "Always visible")
          .addOption("hover", "On hover")
          .setValue(this.plugin.settings.visibility)
          .onChange(async (value) => {
            this.plugin.settings.visibility = value as AccordionSettings["visibility"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Heading levels").setHeading();
    containerEl.createEl("p", {
      text: "Which heading levels get the accordion fold indicator.",
    });

    for (let i = 1; i <= 6; i++) {
      const key = `h${i}` as keyof AccordionSettings["levels"];
      new Setting(containerEl)
        .setName(`Heading ${i}`)
        .addToggle((t) =>
          t.setValue(this.plugin.settings.levels[key]).onChange(async (value) => {
            this.plugin.settings.levels[key] = value;
            await this.plugin.saveSettings();
          }),
        );
    }
  }
}
