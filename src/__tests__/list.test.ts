import { describe, it, expect, vi } from "vitest";
import { featureToFields, createList, ensureList } from "../list.js";
import type { Backlog, Feature, Score } from "../types.js";

vi.mock("../state.js", () => ({
  saveBacklog: vi.fn(),
}));

const mockSchema = [
  { key: "feature", id: "col_feature" },
  { key: "score", id: "col_score" },
  { key: "effort", id: "col_effort" },
  { key: "impact", id: "col_impact" },
  { key: "reach", id: "col_reach" },
  { key: "recurring", id: "col_recurring" },
  { key: "security", id: "col_security" },
  { key: "description", id: "col_description" },
  { key: "pros", id: "col_pros" },
  { key: "cons", id: "col_cons" },
];

function makeFeature(id: string, label: string): Feature {
  return {
    id,
    label,
    description: `Desc for ${label}`,
    dod: ["Done"],
    pros: ["Fast", "Reliable"],
    cons: ["Hard"],
    scores: {
      effort: 3 as Score,
      impact: 4 as Score,
      reach: 3 as Score,
      recurring: 2 as Score,
      security: 1 as Score,
    },
    totalScore: 12,
    createdBy: "U12345",
    updatedAt: "2026-04-08T00:00:00.000Z",
  };
}

describe("featureToFields", () => {
  it("produces correct field array with all columns", () => {
    const feature = makeFeature("dark-mode", "Dark Mode");
    const fields = featureToFields(feature, mockSchema);

    expect(fields).toHaveLength(10);
    expect(fields[0]).toEqual(
      expect.objectContaining({ column_id: "col_feature" }),
    );
    expect(fields[1]).toEqual(
      expect.objectContaining({ column_id: "col_score", number: [12] }),
    );
    expect(fields[2]).toEqual(
      expect.objectContaining({ column_id: "col_effort", select: ["3"] }),
    );
  });

  it("joins pros and cons with commas", () => {
    const feature = makeFeature("test", "Test");
    const fields = featureToFields(feature, mockSchema);

    const prosField = fields.find((f) => f.column_id === "col_pros");
    expect(prosField).toBeDefined();
    const richText = (prosField as unknown as Record<string, unknown>)["rich_text"] as Array<Record<string, unknown>>;
    const elements = richText[0]!["elements"] as Array<Record<string, unknown>>;
    const section = elements[0]!["elements"] as Array<Record<string, unknown>>;
    expect(section[0]!["text"]).toBe("Fast, Reliable");
  });

  it("throws when column key not found in schema", () => {
    const feature = makeFeature("test", "Test");
    expect(() => featureToFields(feature, [])).toThrow("Column not found");
  });
});

describe("createList", () => {
  it("calls slackLists.create with correct schema and grants channel access", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      list_id: "F_NEW_LIST",
      list_metadata: { schema: mockSchema },
    });
    const mockAccessSet = vi.fn().mockResolvedValue({ ok: true });
    const mockUpdate = vi.fn().mockResolvedValue({ ok: true });
    const mockClient = {
      slackLists: {
        create: mockCreate,
        update: mockUpdate,
        access: { set: mockAccessSet },
      },
    } as unknown as import("@slack/web-api").WebClient;

    const result = await createList(mockClient, "C_CHANNEL");

    expect(result.listId).toBe("F_NEW_LIST");
    expect(result.schema).toEqual(mockSchema);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Roadmap",
        schema: expect.arrayContaining([
          expect.objectContaining({ key: "feature", is_primary_column: true }),
          expect.objectContaining({ key: "score", type: "number" }),
          expect.objectContaining({ key: "effort", type: "select" }),
        ]),
      }),
    );
    expect(mockAccessSet).toHaveBeenCalledWith(
      expect.objectContaining({
        list_id: "F_NEW_LIST",
        channel_ids: ["C_CHANNEL"],
        access_level: "read",
      }),
    );
  });

  it("throws when no list_id returned", async () => {
    const mockClient = {
      slackLists: {
        create: vi.fn().mockResolvedValue({}),
        access: { set: vi.fn() },
      },
    } as unknown as import("@slack/web-api").WebClient;

    await expect(createList(mockClient, "C_CHANNEL")).rejects.toThrow(
      "no list_id returned",
    );
  });
});

describe("ensureList", () => {
  it("creates list on first run and syncs items", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      list_id: "F_NEW",
      list_metadata: { schema: mockSchema },
    });
    const mockItemCreate = vi.fn().mockResolvedValue({ item_id: "item_1" });
    const mockItemsList = vi.fn().mockResolvedValue({
      items: [],
      list: { list_metadata: { schema: mockSchema } },
    });
    const mockClient = {
      slackLists: {
        create: mockCreate,
        update: vi.fn().mockResolvedValue({ ok: true }),
        access: { set: vi.fn().mockResolvedValue({ ok: true }) },
        items: {
          create: mockItemCreate,
          list: mockItemsList,
          update: vi.fn(),
          delete: vi.fn(),
        },
      },
    } as unknown as import("@slack/web-api").WebClient;

    const backlog: Backlog = {
      features: [makeFeature("dark-mode", "Dark Mode")],
      lastUpdatedBy: "U12345",
      lastUpdatedAt: "2026-04-08T00:00:00.000Z",
    };

    await ensureList(mockClient, "C_CHANNEL", backlog);

    expect(backlog.listId).toBe("F_NEW");
    expect(mockCreate).toHaveBeenCalled();
    expect(mockItemCreate).toHaveBeenCalled();
  });

  it("skips create on subsequent runs and syncs items", async () => {
    const mockCreate = vi.fn();
    const mockItemsList = vi.fn().mockResolvedValue({
      items: [],
      list: { list_metadata: { schema: mockSchema } },
    });
    const mockItemCreate = vi.fn().mockResolvedValue({ item_id: "item_2" });
    const mockClient = {
      slackLists: {
        create: mockCreate,
        access: { set: vi.fn() },
        items: {
          create: mockItemCreate,
          list: mockItemsList,
          update: vi.fn(),
          delete: vi.fn(),
        },
      },
    } as unknown as import("@slack/web-api").WebClient;

    const backlog: Backlog = {
      features: [makeFeature("test", "Test")],
      listId: "F_EXISTING",
      lastUpdatedBy: "U12345",
      lastUpdatedAt: "2026-04-08T00:00:00.000Z",
    };

    await ensureList(mockClient, "C_CHANNEL", backlog);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockItemCreate).toHaveBeenCalled();
  });
});
