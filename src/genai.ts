/**
 * `gen_ai.*` attributes in Anthropic Messages API shape, bounded in size: long strings
 * truncated, thinking signatures dropped, images and documents replaced by markers.
 */
import { blocksOf, contentOf, truncate, type Row } from "./transcript.js";

const USAGE_KEYS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
// A generation's input stays under this so its span fits in one export request.
const MAX_INPUT_BYTES = 2 * 1024 * 1024;

/** The history as JSON; past MAX_INPUT_BYTES the oldest messages after the prompt become a note. */
function boundedHistoryJson(history: Row[]): string {
  const json = JSON.stringify(history);
  if (Buffer.byteLength(json) <= MAX_INPUT_BYTES || history.length < 2) {
    return json;
  }
  const sizes = history.map((m) => Buffer.byteLength(JSON.stringify(m)) + 1);
  let budget = MAX_INPUT_BYTES - sizes[0]! - 100;
  let keepFrom = history.length;
  while (keepFrom > 1 && sizes[keepFrom - 1]! <= budget) {
    budget -= sizes[--keepFrom]!;
  }
  const note = { role: "user", content: [{ type: "text", text: `[${keepFrom - 1} earlier messages omitted]` }] };
  return JSON.stringify([history[0], note, ...history.slice(keepFrom)]);
}

/** Truncate every string in a JSON value (tool inputs can carry whole files). */
function truncateStrings(value: any): any {
  if (typeof value === "string") {
    return truncate(value);
  }
  if (Array.isArray(value)) {
    return value.map(truncateStrings);
  }
  if (typeof value === "object" && value !== null) {
    const out: Row = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = truncateStrings(inner);
    }
    return out;
  }
  return value;
}

function toAnthropicBlock(block: any): Row | null {
  if (typeof block === "string") {
    return block ? { type: "text", text: truncate(block) } : null;
  }
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return null;
  }
  switch (block.type) {
    case "text":
      return block.text ? { type: "text", text: truncate(String(block.text)) } : null;
    case "thinking":
      // The signature is an opaque blob.
      return block.thinking ? { type: "thinking", thinking: truncate(String(block.thinking)) } : null;
    case "redacted_thinking":
      return { type: "redacted_thinking", data: "" };
    case "tool_use":
      return { type: "tool_use", id: String(block.id ?? ""), name: String(block.name ?? ""), input: truncateStrings(block.input ?? {}) };
    case "tool_result":
      return toolResultBlock(String(block.tool_use_id ?? ""), block.content, block.is_error === true);
    case "image":
      return { type: "text", text: "[image]" };
    case "document":
      return { type: "text", text: "[document]" };
    default:
      return truncateStrings(block) as Row;
  }
}

/** Convert a transcript row's content (a string or a block array) to Anthropic content blocks. */
export function toAnthropicContent(content: any): Row[] {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.map(toAnthropicBlock).filter((b): b is Row => b !== null);
}

export function toolResultBlock(toolUseId: string, content: any, isError: boolean): Row {
  const block: Row = {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: typeof content === "string" ? truncate(content) : toAnthropicContent(content ?? ""),
  };
  if (isError) {
    block.is_error = true;
  }
  return block;
}

/** A user row (the prompt, or context Claude Code injected) as a user message. */
export function buildUserMessage(userRow: Row): Row {
  return { role: "user", content: toAnthropicContent(contentOf(userRow)) };
}

/** One generation's attributes, its tool_use blocks, and the message to append to the history. */
export function buildGenerationAttributes(
  history: Row[],
  assistantMessage: Row,
  toolDefinitions: Row[] | null = null
): [Record<string, any>, Row[], Row] {
  const content = contentOf(assistantMessage);
  const toolUses = blocksOf(content, "tool_use");
  const outputMessage: Row = { role: "assistant", content: toAnthropicContent(content) };

  const model = assistantMessage.message?.model || "claude";
  const attrs: Record<string, any> = {
    "gen_ai.system": "anthropic",
    "gen_ai.request.model": model,
    "gen_ai.response.model": model,
    "gen_ai.input.messages": boundedHistoryJson(history),
  };
  if (toolDefinitions !== null && toolDefinitions.length > 0) {
    attrs["gen_ai.tool.definitions"] = JSON.stringify(toolDefinitions);
  }

  const stopReason = assistantMessage.message?.stop_reason;
  attrs["gen_ai.output.messages"] = JSON.stringify([
    typeof stopReason === "string" ? { ...outputMessage, stop_reason: stopReason } : outputMessage,
  ]);

  const usage = assistantMessage.message?.usage ?? {};
  let total = 0;
  for (const key of USAGE_KEYS) {
    const value = usage[key];
    if (Number.isInteger(value) && value > 0) {
      attrs[`gen_ai.usage.${key}`] = value;
      total += value;
    }
  }
  if (total > 0) {
    attrs["llm.usage.total_tokens"] = total;
  }

  return [attrs, toolUses, outputMessage];
}
