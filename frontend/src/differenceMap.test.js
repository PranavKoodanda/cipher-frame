import { describe, expect, it } from "vitest";
import { DIFFERENCE_AMPLIFICATIONS, differenceDisplayIntensity } from "./differenceMap";

describe("difference-map display amplification", () => {
  it("preserves actual differences while increasing display brightness", () => {
    const intensities = DIFFERENCE_AMPLIFICATIONS.map((factor) => differenceDisplayIntensity(1, factor));

    expect(intensities).toEqual([1, 10, 50]);
  });

  it("clips amplified display intensity at full red without changing the actual value", () => {
    expect(differenceDisplayIntensity(6, 50)).toBe(255);
    expect(differenceDisplayIntensity(255, 1)).toBe(255);
  });
});
