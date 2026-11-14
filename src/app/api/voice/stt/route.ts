// Tamil speech → text with Sarvam (saaras). Without a key the client falls back.
export const maxDuration = 30;

export async function POST(req: Request) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return Response.json({ error: "SARVAM_API_KEY not set" }, { status: 501 });
  const form = await req.formData();
  const audio = form.get("file") as File | null;
  if (!audio) return Response.json({ error: "No audio" }, { status: 400 });
  const out = new FormData();
  out.append("file", audio, "voice.webm");
  out.append("model", process.env.SARVAM_STT_MODEL || "saaras:v3");
  out.append("language_code", "ta-IN");
  const r = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": key },
    body: out,
  });
  const j = await r.json();
  if (!r.ok) return Response.json({ error: j }, { status: r.status });
  return Response.json({ transcript: j.transcript ?? "" });
}
