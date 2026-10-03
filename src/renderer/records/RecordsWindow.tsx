import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { loadCatalogue } from "@shared/i18n/catalogues";
import type { InterfaceLanguage } from "@shared/i18n/languages";
import { RECORDS_LIST_WIDTH, clampRecordsListWidth, recordsListDisplayWidth } from "@shared/layout/records-metrics";
import {
  RECORD_KINDS,
  RECORD_LEVEL_FILTERS,
  type RecordDetail,
  type RecordKind,
  type RecordLevel,
  type RecordLevelFilter,
  type RecordSources,
  type RecordsQuery,
  type RecordSummary
} from "@shared/records";
import { useListbox } from "@renderer/components/useListbox";
import { I18nProvider, useI18n } from "@renderer/i18n/I18nContext";
import { api } from "@renderer/ipc/client";
import { presentFailure } from "@renderer/present-failure";
import {
  KIND_LABELS,
  LEVEL_CHIPS,
  LEVEL_FILTER_LABELS,
  LEVEL_LABELS,
  cursorAfter,
  mergeNewestPage,
  prettyJson,
  recordKey,
  roleLabel
} from "./record-format";

const ENGLISH: InterfaceLanguage = { language: "en", locale: "en" };

/**
 * The Records window speaks the interface language from its first text, and follows it when Settings
 * changes it in the main window. The list pane opens at its saved width, so nothing is drawn until
 * both are known.
 */
export function RecordsApp(): React.JSX.Element | null {
  const [language, setLanguage] = useState<InterfaceLanguage | null>(null);
  const [listWidth, setListWidth] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    // Only the newest language is shown, whichever catalogue finishes loading first.
    let latest = 0;
    const show = (next: InterfaceLanguage): void => {
      const ticket = ++latest;
      void loadCatalogue(next.language)
        .then(() => {
          if (current && ticket === latest) setLanguage(next);
        })
        .catch((error: unknown) => {
          presentFailure(error, null, "records window language load failed");
          if (current && ticket === latest) setLanguage(ENGLISH);
        });
    };
    const off = api.language.onChanged(show);
    void api.language.current().then(show, (error: unknown) => {
      presentFailure(error, null, "records window language read failed");
      if (current) setLanguage((shown) => shown ?? ENGLISH);
    });
    return () => {
      current = false;
      off();
    };
  }, []);

  useEffect(() => {
    let current = true;
    void api.state.get().then(
      (state) => {
        if (current) setListWidth(state.recordsListWidth);
      },
      (error: unknown) => {
        presentFailure(error, null, "records list width read failed");
        if (current) setListWidth(RECORDS_LIST_WIDTH.default);
      }
    );
    return () => {
      current = false;
    };
  }, []);

  if (language === null || listWidth === null) return null;
  return (
    <I18nProvider language={language.language} locale={language.locale}>
      <RecordsWindow initialListWidth={listWidth} />
    </I18nProvider>
  );
}

type Filters = Omit<RecordsQuery, "after">;

const NO_FILTERS: Filters = { session: null, kind: null, level: null, taskId: null, search: "" };
const SEARCH_DELAY_MS = 300;
// New records are read at most this often while they keep arriving.
const LIVE_INTERVAL_MS = 1000;

type ListState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; records: RecordSummary[]; more: boolean; loadingMore: boolean; moreFailed: boolean };

type DetailState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; record: RecordDetail };

type Selection = { kind: RecordKind; id: number };

// Within about one screen of the end of what is loaded.
function nearEnd(scroll: HTMLElement): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= scroll.clientHeight;
}

function atTop(scroll: HTMLElement): boolean {
  return scroll.scrollTop < 1;
}

export function RecordsWindow({ initialListWidth }: { initialListWidth: number }): React.JSX.Element {
  const { t, locale } = useI18n();
  const [sources, setSources] = useState<RecordSources | null>(null);
  const [sourceReads, setSourceReads] = useState(0);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [selected, setSelected] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: "none" });
  const [listWidth, setListWidth] = useState(initialListWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [shellWidth, setShellWidth] = useState<number | null>(null);
  const listGeneration = useRef(0);
  // The busy claim for the next page (PLAYBOOK, Own the work in flight).
  const fetchingMore = useRef(false);
  // The filters the current list was read for, for the live reads below.
  const filtersRef = useRef(filters);
  // New records arrived while the list was scrolled away from the top.
  const newestPending = useRef(false);
  // A failed read is itself logged as a record, whose signal would start the next read; live reads
  // stop after a failure and resume after a read succeeds.
  const liveSuspended = useRef(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Pane sizing: window-conventions. The display follows the window; only a drag changes the intent.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = (): void => setShellWidth(shell.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    measure();
    return () => observer.disconnect();
  }, []);
  const shownListWidth = recordsListDisplayWidth(dragWidth ?? listWidth, shellWidth);

  const timeFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }), [locale]);

  useEffect(() => {
    document.title = t("records.title");
  }, [t]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => (current.search === searchText ? current : { ...current, search: searchText }));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let cancelled = false;
    void api.records.sources().then(
      (next) => {
        if (!cancelled) setSources(next);
      },
      (error: unknown) => {
        liveSuspended.current = true;
        presentFailure(error, null, "record sources read failed");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [sourceReads]);

  // A page applies only while the filters it was read for are still the newest ones asked for.
  useEffect(() => {
    filtersRef.current = filters;
    const generation = ++listGeneration.current;
    fetchingMore.current = false;
    newestPending.current = false;
    setList({ status: "loading" });
    void api.records.page({ ...filters, after: null }).then(
      (page) => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = false;
        setList({ status: "ready", records: page.records, more: page.more, loadingMore: false, moreFailed: false });
      },
      (error: unknown) => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = true;
        presentFailure(error, null, "records read failed");
        setList({ status: "failed" });
      }
    );
  }, [filters]);

  // The newest page read again for new records. It joins the rows already shown rather than
  // replacing them, so the list never falls back to the loading note and the pages already read
  // stay. It reads only refs, so one copy serves the live subscription below.
  const readNewest = useCallback((): void => {
    const generation = listGeneration.current;
    void api.records.page({ ...filtersRef.current, after: null }).then(
      (page) => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = false;
        setList((current) =>
          current.status === "ready"
            ? { ...current, ...mergeNewestPage(current.records, current.more, page) }
            : { status: "ready", records: page.records, more: page.more, loadingMore: false, moreFailed: false }
        );
      },
      (error: unknown) => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = true;
        presentFailure(error, null, "records read failed");
      }
    );
  }, []);

  // A stored record reaches the list at once while it is scrolled to the top; otherwise it waits
  // until the list is back there, so the list never moves under the reader.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = api.records.onChanged(() => {
      if (timer !== null || liveSuspended.current) return;
      timer = setTimeout(() => {
        timer = null;
        setSourceReads((count) => count + 1);
        const scroll = scrollRef.current;
        if (scroll === null || atTop(scroll)) readNewest();
        else newestPending.current = true;
      }, LIVE_INTERVAL_MS);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [readNewest]);

  const selectedKey = selected === null ? null : recordKey(selected);

  useEffect(() => {
    if (selected === null) {
      setDetail({ status: "none" });
      return;
    }
    let cancelled = false;
    setDetail({ status: "loading" });
    void api.records.detail(selected.kind, selected.id).then(
      (record) => {
        if (!cancelled) setDetail(record === null ? { status: "failed" } : { status: "ready", record });
      },
      (error: unknown) => {
        if (cancelled) return;
        presentFailure(error, null, "record read failed");
        setDetail({ status: "failed" });
      }
    );
    return () => {
      cancelled = true;
    };
    // The selection is compared by its key, not by the object holding it.
  }, [selectedKey]);

  // Loading more: composite-control-conventions, Integration Points. A failed page is read again
  // when the end is reached again.
  const loadMore = (): void => {
    if (list.status !== "ready" || !list.more || fetchingMore.current) return;
    fetchingMore.current = true;
    const generation = listGeneration.current;
    setList((current) => (current.status === "ready" ? { ...current, loadingMore: true, moreFailed: false } : current));
    void api.records.page({ ...filters, after: cursorAfter(list.records) }).then(
      (page) => {
        if (generation !== listGeneration.current) return;
        fetchingMore.current = false;
        liveSuspended.current = false;
        setList((current) =>
          current.status === "ready"
            ? { ...current, records: [...current.records, ...page.records], more: page.more, loadingMore: false }
            : current
        );
      },
      (error: unknown) => {
        if (generation !== listGeneration.current) return;
        fetchingMore.current = false;
        liveSuspended.current = true;
        presentFailure(error, null, "records read failed");
        setList((current) => (current.status === "ready" ? { ...current, loadingMore: false, moreFailed: true } : current));
      }
    );
  };

  // A page that leaves the list short of the end reads the next one; a failed page waits for the
  // reader instead.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (list.status !== "ready" || list.loadingMore || list.moreFailed || scroll === null) return;
    if (nearEnd(scroll)) loadMore();
    // Only a new list state can change what is loaded.
  }, [list]);

  const onListScroll = (): void => {
    const scroll = scrollRef.current;
    if (scroll === null) return;
    if (newestPending.current && atTop(scroll)) {
      newestPending.current = false;
      readNewest();
    }
    if (nearEnd(scroll)) loadMore();
  };

  const records = list.status === "ready" ? list.records : [];
  const keys = records.map(recordKey);

  // The list is one listbox (composite-control-conventions, Listbox) through the app's own layer;
  // the selection follows the keys, and reaching the last row reads the next page.
  const selectKey = (key: string): void => {
    const record = records.find((item) => recordKey(item) === key);
    if (!record) return;
    if (key !== selectedKey) setSelected({ kind: record.kind, id: record.id });
    if (key === keys.at(-1)) loadMore();
  };
  const listbox = useListbox({ ids: keys, selectedId: selectedKey, onSelect: selectKey });
  const { ref: listboxRef, ...listboxProps } = listbox.listboxProps;
  const attachList = useCallback((element: HTMLDivElement | null) => {
    listboxRef.current = element;
    scrollRef.current = element;
  }, [listboxRef]);

  // Drag intent: window-conventions, Content-based minimum size. Only the drag's end is saved.
  const commitListWidth = (width: number): void => {
    setListWidth(width);
    setDragWidth(null);
    void api.state.update({ recordsListWidth: width }).then(
      (state) => setListWidth(state.recordsListWidth),
      (error: unknown) => presentFailure(error, null, "records list width save failed")
    );
  };

  const launchLabel = (session: string): string => {
    const time = timeFormat.format(new Date(session));
    return session === sources?.currentSession ? t("records.thisLaunch", { time }) : time;
  };

  return (
    <div
      ref={shellRef}
      className="records-shell"
      style={{ "--records-list-width": `${shownListWidth}px` } as CSSProperties}
    >
      <section className="panel records-list-pane" aria-label={t("records.title")}>
        <div className="records-filters">
          <input
            className="compact-control"
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t("records.search")}
            aria-label={t("records.search")}
          />
          <div className="records-filters-row">
            <FilterSelect
              label={t("records.launch")}
              value={filters.session}
              allLabel={t("records.allLaunches")}
              options={(sources?.sessions ?? []).map((session) => ({ value: session, label: launchLabel(session) }))}
              onChange={(session) => setFilters({ ...filters, session })}
            />
            <FilterSelect
              label={t("records.task")}
              value={filters.taskId}
              allLabel={t("records.allTasks")}
              options={(sources?.tasks ?? []).map((task) => ({ value: task.taskId, label: task.name ?? task.taskId }))}
              onChange={(taskId) => setFilters({ ...filters, taskId })}
            />
          </div>
          <div className="records-filters-row">
            <FilterSelect
              label={t("records.kind")}
              value={filters.kind}
              allLabel={t("records.allKinds")}
              options={RECORD_KINDS.map((kind) => ({ value: kind, label: t(KIND_LABELS[kind]) }))}
              onChange={(kind) => setFilters({ ...filters, kind: kind as RecordKind | null })}
            />
            <FilterSelect
              label={t("records.level")}
              value={filters.level}
              allLabel={t("records.allLevels")}
              options={RECORD_LEVEL_FILTERS.map((level) => ({ value: level, label: t(LEVEL_FILTER_LABELS[level]) }))}
              onChange={(level) => setFilters({ ...filters, level: level as RecordLevelFilter | null })}
            />
          </div>
        </div>
        <div
          {...listboxProps}
          ref={attachList}
          aria-label={t("records.title")}
          aria-busy={list.status === "loading"}
          className="records-list"
          onScroll={onListScroll}
        >
          {list.status === "failed" ? (
            <p className="records-note records-note-error" role="alert">{t("records.loadFailed")}</p>
          ) : list.status === "loading" ? (
            <p className="records-note">{t("records.loading")}</p>
          ) : records.length === 0 ? (
            <p className="records-note">{t("records.empty")}</p>
          ) : (
            records.map((record) => {
              const key = recordKey(record);
              return (
                <div
                  key={key}
                  className={`records-row${key === selectedKey ? " active" : ""}`}
                  onClick={() => selectKey(key)}
                  {...listbox.getOptionProps(key)}
                >
                  <div className="records-row-meta">
                    <span>{timeFormat.format(new Date(record.time))}</span>
                    <span className={LEVEL_CHIPS[record.level]}>{t(LEVEL_LABELS[record.level])}</span>
                    {record.kind === "provider-call" ? (
                      <span className="status-chip status-chip-idle">{t(KIND_LABELS[record.kind])}</span>
                    ) : null}
                  </div>
                  <div className="records-row-title">{record.title}</div>
                  {record.text ? <div className="records-row-text">{record.text}</div> : null}
                </div>
              );
            })
          )}
          {list.status === "ready" && list.loadingMore ? <p className="records-note">{t("records.loading")}</p> : null}
          {list.status === "ready" && list.moreFailed ? (
            <p className="records-note records-note-error" role="alert">{t("records.loadFailed")}</p>
          ) : null}
        </div>
      </section>
      <RecordsSplitter
        label={t("records.resizeList")}
        width={shownListWidth}
        onResize={setDragWidth}
        onCommit={commitListWidth}
      />
      <section className="panel records-detail-pane" aria-busy={detail.status === "loading"}>
        {detail.status === "ready" ? (
          <RecordDetailView record={detail.record} tasks={sources?.tasks ?? []} launchLabel={launchLabel} />
        ) : (
          <p className={`records-note${detail.status === "failed" ? " records-note-error" : ""}`}>
            {detail.status === "failed" ? t("records.detailFailed") : detail.status === "none" ? t("records.noSelection") : null}
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * The drag handle between the list and the detail pane. It owns only the gesture: it streams the
 * dragged width, held to the list's bounds, and reports the last one when the drag ends. Keyboard
 * resize is not offered, as on the main window's splitters: the width persists, so this is a setup
 * gesture rather than a frequent one.
 */
function RecordsSplitter({
  label,
  width,
  onResize,
  onCommit
}: {
  label: string;
  width: number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
}): React.JSX.Element {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const splitter = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;

    const move = (moveEvent: PointerEvent): void => {
      latest = clampRecordsListWidth(startWidth + (moveEvent.clientX - startX));
      onResize(latest);
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("is-resizing-workspace");
      splitter.classList.remove("is-resizing");
      onCommit(latest);
    };

    document.body.classList.add("is-resizing-workspace");
    splitter.classList.add("is-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className="workspace-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
    />
  );
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange
}: {
  label: string;
  value: string | null;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}): React.JSX.Element {
  // A chosen value the sources no longer list stays selectable until changed.
  const shown = value === null || options.some((option) => option.value === value)
    ? options
    : [{ value, label: value }, ...options];
  return (
    <select
      className="compact-control"
      aria-label={label}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    >
      <option value="">{allLabel}</option>
      {shown.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function RecordDetailView({
  record,
  tasks,
  launchLabel
}: {
  record: RecordDetail;
  tasks: RecordSources["tasks"];
  launchLabel: (session: string) => string;
}): React.JSX.Element {
  const { t, number, locale } = useI18n();
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3
      }),
    [locale]
  );
  const secondsFormat = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "second",
        unitDisplay: "short",
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
      }),
    [locale]
  );
  const time = (value: string): string => timeFormat.format(new Date(value));
  const taskName = record.taskId === null ? null : (tasks.find((task) => task.taskId === record.taskId)?.name ?? null);
  const level: RecordLevel = record.kind === "log" ? record.level : record.error === null ? "info" : "error";

  const fields: { label: string; value: ReactNode }[] = [];
  const add = (label: string, value: ReactNode | null): void => {
    if (value !== null) fields.push({ label, value });
  };
  if (record.kind === "log") {
    add(t("records.time"), time(record.time));
  } else {
    const role = roleLabel(record.role);
    add(t("records.started"), time(record.time));
    add(t("records.duration"), secondsFormat.format(record.durationMs / 1000));
    add(t("records.provider"), <code>{record.provider}</code>);
    add(t("records.role"), role === null ? <code>{record.role}</code> : t(role));
    add(t("records.model"), <code>{record.model}</code>);
    add(t("records.endpoint"), <code>{record.endpoint}</code>);
    add(t("records.attempt"), number(record.attempt));
  }
  add(
    t("records.task"),
    record.taskId === null ? null : (
      <>
        {taskName === null ? null : <span>{taskName}</span>}
        <code>{record.taskId}</code>
      </>
    )
  );
  add(t("records.launch"), launchLabel(record.session));

  const blocks: { label: string; text: string }[] = [];
  if (record.kind === "log") {
    blocks.push({ label: t("records.details"), text: prettyJson(record.fields) });
  } else {
    blocks.push({ label: t("records.request"), text: prettyJson(record.request) });
    if (record.response !== null) blocks.push({ label: t("records.response"), text: prettyJson(record.response) });
    if (record.error !== null) blocks.push({ label: t("records.error"), text: prettyJson(record.error) });
  }

  return (
    <>
      <div className="panel-header records-detail-header">
        <h2 className="records-detail-title">
          {record.kind === "log" ? record.message : `${record.provider} ${record.role}`}
        </h2>
        <div className="records-detail-chips">
          <span className={LEVEL_CHIPS[level]}>{t(LEVEL_LABELS[level])}</span>
          <span className="status-chip status-chip-muted">{t(KIND_LABELS[record.kind])}</span>
        </div>
      </div>
      <div className="records-detail-body" role="region" tabIndex={0} aria-label={t("records.details")}>
        <dl className="records-meta">
          {fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
        {blocks.map((block) => (
          <section key={block.label} className="records-block">
            <h3 className="records-block-label">{block.label}</h3>
            <pre className="records-block-text">{block.text}</pre>
          </section>
        ))}
      </div>
    </>
  );
}
