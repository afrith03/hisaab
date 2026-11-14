import { generateText, isStepCount, Output, tool } from "ai";
import { z } from "zod";
import { aiEnabled, MODEL_ID, withModel } from "./ai";
import { buildDraft, billCredit, classify, inr } from "./gst";
import { merchant, paytm, sampleBills } from "./paytm";
import { copy, fmtDate, type Line } from "./copy";
import type { Bill, GstDraft, Question } from "./types";

export type TraceStep = { tool: string; detail: string; ms: number };
export type AgentResult = {
  mode: "live" | "demo";
  model?: string;
  trace: TraceStep[];
  replies: Line[];
  questions?: Question[];
  bills?: Bill[];
  draft?: GstDraft;
  draftId?: string;
};

const timed = async <T>(trace: TraceStep[], name: string, fn: () => Promise<T>, detail: (r: T) => string) => {
  const t0 = Date.now();
  const r = await fn();
  trace.push({ tool: name, detail: detail(r), ms: Date.now() - t0 });
  return r;
};

/* ---------- Phase 1: merchant asks "is my GST ready?" ---------- */

async function pullSettlements(period: string, trace: TraceStep[]) {
  const txns = await timed(trace, "paytm.getTransactions", () => paytm.getTransactions(period),
    (r) => `${r.length} transactions for ${period} from ${paytm.name}`);
  const biz = classify(txns).filter((t) => t.classification === "business");
  const mdr = biz.filter((t) => t.mdr > 0);
  const gst = Math.round(mdr.reduce((s, t) => s + t.gstOnMdr, 0) * 100) / 100;
  trace.push({ tool: "rules.mdrCredit", detail: `${mdr.length} payments above ₹2,000 had MDR; GST on fees ${inr(gst)} → input tax credit`, ms: 1 });
  return { count: txns.length, mdrCount: mdr.length, gst };
}

export async function startMonth(message: string): Promise<AgentResult> {
  const trace: TraceStep[] = [];
  if (aiEnabled()) {
    try {
      let summary: Awaited<ReturnType<typeof pullSettlements>> | undefined;
      await withModel((model) =>
        generateText({
          model,
          stopWhen: isStepCount(3),
          system:
            "You are Hisaab, a GST bookkeeping agent for a small Indian shop that takes payments on Paytm. " +
            "Today is 15 Nov 2026. When the merchant asks about GST for a month, call getSettlements with that month as YYYY-MM. Reply in one short sentence.",
          prompt: message,
          tools: {
            getSettlements: tool({
              description: "Fetch the merchant's Paytm payments and settlements for a month, and compute GST credit on MDR fees.",
              inputSchema: z.object({ period: z.string().describe("Month as YYYY-MM") }),
              execute: async ({ period }) => {
                trace.push({ tool: "llm.decide", detail: `${MODEL_ID} understood the voice note → getSettlements("${period}")`, ms: 0 });
                summary = await pullSettlements(period, trace);
                return summary;
              },
            }),
          },
        }),
      );
      if (summary) return { mode: "live", model: MODEL_ID, trace, replies: [copy.pulled(summary.count, summary.mdrCount, summary.gst), copy.askBills] };
    } catch (e) {
      trace.push({ tool: "llm.fallback", detail: `AI unavailable (${(e as Error).message.slice(0, 80)}), using rules path`, ms: 0 });
    }
  } else {
    trace.push({ tool: "agent.plan", detail: `Intent "GST status" → period 2026-10 (demo mode)`, ms: 0 });
  }
  const s = await pullSettlements("2026-10", trace);
  return { mode: "demo", trace, replies: [copy.pulled(s.count, s.mdrCount, s.gst), copy.askBills] };
}

/* ---------- Phase 2: merchant sends bill photos ---------- */

const BillSchema = z.object({
  supplier: z.string(),
  supplierGstin: z.string(),
  invoiceNo: z.string(),
  invoiceDate: z.string().describe("YYYY-MM-DD"),
  lines: z.array(z.object({
    description: z.string(), hsn: z.string(), qty: z.number(), rate: z.number(), gstRate: z.number(),
    taxable: z.number(), cgst: z.number(), sgst: z.number(),
  })),
  taxable: z.number(), cgst: z.number(), sgst: z.number(), igst: z.number(), total: z.number(),
});

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

function checkBill(b: Bill): string[] {
  const issues: string[] = [];
  if (!GSTIN.test(b.supplierGstin)) issues.push("supplier GSTIN format looks wrong");
  if (Math.abs(b.taxable + b.cgst + b.sgst + b.igst - b.total) > 1) issues.push("totals don't add up");
  return issues;
}

async function readOne(image: { id: string; dataUrl?: string; path?: string }, origin: string): Promise<Bill> {
  const sample = sampleBills.find((b) => b.id === image.id);
  if (aiEnabled()) {
    const url = image.dataUrl ?? new URL(image.path ?? sample?.image ?? "", origin).toString();
    const { output } = await withModel((model) =>
      generateText({
        model,
        output: Output.object({ schema: BillSchema }),
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Extract this Indian GST purchase invoice. Use numbers exactly as printed. If IGST is absent use 0." },
            { type: "file", mediaType: "image", data: url },
          ],
        }],
      }),
    );
    return { id: image.id, image: sample?.image, ...output } as Bill;
  }
  if (!sample) throw new Error("Unknown bill in demo mode");
  return sample;
}

export async function readBills(images: { id: string; dataUrl?: string; path?: string }[], origin: string): Promise<AgentResult> {
  const trace: TraceStep[] = [];
  const bills: Bill[] = [];
  let live = aiEnabled();
  for (const img of images) {
    const b = await timed(trace, "vision.readBill", async () => {
      try {
        return await readOne(img, origin);
      } catch (e) {
        live = false;
        const s = sampleBills.find((x) => x.id === img.id);
        if (!s) throw e;
        return s;
      }
    }, (r) => `${r.supplier} · ${r.invoiceNo} · GSTIN ${r.supplierGstin} · GST ${inr(billCredit(r))}`);
    const issues = checkBill(b);
    trace.push({ tool: "rules.validateBill", detail: issues.length ? `⚠ ${issues.join(", ")}` : "GSTIN valid, totals add up", ms: 0 });
    bills.push(b);
  }
  const gst = Math.round(bills.reduce((s, b) => s + billCredit(b), 0) * 100) / 100;

  const txns = await paytm.getTransactions("2026-10");
  const unclear = classify(txns).filter((t) => t.classification === "unclear");
  trace.push({ tool: "agent.classify", detail: `${unclear.length} direct transfers can't be classified safely → ask the merchant`, ms: 0 });
  const questions: Question[] = unclear.map((t) => ({
    id: `q-${t.txnId}`,
    txnId: t.txnId,
    amount: t.txnAmount,
    payerName: t.payerName,
    date: t.txnDate,
    text: copy.question(t.payerName, t.txnAmount, fmtDate(t.txnDate)),
    options: [
      { value: "personal", ta: "குடும்பம்", en: "Family" },
      { value: "business", ta: "வியாபாரம்", en: "Sale" },
    ],
  }));
  return { mode: live ? "live" : "demo", model: live ? MODEL_ID : undefined, trace, bills, questions, replies: [copy.billsRead(bills.length, gst), copy.askTransfers] };
}

/* ---------- Phase 3: answers in → draft out ---------- */

export const encodeDraft = (d: GstDraft) => Buffer.from(JSON.stringify(d)).toString("base64url");
export const decodeDraft = (id: string) => JSON.parse(Buffer.from(id, "base64url").toString()) as GstDraft;

export async function finalize(answers: Record<string, "personal" | "business">, bills: Bill[]): Promise<AgentResult> {
  const trace: TraceStep[] = [];
  const txns = await paytm.getTransactions("2026-10");
  const draft = await timed(trace, "rules.buildGstDraft", async () =>
    buildDraft({ merchant, period: "2026-10", txns, bills: bills.length ? bills : sampleBills, answers }),
    (d) => `Output tax ${inr(d.outputTax.total)} − credit ${inr(d.credit.total)} (bills ${inr(d.credit.fromBills)} + MDR GST ${inr(d.credit.fromMdr)}) = ${inr(d.netPayable)}`);
  const id = encodeDraft(draft);
  trace.push({ tool: "share.draftLink", detail: "Draft saved; shareable link ready for the CA", ms: 0 });
  return {
    mode: aiEnabled() ? "live" : "demo",
    trace,
    draft,
    draftId: id,
    replies: [copy.draftReady(draft.netPayable, draft.credit.total, fmtDate(draft.dueDate))],
  };
}
