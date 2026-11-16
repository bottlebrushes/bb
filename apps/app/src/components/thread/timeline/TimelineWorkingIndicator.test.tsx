// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineWorkingIndicator } from "./TimelineWorkingIndicator";

afterEach(() => {
  cleanup();
});

describe("TimelineWorkingIndicator", () => {
  it("renders the machine wait as a yellow pulsing Power indicator", () => {
    const { container } = render(<TimelineWorkingIndicator waitingForHost />);

    expect(screen.getByText("Waiting for machine to resume…")).toBeTruthy();
    const icon = container.querySelector('[data-icon="Power"]');
    expect(icon).not.toBeNull();
    expect(Array.from(icon?.classList ?? [])).toContain("animate-shine-icon");
    expect(Array.from(icon?.classList ?? [])).toContain("text-yellow-600");
  });
});
