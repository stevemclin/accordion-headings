/** Everything the plugin remembers between sessions. */
export interface AccordionSettings {
  icon: "chevron" | "plus";
  visibility: "always" | "hover";
  levels: { h1: boolean; h2: boolean; h3: boolean; h4: boolean; h5: boolean; h6: boolean };
}

export type LevelKey = keyof AccordionSettings["levels"];

export const DEFAULT_SETTINGS: AccordionSettings = {
  icon: "chevron",
  visibility: "always",
  levels: { h1: true, h2: true, h3: true, h4: true, h5: true, h6: true },
};
