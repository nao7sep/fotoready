import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { MessageKey } from "@shared/i18n/catalogues";
import { createTranslator, message } from "@shared/i18n/translate";

describe("createTranslator", () => {
  it("fills placeholders and formats numbers for the locale", () => {
    expect(createTranslator("en").t("about.version", { version: "1.2.0" })).toBe("Version 1.2.0");
    expect(createTranslator("en", "en-US").t("settings.numberRange", { min: 1000, max: 600000 })).toBe("Must be between 1,000 and 600,000.");
  });

  it("chooses the plural form by the language's own rules", () => {
    const en = createTranslator("en");
    expect(en.t("status.tasks", { count: 1 })).toBe("1 task");
    expect(en.t("status.tasks", { count: 0 })).toBe("0 tasks");
    expect(en.t("tasks.opCount", { count: 1 })).toBe("1 op");
    expect(en.t("tasks.opCount", { count: 3 })).toBe("3 ops");
  });

  it("renders a message whose value is another message, in the same language", () => {
    const en = createTranslator("en");
    const summary = message("import.withIssues", {
      success: message("import.added", { count: 2 }),
      issues: message("import.needAttention", { count: 1 })
    });
    expect(en.text(summary)).toBe("Added 2 originals; 1 item needs attention.");
  });

  it("puts markup into placeholders for rich text", () => {
    const parts = createTranslator("en").rich("geometry.angleStatus", { angle: "+90°" }) as unknown[];
    const filled = parts.map((part) => (isValidElement(part) ? (part as ReactElement<{ children: unknown }>).props.children : part));
    expect(filled.join("")).toBe("Angle: +90°");
  });

  it("formats percentages and lists for the locale", () => {
    expect(createTranslator("en", "en-US").percent(0.125, 1)).toBe("12.5%");
    expect(createTranslator("en", "en-US").percent(0.5)).toBe("50%");
    expect(createTranslator("en").list(["a.png", "b.png", "c.png"])).toBe("a.png, b.png, c.png");
  });

  it("shows a key the catalogue lacks instead of failing the render", () => {
    // Types keep this out of the app; a stale build or a half-merged catalogue
    // could still reach it, and a window must not go down over one string.
    const missing = "gone.missing" as unknown as MessageKey;
    expect(createTranslator("ja").t(missing)).toBe("gone.missing");
  });
});
