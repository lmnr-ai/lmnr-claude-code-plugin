/**
 * Translation of Claude Code transcript content into the OpenAI-style
 * `gen_ai.*` span attributes Laminar ingests. This module owns the wire-format
 * contract (message shapes, `tool_call_id`/`name` field names, usage keys) and
 * nothing about span timing or emission ordering — that stays in the renderer.
 */
import {
  extractTextFromContent,
  getContentFromRow,
  getModel,
  getToolUseBlocks,
  getUsageDetailsFromRow,
  truncateText,
} from "./transcript.js";
import type { Json, Row } from "./types.js";
import { jsonDumps } from "./util.js";

/** A tool result ready to fold into the next generation's input messages. */
export interface GenerationToolResult {
  toolUseId: string;
  toolName: string;
  output: Json;
}

function buildGenerationInputMessages(
  assistantIndex: number,
  userText: string,
  previousToolResults: GenerationToolResult[],
  readyToolResults: GenerationToolResult[]
): Row[] | null {
  if (assistantIndex === 0) {
    return [{ role: "user", content: userText }];
  }
  // Both feed the next generation's context: results from the previous tool
  // batch AND async agent results that became ready since.
  const toolResults = [...previousToolResults, ...readyToolResults];
  if (toolResults.length > 0) {
    // tool_call_id / name are the OpenAI-style wire field names (kept verbatim).
    return toolResults.map((toolResult) => ({
      role: "tool",
      content: jsonDumps(toolResult.output),
      tool_call_id: toolResult.toolUseId,
      name: toolResult.toolName,
    }));
  }
  return null;
}

function buildGenerationOutputMessage(assistantText: string, toolUses: Row[]): Row {
  const output: Row = { role: "assistant", content: assistantText || "" };
  if (toolUses.length > 0) {
    output.tool_calls = toolUses.map((toolUse) => ({
      id: toolUse.id,
      name: toolUse.name,
      arguments: typeof toolUse.input === "object" && toolUse.input !== null && !Array.isArray(toolUse.input) ? toolUse.input : {},
    }));
  }
  return output;
}

/**
 * Build the `gen_ai.*` attribute payload for one assistant generation and
 * return it alongside the tool_use blocks the renderer needs for tool spans.
 */
export function buildGenerationAttributes(
  assistantIndex: number,
  assistantMessage: Row,
  userText: string,
  previousToolResults: GenerationToolResult[],
  readyToolResults: GenerationToolResult[]
): [Record<string, Json>, Row[]] {
  const [assistantText] = truncateText(extractTextFromContent(getContentFromRow(assistantMessage)));
  const toolUses = getToolUseBlocks(getContentFromRow(assistantMessage));

  const model = getModel(assistantMessage);
  const attrs: Record<string, Json> = {
    "gen_ai.system": "anthropic",
    "gen_ai.request.model": model,
    "gen_ai.response.model": model,
  };

  const inputMessages = buildGenerationInputMessages(assistantIndex, userText, previousToolResults, readyToolResults);
  if (inputMessages !== null) {
    attrs["gen_ai.input.messages"] = jsonDumps(inputMessages);
  }
  attrs["gen_ai.output.messages"] = jsonDumps([buildGenerationOutputMessage(assistantText, toolUses)]);

  const usageDetails = getUsageDetailsFromRow(assistantMessage);
  if (usageDetails !== null) {
    let total = 0;
    for (const [key, value] of Object.entries(usageDetails)) {
      attrs[`gen_ai.usage.${key}`] = value;
      total += value;
    }
    attrs["llm.usage.total_tokens"] = total;
  }

  return [attrs, toolUses];
}
