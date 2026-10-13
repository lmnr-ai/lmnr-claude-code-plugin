/**
 * Spans with backdated times, sent with the OpenTelemetry OTLP/HTTP/JSON
 * exporter. Batching is ours (pipeline.ts), not a span processor's: a run needs
 * each request's outcome to know which turns went out.
 */
import * as crypto from "node:crypto";
import { SpanKind, SpanStatusCode, TraceFlags, type HrTime } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
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

// The SDK's span type (@opentelemetry/sdk-trace), as the exporter declares it.
type ReadableSpan = Parameters<OTLPTraceExporter["export"]>[0][number];

const SAMPLED = { traceFlags: TraceFlags.SAMPLED };
const RESOURCE = resourceFromAttributes({
  "service.name": "claude-code",
  "telemetry.sdk.language": "nodejs",
  "telemetry.sdk.name": "lmnr-claude-code-plugin",
});
const SCOPE = { name: "lmnr.claude_code" };

const hrTime = (ms: number): HrTime => {
  const whole = Math.round(ms);
  return [Math.floor(whole / 1000), (whole % 1000) * 1_000_000];
};

/** Our spans as the SDK's `ReadableSpan`, which is what the OTLP exporter takes. */
export function toReadableSpan(s: Span): ReadableSpan {
  return {
    name: s.name,
    kind: SpanKind.INTERNAL,
    spanContext: () => ({ traceId: s.traceId, spanId: s.spanId, ...SAMPLED }),
    parentSpanContext: s.parentSpanId ? { traceId: s.traceId, spanId: s.parentSpanId, ...SAMPLED } : undefined,
    startTime: hrTime(s.startMs),
    endTime: hrTime(s.endMs),
    duration: hrTime(s.endMs - s.startMs),
    ended: true,
    status: { code: SpanStatusCode.OK },
    attributes: s.attributes,
    links: [],
    events: [],
    resource: RESOURCE,
    instrumentationScope: SCOPE,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

// app-server rejects request bodies over its HTTP_PAYLOAD_LIMIT (5 MB by
// default, measured after decompression), so exports go out in batches below it.
export const MAX_BATCH_BYTES = 4 * 1024 * 1024;

/** Rough serialized size of a span: its attributes plus envelope overhead. */
export const spanBytes = (span: Span): number => Buffer.byteLength(JSON.stringify(span.attributes)) + 512;

/**
 * The exporter merges `OTEL_EXPORTER_OTLP_*` env config (headers, certificates,
 * timeout, ...) into its own. Claude Code passes its telemetry settings to hooks
 * that way, so a key meant for the user's own collector would go to Laminar.
 * The hook is its own short-lived process: drop them before building one.
 */
function dropOtlpEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("OTEL_EXPORTER_OTLP_")) {
      delete process.env[key];
    }
  }
}

/** Send the spans in one OTLP/HTTP/JSON request; true on success. Never throws. */
export async function exportSpans(config: LaminarConfig, spans: Span[]): Promise<boolean> {
  if (spans.length === 0) {
    return true;
  }
  try {
    dropOtlpEnv();
    const exporter = new OTLPTraceExporter({
      url: `${config.baseUrl}/v1/traces`,
      headers: { Authorization: `Bearer ${config.apiKey}` },
      timeoutMillis: EXPORT_TIMEOUT_MS, // bounds retries too
    });
    const result = await new Promise<ExportResult>((resolve) => exporter.export(spans.map(toReadableSpan), resolve));
    await exporter.shutdown().catch(() => {});
    if (result.code === ExportResultCode.SUCCESS) {
      debug(`OTLP export: ${spans.length} span(s)`);
      return true;
    }
    info(`OTLP export failed: ${String(result.error ?? "unknown error").slice(0, 500)}`);
    return false;
  } catch (e) {
    info(`OTLP export failed: ${e}`);
    return false;
  }
}
