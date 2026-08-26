import { describe, expect, it } from "vitest";
import { calculateWorkerComfort } from "@/lib/risk/workerComfort";

describe("calculateWorkerComfort", () => {
  it("is good with comfort heat and good air quality", () => {
    expect(calculateWorkerComfort("comfort", 20)).toBe("good");
  });

  it("is suitable with mild heat and moderate air quality", () => {
    expect(calculateWorkerComfort("mild", 75)).toBe("suitable");
  });

  it("is bad with moderate heat regardless of air quality", () => {
    expect(calculateWorkerComfort("moderate", 10)).toBe("bad");
  });

  it("is bad with unhealthy-for-sensitive air quality regardless of heat", () => {
    expect(calculateWorkerComfort("comfort", 120)).toBe("bad");
  });

  it("is intolerable with severe heat regardless of air quality", () => {
    expect(calculateWorkerComfort("severe", 10)).toBe("intolerable");
  });

  it("is intolerable with hazardous air quality regardless of heat", () => {
    expect(calculateWorkerComfort("comfort", 200)).toBe("intolerable");
  });

  it("falls through to good for mild heat with good air quality (AND row not met)", () => {
    expect(calculateWorkerComfort("mild", 30)).toBe("good");
  });
});
