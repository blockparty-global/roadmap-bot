import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadBacklog,
  saveBacklog,
  generateId,
  calculateTotalScore,
  addFeature,
  updateFeature,
  deleteFeature,
  splitFeature,
} from "../state.js";
import type { Backlog, Feature, FeatureScores, Score } from "../types.js";

function makeTmpPath(): string {
  return path.join(os.tmpdir(), `backlog-test-${Date.now()}.json`);
}

function makeScores(overrides?: Partial<FeatureScores>): FeatureScores {
  return {
    effort: 3 as Score,
    impact: 4 as Score,
    reach: 3 as Score,
    recurring: 2 as Score,
    security: 1 as Score,
    ...overrides,
  };
}

function makeFeatureInput(
  label: string,
  overrides?: Partial<Omit<Feature, "id" | "totalScore" | "updatedAt">>,
) {
  return {
    label,
    description: `Description for ${label}`,
    dod: ["Done when shipped"],
    pros: ["It's good"],
    cons: ["It's hard"],
    scores: makeScores(),
    createdBy: "U12345",
    ...overrides,
  };
}

describe("loadBacklog", () => {
  it("returns empty backlog when file does not exist", () => {
    const backlog = loadBacklog("/tmp/nonexistent-file-xyz.json");
    expect(backlog.features).toEqual([]);
    expect(backlog.lastUpdatedBy).toBe("");
    expect(backlog.lastUpdatedAt).toBe("");
  });
});

describe("saveBacklog + loadBacklog", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  });

  it("round-trips backlog data through save and load", () => {
    const backlog: Backlog = {
      features: [
        {
          id: "basic-balances",
          label: "Basic Balances",
          description: "Show account balances",
          dod: ["API returns balances"],
          pros: ["Fast to ship"],
          cons: ["No pagination"],
          scores: makeScores(),
          totalScore: 12,
          createdBy: "U12345",
          updatedAt: "2026-04-06T00:00:00.000Z",
        },
      ],
      lastUpdatedBy: "U12345",
      lastUpdatedAt: "2026-04-06T00:00:00.000Z",
    };

    saveBacklog(backlog, tmpPath);
    const loaded = loadBacklog(tmpPath);

    expect(loaded).toEqual(backlog);
  });
});

describe("generateId", () => {
  it("slugifies a label to lowercase kebab-case", () => {
    const id = generateId("Basic Balances", new Set());
    expect(id).toBe("basic-balances");
  });

  it("appends numeric suffix on collision", () => {
    const existing = new Set(["basic-balances"]);
    const id = generateId("Basic Balances", existing);
    expect(id).toBe("basic-balances-2");
  });

  it("increments suffix until unique", () => {
    const existing = new Set(["dark-mode", "dark-mode-2", "dark-mode-3"]);
    const id = generateId("Dark Mode", existing);
    expect(id).toBe("dark-mode-4");
  });
});

describe("calculateTotalScore", () => {
  it("returns effort * impact", () => {
    const scores = makeScores({ effort: 3 as Score, impact: 4 as Score });
    expect(calculateTotalScore(scores)).toBe(12);
  });

  it("handles edge case of all 1s", () => {
    const scores = makeScores({ effort: 1 as Score, impact: 1 as Score });
    expect(calculateTotalScore(scores)).toBe(1);
  });
});

describe("addFeature", () => {
  it("adds a feature with auto-generated id and totalScore", () => {
    const backlog: Backlog = {
      features: [],
      lastUpdatedBy: "",
      lastUpdatedAt: "",
    };

    const result = addFeature(backlog, makeFeatureInput("Basic Balances"));

    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.id).toBe("basic-balances");
    expect(result.features[0]!.totalScore).toBe(12);
    expect(result.features[0]!.updatedAt).toBeTruthy();
  });

  it("generates unique id when duplicate label exists", () => {
    let backlog: Backlog = {
      features: [],
      lastUpdatedBy: "",
      lastUpdatedAt: "",
    };

    backlog = addFeature(backlog, makeFeatureInput("Dark Mode"));
    backlog = addFeature(backlog, makeFeatureInput("Dark Mode"));

    expect(backlog.features).toHaveLength(2);
    expect(backlog.features[0]!.id).toBe("dark-mode");
    expect(backlog.features[1]!.id).toBe("dark-mode-2");
  });

  it("does not mutate the original backlog", () => {
    const backlog: Backlog = {
      features: [],
      lastUpdatedBy: "",
      lastUpdatedAt: "",
    };

    addFeature(backlog, makeFeatureInput("Test"));
    expect(backlog.features).toHaveLength(0);
  });
});

describe("updateFeature", () => {
  const baseBacklog: Backlog = {
    features: [
      {
        id: "basic-balances",
        label: "Basic Balances",
        description: "Show balances",
        dod: ["Done"],
        pros: ["Fast"],
        cons: ["Limited"],
        scores: makeScores(),
        totalScore: 12,
        createdBy: "U12345",
        updatedAt: "2026-04-06T00:00:00.000Z",
      },
    ],
    lastUpdatedBy: "U12345",
    lastUpdatedAt: "2026-04-06T00:00:00.000Z",
  };

  it("merges patch into existing feature", () => {
    const result = updateFeature(baseBacklog, "basic-balances", {
      description: "Show all balances",
      pros: ["Fast", "Reliable"],
    });

    expect(result.features[0]!.description).toBe("Show all balances");
    expect(result.features[0]!.pros).toEqual(["Fast", "Reliable"]);
    expect(result.features[0]!.label).toBe("Basic Balances");
  });

  it("recalculates totalScore when scores change", () => {
    const result = updateFeature(baseBacklog, "basic-balances", {
      scores: makeScores({ effort: 5 as Score, impact: 5 as Score }),
    });

    expect(result.features[0]!.totalScore).toBe(25);
  });

  it("throws when targetId not found", () => {
    expect(() => {
      updateFeature(baseBacklog, "nonexistent", { description: "New" });
    }).toThrow("Feature not found: nonexistent");
  });
});

describe("deleteFeature", () => {
  const baseBacklog: Backlog = {
    features: [
      {
        id: "basic-balances",
        label: "Basic Balances",
        description: "Show balances",
        dod: ["Done"],
        pros: ["Fast"],
        cons: ["Limited"],
        scores: makeScores(),
        totalScore: 12,
        createdBy: "U12345",
        updatedAt: "2026-04-06T00:00:00.000Z",
      },
    ],
    lastUpdatedBy: "U12345",
    lastUpdatedAt: "2026-04-06T00:00:00.000Z",
  };

  it("removes feature by id", () => {
    const result = deleteFeature(baseBacklog, "basic-balances");
    expect(result.features).toHaveLength(0);
  });

  it("throws when targetId not found", () => {
    expect(() => {
      deleteFeature(baseBacklog, "nonexistent");
    }).toThrow("Feature not found: nonexistent");
  });
});

describe("splitFeature", () => {
  const baseBacklog: Backlog = {
    features: [
      {
        id: "full-balances",
        label: "Full Balances",
        description: "Complete balance view",
        dod: ["Done"],
        pros: ["Complete"],
        cons: ["Takes long"],
        scores: makeScores({ effort: 2 as Score, impact: 5 as Score }),
        totalScore: 10,
        createdBy: "U12345",
        updatedAt: "2026-04-06T00:00:00.000Z",
      },
    ],
    lastUpdatedBy: "U12345",
    lastUpdatedAt: "2026-04-06T00:00:00.000Z",
  };

  it("removes target and adds new features with splitOf set", () => {
    const result = splitFeature(baseBacklog, "full-balances", [
      makeFeatureInput("Balance Summary"),
      makeFeatureInput("Balance Details"),
    ]);

    expect(result.features).toHaveLength(2);
    expect(result.features.find((f) => f.id === "full-balances")).toBeUndefined();

    const summary = result.features.find((f) => f.id === "balance-summary");
    const details = result.features.find((f) => f.id === "balance-details");

    expect(summary).toBeDefined();
    expect(details).toBeDefined();
    expect(summary!.splitOf).toBe("full-balances");
    expect(details!.splitOf).toBe("full-balances");
  });

  it("throws when targetId not found", () => {
    expect(() => {
      splitFeature(baseBacklog, "nonexistent", [
        makeFeatureInput("Part A"),
      ]);
    }).toThrow("Feature not found: nonexistent");
  });
});
