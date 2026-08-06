import { CAPTURE_SKILL_CONTENT, type LaminarConfig } from "./config.js";
import {
  extractTextFromContent,
  getContentFromRow,
  getToolUseBlocks,
  parseTimestamp,
  truncateText,
} from "./transcript.js";
import { ASSOC_PREFIX, SPAN_OUTPUT_ATTR, startSpan, TraceEmitter, type SpanHandle } from "./tracer.js";
import { buildTurns, type ToolResultEntry, type Turn } from "./turns.js";
import { readSubagentJsonl, type SubagentTranscript } from "./subagents.js";
import { buildGenerationAttributes, type GenerationToolResult } from "./genai.js";
import type { Json, Row } from "./types.js";
import { getLatestTimestamp, jsonDumps } from "./util.js";

// ----------------- Emission internal shapes -----------------
interface PendingSubagent {
  toolUseId: string;
  subagent: SubagentTranscript;
  parentSpan: SpanHandle;
  startTimestamp: Date | null;
  readyTimestamp: Date | null;
  displayStartTimestamp?: Date | null;
}

interface PendingAsyncToolResult {
  timestamp: Date | null;
  toolResult: GenerationToolResult;
}

interface ToolResultForObservation {
  output: Json;
  resultTimestamp: Date | null;
  finalOutput: Json;
  finalResultTimestamp: Date | null;
}

interface EmittedSingleToolObservation {
  handoffTimestamp: Date | null;
  toolResult: GenerationToolResult;
  latestEndTimestamp: Date | null;
}

interface EmittedToolObservationBatch {
  resultTimestamps: Date[];
  toolResults: GenerationToolResult[];
  latestEndTimestamp: Date | null;
}

// ----------------- Trace naming and tags -----------------
/** Return the distinct skill names invoked in the turn (bare names, no prefix). */
function collectSkillNames(turn: Turn): string[] {
  const names: string[] = [];
  for (const assistantMessage of turn.assistantMsgs) {
    for (const toolUse of getToolUseBlocks(getContentFromRow(assistantMessage))) {
      if (toolUse.name !== "Skill") {
        continue;
      }
      const toolInput = toolUse.input;
      const skill = typeof toolInput === "object" && toolInput !== null ? toolInput.skill : null;
      if (typeof skill === "string" && skill && !names.includes(skill)) {
        names.push(skill);
      }
    }
  }
  return names;
}

/** Return a compact session label for trace names. */
export function shortSessionLabel(sessionId: string, maxLen = 12): string {
  const sid = sessionId.trim();
  if (!sid) {
    return "unknown";
  }
  const parts = sid.split("-");
  if (parts.length === 5 && parts[0]!.length === 8) {
    return parts[0]!;
  }
  return sid.length <= maxLen ? sid : sid.slice(0, maxLen).replace(/-+$/, "");
}

function traceDisplayName(sessionId: string, turnNum: number): string {
  return `Claude Code - Turn ${turnNum} (${shortSessionLabel(sessionId)})`;
}


// ----------------- Tool spans -----------------
function getToolInputForObservation(toolUse: Row): Json {
  const raw = toolUse.input;
  const isScalarOrContainer =
    typeof raw === "object" || typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean";
  const toolInputRaw = isScalarOrContainer && raw !== null ? raw : {};
  if (typeof toolInputRaw === "string") {
    return truncateText(toolInputRaw)[0];
  }
  return toolInputRaw;
}

function getToolResultForObservation(toolResultEntry: ToolResultEntry | null | undefined): ToolResultForObservation {
  const empty: ToolResultForObservation = {
    output: null,
    resultTimestamp: null,
    finalOutput: null,
    finalResultTimestamp: null,
  };
  if (!toolResultEntry) {
    return empty;
  }

  const outputRaw = toolResultEntry.content;
  const outputStr = typeof outputRaw === "string" ? outputRaw : jsonDumps(outputRaw);
  const [output] = truncateText(outputStr);
  const resultTimestamp = parseTimestamp(toolResultEntry.timestamp);

  const finalOutputRaw = toolResultEntry.finalContent;
  if (finalOutputRaw === undefined || finalOutputRaw === null) {
    return { output, resultTimestamp, finalOutput: null, finalResultTimestamp: null };
  }

  const finalOutputStr = typeof finalOutputRaw === "string" ? finalOutputRaw : jsonDumps(finalOutputRaw);
  const [finalOutput] = truncateText(finalOutputStr);
  const finalResultTimestamp = parseTimestamp(toolResultEntry.finalTimestamp);
  return { output, resultTimestamp, finalOutput, finalResultTimestamp };
}

function getShortTranscriptPathForMetadata(p: unknown): string | null {
  if (typeof p === "string" && p) {
    // Return the basename, mirroring Path(path).name.
    const parts = p.split(/[/\\]/);
    return parts[parts.length - 1] || null;
  }
  return null;
}

function buildToolMetadataAttributes(
  toolName: string,
  toolUseId: string,
  subagent: SubagentTranscript | null
): Record<string, Json> {
  // Plain span attributes, NOT lmnr.association.properties.metadata.* —
  // association metadata propagates to the whole trace, so per-tool details
  // there would pollute (and race on) the trace-level metadata.
  const attrs: Record<string, Json> = {
    "claude_code.tool.name": toolName,
    "claude_code.tool.id": toolUseId,
  };
  if (subagent) {
    if (typeof subagent.agentType === "string" && subagent.agentType) {
      attrs["claude_code.subagent.type"] = subagent.agentType;
    }
    if (typeof subagent.description === "string" && subagent.description) {
      attrs["claude_code.subagent.description"] = subagent.description;
    }
  }
  return attrs;
}

function emitSingleToolObservation(
  emitter: TraceEmitter,
  parentSpan: SpanHandle,
  turn: Turn,
  assistantTimestamp: Date | null,
  toolUse: Row,
  subagentMap: Record<string, SubagentTranscript> | null,
  pendingSubagents: PendingSubagent[],
  pendingAsyncToolResults: PendingAsyncToolResult[]
): EmittedSingleToolObservation {
  const toolUseId = String(toolUse.id || "");
  const toolName = toolUse.name || "unknown";
  const toolInput = getToolInputForObservation(toolUse);

  const toolResultEntry = toolUseId ? turn.toolResultsById[toolUseId] : null;
  const toolResult = getToolResultForObservation(toolResultEntry);

  let toolOutput: Json = toolResult.output;
  if (CAPTURE_SKILL_CONTENT) {
    const injected = toolUseId ? turn.injectedByToolId[toolUseId] : null;
    if (injected) {
      const [injectedTrunc] = truncateText(injected);
      toolOutput = { result: toolResult.output, injected_instructions: injectedTrunc };
    }
  }

  const subagent = subagentMap && toolUseId ? subagentMap[toolUseId] ?? null : null;

  const toolUseTimestamp = parseTimestamp(turn.toolUseTimestampsById[toolUseId]) ?? assistantTimestamp;
  const toolSpan = startSpan(emitter, {
    name: toolName,
    parent: parentSpan,
    startTime: toolUseTimestamp,
    spanType: "TOOL",
    inputValue: toolInput,
    attributes: buildToolMetadataAttributes(toolName, toolUseId, subagent),
  });
  if (toolOutput !== null && toolOutput !== undefined) {
    toolSpan.setAttributes({ [SPAN_OUTPUT_ATTR]: jsonDumps(toolOutput) });
  }

  // Subagent subtrees nest under their launching Agent/Task tool span so the
  // frontend groups them automatically.
  let subagentEndTimestamp: Date | null = null;
  if (subagent) {
    if (toolResult.finalResultTimestamp !== null) {
      pendingSubagents.push({
        toolUseId,
        subagent,
        parentSpan: toolSpan,
        startTimestamp: toolUseTimestamp,
        readyTimestamp: toolResult.finalResultTimestamp,
      });
    } else {
      subagentEndTimestamp = emitSubagentObservations(emitter, toolSpan, subagent, toolUseTimestamp);
    }
  }

  const toolEndTimestamp = getLatestTimestamp(
    toolResult.resultTimestamp,
    toolResult.finalResultTimestamp,
    subagentEndTimestamp,
    toolUseTimestamp
  );
  const handoffTimestamp =
    toolResult.resultTimestamp ?? toolResult.finalResultTimestamp ?? subagentEndTimestamp ?? assistantTimestamp;
  toolSpan.end(toolEndTimestamp);

  if (toolResult.finalResultTimestamp !== null && toolResult.finalOutput !== null) {
    pendingAsyncToolResults.push({
      timestamp: toolResult.finalResultTimestamp,
      toolResult: { toolUseId, toolName, output: toolResult.finalOutput },
    });
  }

  return {
    handoffTimestamp,
    toolResult: { toolUseId, toolName, output: toolResult.output },
    latestEndTimestamp: getLatestTimestamp(toolEndTimestamp, subagentEndTimestamp),
  };
}

function emitToolObservationBatch(
  emitter: TraceEmitter,
  parentSpan: SpanHandle,
  turn: Turn,
  assistantMessage: Row,
  toolUses: Row[],
  subagentMap: Record<string, SubagentTranscript> | null,
  pendingSubagents: PendingSubagent[],
  pendingAsyncToolResults: PendingAsyncToolResult[]
): EmittedToolObservationBatch {
  const assistantTimestamp = parseTimestamp(assistantMessage);
  const resultTimestamps: Date[] = [];
  const toolResults: GenerationToolResult[] = [];
  let latestEndTimestamp: Date | null = null;

  for (const toolUse of toolUses) {
    const emittedTool = emitSingleToolObservation(
      emitter,
      parentSpan,
      turn,
      assistantTimestamp,
      toolUse,
      subagentMap,
      pendingSubagents,
      pendingAsyncToolResults
    );
    if (emittedTool.handoffTimestamp !== null) {
      resultTimestamps.push(emittedTool.handoffTimestamp);
    }
    toolResults.push(emittedTool.toolResult);
    latestEndTimestamp = getLatestTimestamp(latestEndTimestamp, emittedTool.latestEndTimestamp);
  }

  return { resultTimestamps, toolResults, latestEndTimestamp };
}

// ----------------- Turn and subagent spans -----------------
/** Partition items into those ready at `cutoff` (timestamp <= cutoff, or no cutoff) and the rest. */
function partitionReady<T>(items: T[], tsOf: (item: T) => Date | null, cutoff: Date | null): [T[], T[]] {
  const ready: T[] = [];
  const pending: T[] = [];
  for (const item of items) {
    const ts = tsOf(item);
    if (ts instanceof Date && (cutoff === null || ts.getTime() <= cutoff.getTime())) {
      ready.push(item);
    } else {
      pending.push(item);
    }
  }
  return [ready, pending];
}

function updatePendingSubagentDisplayStartAfterLaunchResponse(
  pendingSubagents: PendingSubagent[],
  toolResultsUsedAsGenerationInput: GenerationToolResult[],
  generationStartTimestamp: Date | null
): void {
  if (generationStartTimestamp === null) {
    return;
  }
  const toolUseIds = new Set(toolResultsUsedAsGenerationInput.filter((r) => r.toolUseId).map((r) => r.toolUseId));
  if (toolUseIds.size === 0) {
    return;
  }
  for (const pending of pendingSubagents) {
    if (pending.displayStartTimestamp != null) {
      continue;
    }
    if (toolUseIds.has(pending.toolUseId)) {
      // Nudge just after the launch generation so the subagent renders after
      // it. Dates are ms-resolution, so we use +1ms (Python used +1µs).
      pending.displayStartTimestamp = new Date(generationStartTimestamp.getTime() + 1);
    }
  }
}

function emitSubagentObservations(
  emitter: TraceEmitter,
  parentSpan: SpanHandle,
  subagent: SubagentTranscript,
  startTimestamp: Date | null
): Date | null {
  const p = subagent.path;
  if (typeof p !== "string") {
    return startTimestamp;
  }
  const rows = readSubagentJsonl(p);
  if (rows === null) {
    return startTimestamp;
  }

  const turns = buildTurns(rows);
  if (turns.length === 0) {
    return startTimestamp;
  }

  const firstTurn = turns[0]!;
  const subagentStartTimestamp = startTimestamp ?? parseTimestamp(firstTurn.userMsg);
  const [subagentInputText] = truncateText(extractTextFromContent(getContentFromRow(firstTurn.userMsg)));

  const lastTurn = turns[turns.length - 1]!;
  const lastAssistant = lastTurn.assistantMsgs[lastTurn.assistantMsgs.length - 1];
  const [subagentOutputText] = truncateText(extractTextFromContent(lastAssistant ? getContentFromRow(lastAssistant) : ""));

  const description = subagent.description;
  const subagentName = typeof description === "string" && description ? `Subagent: ${description}` : "Subagent";
  const subagentAttrs: Record<string, Json> = {};
  if (typeof subagent.agentType === "string" && subagent.agentType) {
    subagentAttrs["claude_code.subagent.type"] = subagent.agentType;
  }
  const subagentSpan = startSpan(emitter, {
    name: subagentName,
    parent: parentSpan,
    startTime: subagentStartTimestamp,
    spanType: "DEFAULT",
    inputValue: { role: "user", content: subagentInputText },
    attributes: subagentAttrs,
  });

  let latestEndTimestamp = subagentStartTimestamp;
  let previousStartTimestamp = subagentStartTimestamp;
  for (const turn of turns) {
    const latestTurnTimestamp = emitTurnObservations(emitter, subagentSpan, turn, previousStartTimestamp, "Subagent LLM Call", null);
    latestEndTimestamp = getLatestTimestamp(latestEndTimestamp, latestTurnTimestamp);
    if (latestTurnTimestamp !== null) {
      previousStartTimestamp = latestTurnTimestamp;
    }
  }

  subagentSpan.setAttributes({ [SPAN_OUTPUT_ATTR]: jsonDumps({ role: "assistant", content: subagentOutputText }) });
  subagentSpan.end(getLatestTimestamp(latestEndTimestamp, subagentStartTimestamp));

  return latestEndTimestamp;
}

/** Emit a turn's generations and tool spans under an existing span. */
function emitTurnObservations(
  emitter: TraceEmitter,
  parentSpan: SpanHandle,
  turn: Turn,
  startTimestamp: Date | null,
  generationPrefix = "LLM Call",
  subagentMap: Record<string, SubagentTranscript> | null = null
): Date | null {
  const [userText] = truncateText(extractTextFromContent(getContentFromRow(turn.userMsg)));
  let previousTimestamp = startTimestamp;
  let previousToolResults: GenerationToolResult[] = [];
  let pendingAsyncToolResults: PendingAsyncToolResult[] = [];
  let pendingSubagents: PendingSubagent[] = [];
  let latestEndTimestamp = startTimestamp;

  turn.assistantMsgs.forEach((assistantMessage, assistantIndex) => {
    const assistantTimestamp = parseTimestamp(assistantMessage);
    if (assistantIndex > 0 && pendingSubagents.length > 0) {
      const [readySubagents, stillPending] = partitionReady(pendingSubagents, (p) => p.readyTimestamp, assistantTimestamp);
      pendingSubagents = stillPending;
      for (const readySubagent of readySubagents) {
        const subagentEndTimestamp = emitSubagentObservations(
          emitter,
          readySubagent.parentSpan ?? parentSpan,
          readySubagent.subagent,
          readySubagent.displayStartTimestamp ?? readySubagent.startTimestamp
        );
        latestEndTimestamp = getLatestTimestamp(latestEndTimestamp, subagentEndTimestamp);
      }
    }

    let readyAsyncToolResults: PendingAsyncToolResult[] = [];
    if (assistantIndex > 0 && pendingAsyncToolResults.length > 0) {
      const [ready, stillPending] = partitionReady(pendingAsyncToolResults, (r) => r.timestamp, assistantTimestamp);
      readyAsyncToolResults = ready;
      pendingAsyncToolResults = stillPending;
      previousTimestamp = getLatestTimestamp(previousTimestamp, ...ready.map((r) => r.timestamp));
    }

    const [generationAttrs, toolUses] = buildGenerationAttributes(
      assistantIndex,
      assistantMessage,
      userText,
      previousToolResults,
      readyAsyncToolResults.map((r) => r.toolResult)
    );
    const generationStartTimestamp = previousTimestamp ?? assistantTimestamp;
    const generationSpan = startSpan(emitter, {
      name: `${generationPrefix} ${assistantIndex + 1}`,
      parent: parentSpan,
      startTime: generationStartTimestamp,
      spanType: "LLM",
      attributes: generationAttrs,
    });
    updatePendingSubagentDisplayStartAfterLaunchResponse(pendingSubagents, previousToolResults, generationStartTimestamp);

    const emittedTools = emitToolObservationBatch(
      emitter,
      parentSpan,
      turn,
      assistantMessage,
      toolUses,
      subagentMap,
      pendingSubagents,
      pendingAsyncToolResults
    );
    latestEndTimestamp = getLatestTimestamp(latestEndTimestamp, emittedTools.latestEndTimestamp);

    const generationEndTimestamp = assistantTimestamp ?? generationStartTimestamp;
    generationSpan.end(generationEndTimestamp);
    latestEndTimestamp = getLatestTimestamp(latestEndTimestamp, generationEndTimestamp);

    previousToolResults = emittedTools.toolResults;
    if (emittedTools.resultTimestamps.length > 0) {
      previousTimestamp = getLatestTimestamp(...emittedTools.resultTimestamps);
    } else if (assistantTimestamp !== null) {
      previousTimestamp = assistantTimestamp;
    }
  });

  for (const pendingSubagent of pendingSubagents) {
    const subagentEndTimestamp = emitSubagentObservations(
      emitter,
      pendingSubagent.parentSpan ?? parentSpan,
      pendingSubagent.subagent,
      pendingSubagent.displayStartTimestamp ?? pendingSubagent.startTimestamp
    );
    latestEndTimestamp = getLatestTimestamp(latestEndTimestamp, subagentEndTimestamp);
  }

  return latestEndTimestamp;
}

function getTurnEndTimestamp(turn: Turn): Date | null {
  const lastAssistant = turn.assistantMsgs.length > 0 ? turn.assistantMsgs[turn.assistantMsgs.length - 1] : null;
  const candidates: Date[] = [];
  const lastAssistantTimestamp = lastAssistant ? parseTimestamp(lastAssistant) : null;
  if (lastAssistantTimestamp !== null) {
    candidates.push(lastAssistantTimestamp);
  }
  for (const toolResultEntry of Object.values(turn.toolResultsById)) {
    const timestamp = parseTimestamp(toolResultEntry);
    if (timestamp !== null) {
      candidates.push(timestamp);
    }
  }
  return getLatestTimestamp(...candidates);
}

function buildTraceRootAttributes(
  config: LaminarConfig,
  sessionId: string,
  turnNum: number,
  turn: Turn,
  transcriptPath: string
): Record<string, Json> {
  // No tags: everything constant across the turn goes in metadata (which the
  // SDKs reserve for trace-wide values); per-span detail stays on span attributes.
  const attrs: Record<string, Json> = {
    [`${ASSOC_PREFIX}.session_id`]: sessionId,
    [`${ASSOC_PREFIX}.metadata.source`]: "claude-code",
    [`${ASSOC_PREFIX}.metadata.turn_number`]: String(turnNum),
    [`${ASSOC_PREFIX}.metadata.transcript`]: getShortTranscriptPathForMetadata(transcriptPath) ?? "",
    [`${ASSOC_PREFIX}.metadata.os`]: process.platform,
  };
  if (config.userId) {
    attrs[`${ASSOC_PREFIX}.user_id`] = config.userId;
  }
  // Skills invoked in the turn are constant across its spans → trace metadata.
  const skills = collectSkillNames(turn);
  if (skills.length > 0) {
    attrs[`${ASSOC_PREFIX}.metadata.skills`] = skills.join(",");
  }
  // Transcript rows carry the project dir, git branch, and Claude Code version
  // so traces from different projects/worktrees/versions are distinguishable.
  for (const [srcKey, dstKey] of [
    ["cwd", "cwd"],
    ["gitBranch", "git_branch"],
    ["version", "claude_code_version"],
  ] as const) {
    const value = turn.userMsg[srcKey];
    if (typeof value === "string" && value) {
      attrs[`${ASSOC_PREFIX}.metadata.${dstKey}`] = value;
    }
  }
  return attrs;
}

export function emitTurn(
  emitter: TraceEmitter,
  config: LaminarConfig,
  sessionId: string,
  turnNum: number,
  turn: Turn,
  transcriptPath: string,
  subagentMap: Record<string, SubagentTranscript> | null = null
): void {
  // Every span minted below inherits session/user association from the emitter.
  emitter.sessionId = sessionId;
  const [userText] = truncateText(extractTextFromContent(getContentFromRow(turn.userMsg)));

  const lastAssistant = turn.assistantMsgs[turn.assistantMsgs.length - 1]!;
  const [finalAssistantText] = truncateText(extractTextFromContent(getContentFromRow(lastAssistant)));

  const userTs = parseTimestamp(turn.userMsg);
  const lastAssistantTs = parseTimestamp(lastAssistant);
  const turnEndTs = getTurnEndTimestamp(turn);

  const rootSpan = startSpan(emitter, {
    name: traceDisplayName(sessionId, turnNum),
    parent: null,
    startTime: userTs,
    spanType: "DEFAULT",
    inputValue: { role: "user", content: userText },
    attributes: buildTraceRootAttributes(config, sessionId, turnNum, turn, transcriptPath),
  });
  const obsEndTs = emitTurnObservations(emitter, rootSpan, turn, userTs, "LLM Call", subagentMap);
  rootSpan.setAttributes({ [SPAN_OUTPUT_ATTR]: jsonDumps({ role: "assistant", content: finalAssistantText }) });
  rootSpan.end(getLatestTimestamp(turnEndTs, lastAssistantTs, obsEndTs, userTs));
}
