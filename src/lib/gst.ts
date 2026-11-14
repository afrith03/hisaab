// Deterministic GST rules. The AI never calculates tax: it extracts and
// classifies, and these pure functions do the arithmetic. Rates and dates are
// configuration, so a rule change is a data change, not a model change.

import type { Bill, ClassifiedTxn, GstDraft, Merchant, Txn } from "./types";

export const RULES_VERSION = "2026-10-15";
export const MDR_RULE = {
  effectiveFrom: "2026-10-15",
  thresholdExclusive: 2000, // P2M UPI payments above Rs 2,000
  rate: 0.004, // 0.4%
  cap: 300, // Rs 300 per transaction
  gstOnFee: 0.18, // 18% GST on the fee, claimable as input tax credit
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** MDR the bank should have deducted on one UPI payment. */
export function expectedMdr(t: Pick<Txn, "txnAmount" | "txnDate" | "flow">): number {
  if (t.flow !== "P2M") return 0;
  if (t.txnDate.slice(0, 10) < MDR_RULE.effectiveFrom) return 0;
  if (t.txnAmount <= MDR_RULE.thresholdExclusive) return 0;
  return r2(Math.min(t.txnAmount * MDR_RULE.rate, MDR_RULE.cap));
}

/** GST charged on an MDR fee. */
export const gstOnFee = (mdr: number) => r2(mdr * MDR_RULE.gstOnFee);

/**
 * Classify receipts. Merchant QR (P2M) payments are sales. Person-to-person
 * transfers can be family money or a customer paying directly, so the agent
 * asks instead of guessing.
 */
export function classify(txns: Txn[], answers: Record<string, "personal" | "business"> = {}): ClassifiedTxn[] {
  return txns.map((t) => {
    if (answers[t.txnId]) {
      return { ...t, classification: answers[t.txnId], reason: "Confirmed by merchant" };
    }
    if (t.flow === "P2M") return { ...t, classification: "business", reason: "Paid to shop QR" };
    if (t.txnAmount >= 3000) {
      return { ...t, classification: "unclear", reason: "Large direct transfer from an individual" };
    }
    return { ...t, classification: "personal", reason: "Small direct transfer" };
  });
}

/** Output tax on GST-inclusive sales, split by the merchant's slab mix. */
export function outputTax(businessValue: number, slabMix: Record<string, number>) {
  const bySlab = Object.entries(slabMix)
    .map(([rate, share]) => {
      const pct = Number(rate);
      const value = r2(businessValue * share);
      const tax = r2((value * pct) / (100 + pct));
      return { rate: pct, value, tax };
    })
    .sort((a, b) => a.rate - b.rate);
  return { bySlab, total: r2(bySlab.reduce((s, x) => s + x.tax, 0)) };
}

/** Input tax credit from supplier bills (CGST + SGST + IGST). */
export const billCredit = (b: Bill) => r2(b.cgst + b.sgst + b.igst);

/** GSTR-3B due date: the 20th of the following month. */
export function dueDate(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-20`;
}

export function buildDraft(args: {
  merchant: Merchant;
  period: string;
  txns: Txn[];
  bills: Bill[];
  answers?: Record<string, "personal" | "business">;
}): GstDraft {
  const { merchant, period, bills } = args;
  const classified = classify(args.txns, args.answers);
  const business = classified.filter((t) => t.classification === "business");
  const personal = classified.filter((t) => t.classification === "personal");
  const unclear = classified.filter((t) => t.classification === "unclear");

  const businessValue = r2(business.reduce((s, t) => s + t.txnAmount, 0));
  const out = outputTax(businessValue, merchant.salesSlabMix);

  const mdrTxns = business.filter((t) => t.mdr > 0);
  const mdrTotal = r2(mdrTxns.reduce((s, t) => s + t.mdr, 0));
  const fromMdr = r2(mdrTxns.reduce((s, t) => s + t.gstOnMdr, 0));
  const fromBills = r2(bills.reduce((s, b) => s + billCredit(b), 0));
  const credit = r2(fromBills + fromMdr);
  const net = r2(out.total - credit);

  const notes: string[] = [];
  const mismatched = mdrTxns.filter((t) => Math.abs(t.mdr - expectedMdr(t)) > 0.01);
  if (mismatched.length) notes.push(`${mismatched.length} payment(s) had an MDR deduction that doesn't match the 0.4% rule.`);
  if (unclear.length) notes.push(`${unclear.length} transfer(s) still need the merchant's confirmation and are left out of sales.`);
  notes.push(`Rules version ${RULES_VERSION}. Draft for review by the merchant's CA before filing.`);

  return {
    merchant: { name: merchant.name, gstin: merchant.gstin },
    period,
    receipts: {
      businessCount: business.length,
      businessValue,
      personalValue: r2(personal.reduce((s, t) => s + t.txnAmount, 0)),
    },
    outputTax: out,
    credit: {
      fromBills,
      fromMdr,
      total: credit,
      bills: bills.map((b) => ({ supplier: b.supplier, invoiceNo: b.invoiceNo, gst: billCredit(b) })),
      mdrTxnCount: mdrTxns.length,
      mdrTotal,
    },
    netPayable: Math.max(net, 0),
    carryForward: net < 0 ? r2(-net) : 0,
    dueDate: dueDate(period),
    notes,
  };
}

export const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
