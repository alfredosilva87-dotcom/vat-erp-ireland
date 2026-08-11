import type { Config } from "tailwindcss";

// Colours are CSS variables (RGB triplets) defined in app/globals.css, so the
// same class names work in both the dark (purple) and light themes and still
// support opacity modifiers like `bg-surface/50`.
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: v("paper"),
        surface: v("surface"),
        "surface-2": v("surface-2"),
        ink: v("ink"),
        muted: v("muted"),
        line: v("line"),
        // dark sidebar (stays dark in both themes)
        night: v("night"),
        "night-2": v("night-2"),
        "night-muted": v("night-muted"),
        "night-ink": v("night-ink"),
        "night-hover": v("night-hover"),
        // primary = purple
        brand: {
          DEFAULT: v("brand"),
          50: v("brand-50"),
          100: v("brand-100"),
          400: v("brand-400"),
          500: v("brand-500"),
          600: v("brand-600"),
          700: v("brand-700"),
        },
        violet: { DEFAULT: v("violet"), 50: v("violet-50") },
        success: { DEFAULT: v("success"), 50: v("success-50") },
        danger: { DEFAULT: v("danger"), 50: v("danger-50") },
        warning: { DEFAULT: v("warning"), 50: v("warning-50") },
        ok: { DEFAULT: v("success"), 50: v("success-50") },
        info: { DEFAULT: v("brand"), 50: v("brand-50") },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        raised: "var(--shadow-raised)",
        pressed: "var(--shadow-pressed)",
        brand: "var(--shadow-brand)",
      },
      borderRadius: { xl2: "1.1rem" },
    },
  },
  plugins: [],
};

export default config;
