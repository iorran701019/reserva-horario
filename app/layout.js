import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Tipografia do tema (next/font). Trocar a identidade tipográfica = trocar
// estas duas fontes. Expostas como CSS variables e consumidas pelo @theme do
// globals.css (--font-display = títulos, --font-sans = corpo/UI).
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: process.env.NEXT_PUBLIC_NOME_LOJA || "Agendamento",
  description: "Agende seu horário online.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="pt-BR"
      className={`${fraunces.variable} ${hankenGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
