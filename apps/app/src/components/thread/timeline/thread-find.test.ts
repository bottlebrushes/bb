// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  claimsThreadFind,
  findThreadTextRanges,
  nearestRangeIndex,
} from "./thread-find";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function matchedText(root: Element, query: string): string[] {
  return findThreadTextRanges(root, query).map((range) => range.toString());
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findThreadTextRanges", () => {
  it("matches text split across inline formatting", () => {
    const root = mount(
      "<p>Run <code>pnpm</code> <strong>te</strong>st now</p>",
    );
    expect(matchedText(root, "pnpm test")).toEqual(["pnpm test"]);
  });

  it("does not join text across block boundaries or line breaks", () => {
    const root = mount("<p>alpha</p><p>beta</p><div>gam<br>ma</div>");
    expect(matchedText(root, "alphabeta")).toEqual([]);
    expect(matchedText(root, "gamma")).toEqual([]);
    expect(matchedText(root, "beta")).toEqual(["beta"]);
  });

  it("matches case-insensitively and treats the query literally", () => {
    const root = mount("<p>Error: a.b failed; axb ok; ERROR again</p>");
    expect(matchedText(root, "error")).toEqual(["Error", "ERROR"]);
    expect(matchedText(root, "a.b")).toEqual(["a.b"]);
    expect(matchedText(root, "(")).toEqual([]);
  });

  it("skips find chrome, hidden, and editable subtrees", () => {
    const root = mount(
      [
        '<div data-thread-find-ignore=""><input value="needle"><span>needle</span></div>',
        '<span aria-hidden="true">needle</span>',
        '<span class="sr-only">needle</span>',
        "<textarea>needle</textarea>",
        "<p>visible needle</p>",
      ].join(""),
    );
    const ranges = findThreadTextRanges(root, "needle");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startContainer.parentElement?.tagName).toBe("P");
  });

  it("stops at the match limit", () => {
    const root = mount(`<p>${"x ".repeat(20)}</p>`);
    expect(findThreadTextRanges(root, "x", 5)).toHaveLength(5);
  });
});

describe("nearestRangeIndex", () => {
  it("keeps the active match position when matches are inserted before it", () => {
    const root = mount("<p id='a'>one hit</p><p id='b'>two hit</p>");
    const before = findThreadTextRanges(root, "hit");
    const active = before[1]!;
    root.insertAdjacentHTML("afterbegin", "<p>new hit</p>");
    const after = findThreadTextRanges(root, "hit");
    expect(after).toHaveLength(3);
    expect(nearestRangeIndex(after, active, 1)).toBe(2);
  });

  it("clamps the previous index when the active match was removed", () => {
    const root = mount("<p>hit</p><p id='gone'>hit</p>");
    const active = findThreadTextRanges(root, "hit")[1]!;
    root.querySelector("#gone")?.remove();
    const after = findThreadTextRanges(root, "hit");
    expect(nearestRangeIndex(after, active, 1)).toBe(0);
  });
});

describe("claimsThreadFind", () => {
  function windows() {
    const container = mount(
      [
        '<div data-thread-window="" id="main"><div id="main-root"></div><textarea id="composer"></textarea></div>',
        '<div data-thread-window="" id="side"><div id="side-root"></div></div>',
        '<nav id="sidebar"><button id="sidebar-button">x</button></nav>',
      ].join(""),
    );
    const byId = (id: string) => container.querySelector(`#${id}`)!;
    return {
      byId,
      mainRoot: byId("main-root"),
      sideRoot: byId("side-root"),
    };
  }

  it("routes to the chat window that contains the keyboard target", () => {
    const { byId, mainRoot, sideRoot } = windows();
    const args = {
      isFocusedPane: true,
      lastPointerWindow: byId("side"),
      target: byId("composer"),
    };
    expect(claimsThreadFind({ ...args, isPrimary: true, root: mainRoot })).toBe(
      true,
    );
    expect(
      claimsThreadFind({ ...args, isPrimary: false, root: sideRoot }),
    ).toBe(false);
  });

  it("routes an unfocused document to the last clicked chat window", () => {
    const { byId, mainRoot, sideRoot } = windows();
    const args = {
      isFocusedPane: true,
      lastPointerWindow: byId("side"),
      target: document.body,
    };
    expect(
      claimsThreadFind({ ...args, isPrimary: false, root: sideRoot }),
    ).toBe(true);
    expect(claimsThreadFind({ ...args, isPrimary: true, root: mainRoot })).toBe(
      false,
    );
  });

  it("falls back to the primary chat of the focused pane", () => {
    const { byId, mainRoot, sideRoot } = windows();
    const detached = document.createElement("div");
    const outside = {
      lastPointerWindow: detached,
      target: byId("sidebar-button"),
    };
    expect(
      claimsThreadFind({
        ...outside,
        isFocusedPane: true,
        isPrimary: true,
        root: mainRoot,
      }),
    ).toBe(true);
    expect(
      claimsThreadFind({
        ...outside,
        isFocusedPane: false,
        isPrimary: true,
        root: mainRoot,
      }),
    ).toBe(false);
    expect(
      claimsThreadFind({
        ...outside,
        isFocusedPane: true,
        isPrimary: false,
        root: sideRoot,
      }),
    ).toBe(false);
  });
});
