"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const finishLogin = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (session?.user) {
        const md: any = session.user.user_metadata;
        const displayName =
          md?.full_name ??
          md?.name ??
          md?.preferred_username ??
          md?.user_name ??
          md?.username ??
          "Unknown";

        // Only if you actually have a profiles table
        await supabase.from("profiles").upsert({
          id: session.user.id,
          display_name: displayName,
          avatar_url: md?.avatar_url ?? md?.picture ?? null,
          updated_at: new Date().toISOString(),
        });
      }

      router.replace("/");
    };

    finishLogin();
  }, [router]);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card" style={{ width: "min(520px, 100%)" }}>
        <div className="card-inner" style={{ padding: 26 }}>
          <div className="brand">
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--brand)" }} />
            OSRS Bingo
            <span className="badge">Auth</span>
          </div>
          <h1 className="h2" style={{ marginTop: 14 }}>Finishing login…</h1>
          <p className="p" style={{ marginTop: 6 }}>
            Syncing your Discord profile and redirecting you back.
          </p>
          <div className="alert" style={{ marginTop: 14 }}>
            If you get stuck, refresh and try logging in again.
          </div>
        </div>
      </div>
    </main>
  );
}
