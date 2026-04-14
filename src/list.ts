import type { WebClient } from "@slack/web-api";
import type {
  SlackListsSchemaColumn,
  SlackListsItemField,
} from "@slack/web-api/dist/types/request/slackLists";
import type { Backlog, Feature } from "./types.js";
import { saveBacklog } from "./state.js";

const SCORE_COLORS: Record<number, string> = {
  1: "red",
  2: "orange",
  3: "yellow",
  4: "green",
  5: "blue",
};

function scoreChoices() {
  return [1, 2, 3, 4, 5].map((n) => ({
    value: String(n),
    label: String(n),
    color: SCORE_COLORS[n] ?? "#999999",
  }));
}

function scoreColumn(key: string, name: string): SlackListsSchemaColumn {
  return {
    key,
    name,
    type: "select",
    options: { format: "single_select", choices: scoreChoices() },
  };
}

const LIST_SCHEMA: SlackListsSchemaColumn[] = [
  { key: "feature", name: "Feature", type: "text", is_primary_column: true },
  { key: "score", name: "Score", type: "number", options: { precision: 0 } },
  scoreColumn("effort", "Effort"),
  scoreColumn("impact", "Impact"),
  scoreColumn("reach", "Reach"),
  scoreColumn("recurring", "Recurring"),
  scoreColumn("security", "Security"),
  { key: "description", name: "Description", type: "text" },
  { key: "pros", name: "Pros", type: "text" },
  { key: "cons", name: "Cons", type: "text" },
];

function textField(columnId: string, text: string): SlackListsItemField {
  return {
    column_id: columnId,
    rich_text: [
      {
        type: "rich_text",
        block_id: columnId,
        elements: [
          { type: "rich_text_section", elements: [{ type: "text", text }] },
        ],
      },
    ],
  } as SlackListsItemField;
}

function numberField(columnId: string, value: number): SlackListsItemField {
  return { column_id: columnId, number: [value] } as SlackListsItemField;
}

function selectField(columnId: string, value: number): SlackListsItemField {
  return { column_id: columnId, select: [String(value)] } as SlackListsItemField;
}

export function featureToFields(
  feature: Feature,
  schema: { key: string; id: string }[],
): SlackListsItemField[] {
  const col = (key: string) => {
    const found = schema.find((c) => c.key === key);
    if (!found) throw new Error(`Column not found: ${key}`);
    return found.id;
  };

  return [
    textField(col("feature"), feature.label),
    numberField(col("score"), feature.totalScore),
    selectField(col("effort"), feature.scores.effort),
    selectField(col("impact"), feature.scores.impact),
    selectField(col("reach"), feature.scores.reach),
    selectField(col("recurring"), feature.scores.recurring),
    selectField(col("security"), feature.scores.security),
    textField(col("description"), feature.description),
    textField(col("pros"), feature.pros.join(", ")),
    textField(col("cons"), feature.cons.join(", ")),
  ];
}

function scoreReferenceBlocks(): import("@slack/types").RichTextBlock[] {
  return [
    {
      type: "rich_text",
      block_id: "score_ref",
      elements: [
        {
          type: "rich_text_section",
          elements: [
            { type: "text", text: "Score = Effort x Impact", style: { bold: true } },
            { type: "text", text: " (higher is better). Each point is an order of magnitude.\n\n" },
            { type: "text", text: "5", style: { bold: true } },
            { type: "text", text: " Effort: 1 hour | Impact: Transformative | Reach: Everyone | Recurring: Hourly | Security: Critical\n" },
            { type: "text", text: "4", style: { bold: true } },
            { type: "text", text: " Effort: 1 day | Impact: Great | Reach: Majority | Recurring: Daily | Security: High\n" },
            { type: "text", text: "3", style: { bold: true } },
            { type: "text", text: " Effort: 1 week | Impact: Good | Reach: Minority | Recurring: Weekly | Security: Moderate\n" },
            { type: "text", text: "2", style: { bold: true } },
            { type: "text", text: " Effort: 1 month | Impact: Minimal | Reach: Few | Recurring: Monthly | Security: Low\n" },
            { type: "text", text: "1", style: { bold: true } },
            { type: "text", text: " Effort: 1 quarter | Impact: None | Reach: One | Recurring: Quarterly | Security: None" },
          ],
        },
      ],
    },
  ];
}

async function updateListDescription(
  client: WebClient,
  listId: string,
): Promise<void> {
  await client.slackLists.update({
    id: listId,
    description_blocks: scoreReferenceBlocks(),
  });
}

export async function createList(
  client: WebClient,
  channelId: string,
): Promise<{ listId: string; schema: { key: string; id: string }[] }> {
  const result = await client.slackLists.create({
    name: "Roadmap",
    schema: LIST_SCHEMA,
  });

  const res = result as unknown as Record<string, unknown>;
  const listId = res["list_id"] as string | undefined;
  const metadata = res["list_metadata"] as Record<string, unknown> | undefined;
  const schemaResponse = (metadata?.["schema"] ?? []) as {
    key: string;
    id: string;
  }[];

  if (!listId) {
    throw new Error("List creation succeeded but no list_id returned");
  }

  await client.slackLists.access.set({
    list_id: listId,
    channel_ids: [channelId],
    access_level: "read",
  });

  await updateListDescription(client, listId);
  console.log(`[list] created list ${listId}, granted read access to channel`);
  return { listId, schema: schemaResponse };
}

async function getSchema(
  client: WebClient,
  listId: string,
): Promise<{ key: string; id: string }[]> {
  const result = await client.slackLists.items.list({
    list_id: listId,
    limit: 1,
  });

  const res = result as unknown as Record<string, unknown>;
  const metadata = res["list_metadata"] as Record<string, unknown> | undefined;
  if (metadata?.["schema"]) {
    return metadata["schema"] as { key: string; id: string }[];
  }
  const listObj = res["list"] as Record<string, unknown> | undefined;
  const listMeta = listObj?.["list_metadata"] as Record<string, unknown> | undefined;
  return (listMeta?.["schema"] ?? []) as { key: string; id: string }[];
}

export async function syncListItems(
  client: WebClient,
  listId: string,
  backlog: Backlog,
  schema: { key: string; id: string }[],
): Promise<void> {
  const itemMap = backlog.listItemMap ?? {};

  const featureIds = new Set(backlog.features.map((f) => f.id));

  // Delete items for removed features
  for (const [featureId, itemId] of Object.entries(itemMap)) {
    if (!featureIds.has(featureId)) {
      await client.slackLists.items.delete({ list_id: listId, id: itemId });
      delete itemMap[featureId];
      console.log(`[list] deleted item for removed feature: ${featureId}`);
    }
  }

  // Add or update items for current features
  for (const feature of backlog.features) {
    const fields = featureToFields(feature, schema);
    const existingItemId = itemMap[feature.id];

    if (existingItemId) {
      const cells = fields.map((f) => ({ ...f, row_id: existingItemId }));
      await client.slackLists.items.update({ list_id: listId, cells });
    } else {
      const result = await client.slackLists.items.create({
        list_id: listId,
        initial_fields: fields,
      });
      const res = result as unknown as Record<string, unknown>;
      const item = res["item"] as Record<string, unknown> | undefined;
      const newItemId = (item?.["id"] as string) ?? (res["item_id"] as string);
      if (newItemId) {
        itemMap[feature.id] = newItemId;
      }
      console.log(`[list] added item for feature: ${feature.id}`);
    }
  }

  backlog.listItemMap = itemMap;
  saveBacklog(backlog);
}

export async function ensureList(
  client: WebClient,
  channelId: string,
  backlog: Backlog,
): Promise<void> {
  let listId = backlog.listId;
  let schema: { key: string; id: string }[];

  if (!listId) {
    const created = await createList(client, channelId);
    listId = created.listId;
    schema = created.schema;
    backlog.listId = listId;
    saveBacklog(backlog);
  } else {
    schema = await getSchema(client, listId);
  }

  await syncListItems(client, listId, backlog, schema);
}
