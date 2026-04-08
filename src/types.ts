export type Score = 1 | 2 | 3 | 4 | 5;

export type FeatureScores = {
  effort: Score;
  impact: Score;
  reach: Score;
  recurring: Score;
  security: Score;
};

export type Feature = {
  id: string;
  label: string;
  description: string;
  dod: string[];
  pros: string[];
  cons: string[];
  scores: FeatureScores;
  totalScore: number;
  splitOf?: string;
  createdBy: string;
  updatedAt: string;
};

export type Backlog = {
  features: Feature[];
  canvasId?: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
};

export type Action = "add" | "update" | "delete" | "split" | "clarify";

export type ProposedChange = {
  action: Action;
  targetId: string | null;
  patch: Partial<Feature> | null;
  newFeatures: Feature[] | null;
  humanSummary: string;
};
