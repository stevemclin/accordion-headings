/**
 * Editor-side behaviour: the chevron widget, the click handling and the fold
 * toggling. Deliberately free of any `obsidian` import so it can run in a plain
 * CodeMirror 6 harness (see `test/`) as well as inside the plugin. The one
 * Obsidian-specific dependency — its `createSpan` helper — is injected.
 */
import { EditorState, Extension, RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { foldEffect, foldable, foldState, unfoldEffect } from "@codemirror/language";
import type { AccordionSettings, LevelKey } from "./settings";

/** ATX headings (`#`–`######` followed by whitespace). */
export const HEADING_RE = /^(#{1,6})\s/;

/**
 * How far past the heading text a click still places the caret instead of
 * folding, in CSS pixels. Keeps the natural "click after the last word to keep
 * typing" gesture working.
 */
export const CARET_ZONE_PX = 8;

/** Creates the chevron's elements. Injected so this module stays Obsidian-free. */
export type ElementFactory = (cls: string, attr?: Record<string, string>) => HTMLElement;

/** Dispatched when settings change, to force the view plugin to rebuild. */
export const settingsChangeEffect = StateEffect.define<void>();

export interface AccordionOptions {
  getSettings: () => AccordionSettings;
  createEl: ElementFactory;
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

function isRangeFolded(state: EditorState, range: { from: number; to: number }): boolean {
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

export function accordionExtension({ getSettings, createEl }: AccordionOptions): Extension {
  class ChevronWidget extends WidgetType {
    constructor(
      private readonly collapsed: boolean,
      private readonly onToggle: () => void,
    ) {
      super();
    }

    toDOM(): HTMLElement {
      // The outer element has zero layout width and the icon is absolutely
      // positioned inside it. That matters: an inline widget that occupies
      // width sits *at* the end-of-line position, so with the caret at the same
      // position CodeMirror draws the caret on the far side of the icon — the
      // caret then disagrees with the real insertion point. Zero width keeps
      // the caret where the text actually ends while the icon still renders.
      const el = createEl(
        "accordion-headings-chevron" + (this.collapsed ? " is-collapsed" : ""),
        {
          role: "button",
          "aria-label": this.collapsed ? "Expand section" : "Collapse section",
        },
      );
      el.append(createEl("accordion-headings-chevron-icon", { "aria-hidden": "true" }));

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

  const viewPlugin = ViewPlugin.fromClass(
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
                e.is(foldEffect) || e.is(unfoldEffect) || e.is(settingsChangeEffect),
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

  const onLineClick = (event: MouseEvent, view: EditorView): boolean => {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".accordion-headings-chevron")) return false;

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    const line = view.state.doc.lineAt(pos);
    if (getHeadingFoldRange(view.state, line.number, getSettings()) === null) {
      return false;
    }

    // Clicking on the text is editing. So is the strip immediately after the
    // last character — that is where people click to keep typing, and hijacking
    // it to fold makes a heading impossible to edit from the end. Only clicks
    // further right, or on the chevron itself, fold.
    const textEnd = view.coordsAtPos(line.to, -1);
    if (textEnd) {
      if (event.clientX <= textEnd.right + CARET_ZONE_PX) return false;
    } else {
      const trimmedEnd = line.from + line.text.replace(/\s+$/, "").length;
      if (pos < trimmedEnd) return false;
    }

    toggleHeadingFold(view, line.number, getSettings());
    return true;
  };

  return [
    EditorView.domEventHandlers({ click: onLineClick }),
    viewPlugin,
  ];
}
