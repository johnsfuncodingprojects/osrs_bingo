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

export async function getMyMemberships(): Promise<TeamMembership[]> {
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id,user_id,role,created_at,teams(id,name,join_code,created_at)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as any;
}

export async function getMyTeams(): Promise<Team[]> {
  const memberships = await getMyMemberships();
  const seen = new Set<string>();
  const out: Team[] = [];
  for (const m of memberships) {
    if (!m.teams || seen.has(m.teams.id)) continue;
    seen.add(m.teams.id);
    out.push(m.teams);
  }
  return out;
}

export async function getMyDefaultTeam(): Promise<Team | null> {
  const teams = await getMyTeams();
  return teams[0] ?? null;
}
