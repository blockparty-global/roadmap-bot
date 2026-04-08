import { describe, it, expect, vi } from "vitest";
import { renderMarkdown, ensureCanvas } from "../canvas.js";
import type { Backlog, Feature, Score } from "../types.js";

vi.mock("../state.js", () => ({
  saveBacklog: vi.fn(),
}));

function makeScores(effort: Score = 3, impact: Score = 4) {
  return {
    effort,
    impact,
    reach: 3 as Score,
    recurring: 2 as Score,
    security: 1 as Score,
  };
}

function makeFeature(
  id: string,
  label: string,
  effort: Score = 3,
  impact: Score = 4,
): Feature {
  return {
    id,
    label,
    description: `Desc for ${label}`,
    dod: ["Done"],
    pros: ["Fast to ship", "Unblocks partners"],
    cons: ["No pagination"],
    scores: makeScores(effort, impact),
    totalScore: effort * impact,
    createdBy: "U12345",
    updatedAt: "2026-04-07T00:00:00.000Z",
  };
}

describe("renderMarkdown", () => {
  it("renders a single feature as a table row", () => {
    const backlog: Backlog = {
      features: [makeFeature("basic-balances", "Basic Balances")],
      lastUpdatedBy: "U12345",
      lastUpdatedAt: "2026-04-07T00:00:00.000Z",
    };

    const md = renderMarkdown(backlog);
    expect(md).toContain("# Roadmap");
    expect(md).toContain("Basic Balances");
    expect(md).toContain("**12**");
    expect(md).toContain("3/4/3/2/1");
    expect(md).toContain("E/I/R/C/S = Effort / Impact / Reach / Recurring / Security");
    expect(md).not.toContain("Pros");
    expect(md).not.toContain("Cons");
  });

  it("sorts features by totalScore descending", () => {
    const backlog: Backlog = {
      features: [
        makeFeature("low", "Low Score", 1 as Score, 2 as Score),
        makeFeature("high", "High Score", 5 as Score, 5 as Score),
        makeFeature("mid", "Mid Score", 3 as Score, 3 as Score),
      ],
      lastUpdatedBy: "U12345",
      lastUpdatedAt: "2026-04-07T00:00:00.000Z",
    };

    const md = renderMarkdown(backlog);
    const highPos = md.indexOf("High Score");
    const midPos = md.indexOf("Mid Score");
    const lowPos = md.indexOf("Low Score");

    expect(highPos).toBeLessThan(midPos);
    expect(midPos).toBeLessThan(lowPos);
  });

  it("renders empty backlog message", () => {
    const backlog: Backlog = {
      features: [],
      lastUpdatedBy: "",
      lastUpdatedAt: "",
    };

    const md = renderMarkdown(backlog);
    expect(md).toContain("No features yet");
  });

  it("renders a row for each feature", () => {
    const backlog: Backlog = {
      features: [
        makeFeature("a", "Feature A", 5 as Score, 5 as Score),
        makeFeature("b", "Feature B", 3 as Score, 3 as Score),
      ],
      lastUpdatedBy: "U12345",
      lastUpdatedAt: "2026-04-07T00:00:00.000Z",
    };

    const md = renderMarkdown(backlog);
    expect(md).toContain("Feature A");
    expect(md).toContain("Feature B");
    const dataRows = md.split("\n").filter((l) => l.startsWith("|") && l.includes("**"));
    expect(dataRows).toHaveLength(2);
  });

  it("includes combined score column", () => {
    const feature = makeFeature("test", "Test", 5 as Score, 4 as Score);

    const backlog: Backlog = {
      features: [feature],
      lastUpdatedBy: "U12345",
      lastUpdatedAt: "2026-04-07T00:00:00.000Z",
    };

    const md = renderMarkdown(backlog);
    expect(md).toContain("5/4/3/2/1");
    expect(md).toContain("**20**");
  });
});

describe("ensureCanvas", () => {
  it("creates a canvas when no canvasId exists", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ canvas_id: "F_NEW_123" });
    const mockClient = {
      conversations: { canvases: { create: mockCreate } },
      canvases: { edit: vi.fn() },
    } as unknown as import("@slack/web-api").WebClient;

    const backlog: Backlog = {
      features: [makeFeature("test", "Test")],
      lastUpdatedBy: "U12345",
      lastUpdatedAt: "2026-04-07T00:00:00.000Z",
    };

    const canvasId = await ensureCanvas(mockClient, "C123", backlog);

    expect(canvasId).toBe("F_NEW_123");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: "C123",
        document_content: expect.objectContaining({ type: "markdown" }),
      }),
    );
  });

  it("updates existing canvas when canvasId is set", async () => {
    const mockEdit = vi.fn().mockResolvedValue({ ok: true });
    const mockClient = {
      conversations: { canvases: { create: vi.fn() } },
      canvases: { edit: mockEdit },
    } as unknown as import("@slack/web-api").WebClient;

    const backlog: Backlog = {
      features: [makeFeature("test", "Test")],
      canvasId: "F_EXISTING_456",
      lastUpdatedBy: "U12345",
      lastUpdatedAt: "2026-04-07T00:00:00.000Z",
    };

    const canvasId = await ensureCanvas(mockClient, "C123", backlog);

    expect(canvasId).toBe("F_EXISTING_456");
    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas_id: "F_EXISTING_456",
        changes: expect.arrayContaining([
          expect.objectContaining({ operation: "replace" }),
        ]),
      }),
    );
  });

  it("recovers from stale canvasId by creating a new canvas", async () => {
    const mockEdit = vi.fn().mockRejectedValue(new Error("canvas_not_found"));
    const mockCreate = vi.fn().mockResolvedValue({ canvas_id: "F_NEW_789" });
    const mockClient = {
      conversations: { canvases: { create: mockCreate } },
      canvases: { edit: mockEdit },
    } as unknown as import("@slack/web-api").WebClient;

    const backlog: Backlog = {
      features: [makeFeature("test", "Test")],
      canvasId: "F_STALE_ID",
      lastUpdatedBy: "U12345",
      lastUpdatedAt: "2026-04-07T00:00:00.000Z",
    };

    const canvasId = await ensureCanvas(mockClient, "C123", backlog);

    expect(mockEdit).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
    expect(canvasId).toBe("F_NEW_789");
    expect(backlog.canvasId).toBe("F_NEW_789");
  });

  it("throws when canvas creation returns no id", async () => {
    const mockCreate = vi.fn().mockResolvedValue({});
    const mockClient = {
      conversations: { canvases: { create: mockCreate } },
      canvases: { edit: vi.fn() },
    } as unknown as import("@slack/web-api").WebClient;

    const backlog: Backlog = {
      features: [],
      lastUpdatedBy: "",
      lastUpdatedAt: "",
    };

    await expect(
      ensureCanvas(mockClient, "C123", backlog),
    ).rejects.toThrow("no canvas_id returned");
  });
});
