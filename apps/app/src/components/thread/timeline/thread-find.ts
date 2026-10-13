export const THREAD_WINDOW_SELECTOR = "[data-thread-window]";
export const THREAD_FIND_IGNORE_ATTRIBUTE = "data-thread-find-ignore";
export const THREAD_FIND_MAX_MATCHES = 1000;

const MATCH_HIGHLIGHT_NAME = "bb-thread-find-match";
const ACTIVE_HIGHLIGHT_NAME = "bb-thread-find-active";

const INLINE_TAGS: Record<string, true> = {
  A: true,
  ABBR: true,
  B: true,
  BDI: true,
  BDO: true,
  CITE: true,
  CODE: true,
  DATA: true,
  DEL: true,
  DFN: true,
  EM: true,
  I: true,
  INS: true,
  KBD: true,
  LABEL: true,
  MARK: true,
  Q: true,
  S: true,
  SAMP: true,
  SMALL: true,
  SPAN: true,
  STRONG: true,
  SUB: true,
  SUP: true,
  TIME: true,
  U: true,
  VAR: true,
};

const SKIPPED_TAGS: Record<string, true> = {
  INPUT: true,
  NOSCRIPT: true,
  SCRIPT: true,
  SELECT: true,
  STYLE: true,
  TEMPLATE: true,
  TEXTAREA: true,
};

interface TextSegment {
  node: Text;
  start: number;
}

function blockAncestor(
  node: Text,
  root: Element,
  cache: Map<Element, Element>,
): Element {
  const parent = node.parentElement ?? root;
  const cached = cache.get(parent);
  if (cached !== undefined) return cached;
  let element = parent;
  while (element !== root && INLINE_TAGS[element.tagName] === true) {
    const next = element.parentElement;
    if (next === null) break;
    element = next;
  }
  cache.set(parent, element);
  return element;
}

function collectTextSegments(root: Element): {
  segments: TextSegment[];
  text: string;
} {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return NodeFilter.FILTER_ACCEPT;
        }
        const element = node as Element;
        if (
          SKIPPED_TAGS[element.tagName] === true ||
          element.hasAttribute(THREAD_FIND_IGNORE_ATTRIBUTE) ||
          element.getAttribute("aria-hidden") === "true" ||
          element.classList.contains("sr-only")
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return element.tagName === "BR"
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    },
  );
  const blocks = new Map<Element, Element>();
  const segments: TextSegment[] = [];
  let text = "";
  let previousBlock: Element | null = null;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      text += "\n";
      continue;
    }
    const textNode = node as Text;
    if (textNode.data.length === 0) continue;
    const block = blockAncestor(textNode, root, blocks);
    if (previousBlock !== null && block !== previousBlock) text += "\n";
    previousBlock = block;
    segments.push({ node: textNode, start: text.length });
    text += textNode.data;
  }
  return { segments, text };
}

function segmentIndexAt(
  segments: readonly TextSegment[],
  offset: number,
  inclusiveEnd: boolean,
): number {
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const start = segments[middle]!.start;
    if (inclusiveEnd ? start < offset : start <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function isRendered(node: Text, visibility: Map<Element, boolean>): boolean {
  const parent = node.parentElement;
  if (parent === null) return false;
  const cached = visibility.get(parent);
  if (cached !== undefined) return cached;
  const rendered =
    typeof parent.checkVisibility === "function"
      ? parent.checkVisibility({ visibilityProperty: true })
      : true;
  visibility.set(parent, rendered);
  return rendered;
}

export function findThreadTextRanges(
  root: Element,
  query: string,
  limit = THREAD_FIND_MAX_MATCHES,
): Range[] {
  if (query.length === 0) return [];
  const { segments, text } = collectTextSegments(root);
  if (segments.length === 0) return [];
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
    "giu",
  );
  const visibility = new Map<Element, boolean>();
  const ranges: Range[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    const startSegment = segments[segmentIndexAt(segments, start, false)]!;
    const endSegment = segments[segmentIndexAt(segments, end, true)]!;
    if (
      !isRendered(startSegment.node, visibility) ||
      !isRendered(endSegment.node, visibility)
    ) {
      continue;
    }
    const range = root.ownerDocument.createRange();
    range.setStart(startSegment.node, start - startSegment.start);
    range.setEnd(endSegment.node, end - endSegment.start);
    ranges.push(range);
    if (ranges.length >= limit) break;
  }
  return ranges;
}

export function resolveThreadFindWindow(
  target: EventTarget | null,
  lastPointerWindow: Element | null,
): Element | null {
  if (target instanceof Element) {
    const targetWindow = target.closest(THREAD_WINDOW_SELECTOR);
    if (targetWindow !== null) return targetWindow;
    const document = target.ownerDocument;
    if (target !== document.body && target !== document.documentElement) {
      return null;
    }
  }
  return lastPointerWindow?.isConnected ? lastPointerWindow : null;
}

interface ThreadFindClaimArgs {
  isFocusedPane: boolean;
  isPrimary: boolean;
  lastPointerWindow: Element | null;
  root: Element;
  target: EventTarget | null;
}

export function claimsThreadFind({
  isFocusedPane,
  isPrimary,
  lastPointerWindow,
  root,
  target,
}: ThreadFindClaimArgs): boolean {
  const intendedWindow = resolveThreadFindWindow(target, lastPointerWindow);
  if (intendedWindow !== null) {
    return root.closest(THREAD_WINDOW_SELECTOR) === intendedWindow;
  }
  return isPrimary && isFocusedPane;
}

let lastPointerWindow: Element | null = null;
let pointerTrackingRetainers = 0;

function trackPointerWindow(event: PointerEvent): void {
  lastPointerWindow =
    event.target instanceof Element
      ? event.target.closest(THREAD_WINDOW_SELECTOR)
      : null;
}

export function retainThreadFindPointerTracking(): () => void {
  if (pointerTrackingRetainers === 0) {
    document.addEventListener("pointerdown", trackPointerWindow, true);
  }
  pointerTrackingRetainers += 1;
  return () => {
    pointerTrackingRetainers -= 1;
    if (pointerTrackingRetainers === 0) {
      document.removeEventListener("pointerdown", trackPointerWindow, true);
      lastPointerWindow = null;
    }
  };
}

export function lastPointerThreadWindow(): Element | null {
  return lastPointerWindow;
}

export function nearestRangeIndex(
  ranges: readonly Range[],
  previous: Range | null,
  fallbackIndex: number,
): number {
  if (ranges.length === 0) return -1;
  if (previous !== null && previous.startContainer.isConnected) {
    const index = ranges.findIndex(
      (range) =>
        range.compareBoundaryPoints(Range.START_TO_START, previous) >= 0,
    );
    return index === -1 ? ranges.length - 1 : index;
  }
  return Math.min(Math.max(fallbackIndex, 0), ranges.length - 1);
}

export function firstRangeBelow(
  ranges: readonly Range[],
  viewportTop: number,
): number {
  if (ranges.length === 0) return -1;
  const index = ranges.findIndex(
    (range) => range.getBoundingClientRect().top >= viewportTop,
  );
  return index === -1 ? ranges.length - 1 : index;
}

const SCROLLABLE_OVERFLOW = /^(?:auto|scroll|overlay)$/u;

export function revealRange(range: Range, obstruction: Element | null): void {
  const view = range.startContainer.ownerDocument?.defaultView;
  if (!view) return;
  for (
    let element = range.startContainer.parentElement;
    element !== null;
    element = element.parentElement
  ) {
    const style = view.getComputedStyle(element);
    const scrollsX =
      SCROLLABLE_OVERFLOW.test(style.overflowX) &&
      element.scrollWidth > element.clientWidth;
    const scrollsY =
      SCROLLABLE_OVERFLOW.test(style.overflowY) &&
      element.scrollHeight > element.clientHeight;
    if (!scrollsX && !scrollsY) continue;
    const box = element.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    if (scrollsX && (rect.left < box.left || rect.right > box.right)) {
      element.scrollLeft += rect.left - box.left - (box.width - rect.width) / 2;
    }
    if (scrollsY) {
      const obstructionBottom =
        obstruction !== null && element.contains(obstruction)
          ? obstruction.getBoundingClientRect().bottom
          : box.top;
      const footer = element.querySelector("[data-scroll-footer]");
      const footerTop =
        footer !== null ? footer.getBoundingClientRect().top : box.bottom;
      const visibleTop = Math.max(box.top, obstructionBottom);
      const visibleBottom = Math.min(box.bottom, footerTop);
      if (rect.top < visibleTop || rect.bottom > visibleBottom) {
        element.scrollTop +=
          rect.top -
          visibleTop -
          (visibleBottom - visibleTop - rect.height) / 2;
      }
    }
  }
  const rect = range.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > view.innerHeight) {
    view.scrollBy({ top: rect.top - (view.innerHeight - rect.height) / 2 });
  }
}

function sharedHighlight(name: string, priority: number): Highlight | null {
  if (
    typeof CSS === "undefined" ||
    !("highlights" in CSS) ||
    typeof Highlight === "undefined"
  ) {
    return null;
  }
  const existing = CSS.highlights.get(name);
  if (existing !== undefined) return existing;
  const highlight = new Highlight();
  highlight.priority = priority;
  CSS.highlights.set(name, highlight);
  return highlight;
}

export class ThreadFindHighlighter {
  private ranges: readonly Range[] = [];
  private active: Range | null = null;

  show(ranges: readonly Range[], activeIndex: number): void {
    this.clear();
    const matches = sharedHighlight(MATCH_HIGHLIGHT_NAME, 0);
    const active = sharedHighlight(ACTIVE_HIGHLIGHT_NAME, 1);
    if (matches === null || active === null) return;
    for (const range of ranges) matches.add(range);
    this.ranges = ranges;
    this.active = ranges[activeIndex] ?? null;
    if (this.active !== null) active.add(this.active);
  }

  clear(): void {
    const matches = sharedHighlight(MATCH_HIGHLIGHT_NAME, 0);
    const active = sharedHighlight(ACTIVE_HIGHLIGHT_NAME, 1);
    for (const range of this.ranges) matches?.delete(range);
    if (this.active !== null) active?.delete(this.active);
    this.ranges = [];
    this.active = null;
  }
}
