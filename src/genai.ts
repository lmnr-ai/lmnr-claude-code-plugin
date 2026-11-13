/**
 * Translation of Claude Code transcript content into the `gen_ai.*` span
 * attributes Laminar ingests. This module owns the wire-format contract
 * (message shapes, usage keys) and nothing about span timing or emission
 * ordering — that stays in the renderer.
 *
 * Messages keep the Anthropic Messages API shape, which is what the transcript
 * already holds and what Laminar's trace view renders natively: an assistant
 * message carries text / thinking / tool_use blocks, and tool results go back
 * as tool_result blocks in the next user message. The only changes are size
 * bounds: strings are truncated to MAX_CHARS, thinking signatures and
 * redacted-thinking payloads are dropped, and images and documents become
 * short text markers.
 */
import { getContentFromRow, getModel, getToolUseBlocks, getUsageDetailsFromRow, truncateText } from "./transcript.js";
import type { Json, Row } from "./types.js";
import { jsonDumps } from "./util.js";

/** A tool result ready to fold into the next generation's input messages. */
export interface GenerationToolResult {
  toolUseId: string;
  // Raw tool_result content from the transcript: a string or a block array.
  content: Json;
  isError?: boolean;
}

/** Truncate every string in a JSON value (tool inputs can carry whole files). */
function truncateStrings(value: Json): Json {
  if (typeof value === "string") {
    return truncateText(value)[0];
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

function toAnthropicBlock(block: Json): Row | null {
  if (typeof block === "string") {
    return block ? { type: "text", text: truncateText(block)[0] } : null;
  }
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return null;
  }
  switch (block.type) {
    case "text":
      return block.text ? { type: "text", text: truncateText(String(block.text))[0] } : null;
    case "thinking":
      // The signature is an opaque verification blob; it says nothing to a reader.
      return block.thinking ? { type: "thinking", thinking: truncateText(String(block.thinking))[0] } : null;
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
export function toAnthropicContent(content: Json): Row[] {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.map(toAnthropicBlock).filter((b): b is Row => b !== null);
}

function toolResultBlock(toolUseId: string, content: Json, isError: boolean): Row {
  const block: Row = {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: typeof content === "string" ? truncateText(content)[0] : toAnthropicContent(content ?? ""),
  };
  if (isError) {
    block.is_error = true;
  }
  return block;
}

/** The user message that opens a turn. */
export function buildUserMessage(userRow: Row): Row {
  return { role: "user", content: toAnthropicContent(getContentFromRow(userRow)) };
}

/** The user message that hands a batch of tool results back to the model. */
export function buildToolResultMessage(toolResults: GenerationToolResult[]): Row {
  return {
    role: "user",
    content: toolResults.map((r) => toolResultBlock(r.toolUseId, r.content, r.isError === true)),
  };
}

/**
 * Build the `gen_ai.*` attribute payload for one assistant generation, given
 * the turn's messages so far and the tools it was offered. Returns the attributes, the tool_use blocks the
 * renderer needs for tool spans, and the assistant message to append to the
 * history for the next generation.
 */
export function buildGenerationAttributes(
  history: Row[],
  assistantMessage: Row,
  toolDefinitions: Row[] | null = null
): [Record<string, Json>, Row[], Row] {
  const content = getContentFromRow(assistantMessage);
  const toolUses = getToolUseBlocks(content);
  const outputMessage: Row = { role: "assistant", content: toAnthropicContent(content) };

  const model = getModel(assistantMessage);
  const attrs: Record<string, Json> = {
    "gen_ai.system": "anthropic",
    "gen_ai.request.model": model,
    "gen_ai.response.model": model,
    "gen_ai.input.messages": jsonDumps(history),
  };
  if (toolDefinitions !== null && toolDefinitions.length > 0) {
    attrs["gen_ai.tool.definitions"] = jsonDumps(toolDefinitions);
  }

  const stopReason = assistantMessage.message?.stop_reason;
  attrs["gen_ai.output.messages"] = jsonDumps([
    typeof stopReason === "string" ? { ...outputMessage, stop_reason: stopReason } : outputMessage,
  ]);

  const usageDetails = getUsageDetailsFromRow(assistantMessage);
  if (usageDetails !== null) {
    let total = 0;
    for (const [key, value] of Object.entries(usageDetails)) {
      attrs[`gen_ai.usage.${key}`] = value;
      total += value;
    }
    attrs["llm.usage.total_tokens"] = total;
  }

  return [attrs, toolUses, outputMessage];
}
