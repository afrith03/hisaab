import { createGoogleGenerativeAI } from "@ai-sdk/google";

// Several free-tier keys can be listed (comma-separated) so the demo can
// fall through to the next one if a daily limit is hit.
const keys = (process.env.GEMINI_API_KEYS || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

export const MODEL_ID = process.env.GEMINI_MODEL || "gemini-3.6-flash";
export const aiEnabled = () => keys.length > 0 && process.env.DEMO_MODE !== "1";

export async function withModel<T>(fn: (model: ReturnType<ReturnType<typeof createGoogleGenerativeAI>>) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const apiKey of keys) {
    try {
      return await fn(createGoogleGenerativeAI({ apiKey })(MODEL_ID));
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("No Gemini API key configured");
}
