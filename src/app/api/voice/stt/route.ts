// Tamil speech → text with Sarvam Saaras. Without a key the client falls back to the scripted note.
import { sarvamKey, speechToText } from "@/lib/sarvam";

export const maxDuration = 30;

export async function POST(req: Request) {
  if (!sarvamKey()) return Response.json({ error: "SARVAM_API_KEY not set" }, { status: 501 });
  const form = await req.formData();
  const audio = form.get("file") as File | null;
  const lang = String(form.get("lang") || "ta-IN");
  if (!audio) return Response.json({ error: "No audio" }, { status: 400 });
  try {
    return Response.json({ transcript: await speechToText(audio, audio.name || "voice.webm", /^(ta|hi|en)-IN$/.test(lang) ? lang : "ta-IN") });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
