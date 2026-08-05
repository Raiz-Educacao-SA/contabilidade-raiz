import { createSign } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const DRIVE_ROOT = process.env.GOOGLE_DRIVE_EXTRATOS_FOLDER_ID || "1wnOtI3NpylWkvY6i6wUlc1sl_CM2Ml7I";
const FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveItem = { id: string; name: string; mimeType: string; parents?: string[]; modifiedTime?: string; size?: string };
type LocatedFile = DriveItem & { path: string };

let tokenCache: { token: string; expiresAt: number } | null = null;

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

async function listChildren(parentId: string) {
  const token = await accessToken();
  const items: DriveItem[] = []; let pageToken = "";
  do {
    const params = new URLSearchParams({ q: `'${parentId}' in parents and trashed = false`, fields: "nextPageToken,files(id,name,mimeType,parents,modifiedTime,size)", pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("O Google Drive não permitiu listar a pasta de extratos.");
    const data = await response.json() as { files: DriveItem[]; nextPageToken?: string };
    items.push(...data.files); pageToken = data.nextPageToken || "";
  } while (pageToken);
  return items;
}

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const words = (value: string) => normalized(value).replace(/\b\d+\b/g, " ").split(/[^A-Z0-9]+/).filter((word) => word.length > 2);

async function findCompanyFolder(company: string) {
  const companyCode = company.match(/^\s*(\d+)/)?.[1]?.replace(/^0+/, "");
  const terms = words(company);
  const groups = (await listChildren(DRIVE_ROOT)).filter((item) => item.mimeType === FOLDER_MIME);
  const candidates: DriveItem[] = [];
  for (const group of groups) candidates.push(...(await listChildren(group.id)).filter((item) => item.mimeType === FOLDER_MIME));
  const scored = candidates.map((item) => {
    const name = normalized(item.name); const folderCode = name.match(/^\s*(\d+)/)?.[1]?.replace(/^0+/, "");
    const score = (companyCode && folderCode === companyCode ? 100 : 0) + terms.filter((term) => name.includes(term)).length;
    return { item, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].item : null;
}

async function collectFiles(folder: DriveItem, path: string, depth = 0): Promise<LocatedFile[]> {
  if (depth > 6) return [];
  const output: LocatedFile[] = [];
  for (const item of await listChildren(folder.id)) {
    const itemPath = `${path}/${item.name}`;
    if (item.mimeType === FOLDER_MIME) output.push(...await collectFiles(item, itemPath, depth + 1));
    else output.push({ ...item, path: itemPath });
  }
  return output;
}

function matchesCompetence(file: LocatedFile, competence: string) {
  const [year, month] = competence.split("-"); const text = normalized(file.path);
  return text.includes(`${month}_${year}`) || text.includes(`${month}-${year}`) || (text.includes(`/${year}/`) && new RegExp(`(^|[^0-9])${month}([^0-9]|$)`).test(normalized(file.name)));
}

export async function GET(request: NextRequest) {
  try {
    const fileId = request.nextUrl.searchParams.get("fileId");
    if (fileId) {
      const token = await accessToken();
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) return NextResponse.json({ error: "Não foi possível baixar o extrato do Drive." }, { status: response.status });
      return new NextResponse(response.body, { headers: { "content-type": response.headers.get("content-type") || "application/octet-stream", "cache-control": "private, no-store" } });
    }
    const company = request.nextUrl.searchParams.get("company")?.trim(); const competence = request.nextUrl.searchParams.get("competence")?.trim();
    if (!company || !/^\d{4}-\d{2}$/.test(competence || "")) return NextResponse.json({ error: "Empresa e competência são obrigatórias." }, { status: 400 });
    const folder = await findCompanyFolder(company);
    if (!folder) return NextResponse.json({ files: [], warning: "Não encontrei uma pasta correspondente à empresa selecionada." });
    const files = (await collectFiles(folder, folder.name)).filter((file) => matchesCompetence(file, competence!)).map((file) => ({ id: file.id, name: file.name, path: file.path, mimeType: file.mimeType, modifiedTime: file.modifiedTime, size: file.size }));
    return NextResponse.json({ companyFolder: folder.name, competence, files });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
