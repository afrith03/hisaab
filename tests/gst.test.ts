import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDraft, classify, dueDate, expectedMdr, gstOnFee, outputTax } from "../src/lib/gst.ts";
import txns from "../src/data/october-2026-transactions.json" with { type: "json" };
import bills from "../src/data/bills.json" with { type: "json" };
import merchant from "../src/data/merchant.json" with { type: "json" };

test("MDR follows the 0.4% / Rs 2,000 / Rs 300 cap rule from 15 Oct 2026", () => {
  const p = (txnAmount: number, txnDate = "2026-10-20") => expectedMdr({ txnAmount, txnDate, flow: "P2M" });
  assert.equal(p(2000), 0);
  assert.equal(p(10000), 40);
  assert.equal(p(75000), 300);
  assert.equal(p(100000), 300);
  assert.equal(p(10000, "2026-10-14"), 0);
  assert.equal(expectedMdr({ txnAmount: 10000, txnDate: "2026-10-20", flow: "P2P" }), 0);
});

test("GST on a Rs 40 fee is Rs 7.20 (the deck's example)", () => {
  assert.equal(gstOnFee(40), 7.2);
});

test("sample data MDR matches the rule on every payment", () => {
  for (const t of txns as any[]) {
    assert.equal(t.mdr, expectedMdr(t), t.txnId);
    assert.equal(t.gstOnMdr, gstOnFee(t.mdr), t.txnId);
  }
});

test("large direct transfers are asked about, not guessed", () => {
  const c = classify(txns as any);
  const unclear = c.filter((t) => t.classification === "unclear").map((t) => t.payerName);
  assert.deepEqual(unclear.sort(), ["Karthik Subramanian", "Ravi Kumar", "Selvam R"]);
});

test("money paid out is never counted as a sale", () => {
  const out = (txns as any[]).find((t) => t.direction === "OUT");
  const a = buildDraft({ merchant: merchant as any, period: "2026-10", txns: txns as any, bills: [], answers: { [out.txnId]: "business" } });
  const b = buildDraft({ merchant: merchant as any, period: "2026-10", txns: (txns as any[]).filter((t) => t !== out), bills: [], answers: {} });
  assert.equal(a.receipts.businessValue, b.receipts.businessValue);
});

test("output tax extracts GST from inclusive prices", () => {
  const o = outputTax(10500, { "5": 1 });
  assert.equal(o.total, 500);
});

test("due date is the 20th of next month", () => {
  assert.equal(dueDate("2026-10"), "2026-11-20");
  assert.equal(dueDate("2026-12"), "2027-01-20");
});

test("answers move transfers in or out of sales", () => {
  const ravi = (txns as any[]).find((t) => t.payerName === "Ravi Kumar").txnId;
  const karthik = (txns as any[]).find((t) => t.payerName === "Karthik Subramanian").txnId;
  const base = buildDraft({ merchant: merchant as any, period: "2026-10", txns: txns as any, bills: bills as any });
  const answered = buildDraft({
    merchant: merchant as any, period: "2026-10", txns: txns as any, bills: bills as any,
    answers: { [ravi]: "personal", [karthik]: "business" },
  });
  assert.equal(answered.receipts.businessValue - base.receipts.businessValue, 8000);
  assert.equal(answered.receipts.personalValue, 5000);
  assert.ok(answered.credit.fromMdr > 0);
  assert.equal(answered.credit.total, Math.round((answered.credit.fromBills + answered.credit.fromMdr) * 100) / 100);
  console.log(JSON.stringify(answered, null, 1));
});
