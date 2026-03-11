import type { Metadata } from "next";
import { Space_Grotesk, Figtree, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const figtree = Figtree({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ARGUS",
  description: "Real-time AI-powered safety inspection",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${figtree.variable} ${ibmPlexMono.variable}`}
    >
      <body className="bg-argus-bg text-argus-text antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
