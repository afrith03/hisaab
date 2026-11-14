import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource/noto-sans-tamil/400.css";
import "@fontsource/noto-sans-tamil/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hisaab — the tax agent for every Paytm merchant",
  description: "Paytm settlements in, GST-ready books out, and every rupee of credit found.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
