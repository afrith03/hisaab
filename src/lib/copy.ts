// Every line Hisaab says, in Tamil, Hindi and English. The merchant picks her language in the app.
// Edit here to change wording; numbers are filled in by the rules engine.
import { inr } from "./gst";

export type Lang = "ta" | "hi" | "en";
export type Line = { ta: string; hi: string; en: string };

export const LANGS: { id: Lang; label: string; speech: string }[] = [
  { id: "ta", label: "தமிழ்", speech: "ta-IN" },
  { id: "hi", label: "हिंदी", speech: "hi-IN" },
  { id: "en", label: "English", speech: "en-IN" },
];

export const copy = {
  voiceNote: {
    ta: "அக்டோபர் மாச GST ரெடியா?",
    hi: "अक्टूबर का GST तैयार है?",
    en: "Is my GST ready for October?",
  } as Line,

  pulled: (count: number, mdrCount: number, gst: number): Line => ({
    ta: `அக்டோபர் மாசம் ${count} Paytm பணம் வந்திருக்கு. அதுல ${mdrCount} பெரிய பேமெண்ட்டுக்கு MDR கட்டணம் போயிருக்கு. அந்த கட்டணத்து மேல ${inr(gst)} GST கட்டியிருக்கீங்க — அதை உங்க GST-ல கழிச்சுக்கலாம். கணக்குல சேர்த்துட்டேன்.`,
    hi: `अक्टूबर में ${count} Paytm पेमेंट आए। इनमें से ${mdrCount} बड़े पेमेंट पर MDR फीस कटी, और उस फीस पर आपने ${inr(gst)} GST दिया है। ये आपके GST बिल में से घटेगा। हिसाब में जोड़ दिया है।`,
    en: `${count} Paytm payments came in for October. ${mdrCount} large ones had an MDR fee deducted, and you paid ${inr(gst)} GST on those fees. That is input tax credit: it comes off your GST bill. Added to your books.`,
  }),

  askBills: {
    ta: "இந்த மாசம் வாங்கின சரக்கு பில்லை போட்டோ எடுத்து அனுப்புங்க.",
    hi: "इस महीने की खरीद के बिलों की फोटो भेजिए।",
    en: "Send photos of this month's purchase bills.",
  } as Line,

  billsRead: (n: number, gst: number, handwritten = 0): Line => ({
    ta: `${n} பில் படிச்சுட்டேன்${handwritten ? ` (${handwritten} கையால எழுதின பில்லும் சேர்த்து)` : ""}. அதுல ${inr(gst)} GST credit இருக்கு — இதுவும் உங்க GST-ல கழியும்.`,
    hi: `${n} बिल पढ़ लिए${handwritten ? ` (${handwritten} हाथ से लिखा बिल भी)` : ""}। इनमें ${inr(gst)} का GST क्रेडिट है, ये भी आपके GST बिल में से घटेगा।`,
    en: `Read ${n} bills${handwritten ? `, including ${handwritten} handwritten` : ""}: ${inr(gst)} of GST credit, which also comes off your GST bill.`,
  }),

  askTransfers: {
    ta: "உங்க Paytm கணக்குல 3 நேரடி பணப் பரிமாற்றம் எனக்கு தெளிவா இல்ல (கடை QR இல்லாம): 2 வந்த பணம், 1 நீங்க அனுப்பின பணம். எதுக்கானதுன்னு சொல்லுங்க.",
    hi: "आपके Paytm खाते में 3 सीधे लेन-देन मुझे साफ़ नहीं हैं (दुकान के QR से नहीं): 2 बार पैसे आए, 1 बार आपने भेजे। बताइए किस बात के थे।",
    en: "3 direct transfers on your Paytm account aren't clear to me (not through your shop QR): 2 payments in and 1 you sent. Tell me what they were for.",
  } as Line,

  question: (name: string, amount: number, date: string): Line => ({
    ta: `${date} அன்னைக்கு ${name} உங்களுக்கு ${inr(amount)} அனுப்பினாங்க. இது எதுக்கான பணம்?`,
    hi: `${date} को ${name} ने आपको ${inr(amount)} भेजे। ये किस बात का पैसा है?`,
    en: `${name} sent you ${inr(amount)} on ${date}. What was it for?`,
  }),

  questionOut: (name: string, amount: number, date: string): Line => ({
    ta: `${date} அன்னைக்கு நீங்க ${name}-க்கு ${inr(amount)} அனுப்பினீங்க. இது எதுக்கான பணம்?`,
    hi: `${date} को आपने ${name} को ${inr(amount)} भेजे। ये किस बात का पैसा था?`,
    en: `You sent ${inr(amount)} to ${name} on ${date}. What was it for?`,
  }),

  billNeeded: (name: string, amount: number): Line => ({
    ta: `${name}-க்கு கொடுத்த ${inr(amount)} கடை செலவா பதிவு பண்ணிட்டேன். அந்த பில்லை அனுப்புங்க, அதுல இருக்கிற GST-ஐயும் கழிச்சுக்கலாம்.`,
    hi: `${name} को दिए ${inr(amount)} दुकान के खर्च में लिख दिए। उसका बिल भेजिए, तो उस पर लगा GST भी घटेगा।`,
    en: `Recorded the ${inr(amount)} paid to ${name} as a shop expense. Send me its bill and the GST on it comes off your bill too.`,
  }),

  draftReady: (net: number, credit: number, due: string): Line => ({
    ta: `அக்டோபர் GST draft ரெடி. ${inr(credit)} credit கண்டுபிடிச்சேன், அதனால கட்ட வேண்டியது ${inr(net)} மட்டும். கடைசி தேதி ${due}. உங்க ஆடிட்டருக்கு அனுப்பவா?`,
    hi: `अक्टूबर का GST ड्राफ्ट तैयार है। ${inr(credit)} का क्रेडिट मिला, इसलिए आपको सिर्फ ${inr(net)} भरने हैं। आखिरी तारीख ${due}। आपके CA को भेज दूँ?`,
    en: `October GST draft is ready. ${inr(credit)} of credit found, so you pay ${inr(net)}. Due ${due}. Shall I send it to your CA?`,
  }),

  sent: {
    ta: "அனுப்பிட்டேன். ஆடிட்டர் சரிபார்த்து file பண்ணுவாங்க. 17-ஆம் தேதி ஞாபகப்படுத்துறேன்.",
    hi: "भेज दिया। आपके CA जाँच करके फाइल करेंगे। 17 तारीख को याद दिला दूँगा।",
    en: "Sent. Your CA will review and file it. I'll remind you on the 17th.",
  } as Line,
};

export const loanLine = (sales: string): Line => ({
  ta: `இன்னொரு விஷயம். உங்க அக்டோபர் கணக்கு இப்போ சுத்தமா இருக்கு: Paytm விற்பனை ${sales}, GST கணக்கு ரெடி. இந்த கணக்கை வச்சு Paytm வழியா வியாபார கடன் கேட்கலாம். வட்டிக்காரன்கிட்ட போக வேண்டாம்.`,
  hi: `एक और बात। आपका अक्टूबर का हिसाब अब साफ़ है: Paytm बिक्री ${sales}, GST तैयार। इस हिसाब से आप Paytm से बिज़नेस लोन माँग सकते हैं। साहूकार के पास जाने की ज़रूरत नहीं।`,
  en: `One more thing. Your October books are clean now: ${sales} of Paytm sales, GST worked out. With these books you can ask for a business loan through Paytm. No moneylender.`,
});

export const optionLabels: Record<"personal" | "business", Line> = {
  personal: { ta: "சொந்த / குடும்ப பணம்", hi: "निजी / परिवार का पैसा", en: "Personal / family" },
  business: { ta: "சரக்குக்கான பணம்", hi: "सामान का भुगतान", en: "Payment for goods" },
};

export const optionLabelsOut: Record<"personal" | "business", Line> = {
  personal: { ta: "சொந்த / குடும்ப செலவு", hi: "निजी / परिवार का खर्च", en: "Personal / family" },
  business: { ta: "கடைக்கு சரக்கு வாங்கினது", hi: "दुकान का सामान खरीदा", en: "Shop purchase" },
};

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
