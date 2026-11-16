import {
  App,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  SettingGroupItem,
  WorkspaceWindow,
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

/**
 * How far past the heading text a click still counts as "put the caret here"
 * rather than "fold this section", in CSS pixels.
 */
const CARET_ZONE_PX = 8;

/**
 * All styling lives in styles.css and is gated by these classes on <body>.
 * The plugin only toggles classes, so no CSS is injected at runtime.
 */
const BODY_CLASSES = [
  "ah-h1",
  "ah-h2",
  "ah-h3",
  "ah-h4",
  "ah-h5",
  "ah-h6",
  "ah-icon-chevron",
  "ah-icon-plus",
  "ah-vis-always",
  "ah-vis-hover",
] as const;

export interface AccordionSettings {
  icon: "chevron" | "plus";
  visibility: "always" | "hover";
  levels: { h1: boolean; h2: boolean; h3: boolean; h4: boolean; h5: boolean; h6: boolean };
}

type LevelKey = keyof AccordionSettings["levels"];

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
    const el = createSpan({
      cls: "accordion-headings-chevron" + (this.collapsed ? " is-collapsed" : ""),
      attr: {
        role: "button",
        tabindex: "-1",
        "aria-label": this.collapsed ? "Expand section" : "Collapse section",
      },
    });

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
  const levelKey = `h${m[1].length}` as LevelKey;
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

export default class AccordionHeadingsPlugin extends Plugin {
  settings: AccordionSettings = { ...DEFAULT_SETTINGS };
  /** Bodies we have added classes to, so they can be cleaned up on unload. */
  private readonly styledBodies = new Set<HTMLElement>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyBodyClasses(document.body);

    // Popout windows get their own <body>; keep them in sync too.
    this.registerEvent(
      this.app.workspace.on(
        "window-open",
        (_workspaceWindow: WorkspaceWindow, window: Window) => {
          this.applyBodyClasses(window.document.body);
        },
      ),
    );

    this.registerEditorExtension([
      EditorView.domEventHandlers({
        click: (event, view) => this.onLineClick(event, view),
      }),
      this.buildViewPlugin(),
    ]);

    this.addSettingTab(new AccordionSettingTab(this.app, this));
  }

  onunload(): void {
    for (const body of this.styledBodies) {
      for (const cls of BODY_CLASSES) body.classList.remove(cls);
    }
    this.styledBodies.clear();
  }

  /** Mirror the current settings onto a document's <body> classes. */
  private applyBodyClasses(body: HTMLElement): void {
    if (!body) return;
    this.styledBodies.add(body);

    for (const cls of BODY_CLASSES) body.classList.remove(cls);

    body.classList.add(
      this.settings.icon === "chevron" ? "ah-icon-chevron" : "ah-icon-plus",
    );
    body.classList.add(
      this.settings.visibility === "always" ? "ah-vis-always" : "ah-vis-hover",
    );
    for (let i = 1; i <= 6; i++) {
      if (this.settings.levels[`h${i}` as LevelKey]) {
        body.classList.add(`ah-h${i}`);
      }
    }
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
            update.selectionSet ||
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
              // The chevron is an inline widget at the line's end position, so
              // when the caret sits at that exact position CodeMirror has to
              // draw the caret on one side of it — and with side: -1 it lands on
              // the far side, leaving a caret that does not match the text
              // position. Step the widget aside while the caret is there.
              if (view.state.selection.main.head === line.to) continue;

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
    for (const body of this.styledBodies) this.applyBodyClasses(body);
    this.refreshEditors();
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

    // Clicking on the text is editing. So is the strip immediately after the
    // last character — that is where people click to keep typing, and hijacking
    // it to fold makes the heading impossible to edit from the end. Only clicks
    // further right, or on the chevron itself, fold.
    const textEnd = view.coordsAtPos(line.to, -1);
    if (textEnd) {
      if (event.clientX <= textEnd.right + CARET_ZONE_PX) return false;
    } else {
      // Layout not measurable right now: fall back to the position test.
      const trimmedEnd = line.from + line.text.replace(/\s+$/, "").length;
      if (pos < trimmedEnd) return false;
    }

    toggleHeadingFold(view, line.number, this.settings);
    return true;
  }
}

class AccordionSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AccordionHeadingsPlugin) {
    super(app, plugin);
  }

  /** Declarative definitions, so settings show up in Obsidian's settings search (1.13+). */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const levels: SettingGroupItem[] = [1, 2, 3, 4, 5, 6].map((i) => ({
      name: `Heading ${i}`,
      control: { type: "toggle" as const, key: `h${i}`, defaultValue: true },
    }));

    return [
      {
        name: "Icon style",
        desc: "The fold indicator icon shown after each heading.",
        control: {
          type: "dropdown",
          key: "icon",
          defaultValue: "chevron",
          options: { chevron: "Chevron", plus: "Plus / minus" },
        },
      },
      {
        name: "Visibility",
        desc: "When to show the fold indicator.",
        control: {
          type: "dropdown",
          key: "visibility",
          defaultValue: "always",
          options: { always: "Always visible", hover: "On hover" },
        },
      },
      {
        type: "group",
        heading: "Heading levels",
        items: levels,
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (/^h[1-6]$/.test(key)) {
      return this.plugin.settings.levels[key as LevelKey];
    }
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (/^h[1-6]$/.test(key)) {
      this.plugin.settings.levels[key as LevelKey] = Boolean(value);
    } else {
      (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    }
    await this.plugin.saveSettings();
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
      const key = `h${i}` as LevelKey;
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
