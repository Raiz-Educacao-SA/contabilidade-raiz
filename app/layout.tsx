import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Conciliação Financeira", description: "Gestão financeira segura e orientada por dados" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
