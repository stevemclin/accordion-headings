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
import { EditorView } from "@codemirror/view";
import { accordionExtension, settingsChangeEffect } from "./editor";
import { AccordionSettings, DEFAULT_SETTINGS, LevelKey } from "./settings";

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

    this.registerEditorExtension(
      accordionExtension({
        getSettings: () => this.settings,
        createEl: (cls, attr) => createSpan({ cls, attr }),
      }),
    );

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
