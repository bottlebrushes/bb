import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { BrowserChromeIconButton } from "@/components/secondary-panel/BrowserFindBar";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import {
  THREAD_FIND_IGNORE_ATTRIBUTE,
  THREAD_FIND_MAX_MATCHES,
  ThreadFindHighlighter,
  claimsThreadFind,
  findThreadTextRanges,
  firstRangeBelow,
  lastPointerThreadWindow,
  nearestRangeIndex,
  retainThreadFindPointerTracking,
  revealRange,
} from "./thread-find";

const REFRESH_THROTTLE_MS = 150;

interface ThreadFindResult {
  activeIndex: number;
  count: number;
}

interface ThreadFindProps {
  isPrimary: boolean;
  rootRef: RefObject<HTMLElement | null>;
}

export function ThreadFind({ isPrimary, rootRef }: ThreadFindProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const [result, setResult] = useState<ThreadFindResult | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rangesRef = useRef<readonly Range[]>([]);
  const activeIndexRef = useRef(-1);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [highlighter] = useState(() => new ThreadFindHighlighter());
  const isFocusedPane = useOptionalPaneContext()?.isFocused ?? true;
  const shortcut = useAppCommandShortcut("thread.find");

  useEffect(() => retainThreadFindPointerTracking(), []);
  useEffect(() => () => highlighter.clear(), [highlighter]);

  const showMatches = useCallback(
    (ranges: readonly Range[], activeIndex: number, reveal: boolean) => {
      rangesRef.current = ranges;
      activeIndexRef.current = activeIndex;
      highlighter.show(ranges, activeIndex);
      setResult({ activeIndex, count: ranges.length });
      const activeRange = ranges[activeIndex];
      if (reveal && activeRange !== undefined) {
        revealRange(activeRange, barRef.current);
      }
    },
    [highlighter],
  );

  const search = useCallback(
    (text: string, mode: "viewport" | "preserve") => {
      const root = rootRef.current;
      if (root === null || text.length === 0) {
        rangesRef.current = [];
        activeIndexRef.current = -1;
        highlighter.clear();
        setResult(null);
        return;
      }
      const ranges = findThreadTextRanges(root, text);
      const activeIndex =
        mode === "viewport"
          ? firstRangeBelow(
              ranges,
              barRef.current?.getBoundingClientRect().bottom ?? 0,
            )
          : nearestRangeIndex(
              ranges,
              rangesRef.current[activeIndexRef.current] ?? null,
              activeIndexRef.current,
            );
      showMatches(ranges, activeIndex, mode === "viewport");
    },
    [highlighter, rootRef, showMatches],
  );

  useEffect(() => {
    if (isOpen) search(query, "viewport");
  }, [isOpen, query, search]);

  useEffect(() => {
    const root = rootRef.current;
    if (!isOpen || query.length === 0 || root === null) return;
    let timer: number | undefined;
    const observer = new MutationObserver((records) => {
      if (
        timer !== undefined ||
        records.every((record) => barRef.current?.contains(record.target))
      ) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        search(query, "preserve");
      }, REFRESH_THROTTLE_MS);
    });
    observer.observe(root, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [isOpen, query, rootRef, search]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest, isOpen]);

  useAppCommandHandler("thread.find", ({ target }) => {
    const root = rootRef.current;
    if (
      root === null ||
      !root.isConnected ||
      !claimsThreadFind({
        isFocusedPane,
        isPrimary,
        lastPointerWindow: lastPointerThreadWindow(),
        root,
        target,
      })
    ) {
      return false;
    }
    if (!isOpen) {
      const active = document.activeElement;
      restoreFocusRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
    }
    setIsOpen(true);
    setFocusRequest((request) => request + 1);
    return true;
  });

  const step = (delta: number) => {
    const ranges = rangesRef.current;
    if (ranges.length === 0) return;
    showMatches(
      ranges,
      (activeIndexRef.current + delta + ranges.length) % ranges.length,
      true,
    );
  };

  const close = () => {
    setIsOpen(false);
    rangesRef.current = [];
    activeIndexRef.current = -1;
    highlighter.clear();
    setResult(null);
    const restoreTarget = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (restoreTarget?.isConnected) {
      restoreTarget.focus({ preventScroll: true });
    } else {
      inputRef.current?.blur();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  if (!isOpen) return null;

  const hasMatches = result !== null && result.count > 0;
  const matchLabel =
    result === null
      ? null
      : result.count === 0
        ? "No results"
        : `${result.activeIndex + 1}/${result.count}${
            result.count >= THREAD_FIND_MAX_MATCHES ? "+" : ""
          }`;
  const inputLabel = shortcut
    ? `Find in chat (${shortcut.label})`
    : "Find in chat";

  return (
    <div
      {...{ [THREAD_FIND_IGNORE_ATTRIBUTE]: "" }}
      className="pointer-events-none sticky top-0 z-30 -mb-1 h-0"
    >
      <div
        ref={barRef}
        role="search"
        aria-label="Find in chat"
        className="pointer-events-auto absolute right-0 top-2 flex w-72 max-w-full items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg"
      >
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Find in chat"
            aria-label={inputLabel}
            aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          />
          {matchLabel !== null ? (
            <span
              aria-live="polite"
              className={cn(
                "shrink-0 tabular-nums",
                hasMatches ? "text-muted-foreground" : "text-destructive",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            >
              {matchLabel}
            </span>
          ) : null}
        </div>
        <BrowserChromeIconButton
          icon="ChevronUp"
          label="Previous match"
          disabled={!hasMatches}
          onClick={() => step(-1)}
        />
        <BrowserChromeIconButton
          icon="ChevronDown"
          label="Next match"
          disabled={!hasMatches}
          onClick={() => step(1)}
        />
        <BrowserChromeIconButton
          icon="X"
          label="Close find bar"
          onClick={close}
        />
      </div>
    </div>
  );
}
