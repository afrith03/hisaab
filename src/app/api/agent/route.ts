import { finalize, readBills, startMonth } from "@/lib/agent";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json();
  try {
    if (body.phase === "start") return Response.json(await startMonth(body.message ?? ""));
    if (body.phase === "bills") return Response.json(await readBills(body.images ?? [], new URL(req.url).origin));
    if (body.phase === "finalize") return Response.json(await finalize(body.answers ?? {}, body.bills ?? []));
    return Response.json({ error: "Unknown phase" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
