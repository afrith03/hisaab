// Thin Sarvam AI client: Sarvam-105B chat (tool calling), Sarvam Vision document
// extraction, Saaras speech-to-text and Bulbul text-to-speech.
// Docs: https://docs.sarvam.ai  ·  auth header: api-subscription-key
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import path from "node:path";

const BASE = "https://api.sarvam.ai";
export const sarvamKey = () => process.env.SARVAM_API_KEY?.trim() || "";
export const CHAT_MODEL = process.env.SARVAM_CHAT_MODEL || "sarvam-105b";
export const STT_MODEL = process.env.SARVAM_STT_MODEL || "saaras:v3";
export const TTS_MODEL = process.env.SARVAM_TTS_MODEL || "bulbul:v3";
export const TTS_SPEAKER = process.env.SARVAM_TTS_SPEAKER || "kavitha";
// 1.0 is Bulbul's normal speed; 1.25 sounds natural and keeps the demo moving.
export const TTS_PACE = Number(process.env.SARVAM_TTS_PACE || "1.25");
export const VISION_MODEL = process.env.SARVAM_VISION_MODEL || ""; // empty → API default

const headers = (json = true): Record<string, string> => ({
  "api-subscription-key": sarvamKey(),
  ...(json ? { "content-type": "application/json" } : {}),
});

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fn(ac.signal);
  } finally {
    clearTimeout(t);
  }
}

async function json<T>(r: Response): Promise<T> {
  const text = await r.text();
  if (!r.ok) throw new Error(`Sarvam ${r.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text) as T;
}

/* ---------- Chat: Sarvam-105B with OpenAI-style tool calling ---------- */

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: object } };

export async function chat(opts: {
  messages: ChatMessage[];
  tools?: ToolDef[];
  tool_choice?: "auto" | "required" | "none";
  response_format?: object;
  max_tokens?: number;
  timeoutMs?: number;
}) {
  return withTimeout(opts.timeoutMs ?? 20000, async (signal) => {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: headers(),
      signal,
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: opts.messages,
        tools: opts.tools,
        tool_choice: opts.tools ? opts.tool_choice ?? "auto" : undefined,
        response_format: opts.response_format,
        reasoning_effort: "low",
        temperature: 0.1,
        max_tokens: opts.max_tokens ?? 800,
      }),
    });
    const j = await json<{ choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[] }>(r);
    return j.choices[0].message;
  });
}

/* ---------- Vision: Sarvam Document AI "extract" (schema → JSON) ---------- */

export async function imageBlob(src: { dataUrl?: string; path?: string }): Promise<{ blob: Blob; name: string }> {
  if (src.dataUrl) {
    const [meta, b64] = src.dataUrl.split(",");
    const type = meta.match(/data:(.*?);/)?.[1] || "image/png";
    return { blob: new Blob([Buffer.from(b64, "base64")], { type }), name: `bill.${type.split("/")[1] || "png"}` };
  }
  const rel = (src.path || "").replace(/^\/+/, "");
  const buf = await readFile(path.join(process.cwd(), "public", rel));
  return { blob: new Blob([buf], { type: "image/png" }), name: path.basename(rel) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function extractDocument(file: { blob: Blob; name: string }, schema: object, timeoutMs = 40000): Promise<{ data: unknown; confidence: Record<string, number> }> {
  const t0 = Date.now();
  const form = new FormData();
  form.append("file", file.blob, file.name);
  form.append("schema", JSON.stringify(schema));
  form.append("output_format", "json");
  if (VISION_MODEL) form.append("model", VISION_MODEL);
  const job = await json<{ job_id: string }>(
    await fetch(`${BASE}/doc-ai/v1/job/extract`, { method: "POST", headers: headers(false), body: form }),
  );

  let status = "pending";
  while (Date.now() - t0 < timeoutMs) {
    await sleep(1200);
    const s = await json<{ status: string }>(await fetch(`${BASE}/doc-ai/v1/job/${job.job_id}/status`, { headers: headers(false) }));
    status = s.status;
    if (["completed", "partially_completed", "failed", "rejected"].includes(status)) break;
  }
  if (status !== "completed" && status !== "partially_completed") throw new Error(`Vision job ${status}`);

  // Results are fetched through a signed download URL (same pattern as Digitise).
  const dl = await json<{ url?: string; download_url?: string; urls?: string[] }>(
    await fetch(`${BASE}/doc-ai/v1/job/${job.job_id}/download-url`, { headers: headers(false) }),
  );
  const url = dl.url || dl.download_url || dl.urls?.[0];
  if (!url) throw new Error("Vision job has no download URL");
  // The result is a ZIP holding extraction.json: { data, field_confidence, ... }.
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const raw = buf[0] === 0x50 && buf[1] === 0x4b ? readZipEntry(buf, "extraction.json") : buf.toString("utf8");
  const out = JSON.parse(raw);
  const first = Array.isArray(out) ? out[0] : out;
  return { data: first?.data ?? first?.extraction ?? first?.result ?? first, confidence: first?.field_confidence ?? first?.field_confidences ?? {} };
}

/** Minimal ZIP reader (central directory → one entry); avoids adding a dependency. */
export function readZipEntry(zip: Buffer, wanted: string): string {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 66000); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Bad ZIP from Vision");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28), extraLen = zip.readUInt16LE(p + 30), commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === wanted || name.endsWith("/" + wanted)) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compSize);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wanted} not in Vision ZIP`);
}

/* ---------- Voice ---------- */

export async function speechToText(audio: Blob, name = "voice.webm", lang = "ta-IN") {
  const form = new FormData();
  form.append("file", audio, name);
  form.append("model", STT_MODEL);
  form.append("mode", "transcribe");
  form.append("language_code", lang);
  const j = await json<{ transcript?: string }>(
    await fetch(`${BASE}/speech-to-text`, { method: "POST", headers: headers(false), body: form }),
  );
  return j.transcript ?? "";
}

export async function textToSpeech(text: string, lang = "ta-IN") {
  const j = await json<{ audios?: string[] }>(
    await fetch(`${BASE}/text-to-speech`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ text: text.slice(0, 2000), language_code: lang, model: TTS_MODEL, speaker: TTS_SPEAKER, pace: TTS_PACE }),
    }),
  );
  return j.audios?.join("") ?? null;
}
