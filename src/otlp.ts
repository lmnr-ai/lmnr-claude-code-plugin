/**
 * Minimal OTLP/HTTP/JSON: spans with backdated times, serialized the way the
 * OpenTelemetry JS SDK does, sent with fetch.
 */
import * as crypto from "node:crypto";
import { debug, EXPORT_TIMEOUT_MS, info, type LaminarConfig } from "./config.js";

export type AttrValue = string | number | boolean;
export type Attrs = Record<string, AttrValue | null | undefined>;

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: Record<string, AttrValue>;
}

type SpanContext = Pick<Span, "traceId" | "spanId">;

const hex = (bytes: number) => crypto.randomBytes(bytes).toString("hex");

function normalizeId(value: unknown, len: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  let id = value.trim().replace(/-/g, "").toLowerCase();
  if (len === 16 && id.length === 32) {
    id = id.slice(16); // a UUID-formatted span id carries it in the low half
  }
  return new RegExp(`^[0-9a-f]{${len}}$`).test(id) && !/^0+$/.test(id) ? id : null;
}

/** `LMNR_SPAN_CONTEXT` makes turn roots join the caller's trace; invalid values are ignored. */
function parentFromEnv(): SpanContext | null {
  const raw = process.env.LMNR_SPAN_CONTEXT?.trim();
  if (!raw) {
    return null;
  }
  try {
    const ctx = JSON.parse(raw);
    const traceId = normalizeId(ctx?.traceId ?? ctx?.trace_id, 32);
    const spanId = normalizeId(ctx?.spanId ?? ctx?.span_id, 16);
    if (traceId && spanId) {
      return { traceId, spanId };
    }
  } catch {
    // fall through
  }
  debug("Ignoring invalid LMNR_SPAN_CONTEXT");
  return null;
}

export function setAttributes(span: Span, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) {
      span.attributes[key] = value;
    }
  }
}

/** End a span; an end before its start (or unknown) clamps to the start. */
export function endSpan(span: Span, endMs: number | null): void {
  span.endMs = Math.max(span.startMs, endMs ?? span.startMs);
}

export class Tracer {
  readonly spans: Span[] = [];
  private readonly remoteParent = parentFromEnv();

  /** Start a span under `parent`, or as a turn root (under LMNR_SPAN_CONTEXT if set). */
  start(name: string, startMs: number | null, attrs: Attrs, parent?: Span): Span {
    const p = parent ?? this.remoteParent;
    const start = startMs ?? Date.now();
    const span: Span = { traceId: p?.traceId ?? hex(16), spanId: hex(8), name, startMs: start, endMs: start, attributes: {} };
    if (p) {
      span.parentSpanId = p.spanId;
    }
    setAttributes(span, attrs);
    this.spans.push(span);
    return span;
  }
}

function attrValue(v: AttrValue): Record<string, AttrValue> {
  if (typeof v === "string") {
    return { stringValue: v };
  }
  if (typeof v === "boolean") {
    return { boolValue: v };
  }
  return Number.isInteger(v) ? { intValue: v } : { doubleValue: v };
}

const toAttributes = (attrs: Record<string, AttrValue>) =>
  Object.entries(attrs).map(([key, value]) => ({ key, value: attrValue(value) }));

const nanos = (ms: number) => (BigInt(Math.round(ms)) * 1_000_000n).toString();

export function toOtlpJson(spans: Span[]): object {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: toAttributes({
            "service.name": "claude-code",
            "telemetry.sdk.language": "nodejs",
            "telemetry.sdk.name": "lmnr-claude-code-plugin",
          }),
          droppedAttributesCount: 0,
        },
        scopeSpans: [
          {
            scope: { name: "lmnr.claude_code" },
            spans: spans.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId,
              name: s.name,
              kind: 1, // INTERNAL
              startTimeUnixNano: nanos(s.startMs),
              endTimeUnixNano: nanos(s.endMs),
              attributes: toAttributes(s.attributes),
              droppedAttributesCount: 0,
              events: [],
              droppedEventsCount: 0,
              status: { code: 1 }, // OK
              links: [],
              droppedLinksCount: 0,
            })),
          },
        ],
      },
    ],
  };
}

// app-server rejects request bodies over its HTTP_PAYLOAD_LIMIT (5 MB by
// default, measured after decompression), so exports go out in batches below it.
export const MAX_BATCH_BYTES = 4 * 1024 * 1024;

/** Rough serialized size of a span: its attributes plus envelope overhead. */
export const spanBytes = (span: Span): number => Buffer.byteLength(JSON.stringify(span.attributes)) + 512;

/** POST the spans in one request; true on 2xx. Never throws. */
export async function exportSpans(config: LaminarConfig, spans: Span[]): Promise<boolean> {
  if (spans.length === 0) {
    return true;
  }
  try {
    const res = await fetch(`${config.baseUrl}/v1/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(toOtlpJson(spans)),
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
    if (res.ok) {
      debug(`OTLP export: ${spans.length} span(s)`);
      return true;
    }
    info(`OTLP export failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 500)}`);
    return false;
  } catch (e) {
    info(`OTLP export failed: ${e}`);
    return false;
  }
}
