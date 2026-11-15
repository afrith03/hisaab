// Shapes mirror Paytm transaction / settlement records so the sample source
// can be swapped for the Paytm MCP Server without changing the agent or rules.

export type Txn = {
  txnId: string;
  orderId: string;
  txnDate: string;
  txnAmount: number;
  paymentMode: string;
  flow: "P2M" | "P2P";
  /** Money into her account (default) or paid out from her Paytm UPI. payerName/payerVpa hold the other party. */
  direction?: "IN" | "OUT";
  payerName: string;
  payerVpa: string;
  status: string;
  mdr: number;
  gstOnMdr: number;
  settledAmount: number;
  settlementDate: string;
};

export type BillLine = {
  description: string;
  hsn: string;
  qty: number;
  rate: number;
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
};

export type Bill = {
  id: string;
  image?: string;
  /** Bill-book invoice filled in by hand (common with local wholesalers). */
  handwritten?: boolean;
  supplier: string;
  supplierGstin: string;
  invoiceNo: string;
  invoiceDate: string;
  lines: BillLine[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
};

export type Merchant = {
  mid: string;
  name: string;
  owner: string;
  city: string;
  gstin: string;
  language: string;
  /** Only "regular" GST registrants can claim input tax credit. */
  gstType: "regular" | "composition" | "unregistered";
  salesSlabMix: Record<string, number>;
};

export type Classification = "business" | "personal" | "unclear";

export type ClassifiedTxn = Txn & { classification: Classification; reason: string };

export type Question = {
  id: string;
  txnId: string;
  amount: number;
  payerName: string;
  date: string;
  text: { ta: string; hi: string; en: string };
  options: { value: "personal" | "business"; ta: string; hi: string; en: string }[];
  /** Where the money came from, straight from the Paytm transaction record. */
  direction: "IN" | "OUT";
  source: { channel: string; flow: string; payerVpa: string; txnId: string; time: string; settledTo: string };
};

export type GstDraft = {
  merchant: { name: string; gstin: string };
  period: string;
  receipts: { businessCount: number; businessValue: number; personalValue: number };
  outputTax: { bySlab: { rate: number; value: number; tax: number }[]; total: number };
  credit: {
    fromBills: number;
    fromMdr: number;
    total: number;
    bills: { supplier: string; invoiceNo: string; gst: number }[];
    mdrTxnCount: number;
    mdrTotal: number;
  };
  netPayable: number;
  carryForward: number;
  dueDate: string;
  notes: string[];
};
