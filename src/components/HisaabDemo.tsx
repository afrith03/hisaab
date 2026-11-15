"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentResult, LoanOffer, TraceStep } from "@/lib/agent";
import { copy, LANGS, type Lang, type Line } from "@/lib/copy";
import type { Bill, GstDraft, Question } from "@/lib/types";

const VOICE_NOTE: Line = copy.voiceNote;
const BILL_IMAGES = ["bill-1", "bill-2", "bill-3"].map((id) => ({ id, path: `/bills/${id}.png` }));

type Msg =
  | { id: number; from: "me"; kind: "voice"; line: Line; seconds: number }
  | { id: number; from: "me"; kind: "images"; images: string[] }
  | { id: number; from: "me"; kind: "text"; line: Line }
  | { id: number; from: "bot"; kind: "text"; line: Line }
  | { id: number; from: "bot"; kind: "question"; q: Question }
  | { id: number; from: "bot"; kind: "draft"; draft: GstDraft; draftId: string }
  | { id: number; from: "bot"; kind: "loan"; loan: LoanOffer };

type NoId<T> = T extends unknown ? Omit<T, "id"> : never;
type Stage = "idle" | "working" | "awaitBills" | "awaitAnswers" | "awaitSend" | "done";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrK = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(2)} L` : `₹${Math.round(n / 1000)}K`);
const inr0 = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const titleCase = (t: string) => t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDue = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

type StepKey = "payments" | "bills" | "questions" | "draft" | "loan";
const STEPS: { key: StepKey; title: string; hint: string; waiting: string }[] = [
  { key: "payments", title: "Checks her Paytm payments", hint: "Every payment and fee from October.", waiting: "Waiting for Meena's voice note." },
  { key: "bills", title: "Reads her purchase bills", hint: "Printed or handwritten, photos of supplier bills become GST credit.", waiting: "Waiting for bill photos." },
  { key: "questions", title: "Asks, never guesses", hint: "Unclear money in or out becomes a one-tap question.", waiting: "Waiting for Meena's answers." },
  { key: "draft", title: "Prepares her GST return for the CA", hint: "Tax worked out by rules, explained in her language.", waiting: "Ready to send to her CA." },
  { key: "loan", title: "Unlocks a business loan", hint: "Clean books are what a lender wants.", waiting: "Working on it…" },
];

function stepState(k: StepKey, x: { stage: Stage; story: Record<StepKey, string>; draft: boolean; sent: boolean }): "todo" | "active" | "done" {
  const order: StepKey[] = ["payments", "bills", "questions", "draft", "loan"];
  const doneUpTo =
    x.stage === "done" ? 5 : x.sent ? 4 : x.draft ? 3 : x.stage === "awaitAnswers" ? 2 : x.stage === "awaitBills" ? 1 :
    x.story.questions ? 2 : x.story.payments ? 1 : 0;
  const i = order.indexOf(k);
  if (i < doneUpTo) return "done";
  if (i === doneUpTo) return "active";
  return "todo";
}

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
  const [showReal, setShowReal] = useState(false);
  const [draftCredit, setDraftCredit] = useState<number | null>(null);
  const [draft, setDraft] = useState<GstDraft | null>(null);
  const [lang, setLang] = useState<Lang>("ta");
  const [showTrace, setShowTrace] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);   // bill photo opened full size
  const [showPanel, setShowPanel] = useState(false);              // mobile: progress sheet over the chat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPreview(null); setShowPanel(false); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [story, setStory] = useState<Record<StepKey, string>>({} as Record<StepKey, string>);
  const note = (k: StepKey, text: string) => setStory((st) => ({ ...st, [k]: text }));
  const speech = LANGS.find((l) => l.id === lang)!.speech;
  const idRef = useRef(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const traceRef = useRef<HTMLOListElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const answersRef = useRef<Record<string, "personal" | "business">>({});
  const finalizingRef = useRef(false);
  const questionsRef = useRef<Question[]>([]);
  const sentRef = useRef(false);

  useEffect(() => { fetch("/api/config").then((r) => r.json()).then(setCfg).catch(() => {}); }, []);
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, typing]);
  useEffect(() => { traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight, behavior: "smooth" }); }, [trace]);

  const push = (m: NoId<Msg>) => setMsgs((xs) => [...xs, { ...m, id: ++idRef.current } as Msg]);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // One ordered voice queue. Each line's audio is fetched right away (so it is ready in time) but
  // played only after the previous line finishes. Restart or a language change cancels everything,
  // so lines never overlap, repeat, or play late.
  const voiceGen = useRef(0);
  const voiceChain = useRef<Promise<void>>(Promise.resolve());
  const voiceNow = useRef<HTMLAudioElement | null>(null);

  function stopVoice() {
    voiceGen.current++;
    voiceNow.current?.pause();
    voiceNow.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    voiceChain.current = Promise.resolve();
  }

  function say(line: Line) {
    if (!speak || typeof window === "undefined") return;
    const gen = voiceGen.current;
    const text = line[lang];
    const tag = speech;
    const clip: Promise<string | null> = cfg.voice
      ? fetch("/api/voice/tts", { method: "POST", body: JSON.stringify({ text, lang: tag }) })
          .then((r) => r.json()).then((j) => j.audio ?? null).catch(() => null)
      : Promise.resolve(null);
    voiceChain.current = voiceChain.current.then(async () => {
      if (gen !== voiceGen.current) return;
      const b64 = await clip;
      if (gen !== voiceGen.current) return;
      await new Promise<void>((done) => {
        const finish = () => { clearTimeout(guard); done(); };
        // Safety net: never let one stuck clip block the queue.
        const guard = setTimeout(finish, 4000 + text.length * 120);
        try {
          if (b64) {
            const a = new Audio(`data:audio/wav;base64,${b64}`);
            voiceNow.current = a;
            a.onended = finish; a.onerror = finish;
            a.play().catch(finish);
          } else {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = tag;
            u.rate = 1.2;
            u.onend = finish; u.onerror = finish;
            window.speechSynthesis.speak(u);
          }
        } catch { finish(); }
      });
    });
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
    const r = await call("start", { message: `${line[lang]} (${line.en})` });
    const mdrLine = r.trace.find((t) => t.tool === "rules.mdrCredit")?.detail ?? "";
    const m = mdrLine.match(/fees ₹([\d,.]+)/);
    if (m) setCredit((c) => ({ ...c, mdr: Number(m[1].replace(/,/g, "")) }));
    const count = r.trace.find((t) => t.tool === "paytm.getTransactions")?.detail.match(/^(\d+)/)?.[1];
    const big = mdrLine.match(/^(\d+)/)?.[1];
    note("payments", `${count ?? "All"} payments checked. ${big ?? "Some"} large ones carried the new UPI fee, so ${m ? "₹" + m[1] : "its GST"} of GST comes back off her bill.`);
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
        fd.append("lang", speech);
        const j = await fetch("/api/voice/stt", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({}));
        const said = j.transcript ? { ta: j.transcript, hi: j.transcript, en: lang === "en" ? j.transcript : "(live transcript)" } : VOICE_NOTE;
        sendVoice(said, Math.max(1, Math.round((Date.now() - t0) / 1000)));
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
    const billGst = (r.bills ?? []).reduce((s, b) => s + b.cgst + b.sgst + b.igst, 0);
    setCredit((c) => ({ ...c, bills: billGst }));
    const hw = (r.bills ?? []).filter((b) => b.handwritten).length;
    note("bills", `${(r.bills ?? []).length} bills read (${(r.bills ?? []).map((b) => titleCase(b.supplier).split(" ")[0] + (b.handwritten ? ", handwritten" : "")).join(" · ")}). ${inr0(billGst)} of GST credit. Every bill checked: supplier GST number, HSN codes and tax shown.`);
    note("questions", `${(r.questions ?? []).length} direct transfers aren't clear: money in could be a sale or family money; money out could be a shop purchase or personal. Hisaab asks instead of guessing.`);
    questionsRef.current = r.questions ?? [];
    setQuestions(questionsRef.current);
    await botLines(r.replies);
    for (const q of r.questions ?? []) { push({ from: "bot", kind: "question", q }); await wait(450); }
    setStage("awaitAnswers");
  }

  /* Step 3: answers → draft */
  async function answer(q: Question, value: "personal" | "business") {
    // A ref, not state: two quick taps must see each other's answer, or the draft is built twice.
    if (answersRef.current[q.txnId] || finalizingRef.current) return;
    const opt = q.options.find((o) => o.value === value)!;
    const next = { ...answersRef.current, [q.txnId]: value };
    answersRef.current = next;
    setAnswers(next);
    push({ from: "me", kind: "text", line: { ta: opt.ta, hi: opt.hi, en: opt.en } });
    if (Object.keys(next).length < questionsRef.current.length) return;
    finalizingRef.current = true;
    setStage("working");
    const r = await call("finalize", { answers: next, bills });
    await botLines(r.replies);
    if (r.draft && r.draftId) {
      push({ from: "bot", kind: "draft", draft: r.draft, draftId: r.draftId }); setDraftCredit(r.draft.credit.total); setDraft(r.draft);
      const said = questionsRef.current.map((q) =>
        q.direction === "OUT"
          ? `${inr0(q.amount)} to ${q.payerName.split(" ")[0]} was ${next[q.txnId] === "business" ? "a shop purchase (bill requested)" : "personal"}`
          : `${q.payerName.split(" ")[0]}'s ${inr0(q.amount)} was ${next[q.txnId] === "business" ? "payment for goods (taxed)" : "personal (not taxed)"}`).join(" · ");
      note("questions", `Meena answered: ${said}.`);
      note("draft", `GST of ${inr0(r.draft.outputTax.total)} minus ${inr0(r.draft.credit.total)} credit: she pays ${inr0(r.draft.netPayable)}, due ${fmtDue(r.draft.dueDate)}.`);
    }
    setStage("awaitSend");
  }

  async function sendToCa(draftId: string) {
    window.open(`/draft/${draftId}`, "_blank");
    push({ from: "me", kind: "text", line: { ta: "சரி, அனுப்புங்க", hi: "हाँ, भेज दीजिए", en: "Yes, send it" } });
    setTrace((t) => [...t, { tool: "share.sendToCa", detail: "Draft link shared with the merchant's CA", ms: 0, phase: "send" }]);
    await wait(500);
    note("draft", (story.draft ?? "") + " Sent to her CA.");
    sentRef.current = true;
    await botLines([copy.sent]);
    if (draft) {
      setStage("working");
      await wait(900);
      const r = await call("loan", { draft });
      await botLines(r.replies);
      if (r.loan) { push({ from: "bot", kind: "loan", loan: r.loan }); note("loan", `Clean books → a Paytm business loan offer up to ${inr0(r.loan.indicativeLimit)}, repaid from daily settlements. (Simulated)`); }
    }
    setStage("done");
  }

  function reset() {
    stopVoice();
    answersRef.current = {}; finalizingRef.current = false; questionsRef.current = []; sentRef.current = false; setStory({} as Record<StepKey, string>);
    setMsgs([]); setTrace([]); setStage("idle"); setBills([]); setAnswers({}); setQuestions([]); setCredit({ mdr: 0, bills: 0 }); setDraftCredit(null); setDraft(null);
  }

  const totalCredit = credit.mdr + credit.bills;

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-page">
      <header className="flex flex-wrap items-center justify-between gap-2 bg-navy px-3 py-2 text-white lg:px-6 lg:py-3">
        <div className="flex items-center gap-3">
          <span className="text-xl font-extrabold tracking-tight lg:text-2xl">Hisaab<span className="text-sky">.</span></span>
          <span className="hidden rounded-full bg-sky px-3 py-0.5 text-[11px] font-bold tracking-wide text-navy md:inline">GST AGENT FOR PAYTM MERCHANTS</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs lg:gap-2">
          <div className="flex overflow-hidden rounded-full bg-white/10 p-0.5" data-testid="lang">
            {LANGS.map((l) => (
              <button key={l.id} onClick={() => { stopVoice(); setLang(l.id); }} data-testid={`lang-${l.id}`}
                className={`tamil rounded-full px-2.5 py-1 font-semibold lg:px-3 ${lang === l.id ? "bg-white text-navy" : "text-white/80 hover:text-white"}`}>{l.label}</button>
            ))}
          </div>
          <span data-testid="live" className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold lg:px-3.5 lg:py-1.5 lg:text-[13px] ${cfg.ai ? "bg-good text-white" : "bg-white/10 text-white/80"}`}>
            {cfg.ai && <span className="h-2 w-2 animate-pulse rounded-full bg-white" />}
            {cfg.ai ? <>LIVE<span className="hidden sm:inline">&nbsp;AI · Sarvam</span></> : "Demo"}
          </span>
          <button onClick={() => { setShowReal((v) => !v); setShowPanel(true); }} data-testid="real" className="hidden rounded-full bg-white/10 px-3 py-1 text-white/90 hover:bg-white/20 sm:inline-block">What&apos;s real?</button>
          <button onClick={() => { stopVoice(); setSpeak((s) => !s); }} className="rounded-full bg-white/10 px-3 py-1 text-white/90 hover:bg-white/20">{speak ? "🔊" : "🔇"}<span className="hidden sm:inline"> {speak ? "Voice on" : "Voice off"}</span></button>
          <button onClick={reset} className="rounded-full border border-white/40 px-3 py-1 text-white hover:bg-white/10">↺<span className="hidden sm:inline"> Restart</span></button>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col lg:grid lg:grid-cols-[400px_1fr] lg:gap-6 lg:px-6 lg:py-4">
        {/* Phone: full screen on mobile, a phone frame on desktop */}
        <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-white lg:mx-auto lg:block lg:max-w-[400px] lg:flex-none lg:rounded-[2.2rem] lg:border-[10px] lg:border-[#1d2433] lg:shadow-[0_20px_50px_rgba(0,41,112,.18)]">
          <div className="flex items-center gap-3 bg-navy px-4 py-3 text-white">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-sky text-sm font-extrabold text-navy">H.</div>
            <div className="flex-1">
              <div className="text-sm font-semibold">Hisaab</div>
              <div className="text-[11px] text-white/70">{typing ? "typing…" : "GST helper · Meena Provision Store"}</div>
            </div>
            <span className="hidden rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold sm:inline lg:inline">in your Paytm app</span>
          </div>
          {/* Mobile only: the money so far, and a way into the progress view */}
          <button onClick={() => setShowPanel(true)} data-testid="mobile-progress"
            className="flex items-center justify-between border-b border-edge bg-[#e6f7fd] px-4 py-2 text-left lg:hidden">
            <span className="text-[12px] text-sub">Credit found <b className="text-[15px] text-navy">{inr0(totalCredit)}</b>{draftCredit ? <> · <b className="text-good">{inrK(draftCredit * 12)}</b>/yr</> : null}</span>
            <span className="text-[12px] font-semibold text-sky">Progress ›</span>
          </button>
          <div ref={chatRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#eef3fa] px-3 py-4 lg:h-[calc(100vh-235px)] lg:min-h-[420px] lg:flex-none" data-testid="chat">
            {msgs.length === 0 && (
              <div className="mx-auto mt-10 max-w-[270px] rounded-xl bg-white p-4 lg:mt-20 text-center text-xs text-sub shadow-sm">
                Meena runs a provision store in Chennai and supplies a few small hotels. She takes payments on Paytm. It&apos;s mid-November and her October GST is due on the 20th.
              </div>
            )}
            {msgs.map((m) => <Bubble key={m.id} m={m} lang={lang} answers={answers} onAnswer={answer} onSend={sendToCa} onPreview={setPreview} stage={stage} />)}
            {typing && (
              <div className="pop w-fit rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
                <span className="dot inline-block h-2 w-2 rounded-full bg-sky" /> <span className="dot inline-block h-2 w-2 rounded-full bg-sky" /> <span className="dot inline-block h-2 w-2 rounded-full bg-sky" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-edge bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {stage === "idle" && (
              <button data-testid="voice" onClick={toggleRecord} className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-white ${recording ? "bg-[#e5484d]" : "bg-sky"}`}>
                <MicIcon /> {recording ? "Recording… tap to send" : cfg.voice ? `Tap to speak (${LANGS.find((l) => l.id === lang)!.label})` : "Send Meena's voice note"}
              </button>
            )}
            {stage === "awaitBills" && (
              <button data-testid="bills" onClick={sendBills} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-sky py-2.5 text-sm font-semibold text-white">
                <ClipIcon /> Send 3 bill photos
              </button>
            )}
            {(stage === "working" || stage === "awaitAnswers" || stage === "awaitSend" || stage === "done") && (
              <div className="flex-1 rounded-full bg-page px-4 py-2.5 text-sm text-sub">
                {stage === "awaitAnswers" ? "Tap an answer above" : stage === "awaitSend" ? "Review the draft above" : stage === "done" ? "Done for October ✓" : "Hisaab is working…"}
              </div>
            )}
          </div>
        </section>

        {/* Story panel: plain words by default, the agent trace one tap away */}
        <section className={`${showPanel ? "fixed inset-0 z-40 flex overflow-y-auto bg-page p-3" : "hidden"} min-h-0 flex-col gap-3 lg:static lg:z-auto lg:flex lg:gap-4 lg:overflow-visible lg:bg-transparent lg:p-0`} data-testid="panel">
          <div className="flex items-center justify-between lg:hidden">
            <span className="text-base font-bold text-navy">Meena&apos;s progress</span>
            <button onClick={() => setShowPanel(false)} className="rounded-full bg-navy px-4 py-1.5 text-sm font-semibold text-white" data-testid="panel-close">Back to chat</button>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
            <Stat label="GST on UPI fees" value={inr0(credit.mdr)} hint="new since 15 Oct" accent="text-warn" />
            <Stat label="Credit from bills" value={inr0(credit.bills)} hint="read from photos" accent="text-navy" />
            <Stat label="Credit found" value={inr0(totalCredit)} hint="October · off her GST bill" accent="text-white" big />
            <Stat label="In a year" value={draftCredit ? inrK(draftCredit * 12) : "—"} hint="at this pace" accent="text-good" testid="annual" />
          </div>

          {showReal && <RealPanel live={!!cfg.ai} voice={cfg.voice} onClose={() => setShowReal(false)} />}

          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-edge bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-navy">{showTrace ? "Under the hood: every step the agent ran" : "What Hisaab did for Meena"}</h2>
              <button onClick={() => setShowTrace((v) => !v)} data-testid="hood"
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${showTrace ? "bg-navy text-white" : "border border-navy text-navy hover:bg-navy hover:text-white"}`}>
                {showTrace ? "← Back to story" : "Under the hood ⚙"}
              </button>
            </div>

            {!showTrace && (
              <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto" data-testid="story">
                {STEPS.map((st, i) => {
                  const state = stepState(st.key, { stage, story, draft: !!draft, sent: sentRef.current });
                  return (
                    <li key={st.key} className={`flex items-start gap-4 rounded-xl px-4 py-3 transition ${state === "active" ? "bg-[#e6f7fd] ring-2 ring-sky" : state === "done" ? "bg-page" : "opacity-45"}`}>
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-base font-bold ${state === "done" ? "bg-good text-white" : state === "active" ? "bg-sky text-white" : "bg-edge text-sub"}`}>
                        {state === "done" ? "✓" : i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[17px] font-semibold text-text">{st.title}</div>
                        <div className="text-[15px] leading-snug text-sub">
                          {story[st.key] ?? (state === "active" ? (stage === "working" ? "Working on it…" : st.waiting) : st.hint)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {showTrace && (
              <>
                <p className="mb-2 text-[13px] text-sub">Sarvam AI understands and reads · our GST rules compute every rupee · Meena approves.</p>
                {trace.length === 0 && <p className="text-sm text-sub">Each tool the agent calls appears here as it runs.</p>}
                <ol ref={traceRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" data-testid="trace">
                  {trace.map((t, i) => (
                    <li key={i} className="pop flex gap-3 rounded-lg border border-edge bg-page px-3 py-2">
                      <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${toolColor(t.tool)}`}>{t.tool}</span>
                      <span className="text-[13px] leading-snug text-text">{t.detail}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>

        </section>
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4" onClick={() => setPreview(null)} data-testid="preview">
          <img src={preview} alt="Purchase bill, full size" className="max-h-[85dvh] max-w-full rounded-lg bg-white object-contain shadow-2xl" />
          <span className="text-sm text-white/80">Tap anywhere to close</span>
        </div>
      )}
    </main>
  );
}

function toolColor(tool: string) {
  if (tool.startsWith("paytm") || tool.startsWith("lending")) return "bg-sky text-white";
  if (tool.startsWith("rules")) return "bg-navy text-white";
  if (tool.startsWith("vision") || tool.startsWith("llm")) return "bg-[#7c3aed] text-white";
  if (tool.startsWith("share")) return "bg-warn text-white";
  return "bg-sub text-white";
}

function Stat({ label, value, hint, accent, big, testid }: { label: string; value: string; hint: string; accent: string; big?: boolean; testid?: string }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${big ? "border-navy bg-navy" : "border-edge bg-card"}`}>
      <div className={`text-[12px] font-bold uppercase tracking-wide ${big ? "text-sky" : "text-sub"}`}>{label}</div>
      <div className={`mt-1 text-[28px] font-extrabold leading-tight tabular-nums ${accent}`} data-testid={testid ?? (big ? "credit" : undefined)}>{value}</div>
      <div className={`text-[12px] ${big ? "text-white/75" : "text-sub"}`}>{hint}</div>
    </div>
  );
}

function Bubble({ m, lang, answers, onAnswer, onSend, onPreview, stage }: {
  m: Msg; lang: Lang; answers: Record<string, string>; onAnswer: (q: Question, v: "personal" | "business") => void; onSend: (id: string) => void; onPreview: (src: string) => void; stage: Stage;
}) {
  const mine = m.from === "me";
  const base = `pop max-w-[85%] rounded-2xl px-3 py-2 text-[14px] text-text shadow-sm ${mine ? "ml-auto rounded-tr-sm bg-[#d9f3fd]" : "rounded-tl-sm bg-white"}`;
  const time = <div className="mt-1 text-right text-[10px] text-sub">{now()}</div>;
  const Say = ({ line }: { line: Line }) => (
    <>
      <div className="tamil">{line[lang]}</div>
      {lang !== "en" && <div className="mt-1 text-[12px] italic text-sub">{line.en}</div>}
    </>
  );

  if (m.kind === "voice")
    return (
      <div className={base}>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-sky text-white"><PlayIcon /></span>
          <div className="flex h-6 flex-1 items-center gap-[2px]">
            {Array.from({ length: 28 }).map((_, i) => <span key={i} className="w-[3px] rounded bg-sky/70" style={{ height: `${6 + ((i * 37) % 17)}px` }} />)}
          </div>
          <span className="text-[11px] text-sub">0:0{m.seconds}</span>
        </div>
        <div className="mt-2 text-[13px]"><Say line={m.line} /></div>
        {time}
      </div>
    );
  if (m.kind === "images")
    return (
      <div className={`${base} p-1`}>
        <div className="grid grid-cols-3 gap-1">
          {m.images.map((src, i) => (
            <button key={src} onClick={() => onPreview(src)} data-testid={`bill-thumb-${i}`} className="group relative block" aria-label="Open bill">
              <img src={src} alt="Purchase bill" className="h-28 w-full rounded object-cover object-top transition group-hover:opacity-90" />
              <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[10px] text-white">⤢</span>
            </button>
          ))}
        </div>
        <div className="px-2 pb-1">{time}</div>
      </div>
    );
  if (m.kind === "text")
    return (
      <div className={base}>
        <Say line={m.line} />
        {time}
      </div>
    );
  if (m.kind === "question") {
    const chosen = answers[m.q.txnId];
    return (
      <div className={base}>
        {m.q.direction === "OUT" ? (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="rounded-full bg-[#fde8e8] px-2 py-0.5 text-[11px] font-bold text-[#c2410c]">↑ Money sent</span>
            <span className="text-[15px] font-bold tabular-nums text-[#c2410c]">−{inr(m.q.amount)}</span>
          </div>
        ) : (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="rounded-full bg-[#e3f8ec] px-2 py-0.5 text-[11px] font-bold text-good">↓ Money received</span>
            <span className="text-[15px] font-bold tabular-nums text-good">+{inr(m.q.amount)}</span>
          </div>
        )}
        <Say line={m.q.text} />
        <div className="mt-2 rounded-lg border border-edge bg-page px-2 py-1.5 text-[11px] leading-snug text-sub" data-testid="txn-source">
          <div className="font-semibold text-navy">From her Paytm records · {m.q.source.channel}</div>
          <div>{m.q.source.flow}</div>
          <div>{m.q.payerName} · <span className="font-mono">{m.q.source.payerVpa}</span></div>
          <div>{m.q.source.time} · Txn <span className="font-mono">{m.q.source.txnId}</span> · {m.q.source.settledTo}</div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {m.q.options.map((o) => (
            <button key={o.value} data-testid={`ans-${m.q.payerName.split(" ")[0]}-${o.value}`} disabled={!!chosen}
              onClick={() => onAnswer(m.q, o.value)}
              className={`tamil rounded-xl border px-2 py-2 text-[13px] font-semibold leading-tight ${chosen === o.value ? "border-sky bg-sky text-white" : "border-sky text-navy disabled:opacity-40"}`}>
              <div>{o[lang]}</div>
              {lang !== "en" && <div className={`mt-0.5 text-[11px] font-medium ${chosen === o.value ? "text-white/85" : "text-sub"}`}>{o.en}</div>}
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-center text-[11px] text-sub">
          {m.q.direction === "OUT" ? "Shop purchases are expenses, not sales. Their bill can cut her GST." : "Only payment for goods is taxed."}
        </div>
      </div>
    );
  }
  if (m.kind === "loan") {
    const l = m.loan;
    return (
      <div className={`${base} w-[85%] border-2 border-sky`} data-testid="loan">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wide text-navy">Business loan · via Paytm</span>
          <span className="rounded bg-[#fff1d6] px-1.5 py-0.5 text-[10px] font-bold text-warn">SIMULATED</span>
        </div>
        <div className="mt-2 text-[12px] text-sub">Indicative offer up to</div>
        <div className="text-2xl font-bold tabular-nums text-navy">{inr(l.indicativeLimit).replace(".00", "")}</div>
        <table className="mt-2 w-full text-[12px]">
          <tbody>
            <Row k="Verified Paytm sales (Oct)" v={inr(l.verifiedSales)} />
            <Row k="GST draft" v="Ready before due date" />
            <Row k="Repayment" v={l.repayment} />
          </tbody>
        </table>
        <div className="mt-2 text-[11px] leading-snug text-sub">Clean books, built by Hisaab from her Paytm data, shared with her consent. Real offers and terms come from Paytm&apos;s lending partner.</div>
      </div>
    );
  }
  const d = m.draft;
  return (
    <div className={`${base} w-[85%]`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-navy">GST draft · October 2026</div>
      <table className="mt-2 w-full text-[13px]">
        <tbody>
          <Row k="Sales (Paytm)" v={inr(d.receipts.businessValue)} />
          <Row k="Output GST" v={inr(d.outputTax.total)} />
          <Row k="Credit · bills" v={`− ${inr(d.credit.fromBills)}`} />
          <Row k="Credit · GST on MDR" v={`− ${inr(d.credit.fromMdr)}`} accent="text-warn" />
          <tr><td colSpan={2}><div className="my-1 border-t border-edge" /></td></tr>
          <Row k="Net GST payable" v={inr(d.netPayable)} bold />
          <Row k="Due" v={new Date(d.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} />
        </tbody>
      </table>
      <div className="mt-2 rounded-lg bg-[#e3f8ec] px-2 py-1 text-center text-[12px] font-semibold text-good">Credit found: {inr(d.credit.total)}</div>
      {stage === "awaitSend" && (
        <button data-testid="send-ca" onClick={() => onSend(m.draftId)} className="mt-2 w-full rounded-full bg-sky py-2 text-sm font-semibold text-white">Send to CA</button>
      )}
    </div>
  );
}

function RealPanel({ live, voice, onClose }: { live: boolean; voice: boolean; onClose: () => void }) {
  const rows: [string, string, string][] = [
    ["GST rules engine", "Real", "MDR rule from 15 Oct 2026, output tax by slab, ITC set-off, due date. Unit-tested."],
    ["Agent (understands the request, calls tools)", live ? "Real · live" : "Real code · demo now", "Sarvam-105B tool calling; rules fallback if offline."],
    ["Bill reading", live ? "Real · live" : "Real code · demo now", "Sarvam Vision document extraction, then GSTIN and totals checks."],
    ["Voice in / out (Tamil, Hindi, English)", voice ? "Real · live" : "Browser voice", "Saaras speech-to-text, Bulbul text-to-speech."],
    ["Paytm payments and settlements", "Simulated", "Sample month in the Paytm record shape. Live needs merchant login on Paytm's MCP server."],
    ["Purchase bills", "Sample", "Three printed sample invoices; any real bill photo works with a key."],
    ["Loan offer", "Simulated", "Shows what clean books unlock. Real offers, limits and terms come from Paytm's lending partner."],
    ["Filing", "Not done by us", "Hisaab makes a draft; the merchant's CA reviews and files on the GST portal."],
  ];
  return (
    <div className="rounded-2xl border border-edge bg-card p-4 shadow-sm" data-testid="real-panel">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-navy">WHAT&apos;S REAL VS SIMULATED</h3>
        <button onClick={onClose} className="text-xs text-sub hover:text-navy">Close</button>
      </div>
      <table className="w-full text-[12px]">
        <tbody>
          {rows.map(([k, tag, note]) => (
            <tr key={k} className="border-t border-edge">
              <td className="py-1.5 pr-3 font-medium text-text">{k}</td>
              <td className={`py-1.5 pr-3 whitespace-nowrap font-semibold ${tag.startsWith("Real") ? "text-good" : "text-warn"}`}>{tag}</td>
              <td className="py-1.5 text-sub">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ k, v, bold, accent }: { k: string; v: string; bold?: boolean; accent?: string }) {
  return (
    <tr>
      <td className={`py-0.5 text-sub ${bold ? "font-semibold text-text" : ""}`}>{k}</td>
      <td className={`py-0.5 text-right tabular-nums ${bold ? "font-bold text-navy" : "text-text"} ${accent ?? ""}`}>{v}</td>
    </tr>
  );
}

const MicIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" /></svg>;
const ClipIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.5 12.5 21a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3" /></svg>;
const PlayIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
