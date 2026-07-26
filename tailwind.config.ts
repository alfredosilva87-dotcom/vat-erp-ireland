import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F3F5FA",
        surface: "#FFFFFF",
        ink: "#141B2E",
        muted: "#606B84",
        line: "#E4E8F1",
        // dark navy sidebar (per reference)
        night: "#0B1533",
        "night-2": "#182449",
        "night-muted": "#93A0C4",
        // primary = blue
        brand: {
          DEFAULT: "#2563EB",
          50: "#EAF0FE",
          100: "#D7E3FD",
          400: "#4B83F0",
          500: "#2F6BFF",
          600: "#2563EB",
          700: "#1D4ED8",
        },
        violet: { DEFAULT: "#7C3AED", 50: "#F1ECFD" },
        success: { DEFAULT: "#159A6B", 50: "#E6F5EF" },
        danger: { DEFAULT: "#DC2626", 50: "#FDEBEB" },
        warning: { DEFAULT: "#D97706", 50: "#FCF1E2" },
        ok: { DEFAULT: "#159A6B", 50: "#E6F5EF" },
        info: { DEFAULT: "#2563EB", 50: "#EAF0FE" },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,27,46,0.04), 0 12px 30px -18px rgba(20,27,46,0.16)",
        raised:
          "inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 2px rgba(20,27,46,0.08), 0 8px 18px -10px rgba(20,27,46,0.22)",
        pressed: "inset 0 2px 5px rgba(20,27,46,0.16)",
        brand:
          "inset 0 1px 0 rgba(255,255,255,0.28), 0 1px 2px rgba(37,99,235,0.25), 0 10px 22px -10px rgba(37,99,235,0.55)",
      },
      borderRadius: { xl2: "1.1rem" },
    },
  },
  plugins: [],
};

export default config;
