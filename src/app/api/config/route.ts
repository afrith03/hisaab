import { connection } from "next/server";
import { aiEnabled, MODEL_ID } from "@/lib/ai";

export async function GET() {
  await connection();
  return Response.json({
    ai: aiEnabled() ? MODEL_ID : null,
    voice: Boolean(process.env.SARVAM_API_KEY),
  });
}
