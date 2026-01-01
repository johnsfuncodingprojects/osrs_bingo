"use client";

import { supabase } from "@/lib/supabase";

export default function LoginButton() {
  const login = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: window.location.origin,
      },
    });
  };

  return (
    <button onClick={login} className="btn btn-primary">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 6,
            background: "rgba(255,255,255,0.22)",
            display: "inline-block",
          }}
        />
        Continue with Discord
      </span>
    </button>
  );
}
