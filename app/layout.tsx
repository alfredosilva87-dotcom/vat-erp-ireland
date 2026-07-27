import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import AppFrame from "@/components/AppFrame";

const display = Fraunces({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-display" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "VAT Reader — Ireland ERP",
  description: "Read invoices, check Irish VAT, manage clients, credits and records.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
