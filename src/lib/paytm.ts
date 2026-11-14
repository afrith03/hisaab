// Paytm data source. The demo reads sample data shaped like Paytm transaction
// and settlement records. To go live, implement the same two functions with
// the Paytm MCP Server (https://mcp.paytmpayments.com/mcp) via @ai-sdk/mcp.

import txns from "@/data/october-2026-transactions.json";
import merchantJson from "@/data/merchant.json";
import billsJson from "@/data/bills.json";
import type { Bill, Merchant, Txn } from "./types";

export const merchant = merchantJson as Merchant;
export const sampleBills = billsJson as Bill[];

export interface PaytmSource {
  name: string;
  getTransactions(period: string): Promise<Txn[]>;
}

export const sampleSource: PaytmSource = {
  name: "Sample data (Paytm MCP format)",
  async getTransactions(period: string) {
    return (txns as Txn[]).filter((t) => t.txnDate.startsWith(period));
  },
};

export const paytm: PaytmSource = sampleSource;
