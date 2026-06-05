import { describe, it, expect } from "vitest";
import { classifyHeuristic } from "../../src/notes/capture.js";

describe("capture", () => {
  describe("classifyHeuristic", () => {
    it("returns prompt category by default", () => {
      const result = classifyHeuristic("Generate ADRs for decisions");
      expect(result.category).toBe("prompt");
      expect(result.title).toBe("Generate ADRs for decisions");
      expect(result.content).toBe("Generate ADRs for decisions");
    });

    it("truncates long titles to 50 chars", () => {
      const longText = "a".repeat(100);
      const result = classifyHeuristic(longText);
      expect(result.title.length).toBeLessThanOrEqual(50);
      expect(result.title.endsWith("...")).toBe(true);
    });

    it("preserves short text as-is", () => {
      const result = classifyHeuristic("Quick note");
      expect(result.title).toBe("Quick note");
    });
  });
});
