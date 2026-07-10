// apps/web/tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0e0f11",
        surface: "#15171a", // map backdrop
        panel: "#1a1b1e", // side panels
        elevated: "#202226", // inner cards
        border: "#26282c",
        muted: "#9a9a95",
        subtle: "#6a6c70",
        fg: "#e8e8e6",
        accent: { DEFAULT: "#f2f3f5", fg: "#e8e8e6" },
        draw: { DEFAULT: "#378add", fg: "#85b7eb" },
        warning: { DEFAULT: "#ef9f27", fg: "#efb968" },
        danger: { DEFAULT: "#a33", fg: "#e88f8f" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: { card: "12px" },
    },
  },
  plugins: [],
};
export default config;