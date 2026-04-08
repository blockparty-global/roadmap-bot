import { describe, it, expect } from "vitest";
import { stripMention, applyChange } from "../index.js";
import type { Backlog, Feature, ProposedChange, Score } from "../types.js";

function makeScores() {
  return {
    effort: 3 as Score,
    impact: 4 as Score,
    reach: 3 as Score,
    recurring: 2 as Score,
    security: 1 as Score,
  };
}

function makeFeature(id: string, label: string): Feature {
  return {
    id,
    label,
    description: `Desc for ${label}`,
    dod: ["Done"],
    pros: ["Good"],
    cons: ["Hard"],
    scores: makeScores(),
    totalScore: 12,
    createdBy: "U12345",
    updatedAt: "2026-04-07T00:00:00.000Z",
  };
}

const emptyBacklog: Backlog = {
  features: [],
  lastUpdatedBy: "",
  lastUpdatedAt: "",
};

const backlogWithFeature: Backlog = {
  features: [makeFeature("dark-mode", "Dark Mode")],
  lastUpdatedBy: "U12345",
  lastUpdatedAt: "2026-04-07T00:00:00.000Z",
};

describe("stripMention", () => {
  it("removes a single bot mention", () => {
    expect(stripMention("<@U07ABC123> add dark mode")).toBe("add dark mode");
  });

  it("removes multiple mentions", () => {
    expect(stripMention("<@U07ABC123> hey <@U999> add dark mode")).toBe(
      "hey  add dark mode",
    );
  });

  it("handles text with no mention", () => {
    expect(stripMention("just a message")).toBe("just a message");
  });
});

describe("empty message handling", () => {
  it("stripMention returns empty string for mention-only text", () => {
    expect(stripMention("<@U0AR66Q716W>")).toBe("");
    expect(stripMention("<@U0AR66Q716W>  ")).toBe("");
  });
});

describe("applyChange", () => {
  it("adds features from newFeatures array", () => {
    const change: ProposedChange = {
      action: "add",
      targetId: null,
      patch: null,
      newFeatures: [
        {
          id: "",
          label: "Dark Mode",
          description: "Add dark mode",
          dod: ["Toggle works"],
          pros: ["Looks cool"],
          cons: ["Extra work"],
          scores: makeScores(),
          totalScore: 0,
          createdBy: "",
          updatedAt: "",
        },
      ],
      humanSummary: "Add Dark Mode",
    };

    const result = applyChange(emptyBacklog, change, "U12345");
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.label).toBe("Dark Mode");
    expect(result.lastUpdatedBy).toBe("U12345");
  });

  it("updates a feature with patch", () => {
    const change: ProposedChange = {
      action: "update",
      targetId: "dark-mode",
      patch: { description: "Updated description" },
      newFeatures: null,
      humanSummary: "Update Dark Mode description",
    };

    const result = applyChange(backlogWithFeature, change, "U12345");
    expect(result.features[0]!.description).toBe("Updated description");
  });

  it("deletes a feature by targetId", () => {
    const change: ProposedChange = {
      action: "delete",
      targetId: "dark-mode",
      patch: null,
      newFeatures: null,
      humanSummary: "Remove Dark Mode",
    };

    const result = applyChange(backlogWithFeature, change, "U12345");
    expect(result.features).toHaveLength(0);
  });

  it("splits a feature into multiple", () => {
    const change: ProposedChange = {
      action: "split",
      targetId: "dark-mode",
      patch: null,
      newFeatures: [
        {
          id: "",
          label: "Dark Mode UI",
          description: "UI changes",
          dod: ["Done"],
          pros: ["Good"],
          cons: ["Hard"],
          scores: makeScores(),
          totalScore: 0,
          createdBy: "",
          updatedAt: "",
        },
        {
          id: "",
          label: "Dark Mode Backend",
          description: "Backend changes",
          dod: ["Done"],
          pros: ["Good"],
          cons: ["Hard"],
          scores: makeScores(),
          totalScore: 0,
          createdBy: "",
          updatedAt: "",
        },
      ],
      humanSummary: "Split Dark Mode",
    };

    const result = applyChange(backlogWithFeature, change, "U12345");
    expect(result.features).toHaveLength(2);
    expect(result.features.find((f) => f.id === "dark-mode")).toBeUndefined();
  });

  it("sets lastUpdatedBy and lastUpdatedAt", () => {
    const change: ProposedChange = {
      action: "add",
      targetId: null,
      patch: null,
      newFeatures: [
        {
          id: "",
          label: "Test",
          description: "Test",
          dod: ["Done"],
          pros: ["Good"],
          cons: ["Bad"],
          scores: makeScores(),
          totalScore: 0,
          createdBy: "",
          updatedAt: "",
        },
      ],
      humanSummary: "Add Test",
    };

    const result = applyChange(emptyBacklog, change, "U99999");
    expect(result.lastUpdatedBy).toBe("U99999");
    expect(result.lastUpdatedAt).toBeTruthy();
  });

  it("returns backlog unchanged for clarify action", () => {
    const change: ProposedChange = {
      action: "clarify",
      targetId: null,
      patch: null,
      newFeatures: null,
      humanSummary: "Can you clarify?",
    };

    const result = applyChange(backlogWithFeature, change, "U12345");
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.id).toBe("dark-mode");
  });
});
