"use client";

import { useEffect, useState } from "react";
import LoginButton from "@/components/LoginButton";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const { session, loading } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [session]);

  if (loading) return <p style={{ padding: 40 }}>Loading...</p>;

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="container">
        <div className="card" style={{ width: "min(720px, 100%)", margin: "0 auto" }}>
          <div className="card-inner" style={{ padding: 26 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="brand">
                <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--brand)" }} />
                OSRS Bingo
                <span className="badge">Blackout</span>
              </div>
            </div>

            <div style={{ marginTop: 18 }} className="col">
              {!session ? (
                <>
                  <h1 className="h1">Log in with Discord</h1>
                  <p className="p">
                    Join your team, claim squares, and keep everyone honest with proof uploads.
                  </p>
                  <div className="row" style={{ marginTop: 6 }}>
                    <LoginButton />
                    <span className="badge">Private bucket proof images</span>
                  </div>
                </>
              ) : (
                <>
                  <h1 className="h1">Welcome back</h1>
                  <p className="p">You're signed in.</p>
                  <div className="row" style={{ marginTop: 10 }}>
                    <a className="btn btn-primary" href="/team">Go to Team</a>
                    <a className="btn" href="/board">Go to Board</a>
                    {isAdmin && <a className="btn btn-ghost" href="/admin">Admin</a>}
                  </div>
                </>
              )}
            </div>

            {!session && (
              <div style={{ marginTop: 20 }} className="alert">
                Tip: Log in with Discord to join your team and start tracking tiles.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
