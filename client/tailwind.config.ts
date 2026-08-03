import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0e0f11",
        surface: "#15171a",
        panel: "#1a1b1e",
        elevated: "#202226",
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
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { card: "12px" },
      transitionTimingFunction: { expo: "cubic-bezier(.16,1,.3,1)" },
    },
  },
  plugins: [],
};
export default config;
