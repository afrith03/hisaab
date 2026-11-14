// Text → Tamil speech with Sarvam (bulbul). Without a key the client uses the browser voice.
export const maxDuration = 30;

export async function POST(req: Request) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return Response.json({ error: "SARVAM_API_KEY not set" }, { status: 501 });
  const { text } = await req.json();
  const r = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      text: String(text).slice(0, 1500),
      target_language_code: "ta-IN",
      model: process.env.SARVAM_TTS_MODEL || "bulbul:v2",
      speaker: process.env.SARVAM_TTS_SPEAKER || "anushka",
    }),
  });
  const j = await r.json();
  if (!r.ok) return Response.json({ error: j }, { status: r.status });
  return Response.json({ audio: j.audios?.[0] ?? null });
}
