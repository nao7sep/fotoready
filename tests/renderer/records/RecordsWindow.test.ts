// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORDS_DETAIL_MIN_WIDTH, RECORDS_LIST_WIDTH } from "@shared/layout/records-metrics";
import { SPLITTER_WIDTH } from "@shared/layout/workspace-metrics";
import type { RecordDetail, RecordsPage, RecordsQuery, RecordSummary } from "@shared/records";
import type { FotoReadyApi } from "@shared/types/ipc";
import type { UiState } from "@shared/types/state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = "2026-10-02T08:00:00.000Z";

const call: RecordSummary = {
  kind: "provider-call", id: 4, session: SESSION, time: "2026-10-02T08:01:00.000Z", level: "error",
  title: "gemini description", text: "gemini-3.5-flash", taskId: "task-1"
};
const line: RecordSummary = {
  kind: "log", id: 9, session: SESSION, time: "2026-10-02T08:00:30.000Z", level: "warn",
  title: "vision retry", text: "vision", taskId: "task-1"
};
const callDetail: RecordDetail = {
  kind: "provider-call", id: 4, session: SESSION, time: "2026-10-02T08:01:00.000Z", durationMs: 2500,
  taskId: "task-1", provider: "gemini", endpoint: "https://models.example", role: "description",
  model: "gemini-3.5-flash", attempt: 2,
  request: JSON.stringify({ contents: "Describe", apiKey: "sk-test" }), response: "null",
  error: JSON.stringify({ name: "Error", message: "quota" })
};
const newer: RecordSummary = {
  kind: "log", id: 12, session: SESSION, time: "2026-10-02T08:02:00.000Z", level: "info",
  title: "app later", text: null, taskId: null
};

const page = vi.fn<FotoReadyApi["records"]["page"]>();
const detail = vi.fn<FotoReadyApi["records"]["detail"]>();
const sources = vi.fn<FotoReadyApi["records"]["sources"]>();
const update = vi.fn<FotoReadyApi["state"]["update"]>();
const getState = vi.fn<FotoReadyApi["state"]["get"]>();
const currentLanguage = vi.fn<FotoReadyApi["language"]["current"]>();
const log = vi.fn<FotoReadyApi["system"]["log"]>();
let recordsChanged: (() => void) | null = null;
const onChanged = vi.fn<FotoReadyApi["records"]["onChanged"]>((listener) => {
  recordsChanged = listener;
  return () => {
    recordsChanged = null;
  };
});

// The renderer's client reads window.api once, when it is first imported.
Object.defineProperty(window, "api", {
  configurable: true,
  value: {
    records: { page, detail, sources, onChanged },
    state: { get: getState, update },
    system: { log },
    language: { current: currentLanguage, onChanged: () => () => {} }
  }
});
const { RecordsApp, RecordsWindow } = await import("@renderer/records/RecordsWindow");

let root: Root | null = null;

// jsdom lays nothing out, so the list's scroll box and the shell's width are set here. By default
// the list is scrolled to the top and far from its end.
const box = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, shellWidth: 2000 };
const resizeCallbacks = new Set<() => void>();
class TestResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe(): void {
    resizeCallbacks.add(this.callback);
  }
  disconnect(): void {
    resizeCallbacks.delete(this.callback);
  }
}
const isScroll = (element: HTMLElement) => element.classList.contains("records-list");

beforeEach(() => {
  page.mockReset();
  page.mockResolvedValue({ records: [call, line], more: false } satisfies RecordsPage);
  detail.mockReset();
  detail.mockResolvedValue(callDetail);
  sources.mockReset();
  sources.mockResolvedValue({
    currentSession: SESSION, sessions: [SESSION, "2026-10-01T08:00:00.000Z"], tasks: [{ taskId: "task-1", name: "harbour.jpg" }]
  });
  update.mockReset();
  update.mockImplementation(async (patch) => ({ recordsListWidth: patch.recordsListWidth } as UiState));
  log.mockReset();
  log.mockResolvedValue();
  onChanged.mockClear();
  recordsChanged = null;
  Object.assign(box, { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, shellWidth: 2000 });
  resizeCallbacks.clear();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  Object.defineProperties(HTMLElement.prototype, {
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) { return isScroll(this) ? box.scrollTop : 0; },
      set(this: HTMLElement, value: number) { if (isScroll(this)) box.scrollTop = value; }
    },
    scrollHeight: { configurable: true, get(this: HTMLElement) { return isScroll(this) ? box.scrollHeight : 0; } },
    clientHeight: { configurable: true, get(this: HTMLElement) { return isScroll(this) ? box.clientHeight : 0; } },
    clientWidth: {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains("records-shell") ? box.shellWidth : 0; }
    }
  });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const name of ["scrollTop", "scrollHeight", "clientHeight", "clientWidth"]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

async function mount(): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(RecordsWindow, { initialListWidth: RECORDS_LIST_WIDTH.default })));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
const titles = () => options().map((option) => option.querySelector(".records-row-title")?.textContent);
const lastQuery = (): RecordsQuery => page.mock.calls.at(-1)![0];
const scrollBox = () => document.querySelector<HTMLElement>(".records-list")!;
const scrollTo = async (top: number, events = 1) => {
  await act(async () => {
    box.scrollTop = top;
    for (let index = 0; index < events; index++) scrollBox().dispatchEvent(new Event("scroll"));
  });
};
const press = async (key: string) => {
  await act(async () => {
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
};
const signal = async () => {
  await act(async () => recordsChanged!());
};
const cursorOf = (record: RecordSummary) => ({ time: record.time, kind: record.kind, id: record.id });
const ALL: RecordsQuery = { session: null, kind: null, level: null, taskId: null, search: "", after: null };

describe("RecordsApp", () => {
  it("draws nothing until the language and the saved list width are known, then opens at that width", async () => {
    const state = deferred<UiState>();
    getState.mockReturnValueOnce(state.promise);
    currentLanguage.mockResolvedValueOnce({ language: "en", locale: "en" });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(RecordsApp)));
    expect(container.innerHTML).toBe("");

    await act(async () => state.resolve({ recordsListWidth: 500 } as UiState));
    const shell = document.querySelector<HTMLElement>(".records-shell")!;
    expect(shell.style.getPropertyValue("--records-list-width")).toBe("500px");
    expect(page).toHaveBeenCalledOnce();
  });
});

describe("RecordsWindow", () => {
  it("lists the records newest first in one listbox, with nothing selected yet", async () => {
    await mount();

    expect(titles()).toEqual(["gemini description", "vision retry"]);
    expect(lastQuery()).toEqual(ALL);
    expect(document.body.textContent).toContain("Select a record to see everything it holds.");
    expect(document.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("Records");
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1]);
  });

  it("shows everything a selected provider call holds", async () => {
    await mount();
    await act(async () => options()[0]!.click());

    expect(detail).toHaveBeenCalledWith("provider-call", 4);
    const blocks = Array.from(document.querySelectorAll(".records-block")).map((block) => [
      block.querySelector("h3")?.textContent,
      block.querySelector("pre")?.textContent
    ]);
    expect(blocks).toEqual([
      ["Request", JSON.stringify({ contents: "Describe", apiKey: "sk-test" }, null, 2)],
      ["Error", JSON.stringify({ name: "Error", message: "quota" }, null, 2)]
    ]);
    const body = document.querySelector(".records-detail-body")!.textContent!;
    expect(body).toContain("harbour.jpg");
    expect(body).toContain("task-1");
    expect(body).toContain("Description");
    expect(body).toContain("https://models.example");
    expect(body).toContain("2.500");
    expect(body).toContain("(this launch)");
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".records-detail-header")?.textContent).toContain("Error");
  });

  it("shows a log line's fields, leaving out the task the Task field shows", async () => {
    detail.mockResolvedValue({
      kind: "log", id: 9, session: SESSION, time: line.time, level: "warn", message: "vision retry", taskId: "task-1",
      fields: JSON.stringify({ mod: "vision", taskId: "task-1", attempt: 2 })
    });
    await mount();
    await act(async () => options()[1]!.click());

    expect(document.querySelector(".records-detail-title")?.textContent).toBe("vision retry");
    expect(document.querySelector(".records-block pre")?.textContent).toBe(
      JSON.stringify({ mod: "vision", attempt: 2 }, null, 2)
    );
  });

  it("leaves out the Details block when no field is left to show", async () => {
    detail.mockResolvedValue({
      kind: "log", id: 9, session: SESSION, time: line.time, level: "warn", message: "vision retry", taskId: "task-1",
      fields: JSON.stringify({ taskId: "task-1" })
    });
    await mount();
    await act(async () => options()[1]!.click());

    expect(document.querySelector(".records-detail-title")?.textContent).toBe("vision retry");
    expect(document.querySelectorAll(".records-block")).toHaveLength(0);
  });

  it("moves the selection with the arrow keys", async () => {
    await mount();
    await act(async () => options()[0]!.focus());
    await press("ArrowDown");

    expect(document.activeElement).toBe(options()[1]);
    expect(detail).toHaveBeenLastCalledWith("log", 9);
    expect(options().map((option) => option.tabIndex)).toEqual([-1, 0]);
  });

  it("reads again with each filter, and searches once typing pauses", async () => {
    await mount();
    const selects = Array.from(document.querySelectorAll("select"));
    expect(selects.map((select) => select.getAttribute("aria-label"))).toEqual(["Launch", "Task", "Kind", "Level"]);
    expect(Array.from(selects[0]!.options).map((option) => option.textContent)).toEqual([
      "All launches",
      expect.stringContaining("(this launch)"),
      expect.not.stringContaining("(this launch)")
    ]);
    expect(Array.from(selects[1]!.options).map((option) => option.textContent)).toEqual(["All tasks", "harbour.jpg"]);
    expect(Array.from(selects[2]!.options).map((option) => option.textContent)).toEqual(["All kinds", "Log line", "Provider call"]);

    const choose = async (select: HTMLSelectElement, value: string) => {
      await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    await choose(selects[0]!, SESSION);
    await choose(selects[1]!, "task-1");
    await choose(selects[2]!, "provider-call");
    await choose(selects[3]!, "error");
    expect(lastQuery()).toEqual({ session: SESSION, kind: "provider-call", level: "error", taskId: "task-1", search: "", after: null });

    vi.useFakeTimers();
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(search, "quota");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(299));
    expect(lastQuery().search).toBe("");
    await act(async () => vi.advanceTimersByTime(1));
    expect(lastQuery().search).toBe("quota");
  });

  it("offers Warnings and errors first among the levels, with every filter off", async () => {
    await mount();
    const level = document.querySelectorAll("select")[3]!;
    expect(Array.from(level.options).map((option) => option.textContent)).toEqual([
      "All levels", "Warnings and errors", "Error", "Warning", "Info", "Debug"
    ]);
    expect(Array.from(document.querySelectorAll("select")).map((select) => select.value)).toEqual(["", "", "", ""]);
  });

  it("shows a loading note while the first page is read, then the rows", async () => {
    const first = deferred<RecordsPage>();
    page.mockReturnValueOnce(first.promise);
    await mount();

    expect(document.body.textContent).toContain("Loading records…");
    expect(document.body.textContent).not.toContain("No records match these filters.");
    expect(options()).toHaveLength(0);

    await act(async () => first.resolve({ records: [call, line], more: false }));
    expect(options()).toHaveLength(2);
    expect(document.body.textContent).not.toContain("Loading records…");
  });

  it("says when no records match, keeping the empty list reachable", async () => {
    page.mockResolvedValue({ records: [], more: false });
    await mount();
    expect(document.body.textContent).toContain("No records match these filters.");
    expect(document.querySelector<HTMLElement>('[role="listbox"]')!.tabIndex).toBe(0);
  });

  it("offers no button to load more or refresh", async () => {
    await mount();
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });

  it("reads the next page from the last row once the list is scrolled near its end", async () => {
    page.mockResolvedValueOnce({ records: [call], more: true });
    page.mockResolvedValueOnce({ records: [line], more: false });
    await mount();
    expect(page).toHaveBeenCalledOnce();

    await scrollTo(700);

    expect(page).toHaveBeenCalledTimes(2);
    expect(lastQuery().after).toEqual(cursorOf(call));
    expect(titles()).toEqual(["gemini description", "vision retry"]);
  });

  it("reads the next page when ArrowDown is pressed on the last row", async () => {
    page.mockResolvedValueOnce({ records: [call, line], more: true });
    page.mockResolvedValueOnce({ records: [], more: false });
    await mount();
    await act(async () => options()[1]!.focus());
    await press("ArrowDown");

    expect(page).toHaveBeenCalledTimes(2);
    expect(lastQuery().after).toEqual(cursorOf(line));
    expect(document.activeElement).toBe(options()[1]);
  });

  it("makes one request for two scroll events together", async () => {
    page.mockResolvedValueOnce({ records: [call, line], more: true });
    page.mockReturnValueOnce(new Promise<RecordsPage>(() => {}));
    await mount();

    await scrollTo(800, 2);

    expect(page).toHaveBeenCalledTimes(2);
    expect(options()).toHaveLength(2);
    expect(document.body.textContent).toContain("Loading records…");
  });

  it("reads the next page by itself while a page does not fill the list", async () => {
    box.scrollHeight = 150;
    page.mockResolvedValueOnce({ records: [call], more: true });
    page.mockResolvedValueOnce({ records: [line], more: false });
    await mount();

    expect(page).toHaveBeenCalledTimes(2);
    expect(titles()).toEqual(["gemini description", "vision retry"]);
  });

  it("keeps a failed page's note at the end, and reads it again when the end is reached again", async () => {
    page.mockResolvedValueOnce({ records: [call], more: true });
    page.mockRejectedValueOnce(new Error("busy"));
    page.mockResolvedValueOnce({ records: [line], more: false });
    await mount();

    await scrollTo(700);
    expect(document.body.textContent).toContain("The records could not be read.");
    expect(options()).toHaveLength(1);
    expect(page).toHaveBeenCalledTimes(2);

    await scrollTo(750);
    expect(page).toHaveBeenCalledTimes(3);
    expect(lastQuery().after).toEqual(cursorOf(call));
    expect(titles()).toEqual(["gemini description", "vision retry"]);
    expect(document.body.textContent).not.toContain("The records could not be read.");
  });

  it("re-reads the newest page once for a burst of new records while at the top, keeping the rows shown", async () => {
    await mount();
    vi.useFakeTimers();
    const next = deferred<RecordsPage>();
    page.mockReturnValueOnce(next.promise);

    await signal();
    await signal();
    await signal();
    await act(async () => vi.advanceTimersByTime(1000));

    expect(page).toHaveBeenCalledTimes(2);
    expect(lastQuery()).toEqual(ALL);
    expect(sources).toHaveBeenCalledTimes(2);
    expect(options()).toHaveLength(2);
    expect(document.body.textContent).not.toContain("Loading records…");

    await act(async () => next.resolve({ records: [newer, call, line], more: false }));
    expect(titles()).toEqual(["app later", "gemini description", "vision retry"]);
  });

  it("leaves the list alone while scrolled down, and shows new records once back at the top", async () => {
    await mount();
    await scrollTo(300);
    vi.useFakeTimers();
    page.mockResolvedValueOnce({ records: [newer, call, line], more: false });

    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(page).toHaveBeenCalledOnce();
    expect(options()).toHaveLength(2);

    await scrollTo(0);
    expect(page).toHaveBeenCalledTimes(2);
    expect(titles()).toEqual(["app later", "gemini description", "vision retry"]);
  });

  it("keeps the selected record selected through an update", async () => {
    await mount();
    await act(async () => options()[1]!.click());
    vi.useFakeTimers();
    page.mockResolvedValueOnce({ records: [newer, call, line], more: false });

    await signal();
    await act(async () => vi.advanceTimersByTime(1000));

    expect(options()).toHaveLength(3);
    expect(options()[2]!.getAttribute("aria-selected")).toBe("true");
    expect(detail).toHaveBeenCalledOnce();
  });

  it("stops reading on new-record signals after a failed read, so a logged failure cannot start the next read", async () => {
    await mount();
    vi.useFakeTimers();
    page.mockRejectedValueOnce(new Error("busy"));

    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(page).toHaveBeenCalledTimes(2);

    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(page).toHaveBeenCalledTimes(2);
    expect(options()).toHaveLength(2);
  });

  it("follows signals again once a read succeeds", async () => {
    page.mockRejectedValueOnce(new Error("busy"));
    await mount();
    expect(document.body.textContent).toContain("The records could not be read.");

    vi.useFakeTimers();
    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(page).toHaveBeenCalledOnce();

    // A changed filter reads again; its success lets the next signal through.
    await act(async () => {
      const select = document.querySelectorAll("select")[2]!;
      select.value = "log";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(page).toHaveBeenCalledTimes(2);
    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("stops listening for new records when it closes", async () => {
    await mount();
    expect(recordsChanged).not.toBeNull();
    await act(async () => root?.unmount());
    root = null;
    expect(recordsChanged).toBeNull();
  });

  it("saves the list width once when a drag ends, held to the pane's bounds", async () => {
    await mount();
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!;
    expect(splitter.getAttribute("aria-label")).toBe("Resize list pane");

    await act(async () => {
      splitter.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 100 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 2000 }));
    });
    expect(update).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });

    expect(update).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: RECORDS_LIST_WIDTH.max });
    const shell = document.querySelector<HTMLElement>(".records-shell")!;
    expect(shell.style.getPropertyValue("--records-list-width")).toBe(`${RECORDS_LIST_WIDTH.max}px`);
  });

  it("moves the divider by keyboard and saves once when the key is released or the handle is left", async () => {
    await mount();
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!;
    const shell = document.querySelector<HTMLElement>(".records-shell")!;
    expect(splitter.tabIndex).toBe(0);
    expect(splitter.getAttribute("aria-valuenow")).toBe(String(RECORDS_LIST_WIDTH.default));
    const key = (type: "keydown" | "keyup", name: string) => act(async () => {
      splitter.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true }));
    });

    await key("keydown", "ArrowRight");
    await key("keydown", "ArrowRight");
    expect(shell.style.getPropertyValue("--records-list-width")).toBe(`${RECORDS_LIST_WIDTH.default + 32}px`);
    expect(update).not.toHaveBeenCalled();
    await key("keyup", "ArrowRight");
    expect(update).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: RECORDS_LIST_WIDTH.default + 32 });

    await key("keydown", "Home");
    expect(shell.style.getPropertyValue("--records-list-width")).toBe(`${RECORDS_LIST_WIDTH.min}px`);
    await act(async () => splitter.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(update).toHaveBeenLastCalledWith({ recordsListWidth: RECORDS_LIST_WIDTH.min });

    await key("keydown", "End");
    await key("keyup", "End");
    expect(update).toHaveBeenLastCalledWith({ recordsListWidth: RECORDS_LIST_WIDTH.max });
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("narrows the list when the window narrows, saving nothing", async () => {
    await mount();
    const shell = document.querySelector<HTMLElement>(".records-shell")!;
    expect(shell.style.getPropertyValue("--records-list-width")).toBe(`${RECORDS_LIST_WIDTH.default}px`);

    await act(async () => {
      box.shellWidth = SPLITTER_WIDTH + RECORDS_DETAIL_MIN_WIDTH + RECORDS_LIST_WIDTH.min;
      for (const callback of resizeCallbacks) callback();
    });

    expect(shell.style.getPropertyValue("--records-list-width")).toBe(`${RECORDS_LIST_WIDTH.min}px`);
    expect(update).not.toHaveBeenCalled();
  });

  it("says when the records cannot be read, without the raw error", async () => {
    page.mockRejectedValue(new Error("SQLITE_CORRUPT /Users/someone/.fotoready/records.sqlite3"));
    await mount();

    expect(document.body.textContent).toContain("The records could not be read.");
    expect(document.body.textContent).not.toContain("SQLITE_CORRUPT");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ level: "error", message: "records read failed" }));
  });
});
