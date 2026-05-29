import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ?? "1BQGJ9-2YI2F5bB_5h5Ng_07evRvlSIWNe8gZoUgzfZg";
const SUMMARY_SHEET_NAME = process.env.GOOGLE_SHEET_NAME ?? "Summary Board";

function adminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL env var is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY env var is not set");
  return createClient(url, key);
}

async function getGoogleToken(): Promise<string> {
  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!saEmail || !saKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set");
  }
  const jwt = new JWT({
    email: saEmail,
    key: saKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const res = await jwt.getAccessToken();
  if (!res.token) throw new Error("Failed to get Google access token");
  return res.token;
}

async function fetchSheetRows(googleToken: string, sheetName: string): Promise<string[][]> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/` +
    encodeURIComponent(sheetName);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${googleToken}` } });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Sheets API failed for "${sheetName}": ${resp.status} — ${body.slice(0, 200)}`);
  }
  const json = await resp.json();
  return (json.values ?? []) as string[][];
}

export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (e: any) {
    console.error("[sync-tiles] unhandled error:", e);
    return NextResponse.json({ error: e?.message ?? "Internal server error" }, { status: 500 });
  }
}

async function handlePost(req: NextRequest) {
  // Auth
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = adminClient();
  const { data: { user }, error: authErr } = await db.auth.getUser(auth.slice(7));
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: adminRow } = await db
    .from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!adminRow) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Google token
  const googleToken = await getGoogleToken();

  // Discover team sheet names from spreadsheet metadata
  const metaResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${googleToken}` } }
  );
  if (!metaResp.ok) {
    return NextResponse.json({ error: `Metadata fetch failed: ${metaResp.status}` }, { status: 502 });
  }
  const meta = await metaResp.json();
  const allSheetNames: string[] = (meta.sheets ?? []).map((s: any) => s.properties?.title as string).filter(Boolean);
  const teamSheetNames = allSheetNames.filter((n) => /^Team \d+$/i.test(n));

  // Fetch Summary Board → parse tile content
  const summaryRows = await fetchSheetRows(googleToken, SUMMARY_SHEET_NAME);
  const tiles: Array<{ code: string; title: string; requirement: string; description: string }> = [];
  for (const row of summaryRows) {
    if (row.length < 8) continue;
    const num = parseInt(row[4], 10);
    if (isNaN(num) || num < 1 || num > 22) continue;
    tiles.push({
      code: `S${String(num).padStart(2, "0")}`,
      title: (row[6] ?? "").trim(),
      requirement: (row[7] ?? "").trim(),
      description: (row[5] ?? "").trim(),
    });
  }
  if (tiles.length === 0) {
    return NextResponse.json({ error: "No tiles parsed from Summary Board" }, { status: 422 });
  }

  // Load all DB teams
  const { data: dbTeams, error: teamsErr } = await db.from("teams").select("id,name");
  if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 });
  const teamsByName: Record<string, string> = {};
  for (const t of dbTeams ?? []) teamsByName[t.name] = t.id;

  // Upsert tile content for every team
  for (const team of dbTeams ?? []) {
    const rows = tiles.map((t) => ({ team_id: team.id, ...t }));
    const { error } = await db.from("squares").upsert(rows, { onConflict: "team_id,code" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sync progress from each Team XX sheet
  const progressResults: Array<{ sheet: string; teamName: string; tilesUpdated: number; matched: boolean }> = [];

  for (const sheetName of teamSheetNames) {
    let sheetRows: string[][];
    try {
      sheetRows = await fetchSheetRows(googleToken, sheetName);
    } catch (e: any) {
      progressResults.push({ sheet: sheetName, teamName: "", tilesUpdated: 0, matched: false });
      continue;
    }

    // Find team name from the "Team Name:" row (col[26] = label, col[27] = value)
    let teamName = "";
    for (const row of sheetRows) {
      if ((row[26] ?? "").trim() === "Team Name:" && row[27]) {
        teamName = row[27].trim();
        break;
      }
    }

    const teamId = teamsByName[teamName];
    if (!teamId) {
      progressResults.push({ sheet: sheetName, teamName, tilesUpdated: 0, matched: false });
      continue;
    }

    // Parse tile progress (col[24] = tile num, col[30] = "0.0%")
    const progressRows: Array<{ team_id: string; code: string; progress_pct: number; completed: boolean }> = [];
    for (const row of sheetRows) {
      if (row.length < 31) continue;
      const num = parseInt(row[24] ?? "", 10);
      if (isNaN(num) || num < 1 || num > 22) continue;
      const pct = parseFloat((row[30] ?? "").replace("%", "").trim());
      if (isNaN(pct)) continue;
      progressRows.push({
        team_id: teamId,
        code: `S${String(num).padStart(2, "0")}`,
        progress_pct: pct,
        completed: pct >= 100,
      });
    }

    for (const row of progressRows) {
      const { error } = await db
        .from("squares")
        .update({ progress_pct: row.progress_pct, completed: row.completed })
        .eq("team_id", row.team_id)
        .eq("code", row.code);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    progressResults.push({ sheet: sheetName, teamName, tilesUpdated: progressRows.length, matched: true });
  }

  return NextResponse.json({
    status: "ok",
    tiles_parsed: tiles.length,
    teams_in_db: (dbTeams ?? []).length,
    progress_synced: progressResults,
  });
}
