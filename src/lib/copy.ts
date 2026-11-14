// Every line Hisaab says, in Tamil with an English subtitle for the judges.
// Edit here to change wording; numbers are filled in by the rules engine.
import { inr } from "./gst";

export type Line = { ta: string; en: string };

export const copy = {
  voiceNote: {
    ta: "அக்டோபர் மாச GST ரெடியா?",
    en: "Is my GST ready for October?",
  } as Line,

  pulled: (count: number, mdrCount: number, gst: number): Line => ({
    ta: `அக்டோபர் மாசம் ${count} Paytm பணம் வந்திருக்கு. அதுல ${mdrCount} பெரிய பேமெண்ட்டுக்கு MDR கட்டணம் போயிருக்கு. அந்த கட்டணத்து மேல ${inr(gst)} GST — அதை நீங்க திரும்ப claim பண்ணலாம். கணக்குல சேர்த்துட்டேன்.`,
    en: `${count} Paytm payments came in for October. ${mdrCount} large ones had an MDR fee deducted, and the ${inr(gst)} GST on those fees is credit you can claim back. Added to your books.`,
  }),

  askBills: {
    ta: "இந்த மாசம் வாங்கின சரக்கு பில்லை போட்டோ எடுத்து அனுப்புங்க.",
    en: "Send photos of this month's purchase bills.",
  } as Line,

  billsRead: (n: number, gst: number): Line => ({
    ta: `${n} பில் படிச்சுட்டேன். அதுல ${inr(gst)} GST credit இருக்கு.`,
    en: `Read ${n} bills: ${inr(gst)} of GST credit.`,
  }),

  askTransfers: {
    ta: "ரெண்டு பணம் யாருகிட்ட இருந்து வந்ததுன்னு எனக்கு உறுதியா தெரியல. சொல்லுங்க:",
    en: "I'm not sure about two transfers. Can you tell me?",
  } as Line,

  question: (name: string, amount: number, date: string): Line => ({
    ta: `${date} அன்னைக்கு ${name} அனுப்பின ${inr(amount)} — குடும்ப பணமா, வியாபாரமா?`,
    en: `${inr(amount)} from ${name} on ${date}: family money or a sale?`,
  }),

  draftReady: (net: number, credit: number, due: string): Line => ({
    ta: `அக்டோபர் GST draft ரெடி. கட்ட வேண்டியது ${inr(net)}. இந்த மாசம் ${inr(credit)} credit கண்டுபிடிச்சேன். கடைசி தேதி ${due}. உங்க ஆடிட்டருக்கு அனுப்பவா?`,
    en: `October GST draft is ready. Payable ${inr(net)}, with ${inr(credit)} of credit found. Due ${due}. Shall I send it to your CA?`,
  }),

  sent: {
    ta: "அனுப்பிட்டேன். ஆடிட்டர் சரிபார்த்து file பண்ணுவாங்க. 17-ஆம் தேதி ஞாபகப்படுத்துறேன்.",
    en: "Sent. Your CA will review and file it. I'll remind you on the 17th.",
  } as Line,
};

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
