'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import LoginButton from '@/components/LoginButton'

export default function Home() {
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  return (
    <main style={{ padding: 40 }}>
      <h1>OSRS Bingo</h1>

      {!user ? (
        <LoginButton />
      ) : (
        <>
          <p>Logged in as:</p>
          <p> <a href="/teams">Go to Teams</a></p>
          <pre>{JSON.stringify(user.user_metadata, null, 2)}</pre>
        </>
      )}
    </main>
  )
}
