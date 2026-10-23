import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

export const metadata = {
  title: "OctoPi – Learn math the fun way",
  description: "A Duolingo-style web app for practising math topics with Pieter.",
};

// Runs before the first paint so the saved (or system) theme is applied
// immediately: no white flash when a dark-mode player opens the page.
// Keep the storage key and allowed values in sync with app/page.js.
const THEME_SCRIPT = `(function () {
  var d = document.documentElement, mode = "light", accent = "green";
  try {
    var t = JSON.parse(localStorage.getItem("octopi-theme") || "null") || {};
    if (t.mode === "dark" || t.mode === "light") mode = t.mode;
    else if (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) mode = "dark";
    if (t.accent === "green" || t.accent === "blue" || t.accent === "purple") accent = t.accent;
  } catch (e) {}
  d.setAttribute("data-mode", mode);
  d.setAttribute("data-accent", accent);
})();`;

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: the script above sets data-mode / data-accent
    // on <html> before React hydrates, which is intentional.
    <html lang="en" data-mode="light" data-accent="green" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={nunito.className}>{children}</body>
    </html>
  );
}
