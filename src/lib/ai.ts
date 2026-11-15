import { CHAT_MODEL, sarvamKey } from "./sarvam";

// Live AI runs on Sarvam when a key is present. DEMO_MODE=1 forces the rules + sample path
// (the safe fallback on stage if the venue Wi-Fi dies).
export const MODEL_ID = CHAT_MODEL;
export const aiEnabled = () => Boolean(sarvamKey()) && process.env.DEMO_MODE !== "1";
