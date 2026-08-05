import type { Metadata } from "next";
import "./globals.css";
import "./logo.css";
import "./modules.css";
import "./monthly.css";

export const metadata: Metadata = { title: "Contabilidade Raiz", description: "Financeiro, compras e folha de pagamento em um único ambiente" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
