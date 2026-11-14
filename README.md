# Hisaab. — the tax agent for every Paytm merchant

Paytm settlements in, GST-ready books out, and every rupee of credit found.
Team **Zero Balance Heroes** · Paytm Build for India AI Hackathon, Chennai · Track 1

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add keys for live AI and Tamil voice
npm run dev                  # http://localhost:3000
npm test                     # GST rules tests
```

With no keys it runs in **demo mode**: the same tools and rules, sample data, scripted replies.
Add `GEMINI_API_KEYS` for live tool calling and bill reading, and `SARVAM_API_KEY` for live Tamil voice.
`DEMO_MODE=1` forces demo mode on stage if Wi-Fi or quotas fail.

Deploy: push to GitHub → import in Vercel (Hobby, free) → add the same env vars.

## The demo (about 2 minutes)

1. **Send Meena's voice note** — "அக்டோபர் மாச GST ரெடியா?" (Is my GST ready for October?)
   → agent calls `paytm.getTransactions`, rules find **GST on MDR fees** as credit.
2. **Send 3 bill photos** → `vision.readBill` extracts GSTIN, items, tax; `rules.validateBill` checks them.
3. **Answer two questions** — Ravi's ₹5,000 = family, Karthik's ₹8,000 = sale. Hisaab asks, never guesses.
4. **Draft appears** → output GST, credit (bills + MDR GST), net payable, due date.
5. **Send to CA** → opens the shareable draft at `/draft/[id]`.

## How it's built

| Piece | Where |
|---|---|
| Chat UI + agent trace | `src/components/HisaabDemo.tsx` |
| Agent (AI SDK tool calling, Gemini) with rules fallback | `src/lib/agent.ts`, `src/app/api/agent/route.ts` |
| GST rules (deterministic, tested) | `src/lib/gst.ts`, `tests/gst.test.ts` |
| Paytm data source (sample data in Paytm MCP shape) | `src/lib/paytm.ts`, `src/data/*.json` |
| Tamil voice (Sarvam STT/TTS, browser fallback) | `src/app/api/voice/*` |
| CA draft page | `src/app/draft/[id]/page.tsx` |
| All Tamil/English lines | `src/lib/copy.ts` |
| Regenerate sample data and bill images | `npm run data` |

**Going live on Paytm data:** implement `PaytmSource.getTransactions` in `src/lib/paytm.ts`
with the Paytm MCP Server (`https://mcp.paytmpayments.com/mcp`, merchant login) via `@ai-sdk/mcp`.
The agent and rules don't change.

All merchant data in this repo is synthetic. Meena, Ravi and Karthik are made up.
