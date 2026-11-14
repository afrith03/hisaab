"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentResult, TraceStep } from "@/lib/agent";
import type { Line } from "@/lib/copy";
import type { Bill, GstDraft, Question } from "@/lib/types";

const VOICE_NOTE: Line = { ta: "அக்டோபர் மாச GST ரெடியா?", en: "Is my GST ready for October?" };
const BILL_IMAGES = ["bill-1", "bill-2", "bill-3"].map((id) => ({ id, path: `/bills/${id}.png` }));

type Msg =
  | { id: number; from: "me"; kind: "voice"; line: Line; seconds: number }
  | { id: number; from: "me"; kind: "images"; images: string[] }
  | { id: number; from: "me"; kind: "text"; line: Line }
  | { id: number; from: "bot"; kind: "text"; line: Line }
  | { id: number; from: "bot"; kind: "question"; q: Question }
  | { id: number; from: "bot"; kind: "draft"; draft: GstDraft; draftId: string };

type NoId<T> = T extends unknown ? Omit<T, "id"> : never;
type Stage = "idle" | "working" | "awaitBills" | "awaitAnswers" | "awaitSend" | "done";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const now = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

export default function HisaabDemo() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [trace, setTrace] = useState<(TraceStep & { phase: string })[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [typing, setTyping] = useState(false);
  const [bills, setBills] = useState<Bill[]>([]);
  const [answers, setAnswers] = useState<Record<string, "personal" | "business">>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  const [credit, setCredit] = useState({ mdr: 0, bills: 0 });
  const [cfg, setCfg] = useState<{ ai: string | null; voice: boolean }>({ ai: null, voice: false });
  const [speak, setSpeak] = useState(true);
  const [recording, setRecording] = useState(false);
  const idRef = useRef(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const traceRef = useRef<HTMLOListElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  useEffect(() => { fetch("/api/config").then((r) => r.json()).then(setCfg).catch(() => {}); }, []);
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, typing]);
  useEffect(() => { traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight, behavior: "smooth" }); }, [trace]);

  const push = (m: NoId<Msg>) => setMsgs((xs) => [...xs, { ...m, id: ++idRef.current } as Msg]);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function say(line: Line) {
    if (!speak || typeof window === "undefined") return;
    try {
      if (cfg.voice) {
        const r = await fetch("/api/voice/tts", { method: "POST", body: JSON.stringify({ text: line.ta }) });
        const j = await r.json();
        if (j.audio) { await new Audio(`data:audio/wav;base64,${j.audio}`).play(); return; }
      }
      const u = new SpeechSynthesisUtterance(line.ta);
      u.lang = "ta-IN";
      speechSynthesis.speak(u);
    } catch { /* voice is a nice-to-have */ }
  }

  async function call(phase: string, body: object): Promise<AgentResult> {
    setTyping(true);
    const t0 = Date.now();
    const r = await fetch("/api/agent", { method: "POST", body: JSON.stringify({ phase, ...body }) });
    const j = (await r.json()) as AgentResult & { error?: string };
    if (j.error) throw new Error(j.error);
    const elapsed = Date.now() - t0;
    if (elapsed < 900) await wait(900 - elapsed);
    for (const s of j.trace) { setTrace((t) => [...t, { ...s, phase }]); await wait(260); }
    setTyping(false);
    return j;
  }

  async function botLines(lines: Line[]) {
    for (const l of lines) { push({ from: "bot", kind: "text", line: l }); say(l); await wait(700); setTyping(true); await wait(500); }
    setTyping(false);
  }

  /* Step 1: voice note */
  async function sendVoice(line: Line, seconds = 3) {
    setStage("working");
    push({ from: "me", kind: "voice", line, seconds });
    const r = await call("start", { message: `${line.ta} (${line.en})` });
    const m = r.trace.find((t) => t.tool === "rules.mdrCredit")?.detail.match(/fees ₹([\d,.]+)/);
    if (m) setCredit((c) => ({ ...c, mdr: Number(m[1].replace(/,/g, "")) }));
    await botLines(r.replies);
    setStage("awaitBills");
  }

  async function toggleRecord() {
    if (!cfg.voice) return sendVoice(VOICE_NOTE);
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const t0 = Date.now();
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((t) => t.stop());
        const fd = new FormData();
        fd.append("file", new Blob(chunks, { type: "audio/webm" }), "voice.webm");
        const j = await fetch("/api/voice/stt", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({}));
        const ta = j.transcript || VOICE_NOTE.ta;
        sendVoice({ ta, en: j.transcript ? "(live transcript)" : VOICE_NOTE.en }, Math.max(1, Math.round((Date.now() - t0) / 1000)));
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch { sendVoice(VOICE_NOTE); }
  }

  /* Step 2: bill photos */
  async function sendBills() {
    setStage("working");
    push({ from: "me", kind: "images", images: BILL_IMAGES.map((b) => b.path) });
    const r = await call("bills", { images: BILL_IMAGES });
    setBills(r.bills ?? []);
    setCredit((c) => ({ ...c, bills: (r.bills ?? []).reduce((s, b) => s + b.cgst + b.sgst + b.igst, 0) }));
    await botLines(r.replies);
    for (const q of r.questions ?? []) { push({ from: "bot", kind: "question", q }); await wait(450); }
    setQuestions(r.questions ?? []);
    setStage("awaitAnswers");
  }

  /* Step 3: answers → draft */
  async function answer(q: Question, value: "personal" | "business") {
    if (answers[q.txnId]) return;
    const opt = q.options.find((o) => o.value === value)!;
    const next = { ...answers, [q.txnId]: value };
    setAnswers(next);
    push({ from: "me", kind: "text", line: { ta: opt.ta, en: opt.en } });
    if (Object.keys(next).length < questions.length) return;
    setStage("working");
    const r = await call("finalize", { answers: next, bills });
    await botLines(r.replies);
    if (r.draft && r.draftId) push({ from: "bot", kind: "draft", draft: r.draft, draftId: r.draftId });
    setStage("awaitSend");
  }

  async function sendToCa(draftId: string) {
    window.open(`/draft/${draftId}`, "_blank");
    push({ from: "me", kind: "text", line: { ta: "சரி, அனுப்புங்க", en: "Yes, send it" } });
    setTrace((t) => [...t, { tool: "share.sendToCa", detail: "Draft link shared with the merchant's CA", ms: 0, phase: "send" }]);
    await wait(500);
    await botLines([{ ta: "அனுப்பிட்டேன். ஆடிட்டர் சரிபார்த்து file பண்ணுவாங்க. 17-ஆம் தேதி ஞாபகப்படுத்துறேன்.", en: "Sent. Your CA will review and file it. I'll remind you on the 17th." }]);
    setStage("done");
  }

  function reset() {
    setMsgs([]); setTrace([]); setStage("idle"); setBills([]); setAnswers({}); setQuestions([]); setCredit({ mdr: 0, bills: 0 });
  }

  const totalCredit = credit.mdr + credit.bills;

  return (
    <main className="bg-grid h-screen overflow-hidden">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold tracking-tight">Hisaab<span className="text-wasabi">.</span></span>
          <span className="rounded-full border border-wasabi/60 bg-[#0e4a3c] px-3 py-0.5 text-[11px] font-semibold tracking-wide text-wasabi">TAX AGENT FOR PAYTM MERCHANTS</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`rounded-full px-3 py-1 font-medium ${cfg.ai ? "bg-wasabi text-ink" : "bg-panel text-muted"}`}>
            {cfg.ai ? `Live AI · ${cfg.ai}` : "Demo mode · rules + sample data"}
          </span>
          <span className="rounded-full bg-panel px-3 py-1 text-muted">Data: sample merchant · Paytm MCP format</span>
          <button onClick={() => setSpeak((s) => !s)} className="rounded-full bg-panel px-3 py-1 text-muted hover:text-white">{speak ? "Voice on" : "Voice off"}</button>
          <button onClick={reset} className="rounded-full border border-line px-3 py-1 text-muted hover:text-white">Restart</button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 pb-4 lg:grid-cols-[400px_1fr]">
        {/* Phone */}
        <section className="mx-auto w-full max-w-[400px] overflow-hidden rounded-[2.2rem] border-[10px] border-[#0b1418] bg-[#0b141a] shadow-2xl">
          <div className="flex items-center gap-3 bg-[#1f2c34] px-4 py-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-wasabi text-sm font-bold text-ink">H.</div>
            <div className="flex-1">
              <div className="text-sm font-semibold">Hisaab</div>
              <div className="text-[11px] text-[#8696a0]">{typing ? "typing…" : "GST helper · Meena Provision Store"}</div>
            </div>
          </div>
          <div ref={chatRef} className="h-[calc(100vh-250px)] min-h-[420px] space-y-2 overflow-y-auto bg-[#0b141a] px-3 py-4" data-testid="chat">
            {msgs.length === 0 && (
              <div className="mx-auto mt-24 max-w-[260px] text-center text-xs text-[#8696a0]">
                Meena runs a provision store in Chennai and takes payments on Paytm. It&apos;s the start of November.
              </div>
            )}
            {msgs.map((m) => <Bubble key={m.id} m={m} answers={answers} onAnswer={answer} onSend={sendToCa} stage={stage} />)}
            {typing && (
              <div className="pop w-fit rounded-lg rounded-tl-none bg-[#202c33] px-4 py-3">
                <span className="dot inline-block h-2 w-2 rounded-full bg-[#8696a0]" /> <span className="dot inline-block h-2 w-2 rounded-full bg-[#8696a0]" /> <span className="dot inline-block h-2 w-2 rounded-full bg-[#8696a0]" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 bg-[#1f2c34] px-3 py-3">
            {stage === "idle" && (
              <button data-testid="voice" onClick={toggleRecord} className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold ${recording ? "bg-[#ff6b6b] text-white" : "bg-wasabi text-ink"}`}>
                <MicIcon /> {recording ? "Recording… tap to send" : cfg.voice ? "Tap to speak (Tamil)" : "Send Meena's voice note"}
              </button>
            )}
            {stage === "awaitBills" && (
              <button data-testid="bills" onClick={sendBills} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-wasabi py-2.5 text-sm font-semibold text-ink">
                <ClipIcon /> Send 3 bill photos
              </button>
            )}
            {(stage === "working" || stage === "awaitAnswers" || stage === "awaitSend" || stage === "done") && (
              <div className="flex-1 rounded-full bg-[#2a3942] px-4 py-2.5 text-sm text-[#8696a0]">
                {stage === "awaitAnswers" ? "Tap an answer above" : stage === "awaitSend" ? "Review the draft above" : stage === "done" ? "Done for October ✓" : "Hisaab is working…"}
              </div>
            )}
          </div>
        </section>

        {/* Agent panel */}
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="GST on MDR fees" value={inr(credit.mdr)} hint="new since 15 Oct" accent="text-amber" />
            <Stat label="Credit from bills" value={inr(credit.bills)} hint="read from photos" accent="text-mint" />
            <Stat label="Credit found" value={inr(totalCredit)} hint="for October" accent="text-wasabi" big />
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-panel/70 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-wasabi">AGENT TRACE</h2>
              <span className="text-[11px] text-muted">AI reads and sorts · rules compute tax · merchant approves</span>
            </div>
            {trace.length === 0 && <p className="text-sm text-muted">Each tool the agent calls appears here as it runs.</p>}
            <ol ref={traceRef} className="h-[calc(100vh-340px)] min-h-[300px] space-y-2 overflow-y-auto pr-1" data-testid="trace">
              {trace.map((t, i) => (
                <li key={i} className="pop flex gap-3 rounded-lg bg-ink/60 px-3 py-2">
                  <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${toolColor(t.tool)}`}>{t.tool}</span>
                  <span className="text-[13px] leading-snug text-[#dbe7ea]">{t.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </main>
  );
}

function toolColor(tool: string) {
  if (tool.startsWith("paytm")) return "bg-[#00baf2] text-ink";
  if (tool.startsWith("rules")) return "bg-wasabi text-ink";
  if (tool.startsWith("vision") || tool.startsWith("llm")) return "bg-mint text-ink";
  if (tool.startsWith("share")) return "bg-amber text-ink";
  return "bg-line text-white";
}

function Stat({ label, value, hint, accent, big }: { label: string; value: string; hint: string; accent: string; big?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${big ? "border-wasabi bg-[#0e4a3c]" : "border-line bg-panel/70"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${accent}`} data-testid={big ? "credit" : undefined}>{value}</div>
      <div className="text-[11px] text-muted">{hint}</div>
    </div>
  );
}

function Bubble({ m, answers, onAnswer, onSend, stage }: {
  m: Msg; answers: Record<string, string>; onAnswer: (q: Question, v: "personal" | "business") => void; onSend: (id: string) => void; stage: Stage;
}) {
  const mine = m.from === "me";
  const base = `pop max-w-[85%] rounded-lg px-3 py-2 text-[14px] shadow ${mine ? "ml-auto rounded-tr-none bg-[#005c4b]" : "rounded-tl-none bg-[#202c33]"}`;
  const time = <div className="mt-1 text-right text-[10px] text-[#8696a0]">{now()}</div>;

  if (m.kind === "voice")
    return (
      <div className={base}>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-wasabi text-ink"><PlayIcon /></span>
          <div className="flex h-6 flex-1 items-center gap-[2px]">
            {Array.from({ length: 28 }).map((_, i) => <span key={i} className="w-[3px] rounded bg-[#8fd6c4]" style={{ height: `${6 + ((i * 37) % 17)}px` }} />)}
          </div>
          <span className="text-[11px] text-[#c9e8df]">0:0{m.seconds}</span>
        </div>
        <div className="tamil mt-2 text-[13px]">{m.line.ta}</div>
        <div className="text-[11px] italic text-[#a6d3c7]">{m.line.en}</div>
        {time}
      </div>
    );
  if (m.kind === "images")
    return (
      <div className={`${base} p-1`}>
        <div className="grid grid-cols-3 gap-1">
          {m.images.map((src) => <img key={src} src={src} alt="Purchase bill" className="h-28 w-full rounded object-cover object-top" />)}
        </div>
        <div className="px-2 pb-1">{time}</div>
      </div>
    );
  if (m.kind === "text")
    return (
      <div className={base}>
        <div className="tamil">{m.line.ta}</div>
        <div className="mt-1 text-[12px] italic text-[#8696a0]">{m.line.en}</div>
        {time}
      </div>
    );
  if (m.kind === "question") {
    const chosen = answers[m.q.txnId];
    return (
      <div className={base}>
        <div className="tamil">{m.q.text.ta}</div>
        <div className="mt-1 text-[12px] italic text-[#8696a0]">{m.q.text.en}</div>
        <div className="mt-2 flex gap-2">
          {m.q.options.map((o) => (
            <button key={o.value} data-testid={`ans-${m.q.payerName.split(" ")[0]}-${o.value}`} disabled={!!chosen}
              onClick={() => onAnswer(m.q, o.value)}
              className={`flex-1 rounded-full border px-3 py-1.5 text-[13px] ${chosen === o.value ? "border-wasabi bg-wasabi text-ink" : "border-[#3b4a54] text-[#53bdeb] disabled:opacity-40"}`}>
              <span className="tamil">{o.ta}</span> · {o.en}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const d = m.draft;
  return (
    <div className={`${base} w-[85%]`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-wasabi">GST draft · October 2026</div>
      <table className="mt-2 w-full text-[13px]">
        <tbody>
          <Row k="Sales (Paytm)" v={inr(d.receipts.businessValue)} />
          <Row k="Output GST" v={inr(d.outputTax.total)} />
          <Row k="Credit · bills" v={`− ${inr(d.credit.fromBills)}`} />
          <Row k="Credit · GST on MDR" v={`− ${inr(d.credit.fromMdr)}`} accent="text-amber" />
          <tr><td colSpan={2}><div className="my-1 border-t border-[#3b4a54]" /></td></tr>
          <Row k="Net GST payable" v={inr(d.netPayable)} bold />
          <Row k="Due" v={new Date(d.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} />
        </tbody>
      </table>
      <div className="mt-2 rounded bg-[#0e4a3c] px-2 py-1 text-center text-[12px] text-wasabi">Credit found: {inr(d.credit.total)}</div>
      {stage === "awaitSend" && (
        <button data-testid="send-ca" onClick={() => onSend(m.draftId)} className="mt-2 w-full rounded-full bg-wasabi py-2 text-sm font-semibold text-ink">Send to CA</button>
      )}
    </div>
  );
}

function Row({ k, v, bold, accent }: { k: string; v: string; bold?: boolean; accent?: string }) {
  return (
    <tr>
      <td className={`py-0.5 text-[#c5d1d6] ${bold ? "font-semibold text-white" : ""}`}>{k}</td>
      <td className={`py-0.5 text-right tabular-nums ${bold ? "font-bold text-white" : ""} ${accent ?? ""}`}>{v}</td>
    </tr>
  );
}

const MicIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" /></svg>;
const ClipIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.5 12.5 21a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3" /></svg>;
const PlayIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
