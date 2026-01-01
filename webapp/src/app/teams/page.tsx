'use client'

import { useEffect, useState } from 'react'
import { createTeam, joinTeam, getMyTeams } from '@/lib/team'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function TeamsPage() {
  const router = useRouter()
  const [userLoaded, setUserLoaded] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [teamCode, setTeamCode] = useState('')
  const [teams, setTeams] = useState<any[]>([])
  const [msg, setMsg] = useState<string>('')

  const refresh = async () => {
    const t = await getMyTeams()
    setTeams(t)
  }

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.replace('/')
        return
      }
      setUserLoaded(true)
      await refresh()
    })()
  }, [router])

  const onCreate = async () => {
    setMsg('')
    try {
      const t = await createTeam(teamName.trim())
      setTeamName('')
      await refresh()
      setMsg(`Created team "${t.name}" with code ${t.code}`)
    } catch (e: any) {
      setMsg(e.message ?? String(e))
    }
  }

  const onJoin = async () => {
    setMsg('')
    try {
      const t = await joinTeam(teamCode.trim().toUpperCase())
      setTeamCode('')
      await refresh()
      setMsg(`Joined team "${t.name}"`)
    } catch (e: any) {
      setMsg(e.message ?? String(e))
    }
  }

  if (!userLoaded) return <p style={{ padding: 40 }}>Loading...</p>

  return (
    <main style={{ padding: 40 }}>
      <h1>Teams</h1>

      <div style={{ marginTop: 20 }}>
        <h3>Create team</h3>
        <input
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="Team name"
          style={{ padding: 10, width: 260, marginRight: 10 }}
        />
        <button onClick={onCreate} disabled={!teamName.trim()}>
          Create
        </button>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Join team</h3>
        <input
          value={teamCode}
          onChange={(e) => setTeamCode(e.target.value)}
          placeholder="ABCD-1234"
          style={{ padding: 10, width: 260, marginRight: 10, textTransform: 'uppercase' }}
        />
        <button onClick={onJoin} disabled={!teamCode.trim()}>
          Join
        </button>
      </div>

      {msg && <p style={{ marginTop: 20 }}>{msg}</p>}

      <div style={{ marginTop: 30 }}>
        <h3>My teams</h3>
        {teams.length === 0 ? (
          <p>No teams yet.</p>
        ) : (
          <ul>
            {teams.map((t) => (
              <li key={t.id}>
                <b>{t.name}</b> — code: <code>{t.code}</code> —{' '}
                <a href={`/board?team=${t.id}`}>Open board</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
