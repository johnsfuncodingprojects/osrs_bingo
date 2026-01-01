'use client'

import { supabase } from '@/lib/supabase'

export default function LoginButton() {
  const signInWithDiscord = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  return (
    <button
      onClick={signInWithDiscord}
      style={{
        padding: '12px 20px',
        background: '#5865F2',
        color: 'white',
        borderRadius: 8,
        fontWeight: 'bold',
      }}
    >
      Login with Discord
    </button>
  )
}
