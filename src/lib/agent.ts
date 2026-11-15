import { aiEnabled, MODEL_ID } from "./ai";
import { chat, extractDocument, imageBlob, type ChatMessage, type ToolDef } from "./sarvam";
import { buildDraft, billCredit, classify, inr } from "./gst";
import { merchant, paytm, sampleBills } from "./paytm";
import { copy, fmtDate, fmtDateTime, loanLine, optionLabels, optionLabelsOut, type Line } from "./copy";
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
  loan?: LoanOffer;
};

export type LoanOffer = {
  verifiedSales: number;
  creditFound: number;
  netPayable: number;
  indicativeLimit: number;
  repayment: string;
  simulated: true;
};

const timed = async <T>(trace: TraceStep[], name: string, fn: () => Promise<T>, detail: (r: T) => string) => {
  const t0 = Date.now();
  const r = await fn();
  trace.push({ tool: name, detail: detail(r), ms: Date.now() - t0 });
  return r;
};

/* ---------- Phase 1: merchant asks "is my GST ready?" ---------- */

async function pullSettlements(period: string, trace: TraceStep[]) {
  trace.push({
    tool: "rules.eligibility",
    detail: merchant.gstType === "regular"
      ? `GSTIN ${merchant.gstin} · regular scheme → input tax credit allowed (needs supplier invoice in GSTR-2B)`
      : `${merchant.gstType} → no input tax credit; Hisaab keeps books only`,
    ms: 0,
  });
  const txns = await timed(trace, "paytm.getTransactions", () => paytm.getTransactions(period),
    (r) => `${r.length} transactions for ${period} from ${paytm.name}`);
  const biz = classify(txns).filter((t) => t.classification === "business");
  const mdr = biz.filter((t) => t.mdr > 0);
  const gst = Math.round(mdr.reduce((s, t) => s + t.gstOnMdr, 0) * 100) / 100;
  trace.push({ tool: "rules.mdrCredit", detail: `${mdr.length} payments above ₹2,000 had MDR; GST on fees ${inr(gst)} → input tax credit`, ms: 1 });
  return { count: txns.length, mdrCount: mdr.length, gst };
}

const TOOLS: ToolDef[] = [{
  type: "function",
  function: {
    name: "getSettlements",
    description: "Fetch the merchant's Paytm payments and settlements for one month and compute the GST credit on MDR fees.",
    parameters: {
      type: "object",
      properties: { period: { type: "string", description: "Month as YYYY-MM" } },
      required: ["period"],
    },
  },
}];

export async function startMonth(message: string): Promise<AgentResult> {
  const trace: TraceStep[] = [];
  if (aiEnabled()) {
    try {
      const messages: ChatMessage[] = [
        { role: "system", content:
          "You are Hisaab, a GST bookkeeping agent for a small regular-GST-registered shop in Tamil Nadu that takes payments on Paytm. " +
          "Today is 15 Nov 2026. The merchant may speak Tamil, Hindi, English or a mix. When they ask about GST for a month, call getSettlements " +
          "with that month as YYYY-MM. If they don't name a month, use the previous month (2026-10)." },
        { role: "user", content: message },
      ];
      const t0 = Date.now();
      const reply = await chat({ messages, tools: TOOLS, tool_choice: "required" });
      const call = reply.tool_calls?.find((c) => c.function.name === "getSettlements");
      if (!call) throw new Error("model did not call a tool");
      const { period } = JSON.parse(call.function.arguments || "{}") as { period?: string };
      const p = /^\d{4}-\d{2}$/.test(period ?? "") ? period! : "2026-10";
      trace.push({ tool: "llm.decide", detail: `${MODEL_ID} understood the voice note → getSettlements("${p}")`, ms: Date.now() - t0 });
      const s = await pullSettlements(p, trace);
      return { mode: "live", model: MODEL_ID, trace, replies: [copy.pulled(s.count, s.mdrCount, s.gst), copy.askBills] };
    } catch (e) {
      trace.push({ tool: "llm.fallback", detail: `Sarvam unavailable (${(e as Error).message.slice(0, 80)}) → rules path`, ms: 0 });
    }
  } else {
    trace.push({ tool: "agent.plan", detail: `Intent "GST status" → period 2026-10 (demo mode)`, ms: 0 });
  }
  const s = await pullSettlements("2026-10", trace);
  return { mode: "demo", trace, replies: [copy.pulled(s.count, s.mdrCount, s.gst), copy.askBills] };
}

/* ---------- Phase 2: merchant sends bill photos ---------- */

// Sarvam Document AI schema: every field needs a type and a description; depth ≤ 4.
const num = (d: string) => ({ type: "number", description: d });
const str = (d: string) => ({ type: "string", description: d });
const BILL_SCHEMA = {
  type: "object",
  properties: {
    supplier: str("Supplier / seller business name"),
    supplierGstin: str("Supplier GSTIN, 15 characters"),
    invoiceNo: str("Invoice number"),
    invoiceDate: str("Invoice date as YYYY-MM-DD"),
    handwritten: { type: "boolean", description: "True if the line items and totals are written by hand" },
    lines: {
      type: "array",
      description: "Line items on the invoice",
      items: {
        type: "object",
        properties: {
          description: str("Item description"), hsn: str("HSN code"), qty: num("Quantity"), rate: num("Unit rate in INR"),
          gstRate: num("GST rate percent"), taxable: num("Taxable value in INR"), cgst: num("CGST amount in INR"), sgst: num("SGST amount in INR"),
        },
      },
    },
    taxable: num("Total taxable value in INR"),
    cgst: num("Total CGST in INR"),
    sgst: num("Total SGST in INR"),
    igst: num("Total IGST in INR, 0 if absent"),
    total: num("Invoice grand total in INR"),
  },
};

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

// A bill counts as a tax invoice, printed or handwritten, only if it carries what the GST rules require.
function checkBill(b: Bill): string[] {
  const issues: string[] = [];
  if (!GSTIN.test(b.supplierGstin)) issues.push("supplier GSTIN missing or wrong");
  if (!b.invoiceNo) issues.push("no invoice number");
  if (!b.invoiceDate) issues.push("no date");
  if (b.lines.some((l) => !l.hsn)) issues.push("HSN code missing on an item");
  if (b.cgst + b.sgst + b.igst <= 0) issues.push("no GST shown separately");
  if (Math.abs(b.taxable + b.cgst + b.sgst + b.igst - b.total) > 1) issues.push("totals don't add up");
  return issues;
}

const n = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "0").replace(/[^\d.-]/g, "")) || 0);

async function readOne(image: { id: string; dataUrl?: string; path?: string }): Promise<{ bill: Bill; live: boolean; note?: string }> {
  const sample = sampleBills.find((b) => b.id === image.id);
  if (aiEnabled()) {
    try {
      const x = await extractDocument(await imageBlob({ dataUrl: image.dataUrl, path: image.path ?? sample?.image }), BILL_SCHEMA);
      const r = (x.data ?? {}) as Record<string, unknown>;
      const conf = x.confidence.supplierGstin;
      const lines = Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : [];
      const bill: Bill = {
        id: image.id,
        image: sample?.image,
        handwritten: r.handwritten === true,
        supplier: String(r.supplier ?? ""),
        supplierGstin: String(r.supplierGstin ?? "").replace(/\s/g, "").toUpperCase(),
        invoiceNo: String(r.invoiceNo ?? ""),
        invoiceDate: String(r.invoiceDate ?? ""),
        lines: lines.map((l) => ({
          description: String(l.description ?? ""), hsn: String(l.hsn ?? ""), qty: n(l.qty), rate: n(l.rate),
          gstRate: n(l.gstRate), taxable: n(l.taxable), cgst: n(l.cgst), sgst: n(l.sgst),
        })),
        taxable: n(r.taxable), cgst: n(r.cgst), sgst: n(r.sgst), igst: n(r.igst), total: n(r.total),
      };
      if (!bill.supplier || bill.total <= 0) throw new Error("empty extraction");
      return { bill, live: true, note: typeof conf === "number" ? `GSTIN confidence ${Math.round(conf * 100)}%` : undefined };
    } catch (e) {
      if (!sample) throw e;
      return { bill: sample, live: false, note: (e as Error).message.slice(0, 70) };
    }
  }
  if (!sample) throw new Error("Unknown bill in demo mode");
  return { bill: sample, live: false };
}

export async function readBills(images: { id: string; dataUrl?: string; path?: string }[]): Promise<AgentResult> {
  const trace: TraceStep[] = [];
  const t0 = Date.now();
  // Read all photos in parallel so three bills cost one round-trip on stage.
  const results = await Promise.all(images.map((img) => readOne(img)));
  const ms = Date.now() - t0;
  const bills: Bill[] = [];
  const live = results.some((r) => r.live);
  for (const r of results) {
    const b = r.bill;
    trace.push({
      tool: r.live ? "vision.readBill" : aiEnabled() ? "vision.fallback" : "vision.readBill",
      detail: `${b.handwritten ? "✍ Handwritten bill · " : ""}${b.supplier} · ${b.invoiceNo} · GSTIN ${b.supplierGstin} · GST ${inr(billCredit(b))}` +
        (r.live ? ` (Sarvam Vision${r.note ? `, ${r.note}` : ""})` : r.note ? ` (saved copy; ${r.note})` : ""),
      ms,
    });
    const issues = checkBill(b);
    trace.push({
      tool: "rules.validateBill",
      detail: issues.length
        ? `⚠ Not a valid tax invoice yet (${issues.join(", ")}) → no credit; ask the merchant for a proper bill`
        : b.handwritten
          ? "Handwritten, but has GSTIN, invoice no, date, HSN and GST split → valid tax invoice. Credit is final once it shows in GSTR-2B"
          : "GSTIN valid, totals add up",
      ms: 0,
    });
    bills.push(b);
  }
  const gst = Math.round(bills.reduce((s, b) => s + billCredit(b), 0) * 100) / 100;

  const txns = await paytm.getTransactions("2026-10");
  const unclear = classify(txns).filter((t) => t.classification === "unclear");
  trace.push({ tool: "agent.classify", detail: `${unclear.length} direct UPI transfers (not shop QR) are unclear: money in could be a sale or family money, money out could be a shop purchase or personal → ask the merchant`, ms: 0 });
  const questions: Question[] = unclear.map((t) => {
    const out = t.direction === "OUT";
    const labels = out ? optionLabelsOut : optionLabels;
    return {
      id: `q-${t.txnId}`,
      txnId: t.txnId,
      amount: t.txnAmount,
      payerName: t.payerName,
      date: t.txnDate,
      direction: out ? "OUT" : "IN",
      text: out ? copy.questionOut(t.payerName, t.txnAmount, fmtDate(t.txnDate)) : copy.question(t.payerName, t.txnAmount, fmtDate(t.txnDate)),
      options: [
        { value: "business", ...labels.business },
        { value: "personal", ...labels.personal },
      ],
      source: {
        channel: `Paytm ${t.paymentMode}`,
        flow: out ? `Paid from her Paytm UPI to ${t.payerName}` : t.flow === "P2P" ? "Sent straight to her Paytm account, not via shop QR" : "Shop QR payment",
        payerVpa: t.payerVpa,
        txnId: t.txnId,
        time: fmtDateTime(t.txnDate),
        settledTo: out ? "Debited same day" : `Settled ${fmtDate(t.settlementDate)}`,
      },
    };
  });
  return { mode: live ? "live" : "demo", model: live ? MODEL_ID : undefined, trace, bills, questions, replies: [copy.billsRead(bills.length, gst, bills.filter((b) => b.handwritten).length), copy.askTransfers] };
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
  const shopPaid = txns.filter((t) => t.direction === "OUT" && answers[t.txnId] === "business");
  for (const t of shopPaid)
    trace.push({ tool: "rules.shopExpense", detail: `${inr(t.txnAmount)} paid to ${t.payerName} → shop expense, not a sale; GST claimable once its tax invoice is added`, ms: 0 });
  trace.push({ tool: "share.draftLink", detail: "Draft saved; shareable link ready for the CA", ms: 0 });
  return {
    mode: aiEnabled() ? "live" : "demo",
    trace,
    draft,
    draftId: id,
    replies: [...shopPaid.map((t) => copy.billNeeded(t.payerName, t.txnAmount)), copy.draftReady(draft.netPayable, draft.credit.total, fmtDate(draft.dueDate))],
  };
}

/* ---------- Phase 4: clean books → a loan she can finally get ---------- */

// Illustrative only. Paytm's merchant loans have averaged about ₹2 lakh per loan, repaid from daily
// settlements; the real offer, limit and terms come from Paytm's lending partner, not from Hisaab.
const INDICATIVE_LIMIT = 200000;

export async function offerLoan(draft: GstDraft): Promise<AgentResult> {
  const trace: TraceStep[] = [];
  trace.push({
    tool: "lending.booksPack",
    detail: `Verified October books: sales ${inr(draft.receipts.businessValue)}, GST draft ready before ${fmtDate(draft.dueDate)}, transfers confirmed by the merchant. Shared only with her consent`,
    ms: 0,
  });
  trace.push({
    tool: "lending.precheck",
    detail: `Simulated partner pre-check → indicative offer up to ₹2 lakh, repaid from daily Paytm settlements`,
    ms: 0,
  });
  const sales = "₹" + draft.receipts.businessValue.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return {
    mode: aiEnabled() ? "live" : "demo",
    trace,
    replies: [loanLine(sales)],
    loan: {
      verifiedSales: draft.receipts.businessValue,
      creditFound: draft.credit.total,
      netPayable: draft.netPayable,
      indicativeLimit: INDICATIVE_LIMIT,
      repayment: "From daily Paytm settlements",
      simulated: true,
    },
  };
}
