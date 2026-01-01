import { supabase } from '@/lib/supabase'

export async function createTeam(teamName: string) {
  const { data, error } = await supabase.rpc('create_team', { team_name: teamName })
  if (error) throw error
  return data
}

export async function joinTeam(teamCode: string) {
  const { data, error } = await supabase.rpc('join_team', { team_code: teamCode })
  if (error) throw error
  return data
}

export async function getMyTeams() {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}
