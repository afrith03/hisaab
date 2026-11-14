"use client";

export default function PrintButton() {
  return (
    <button onClick={() => window.print()} className="no-print mt-2 rounded-full border border-[#c9d6dc] px-3 py-1 text-xs text-[#1a6b7e]">
      Print / Save PDF
    </button>
  );
}
