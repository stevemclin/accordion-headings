import { Plugin } from "obsidian";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  foldEffect,
  foldable,
  foldState,
  unfoldEffect,
} from "@codemirror/language";

/** ATX headings (`#`–`######` followed by whitespace). */
const HEADING_RE = /^(#{1,6})\s/;

/**
 * Inline chevron rendered right after a heading's text in Source / Live
 * Preview. Purely the affordance — it toggles Obsidian's (CodeMirror's) own
 * fold state and never hides content itself, so the Outline stays in sync.
 */
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
    return true; // treat this as a control, not editor text
  }

  eq(other: ChevronWidget): boolean {
    return other.collapsed === this.collapsed;
  }
}

/**
 * The foldable section range for an ATX heading, or null when the line is not
 * a heading (or has no content to fold).
 *
 * A heading's fold covers the content BELOW it, so we require `range.from` to
 * be past the heading line — this also rejects a `#` line inside a code block,
 * whose foldable range (if any) starts at the fence, before this line.
 */
function getHeadingFoldRange(
  state: EditorState,
  lineNumber1based: number,
): { from: number; to: number } | null {
  const line = state.doc.line(lineNumber1based);
  if (!HEADING_RE.test(line.text)) return null;

  const range = foldable(state, line.from, line.to);
  if (!range || range.from <= line.to) return null;
  return range;
}

/** True when a folded range fully covers `range`. */
function isRangeFolded(
  state: EditorState,
  range: { from: number; to: number },
): boolean {
  const folds = state.field(foldState, false);
  if (!folds) return false; // fold extension not active in this editor

  let found = false;
  folds.between(range.from, range.to, (from, to) => {
    if (from <= range.from && to >= range.to) {
      found = true;
      return false;
    }
  });
  return found;
}

/** Toggle the fold for the heading on 1-based line `n`, via CM6's own fold state. */
function toggleHeadingFold(view: EditorView, n: number): void {
  const state = view.state;
  if (!state.field(foldState, false)) return;

  const range = getHeadingFoldRange(state, n);
  if (!range) return;

  if (isRangeFolded(state, range)) {
    view.dispatch({ effects: unfoldEffect.of({ from: range.from, to: range.to }) });
  } else {
    view.dispatch({ effects: foldEffect.of({ from: range.from, to: range.to }) });
  }
}

class AccordionViewPlugin {
  decorations: DecorationSet;

  constructor(private view: EditorView) {
    this.decorations = this.build();
  }

  update(update: ViewUpdate): void {
    const relevant =
      update.docChanged ||
      update.viewportChanged ||
      update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
      );
    if (relevant) this.decorations = this.build();
  }

  private build(): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const view = this.view;

    for (const range of view.visibleRanges) {
      const start = view.state.doc.lineAt(range.from).number;
      const end = view.state.doc.lineAt(range.to).number;
      for (let n = start; n <= end; n++) {
        const foldRange = getHeadingFoldRange(view.state, n);
        if (!foldRange) continue;

        const line = view.state.doc.line(n);
        const collapsed = isRangeFolded(view.state, foldRange);

        // side: -1 places the widget BEFORE the newline, i.e. inline at the
        // end of the heading text (side: 1 would land on the next line).
        builder.add(
          line.to,
          line.to,
          Decoration.widget({
            widget: new ChevronWidget(collapsed, () => toggleHeadingFold(view, n)),
            side: -1,
          }),
        );
      }
    }
    return builder.finish();
  }
}

export default class AccordionHeadingsPlugin extends Plugin {
  onload(): void {
    this.registerEditorExtension([
      EditorView.domEventHandlers({
        click: (event, view) => this.onLineClick(event, view),
      }),
      ViewPlugin.fromClass(AccordionViewPlugin, {
        decorations: (v) => v.decorations,
      }),
    ]);
  }

  /** Whole-row click: fold when clicking the empty area past the heading text. */
  private onLineClick(event: MouseEvent, view: EditorView): boolean {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".accordion-headings-chevron")) return false;

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    const line = view.state.doc.lineAt(pos);
    if (getHeadingFoldRange(view.state, line.number) === null) return false;

    // Clicking the heading TEXT keeps normal editing; only the empty area
    // to the right of the text toggles the fold.
    const trimmedEnd = line.from + line.text.replace(/\s+$/, "").length;
    if (pos < trimmedEnd) return false;

    toggleHeadingFold(view, line.number);
    return true;
  }
}
