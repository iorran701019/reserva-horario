import { Fraunces, Hanken_Grotesk, Cormorant_Garamond } from "next/font/google";
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

// Fonte própria do tema da Laysla (lib/temas.js: fonteDisplay: "font-cormorant").
// Pesos 400/500 cobrem subtítulo e nome do Hero (ver components/Hero.js).
const cormorantGaramond = Cormorant_Garamond({
  variable: "--font-cormorant-garamond",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata = {
  title: "reserva-horario",
  description: "Agende seu horário online.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="pt-BR"
      className={`${fraunces.variable} ${hankenGrotesk.variable} ${cormorantGaramond.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
