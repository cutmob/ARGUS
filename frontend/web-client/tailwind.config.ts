import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-figtree)"],
        sans: ["var(--font-ibm-plex-sans)"],
        mono: ["var(--font-jetbrains-mono)"],
      },
      colors: {
        argus: {
          bg:       "#080b0f",
          surface:  "#0d1117",
          panel:    "#111820",
          border:   "#1e2d3d",
          muted:    "#8b9ab0",
          text:     "#c9d3df",
          accent:   "#00c2ff",   // cyan — primary interactive
          amber:    "#f59e0b",   // warnings
          danger:   "#ef4444",   // high severity
          critical: "#dc2626",   // critical severity
          safe:     "#22c55e",   // OK / connected
        },
      },
      keyframes: {
        "ping-slow": {
          "75%, 100%": { transform: "scale(1.8)", opacity: "0" },
        },
        "scan-line": {
          "0%":   { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
      },
      animation: {
        "ping-slow": "ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite",
        "scan-line": "scan-line 4s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
