import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

export const metadata = {
  title: "Mathlingo – Learn math the fun way",
  description: "A Duolingo-style web app for practising math topics with Pieter.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={nunito.className}>{children}</body>
    </html>
  );
}
