import type { Metadata } from "next";
import { Figtree, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  weight: ["300", "400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ARGUS - AI Inspection System",
  description: "Real-time AI-powered safety inspection copilot",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${figtree.variable} ${ibmPlexSans.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-[#fafafa] text-slate-900 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
