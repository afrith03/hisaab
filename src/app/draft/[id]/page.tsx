import { decodeDraft } from "@/lib/agent";
import { inr } from "@/lib/gst";
import PrintButton from "./PrintButton";

export const instant = false;

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let d;
  try { d = decodeDraft(id); } catch { return <main className="p-10">This draft link is invalid.</main>; }
  const date = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="min-h-screen bg-[#eef3f5] py-10 text-[#0b2230] print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-10 shadow-xl print:shadow-none">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-[#1a6b7e]">Draft for CA review · GSTR-3B summary</div>
            <h1 className="mt-1 text-3xl font-bold">{d.merchant.name}</h1>
            <div className="text-sm text-[#4b6470]">GSTIN {d.merchant.gstin} · Period: October 2026</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">Hisaab<span className="text-[#3aa02a]">.</span></div>
            <PrintButton />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4">
          <Card label="Output GST" value={inr(d.outputTax.total)} />
          <Card label="Input tax credit" value={inr(d.credit.total)} green />
          <Card label="Net payable" value={inr(d.netPayable)} dark />
        </div>
        <p className="mt-2 text-sm text-[#4b6470]">Due by {date(d.dueDate)}.{d.carryForward > 0 && ` Credit carried forward: ${inr(d.carryForward)}.`}</p>

        <Section title="1. Sales received on Paytm">
          <T rows={[
            ["Business receipts", `${d.receipts.businessCount} payments`, inr(d.receipts.businessValue)],
            ["Excluded: confirmed personal transfers", "", inr(d.receipts.personalValue)],
          ]} />
          <T head={["GST slab", "Value (incl. GST)", "Tax"]} rows={d.outputTax.bySlab.map((s) => [`${s.rate}%`, inr(s.value), inr(s.tax)])} />
          <p className="text-xs text-[#6b8590]">Slab split uses the merchant&apos;s item mix (configurable). CA to confirm against the billing register.</p>
        </Section>

        <Section title="2. Input tax credit">
          <T head={["Source", "Reference", "GST"]} rows={[
            ...d.credit.bills.map((b) => [b.supplier, b.invoiceNo, inr(b.gst)]),
            ["GST on UPI MDR fees", `${d.credit.mdrTxnCount} payments · MDR ${inr(d.credit.mdrTotal)}`, inr(d.credit.fromMdr)],
            ["Total credit", "", inr(d.credit.total)],
          ]} />
          <p className="text-xs text-[#6b8590]">MDR at 0.4% on P2M UPI payments above ₹2,000 (capped at ₹300) from 15 Oct 2026; 18% GST on the fee is claimable as ITC, subject to the provider&apos;s invoice.</p>
        </Section>

        <Section title="3. Notes">
          <ul className="list-disc space-y-1 pl-5 text-sm">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Section>

        <p className="mt-10 border-t pt-4 text-xs text-[#6b8590]">
          Prepared automatically by Hisaab from Paytm settlements and purchase bills. Hisaab prepares and reminds; the merchant or their CA reviews and files.
        </p>
      </div>
    </main>
  );
}

function Card({ label, value, green, dark }: { label: string; value: string; green?: boolean; dark?: boolean }) {
  return (
    <div className={`rounded-xl p-4 ${dark ? "bg-[#032d42] text-white" : green ? "bg-[#e6f7e2]" : "bg-[#f1f5f7]"}`}>
      <div className={`text-xs uppercase tracking-wide ${dark ? "text-[#a9c4cc]" : "text-[#4b6470]"}`}>{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-8 space-y-3"><h2 className="text-lg font-semibold">{title}</h2>{children}</section>;
}

function T({ head, rows }: { head?: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-sm">
      {head && <thead><tr className="border-b text-left text-[#4b6470]">{head.map((h, i) => <th key={h} className={`py-2 font-medium ${i === head.length - 1 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>}
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={`border-b border-[#eef2f4] ${r[0].startsWith("Total") ? "font-semibold" : ""}`}>
            {r.map((c, j) => <td key={j} className={`py-2 ${j === r.length - 1 ? "text-right tabular-nums" : ""}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
