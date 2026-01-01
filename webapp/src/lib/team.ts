import { supabase } from "@/lib/supabase";

export type Team = {
  id: string;
  name: string;
  join_code: string;
  created_at: string | null;
};

export type TeamMembership = {
  team_id: string;
  user_id: string;
  role: string;
  created_at: string | null;
  teams?: Team | null;
};

function normalizeRpcReturn<T>(data: any): T | null {
  // Supabase RPC sometimes returns:
  // - a single object
  // - an array of objects
  // - null
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] ?? null) as T | null;
  return data as T;
}

export async function createTeam(teamName: string) {
  const { data, error } = await supabase.rpc("create_team", { team_name: teamName });
  if (error) throw error;

  // Expecting your RPC to return either { team_id, join_code, ... } or a Team row.
  return normalizeRpcReturn<any>(data);
}

export async function joinTeam(teamCode: string) {
  const { data, error } = await supabase.rpc("join_team", { team_code: teamCode });
  if (error) throw error;

  return normalizeRpcReturn<any>(data);
}

/**
 * Returns memberships for the current user (multi-team safe).
 * Also joins the actual Team rows.
 */
export async function getMyMemberships(): Promise<TeamMembership[]> {
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id,user_id,role,created_at,teams(id,name,join_code,created_at)")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []) as any;
}

/**
 * Returns only the teams the current user is a member of (multi-team safe).
 */
export async function getMyTeams(): Promise<Team[]> {
  const memberships = await getMyMemberships();
  const teams = memberships.map((m) => m.teams).filter(Boolean) as Team[];

  // De-dupe by id just in case
  const seen = new Set<string>();
  const out: Team[] = [];
  for (const t of teams) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }

  return out;
}

/**
 * Convenience: "default" team for screens that still assume one.
 * Picks most-recent membership.
 */
export async function getMyDefaultTeam(): Promise<Team | null> {
  const teams = await getMyTeams();
  return teams[0] ?? null;
}
