/**
 * Behavioural harness for the editor-side code.
 *
 * Runs the real `src/editor.ts` extension in plain CodeMirror 6 (no Obsidian),
 * against the real `styles.css`, and asserts the things that broke in the wild:
 * the chevron must not displace the caret, clicking at the end of a heading must
 * not fold, and folding must still work from the row and from the icon.
 *
 * Build with `npm run test` and open test/index.html.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { codeFolding, foldService, foldState } from "@codemirror/language";
import { accordionExtension, CARET_ZONE_PX, settingsChangeEffect } from "../src/editor";
import { AccordionSettings, DEFAULT_SETTINGS } from "../src/settings";

const DOC = [
  "# Alpha heading",
  "",
  "Some body text here.",
  "",
  "## Beta heading",
  "",
  "More text.",
  "",
  "### Gamma heading",
  "",
  "Tail.",
  "",
].join("\n");

/** Stand-in for Obsidian's markdown folder: fold to the next same-or-higher heading. */
const foldServiceExt = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const m = /^(#{1,6})\s/.exec(line.text);
  if (!m) return null;
  const level = m[1].length;
  let end = state.doc.length;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    const mm = /^(#{1,6})\s/.exec(l.text);
    if (mm && mm[1].length <= level) {
      end = l.from - 1;
      break;
    }
  }
  return { from: line.to, to: end };
});

const createEl = (cls: string, attr: Record<string, string> = {}): HTMLElement => {
  const el = document.createElement("span");
  el.className = cls;
  for (const [k, v] of Object.entries(attr)) el.setAttribute(k, v);
  return el;
};

const settings: AccordionSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
let view: EditorView | null = null;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function mount(): EditorView {
  view?.destroy();
  const host = document.getElementById("editor") as HTMLElement;
  // Obsidian mounts the editor inside this wrapper; the plugin's Live Preview
  // rules are scoped to it, so the harness has to reproduce it.
  host.className = "markdown-source-view mod-cm6";
  host.innerHTML = "";
  view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [
        codeFolding(),
        foldServiceExt,
        accordionExtension({ getSettings: () => settings, createEl }),
        EditorView.lineWrapping,
      ],
    }),
    parent: host,
  });
  return view;
}

interface Result {
  name: string;
  pass: boolean;
  detail: string;
}

const results: Result[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail });
};

const chevrons = (v: EditorView) =>
  Array.from(v.dom.querySelectorAll<HTMLElement>(".accordion-headings-chevron"));

const foldCount = (v: EditorView): number => {
  const f = v.state.field(foldState, false);
  if (!f) return -1;
  let n = 0;
  f.between(0, v.state.doc.length, () => {
    n++;
  });
  return n;
};

function clickAt(v: EditorView, x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const target = el ?? v.contentDOM;
  for (const type of ["mousedown", "mouseup", "click"]) {
    target.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
      }),
    );
  }
}

async function run() {
  // ---- 1. the chevron exists, is visible, and takes no layout width ----
  {
    const v = mount();
    await nextFrame();
    const all = chevrons(v);
    const wrapper = all[0]?.getBoundingClientRect();
    const icon = all[0]
      ?.querySelector<HTMLElement>(".accordion-headings-chevron-icon")
      ?.getBoundingClientRect();
    check(
      "one chevron per enabled heading",
      all.length === 3,
      `expected 3 (h1,h2,h3), found ${all.length}`,
    );
    check(
      "chevron wrapper has zero layout width",
      !!wrapper && Math.round(wrapper.width) === 0,
      `wrapper width = ${wrapper ? Math.round(wrapper.width) : "n/a"}px`,
    );
    check(
      "icon itself is visible",
      !!icon && icon.width > 4 && icon.height > 4,
      `icon ${icon ? Math.round(icon.width) + "x" + Math.round(icon.height) : "missing"}`,
    );
  }

  // ---- 2. the caret at the end of a heading sits BEFORE the icon ----
  {
    const v = mount();
    await nextFrame();
    const line = v.state.doc.line(1);
    v.dispatch({ selection: { anchor: line.to } });
    await nextFrame();
    const caret = v.coordsAtPos(v.state.selection.main.head);
    const icon = v.dom
      .querySelector<HTMLElement>(".accordion-headings-chevron-icon")!
      .getBoundingClientRect();
    check(
      "caret at end of heading is drawn before the chevron",
      !!caret && Math.round(caret.left) <= Math.round(icon.left),
      `caret x=${caret ? Math.round(caret.left) : "n/a"}, icon x=${Math.round(icon.left)}`,
    );
    if (caret) {
      const caretMid = (caret.top + caret.bottom) / 2;
      const iconMid = (icon.top + icon.bottom) / 2;
      check(
        "chevron is vertically aligned with the caret",
        Math.abs(caretMid - iconMid) <= 4,
        `caret mid=${Math.round(caretMid)}, icon mid=${Math.round(iconMid)}`,
      );
    }
  }

  // ---- 3. clicking just past the text places the caret, does not fold ----
  {
    const v = mount();
    await nextFrame();
    const line = v.state.doc.line(1);
    const end = v.coordsAtPos(line.to)!;
    const y = (end.top + end.bottom) / 2;
    clickAt(v, end.right + 3, y);
    await nextFrame();
    check(
      "click just past the text does not fold",
      foldCount(v) === 0,
      `fold count = ${foldCount(v)}`,
    );
    check(
      "click just past the text leaves the caret at the end of the heading",
      v.state.selection.main.head === line.to,
      `head=${v.state.selection.main.head}, line.to=${line.to}`,
    );

    // Every click strictly inside the visible gap must place the caret. Measure
    // the gap from the icon's real rect rather than assuming em rounding, and
    // stay off the icon's edge — that last pixel is the fold button's.
    const iconRect = v.dom
      .querySelector<HTMLElement>(".accordion-headings-chevron-icon")!
      .getBoundingClientRect();
    const gapPx = iconRect.left - end.right;
    const points = [1, Math.max(1, Math.floor(gapPx * 0.6))];
    const gap: number[] = [];
    for (const dx of points) {
      clickAt(v, end.right + dx, y);
      await nextFrame();
      gap.push(foldCount(v));
    }
    check(
      "there is a clickable gap before the icon",
      gapPx >= 3,
      `gap = ${gapPx.toFixed(1)}px`,
    );
    check(
      "clicks inside the gap before the icon place the caret",
      gap.every((f) => f === 0) && v.state.selection.main.head === line.to,
      `clicked at +${points.join(",+")}px, fold counts ${gap.join(",")}, head=${v.state.selection.main.head}`,
    );
  }

  // ---- 4. clicking far right on the row folds ----
  {
    const v = mount();
    await nextFrame();
    const lineEl = v.dom.querySelectorAll<HTMLElement>(".cm-line")[0];
    const r = lineEl.getBoundingClientRect();
    const end = v.coordsAtPos(v.state.doc.line(1).to)!;
    const y = (end.top + end.bottom) / 2;
    clickAt(v, Math.min(r.right - 12, end.right + 160), y);
    await nextFrame();
    check("click further right folds the section", foldCount(v) === 1, `fold count = ${foldCount(v)}`);
  }

  // ---- 5. clicking the icon toggles, and the icon goes collapsed ----
  {
    const v = mount();
    await nextFrame();
    const icon = v.dom
      .querySelector<HTMLElement>(".accordion-headings-chevron-icon")!
      .getBoundingClientRect();
    clickAt(v, (icon.left + icon.right) / 2, (icon.top + icon.bottom) / 2);
    await nextFrame();
    const collapsedClass = v.dom
      .querySelector(".accordion-headings-chevron")
      ?.classList.contains("is-collapsed");
    check("clicking the chevron folds the section", foldCount(v) === 1, `fold count = ${foldCount(v)}`);
    check("the chevron shows the collapsed state", collapsedClass === true, `is-collapsed=${collapsedClass}`);
  }

  // ---- 6. a disabled level renders no chevron ----
  {
    settings.levels.h3 = false;
    const v = mount();
    await nextFrame();
    check("disabled level has no chevron", chevrons(v).length === 2, `found ${chevrons(v).length}`);
    settings.levels.h3 = true;
  }

  // ---- 7. settings change rebuilds existing editors ----
  {
    const v = mount();
    await nextFrame();
    const before = chevrons(v).length;
    settings.levels.h2 = false;
    v.dispatch({ effects: settingsChangeEffect.of(undefined) });
    await nextFrame();
    const after = chevrons(v).length;
    check(
      "changing settings rebuilds open editors",
      before === 3 && after === 2,
      `before=${before}, after=${after}`,
    );
    settings.levels.h2 = true;
  }

  // ---- report ----
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const host = document.getElementById("results") as HTMLElement;
  host.innerHTML = "";
  const summary = document.createElement("h2");
  summary.textContent = failed === 0 ? `All ${passed} checks passed` : `${failed} of ${results.length} FAILED`;
  summary.className = failed === 0 ? "ok" : "bad";
  host.appendChild(summary);
  for (const r of results) {
    const row = document.createElement("div");
    row.className = "row " + (r.pass ? "ok" : "bad");
    row.textContent = `${r.pass ? "PASS" : "FAIL"}  ${r.name}  —  ${r.detail}`;
    host.appendChild(row);
  }
  (window as unknown as Record<string, unknown>).__results = { passed, failed, results };
}

run().catch((e) => {
  const host = document.getElementById("results") as HTMLElement;
  host.textContent = "harness crashed: " + (e && (e as Error).stack ? (e as Error).stack : String(e));
  (window as unknown as Record<string, unknown>).__results = { passed: 0, failed: 1, error: String(e) };
});
