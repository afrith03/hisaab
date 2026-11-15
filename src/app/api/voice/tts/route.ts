// Text → Tamil speech with Sarvam Bulbul. Without a key the client uses the browser voice.
import { sarvamKey, textToSpeech } from "@/lib/sarvam";

export const maxDuration = 30;

export async function POST(req: Request) {
  if (!sarvamKey()) return Response.json({ error: "SARVAM_API_KEY not set" }, { status: 501 });
  const { text, lang } = await req.json();
  try {
    return Response.json({ audio: await textToSpeech(String(text), /^(ta|hi|en)-IN$/.test(lang) ? lang : "ta-IN") });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
