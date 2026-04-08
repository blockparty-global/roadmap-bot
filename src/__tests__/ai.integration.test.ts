import { describe, it, expect } from "vitest";
import type { Backlog } from "../types.js";
import { interpretMessage } from "../ai.js";

const emptyBacklog: Backlog = {
  features: [],
  lastUpdatedBy: "",
  lastUpdatedAt: "",
};

describe.skipIf(!process.env.ANTHROPIC_API_KEY)(
  "interpretMessage (integration)",
  () => {
    it("sends a real request and gets a valid response", async () => {
      const result = await interpretMessage(
        "add a new feature: dark mode, low effort, high impact",
        emptyBacklog,
        "U_TEST",
      );

      expect(result.action).toBe("add");
      expect(result.humanSummary).toBeTruthy();
      expect(result.newFeatures).toBeTruthy();
    }, 30000);
  },
);
