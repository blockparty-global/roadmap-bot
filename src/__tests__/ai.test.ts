import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { Backlog } from "../types.js";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = { create: mockCreate };
    },
  };
});

let interpretMessage: typeof import("../ai.js")["interpretMessage"];

beforeAll(async () => {
  const mod = await import("../ai.js");
  interpretMessage = mod.interpretMessage;
});

function makeResponse(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

const emptyBacklog: Backlog = {
  features: [],
  lastUpdatedBy: "",
  lastUpdatedAt: "",
};

beforeEach(() => {
  mockCreate.mockReset();
});

describe("interpretMessage", () => {
  it("parses a valid add action", async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse(
        JSON.stringify({
          action: "add",
          targetId: null,
          patch: null,
          newFeatures: [
            {
              label: "Dark Mode",
              description: "Add dark mode support",
              dod: ["Toggle works"],
              pros: ["Looks cool"],
              cons: ["Extra work"],
              scores: {
                effort: 4,
                impact: 3,
                reach: 4,
                recurring: 2,
                security: 1,
              },
              createdBy: "U12345",
            },
          ],
          humanSummary: "Add new feature: Dark Mode",
        }),
      ),
    );

    const result = await interpretMessage(
      "add dark mode",
      emptyBacklog,
      "U12345",
    );

    expect(result.action).toBe("add");
    expect(result.newFeatures).toHaveLength(1);
    expect(result.newFeatures![0]!.label).toBe("Dark Mode");
    expect(result.humanSummary).toBe("Add new feature: Dark Mode");
  });

  it("parses a valid update action", async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse(
        JSON.stringify({
          action: "update",
          targetId: "basic-balances",
          patch: { pros: ["Fast to ship", "Unblocks partners"] },
          newFeatures: null,
          humanSummary: "Update pros for Basic Balances",
        }),
      ),
    );

    const result = await interpretMessage(
      "add a pro to basic balances",
      emptyBacklog,
      "U12345",
    );

    expect(result.action).toBe("update");
    expect(result.targetId).toBe("basic-balances");
    expect(result.patch).toEqual({
      pros: ["Fast to ship", "Unblocks partners"],
    });
  });

  it("parses a valid delete action", async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse(
        JSON.stringify({
          action: "delete",
          targetId: "dark-mode",
          patch: null,
          newFeatures: null,
          humanSummary: "Remove Dark Mode from backlog",
        }),
      ),
    );

    const result = await interpretMessage(
      "remove dark mode",
      emptyBacklog,
      "U12345",
    );

    expect(result.action).toBe("delete");
    expect(result.targetId).toBe("dark-mode");
    expect(result.patch).toBeNull();
    expect(result.newFeatures).toBeNull();
  });

  it("parses a valid split action", async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse(
        JSON.stringify({
          action: "split",
          targetId: "full-balances",
          patch: null,
          newFeatures: [
            {
              label: "Balance Summary",
              description: "Quick balance overview",
              dod: ["Shows totals"],
              pros: ["Fast"],
              cons: ["Incomplete"],
              scores: {
                effort: 4,
                impact: 3,
                reach: 4,
                recurring: 3,
                security: 1,
              },
              createdBy: "U12345",
            },
            {
              label: "Balance Details",
              description: "Full transaction history",
              dod: ["Paginated list"],
              pros: ["Complete"],
              cons: ["Slow to build"],
              scores: {
                effort: 2,
                impact: 4,
                reach: 3,
                recurring: 3,
                security: 1,
              },
              createdBy: "U12345",
            },
          ],
          humanSummary:
            "Split Full Balances into Balance Summary and Balance Details",
        }),
      ),
    );

    const result = await interpretMessage(
      "split full balances into two",
      emptyBacklog,
      "U12345",
    );

    expect(result.action).toBe("split");
    expect(result.targetId).toBe("full-balances");
    expect(result.newFeatures).toHaveLength(2);
  });

  it("parses a clarify action for ambiguous requests", async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse(
        JSON.stringify({
          action: "clarify",
          targetId: null,
          patch: null,
          newFeatures: null,
          humanSummary:
            "I'm not sure what you mean. Could you specify which feature you want to change?",
        }),
      ),
    );

    const result = await interpretMessage(
      "change it",
      emptyBacklog,
      "U12345",
    );

    expect(result.action).toBe("clarify");
    expect(result.targetId).toBeNull();
    expect(result.humanSummary).toContain("not sure");
  });

  it("extracts JSON from markdown code fences", async () => {
    const json = JSON.stringify({
      action: "add",
      targetId: null,
      patch: null,
      newFeatures: [
        {
          label: "Test",
          description: "Test feature",
          dod: ["Done"],
          pros: ["Good"],
          cons: ["Bad"],
          scores: {
            effort: 3,
            impact: 3,
            reach: 3,
            recurring: 3,
            security: 3,
          },
          createdBy: "U12345",
        },
      ],
      humanSummary: "Add Test feature",
    });

    mockCreate.mockResolvedValueOnce(
      makeResponse("```json\n" + json + "\n```"),
    );

    const result = await interpretMessage(
      "add test",
      emptyBacklog,
      "U12345",
    );

    expect(result.action).toBe("add");
    expect(result.humanSummary).toBe("Add Test feature");
  });

  it("throws on malformed JSON response", async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse("This is not JSON at all"),
    );

    await expect(
      interpretMessage("add something", emptyBacklog, "U12345"),
    ).rejects.toThrow("Failed to parse JSON");
  });

  it("throws when humanSummary is missing", async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse(
        JSON.stringify({
          action: "add",
          targetId: null,
          patch: null,
          newFeatures: [],
        }),
      ),
    );

    await expect(
      interpretMessage("add something", emptyBacklog, "U12345"),
    ).rejects.toThrow("Missing or empty humanSummary");
  });

  it("throws on invalid action", async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse(
        JSON.stringify({
          action: "explode",
          targetId: null,
          patch: null,
          newFeatures: null,
          humanSummary: "Boom",
        }),
      ),
    );

    await expect(
      interpretMessage("do something weird", emptyBacklog, "U12345"),
    ).rejects.toThrow("Invalid action");
  });
});

// Integration test lives in ai.integration.test.ts (separate file, no mocks)
