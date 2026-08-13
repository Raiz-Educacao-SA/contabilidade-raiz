import { createSign } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SUPPORTED = /\.(pdf|png|jpe?g|webp|xlsx|xls|xlsm)$/i;
type DriveItem = { id: string; name: string; mimeType: string; parents?: string[]; modifiedTime?: string; size?: string };
type LocatedFile = DriveItem & { path: string };
let tokenCache: { token: string; expiresAt: number } | null = null;

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const escapeQuery = (value: string) => value.replace(/'/g, "\\'");
const monthNames = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function accessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const email = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("A conexão segura com o Google Drive ainda não foi configurada na Vercel.");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256"); signer.update(`${header}.${claim}`); signer.end();
  const assertion = `${header}.${claim}.${base64url(signer.sign(privateKey))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível autenticar a leitura do Google Drive.");
  const data = await response.json() as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function authorizedCompanies(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return null;
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" });
  if (!userResponse.ok) return null;
  const user = await userResponse.json() as { id?: string };
  if (!user.id) return null;
  const accessResponse = await fetch(`${url}/rest/v1/usuarios_empresas?select=empresas(codcoligada)&usuario_id=eq.${encodeURIComponent(user.id)}`, { headers: { authorization, apikey: key }, cache: "no-store" });
  if (!accessResponse.ok) throw new Error("Não foi possível validar as empresas liberadas para este usuário.");
  const links = await accessResponse.json() as Array<{ empresas?: { codcoligada?: string | number } | null }>;
  return new Set(links.flatMap((link) => link.empresas?.codcoligada == null ? [] : [String(link.empresas.codcoligada)]));
}

async function driveList(q: string) {
  const token = await accessToken();
  const items: DriveItem[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ q, fields: "nextPageToken,files(id,name,mimeType,parents,modifiedTime,size)", pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("O Google Drive não permitiu localizar os documentos da folha.");
    const data = await response.json() as { files: DriveItem[]; nextPageToken?: string };
    items.push(...data.files); pageToken = data.nextPageToken || "";
  } while (pageToken);
  return items;
}

async function itemMetadata(id: string) {
  const token = await accessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,parents&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  return response.ok ? await response.json() as DriveItem : null;
}

async function parentPath(item: DriveItem) {
  const names = [item.name];
  let parentId = item.parents?.[0];
  for (let depth = 0; parentId && depth < 8; depth += 1) {
    const parent = await itemMetadata(parentId);
    if (!parent) break;
    names.unshift(parent.name); parentId = parent.parents?.[0];
  }
  return names.join("/");
}

async function locateCompanyFolder(company: string, competence: string) {
  const [year, monthText] = competence.split("-");
  const month = Number(monthText);
  const code = company.replace(/^0+/, "");
  const rootId = process.env.GOOGLE_DRIVE_FOLHA_FOLDER_ID;
  const q = rootId
    ? `'${escapeQuery(rootId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`
    : `mimeType = '${FOLDER_MIME}' and name contains '${escapeQuery(code.padStart(2, "0"))}' and trashed = false`;
  const folders = await driveList(q);
  const candidates = [] as Array<{ folder: DriveItem; path: string; score: number }>;
  for (const folder of folders) {
    const name = normalized(folder.name);
    const folderCode = name.match(/^\s*(\d+)/)?.[1]?.replace(/^0+/, "");
    if (folderCode !== code) continue;
    const path = await parentPath(folder);
    const normalizedPath = normalized(path);
    const score = 100
      + (normalizedPath.includes(year) ? 20 : 0)
      + (normalizedPath.includes(monthNames[month - 1]) ? 20 : 0)
      + (normalizedPath.includes("FOLHA") ? 10 : 0)
      + (normalizedPath.includes("DOC_SUPORTE") ? 5 : 0);
    candidates.push({ folder, path, score });
  }
  return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

async function collectFiles(folder: DriveItem, path: string, depth = 0): Promise<LocatedFile[]> {
  if (depth > 5) return [];
  const output: LocatedFile[] = [];
  for (const item of await driveList(`'${escapeQuery(folder.id)}' in parents and trashed = false`)) {
    const itemPath = `${path}/${item.name}`;
    if (item.mimeType === FOLDER_MIME) output.push(...await collectFiles(item, itemPath, depth + 1));
    else output.push({ ...item, path: itemPath });
  }
  return output;
}

function isSupportFile(file: LocatedFile) {
  const path = normalized(file.path);
  if (!SUPPORTED.test(file.name) || path.includes("00 - ANTERIORES")) return false;
  if (/CONFERENCIA.*LOTE|ANALISE DE FOLHA.*\.XLS/i.test(path)) return false;
  return true;
}

export async function GET(request: NextRequest) {
  try {
    const company = request.nextUrl.searchParams.get("company")?.trim() || "";
    const allowed = await authorizedCompanies(request);
    if (!allowed) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    if (company && (!/^\d+$/.test(company) || !allowed.has(company))) {
      return NextResponse.json({ error: "Esta coligada não está liberada para o usuário." }, { status: 403 });
    }

    const fileId = request.nextUrl.searchParams.get("fileId");
    if (fileId) {
      const token = await accessToken();
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) return NextResponse.json({ error: "Não foi possível baixar o documento da folha." }, { status: response.status });
      return new NextResponse(response.body, { headers: { "content-type": response.headers.get("content-type") || "application/octet-stream", "cache-control": "private, no-store" } });
    }

    const competence = request.nextUrl.searchParams.get("competence")?.trim() || "";
    if (!/^\d+$/.test(company) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });

    const located = await locateCompanyFolder(company, competence);
    if (!located) return NextResponse.json({ error: `Não foi localizada no Drive a pasta da coligada ${company} para ${competence}.` }, { status: 404 });
    const files = (await collectFiles(located.folder, located.path)).filter(isSupportFile).map(({ id, name, path, mimeType, modifiedTime, size }) => ({ id, name, path, mimeType, modifiedTime, size }));
    if (!files.length) return NextResponse.json({ error: `A pasta ${located.path} não contém documentos de suporte válidos.` }, { status: 404 });
    return NextResponse.json({ companyFolder: located.folder.name, folderPath: located.path, competence, files }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
