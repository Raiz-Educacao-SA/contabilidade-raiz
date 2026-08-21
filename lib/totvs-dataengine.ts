import "server-only";

import type { NextRequest } from "next/server";
import { isAllowedCorporateEmail } from "@/lib/auth-domain";

const DEFAULT_BASE_URL = "https://raizeducacao160286.rm.cloudtotvs.com.br:8051";
const SQL_ACTION = "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL";

export type DataEngineQuery = {
  code: string;
  system: string;
  parameters: string;
  company?: number | string;
  timeoutMs?: number;
  errorMessage?: string;
};

export const escapeXml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

export const decodeXml = (value: string) => value
  .replace(/&#xD;|&#13;/gi, "\r")
  .replace(/&#xA;|&#10;/gi, "\n")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&");

export const xmlTag = (xml: string, ...names: string[]) => names
  .map((name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim())
  .find(Boolean) || "";

export const decodedTag = (xml: string, ...names: string[]) => decodeXml(xmlTag(xml, ...names));

export async function isAuthorized(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return false;
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { authorization, apikey: key },
    cache: "no-store",
  });
  if (!response.ok) return false;
  const user = await response.json();
  return isAllowedCorporateEmail(user?.email);
}

function configuration() {
  const baseUrl = (process.env.TOTVS_WS_PRD_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const user = process.env.TOTVS_WS_PRD_USER;
  const password = process.env.TOTVS_WS_PRD_PASSWORD;
  if (!user || !password) {
    throw new Error("As credenciais técnicas do TOTVS/DataEngine ainda não foram configuradas na Vercel.");
  }
  return { baseUrl, authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
}

export async function queryDataEngine({
  code,
  system,
  parameters,
  company = 0,
  timeoutMs = 290_000,
  errorMessage = "O TOTVS/DataEngine não conseguiu executar a consulta.",
}: DataEngineQuery): Promise<string[]> {
  const { baseUrl, authorization } = configuration();
  const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>${escapeXml(code)}</codSentenca><codColigada>${escapeXml(String(company))}</codColigada><codSistema>${escapeXml(system)}</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${baseUrl}/wsConsultaSQL/IwsConsultaSQL`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "text/xml; charset=utf-8",
      soapaction: SQL_ACTION,
    },
    body: envelope,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const soap = await response.text();
  if (!response.ok || /<(?:\w+:)?Fault[ >]/i.test(soap)) {
    throw new Error(decodeXml(xmlTag(soap, "faultstring", "faultcode")) || errorMessage);
  }
  const result = decodeXml(xmlTag(soap, "RealizarConsultaSQLResult"));
  return Array.from(result.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match) => match[1]);
}
