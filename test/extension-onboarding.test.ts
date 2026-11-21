import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analysisPercent, shouldShowOnboarding } from "../extension/src/onboarding.js";

const source = readFileSync(new URL("../extension/src/onboarding.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../extension/src/background.js", import.meta.url), "utf8");

describe("first-run onboarding modal", () => {
  it("shows only before the first analysis and until it is dismissed once", () => {
    expect(shouldShowOnboarding({})).toBe(true);
    expect(shouldShowOnboarding(undefined)).toBe(true);
    expect(shouldShowOnboarding({ ridi_page_index: { catalog: [] } })).toBe(false);
    expect(shouldShowOnboarding({ ridi_onboarding_dismissed: true })).toBe(false);
  });

  it("reports analysis progress across the six phases without claiming 100% early", () => {
    expect(analysisPercent({ phase: "library", done: 0, total: 0 })).toBe(0);
    expect(analysisPercent({ phase: "reading", done: 843, total: 1686 })).toBe(42);
    expect(analysisPercent({ phase: "ratings", done: 10, total: 10 })).toBe(83);
    expect(analysisPercent({ phase: "interest", done: 5, total: 5 })).toBe(99);
    expect(analysisPercent({ phase: "unknown", done: 1, total: 2 })).toBe(8);
  });

  it("is a real modal dialog with managed focus, a way out, and no data sent anywhere", () => {
    expect(source).toContain("dialog.showModal();");
    expect(source).toContain('dialog.setAttribute("aria-labelledby", "title");');
    expect(source).toContain('dialog.addEventListener("cancel"');
    expect(source).toContain("void chrome.storage.local.set({ [DISMISSED_KEY]: true });");
    expect(source).toContain('bar.setAttribute("role", "progressbar");');
    expect(source).not.toMatch(/fetch\(|vercel\.app/u);
  });

  it("opens the RIDI library once on a fresh install so the modal is seen", () => {
    expect(background).toContain('if (details.reason === "install") void chrome.tabs.create({ url: "https://ridibooks.com/library/books" });');
  });
});
