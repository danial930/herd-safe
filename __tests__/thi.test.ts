import { describe, expect, it } from "vitest";
import { calculateTHI, categorizeTHI } from "@/lib/risk/thi";

describe("calculateTHI", () => {
  it("matches a known published input/output pair", () => {
    // THI = 1.8*25 + 32 - (0.55 - 0.0055*50) * (1.8*25 - 26) = 71.775
    expect(calculateTHI(25, 50)).toBeCloseTo(71.775, 2);
  });

  it("increases with humidity at a fixed temperature", () => {
    const low = calculateTHI(30, 30);
    const high = calculateTHI(30, 90);
    expect(high).toBeGreaterThan(low);
  });
});

describe("categorizeTHI", () => {
  it("classifies comfort below 72", () => {
    expect(categorizeTHI(71.9)).toBe("comfort");
  });
  it("classifies mild at the 72 boundary", () => {
    expect(categorizeTHI(72)).toBe("mild");
    expect(categorizeTHI(79.9)).toBe("mild");
  });
  it("classifies moderate at the 80 boundary", () => {
    expect(categorizeTHI(80)).toBe("moderate");
    expect(categorizeTHI(89.9)).toBe("moderate");
  });
  it("classifies severe at the 90 boundary", () => {
    expect(categorizeTHI(90)).toBe("severe");
    expect(categorizeTHI(100)).toBe("severe");
  });
});
