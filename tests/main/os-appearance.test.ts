import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] }, nativeTheme: {}, systemPreferences: {} }));

const { osAppearance, windowsAppearance } = await import("@main/theme");

function reads(overrides: Partial<Parameters<typeof osAppearance>[0]>): Parameters<typeof osAppearance>[0] {
  return {
    platform: "darwin",
    themeSource: () => "dark",
    nativeDark: () => true,
    macInterfaceStyle: () => "",
    windowsPersonalize: async () => "",
    ...overrides
  };
}

describe("what System resolves to", () => {
  it("is what the OS shows while FotoReady follows it", async () => {
    expect(await osAppearance(reads({ themeSource: () => "system", nativeDark: () => true }))).toBe("dark");
    expect(await osAppearance(reads({ themeSource: () => "system", nativeDark: () => false }))).toBe("light");
  });

  it("is read from macOS's own setting while FotoReady forces a theme", async () => {
    expect(await osAppearance(reads({ themeSource: () => "dark", nativeDark: () => true, macInterfaceStyle: () => "" }))).toBe("light");
    expect(await osAppearance(reads({ themeSource: () => "light", nativeDark: () => false, macInterfaceStyle: () => "Dark" }))).toBe("dark");
  });

  it("is read from Windows's app mode while FotoReady forces a theme", async () => {
    const reg = (value: string) => `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\r\n    AppsUseLightTheme    REG_DWORD    ${value}\r\n`;
    expect(windowsAppearance(reg("0x0"))).toBe("dark");
    expect(windowsAppearance(reg("0x1"))).toBe("light");
    expect(windowsAppearance("")).toBe("light");
    expect(await osAppearance(reads({ platform: "win32", themeSource: () => "light", nativeDark: () => false, windowsPersonalize: async () => reg("0x0") }))).toBe("dark");
  });

  it("falls back to what nativeTheme reports when the OS cannot be read", async () => {
    expect(await osAppearance(reads({ platform: "win32", nativeDark: () => true, windowsPersonalize: async () => { throw new Error("reg missing"); } }))).toBe("dark");
    expect(await osAppearance(reads({ platform: "linux", nativeDark: () => false }))).toBe("light");
  });
});
