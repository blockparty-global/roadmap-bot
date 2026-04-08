import fs from "node:fs";
import slugify from "slugify";
import type { Backlog, Feature, FeatureScores } from "./types.js";

const DEFAULT_PATH = process.env.BACKLOG_PATH ?? "./backlog.json";

function emptyBacklog(): Backlog {
  return {
    features: [],
    lastUpdatedBy: "",
    lastUpdatedAt: "",
  };
}

export function loadBacklog(path: string = DEFAULT_PATH): Backlog {
  try {
    const raw = fs.readFileSync(path, "utf-8");
    return JSON.parse(raw) as Backlog;
  } catch {
    return emptyBacklog();
  }
}

export function saveBacklog(
  backlog: Backlog,
  path: string = DEFAULT_PATH,
): void {
  fs.writeFileSync(path, JSON.stringify(backlog, null, 2), "utf-8");
}

export function generateId(label: string, existingIds: Set<string>): string {
  const base = slugify(label, { lower: true, strict: true });
  if (!existingIds.has(base)) return base;

  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix++;
  }
  return `${base}-${suffix}`;
}

export function calculateTotalScore(scores: FeatureScores): number {
  return scores.effort * scores.impact;
}

export function addFeature(
  backlog: Backlog,
  feature: Omit<Feature, "id" | "totalScore" | "updatedAt">,
): Backlog {
  const existingIds = new Set(backlog.features.map((f) => f.id));
  const id = generateId(feature.label, existingIds);
  const totalScore = calculateTotalScore(feature.scores);

  const newFeature: Feature = {
    ...feature,
    id,
    totalScore,
    updatedAt: new Date().toISOString(),
  };

  return {
    ...backlog,
    features: [...backlog.features, newFeature],
  };
}

export function updateFeature(
  backlog: Backlog,
  targetId: string,
  patch: Partial<Feature>,
): Backlog {
  const index = backlog.features.findIndex((f) => f.id === targetId);
  if (index === -1) {
    throw new Error(`Feature not found: ${targetId}`);
  }

  const existing = backlog.features[index]!;
  const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };

  if (patch.scores) {
    merged.totalScore = calculateTotalScore(merged.scores);
  }

  const features = [...backlog.features];
  features[index] = merged;

  return { ...backlog, features };
}

export function deleteFeature(backlog: Backlog, targetId: string): Backlog {
  const index = backlog.features.findIndex((f) => f.id === targetId);
  if (index === -1) {
    throw new Error(`Feature not found: ${targetId}`);
  }

  return {
    ...backlog,
    features: backlog.features.filter((f) => f.id !== targetId),
  };
}

export function splitFeature(
  backlog: Backlog,
  targetId: string,
  newFeatures: Omit<Feature, "id" | "totalScore" | "updatedAt" | "splitOf">[],
): Backlog {
  const index = backlog.features.findIndex((f) => f.id === targetId);
  if (index === -1) {
    throw new Error(`Feature not found: ${targetId}`);
  }

  const remaining = backlog.features.filter((f) => f.id !== targetId);
  const existingIds = new Set(remaining.map((f) => f.id));

  const created: Feature[] = newFeatures.map((f) => {
    const id = generateId(f.label, existingIds);
    existingIds.add(id);
    return {
      ...f,
      id,
      totalScore: calculateTotalScore(f.scores),
      splitOf: targetId,
      updatedAt: new Date().toISOString(),
    };
  });

  return {
    ...backlog,
    features: [...remaining, ...created],
  };
}
