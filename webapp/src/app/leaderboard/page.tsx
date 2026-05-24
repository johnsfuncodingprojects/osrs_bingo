"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/hooks/useSession";
import { useRouter } from "next/navigation";

type Team = {
  id: string;
  name: string;
  created_at: string | null;
};

type Square = {
  team_id: string;
  completed: boolean;
  progress_pct: number;
};

type TeamStat = {
  team: Team;
  done: number;
  total: number;
  pct: number;
  avgProgress: number;
};

const RANK_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"];
const RANK_LABELS = ["1st", "2nd", "3rd"];

export default function LeaderboardPage() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [teams, setTeams] = useState<Team[]>([]);
  const [squares, setSquares] = useState<Square[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      if (typeof window !== "undefined") window.location.replace("/");
      return;
    }

    (async () => {
      try {
        const [teamsRes, squaresRes, adminRes] = await Promise.all([
          supabase.from("teams").select("id,name,created_at").order("created_at", { ascending: true }),
          supabase.from("squares").select("team_id,completed,progress_pct"),
          supabase.from("app_admins").select("user_id").eq("user_id", session.user.id).maybeSingle(),
        ]);

        if (teamsRes.error) throw teamsRes.error;
        if (squaresRes.error) throw squaresRes.error;

        setTeams((teamsRes.data ?? []) as Team[]);
        setSquares((squaresRes.data ?? []) as Square[]);
        setIsAdmin(!!adminRes.data);
        setLastUpdated(new Date());
        setDataLoaded(true);
      } catch (e: any) {
        setMsg(e.message ?? "Failed to load leaderboard.");
      }
    })();
  }, [loading, session]);

  const stats = useMemo((): TeamStat[] => {
    const squaresByTeam: Record<string, Square[]> = {};
    for (const s of squares) {
      squaresByTeam[s.team_id] ??= [];
      squaresByTeam[s.team_id].push(s);
    }

    return teams
      .map((team) => {
        const ts = squaresByTeam[team.id] ?? [];
        const done = ts.filter((s) => s.completed).length;
        const total = ts.length;
        const pct = total > 0 ? (done / total) * 100 : 0;
        const avgProgress =
          total > 0
            ? ts.reduce((acc, s) => acc + (s.progress_pct ?? 0), 0) / total
            : 0;
        return { team, done, total, pct, avgProgress };
      })
      .sort((a, b) => {
        if (b.done !== a.done) return b.done - a.done;
        if (b.avgProgress !== a.avgProgress) return b.avgProgress - a.avgProgress;
        return a.team.name.localeCompare(b.team.name);
      });
  }, [teams, squares]);

  const leader = stats[0] ?? null;

  if (loading || (!dataLoaded && !msg)) {
    return <p style={{ padding: 40 }}>Loading...</p>;
  }

  if (!session) return null;

  return (
    <>
      <div className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <span className="dot" />
            OSRS Bingo
            <span className="badge">Leaderboard</span>
          </div>
          <div className="row">
            <a className="btn btn-ghost" href="/board">Board</a>
            <a className="btn btn-ghost" href="/team">Team</a>
            {isAdmin && <a className="btn btn-ghost" href="/admin">Admin</a>}
          </div>
        </div>
      </div>

      <main className="page">
        <div className="container">
          <div style={{ marginBottom: 24 }}>
            <h1 className="h1">Leaderboard</h1>
            <p className="p" style={{ marginTop: 6 }}>
              Live standings — ranked by tiles completed, then overall progress.
            </p>
            {lastUpdated && (
              <p className="tiny" style={{ marginTop: 4 }}>
                Last updated: {lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </div>

          {msg && <div className="alert">{msg}</div>}

          {/* Podium — top 3 */}
          {stats.length >= 2 && (
            <div className="podium" style={{ marginBottom: 24 }}>
              {stats.slice(0, Math.min(3, stats.length)).map((s, i) => (
                <a
                  key={s.team.id}
                  className="podium-card"
                  href={`/board?team=${s.team.id}`}
                  style={{ "--rank-color": RANK_COLORS[i] } as React.CSSProperties}
                >
                  <div className="podium-rank">{RANK_LABELS[i] ?? `${i + 1}th`}</div>
                  <div className="podium-name">{s.team.name}</div>
                  <div className="podium-score">
                    {s.done}<span style={{ opacity: 0.5, fontSize: 14 }}>/{s.total}</span>
                  </div>
                  <div className="tiny" style={{ opacity: 0.6 }}>tiles completed</div>
                  <div className="progress-bar" style={{ marginTop: 10 }}>
                    <div className="progress-fill" style={{ width: `${s.pct}%`, background: RANK_COLORS[i] }} />
                  </div>
                  <div className="tiny" style={{ marginTop: 4, opacity: 0.5 }}>
                    {s.pct.toFixed(1)}%
                  </div>
                </a>
              ))}
            </div>
          )}

          {/* Full table */}
          <div className="panel">
            <div className="panel-title" style={{ marginBottom: 12 }}>All Teams</div>
            <div className="lb-table">
              <div className="lb-head">
                <div>#</div>
                <div>Team</div>
                <div>Tiles</div>
                <div>Progress</div>
                <div></div>
              </div>
              {stats.map((s, i) => {
                const rankColor = i < 3 ? RANK_COLORS[i] : undefined;
                return (
                  <div className="lb-row" key={s.team.id}>
                    <div
                      className="lb-rank"
                      style={rankColor ? { color: rankColor, fontWeight: 900 } : undefined}
                    >
                      {i + 1}
                    </div>
                    <div>
                      <div style={{ fontWeight: 900 }}>{s.team.name}</div>
                      {leader && i === 0 && s.done > 0 && (
                        <div className="tiny" style={{ color: RANK_COLORS[0], marginTop: 2 }}>
                          Leading
                        </div>
                      )}
                      {i > 0 && leader && leader.done > s.done && (
                        <div className="tiny" style={{ opacity: 0.5, marginTop: 2 }}>
                          {leader.done - s.done} tile{leader.done - s.done !== 1 ? "s" : ""} behind
                        </div>
                      )}
                    </div>
                    <div>
                      <span style={{ fontWeight: 900 }}>{s.done}</span>
                      <span className="tiny" style={{ opacity: 0.5 }}>/{s.total}</span>
                    </div>
                    <div style={{ minWidth: 140 }}>
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${s.pct}%`,
                            background: rankColor ?? "var(--good)",
                          }}
                        />
                      </div>
                      <div className="tiny" style={{ marginTop: 3, opacity: 0.6 }}>
                        {s.pct.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <a className="btn" href={`/board?team=${s.team.id}`}>
                        View board
                      </a>
                    </div>
                  </div>
                );
              })}
              {stats.length === 0 && (
                <div className="tiny" style={{ padding: 16 }}>No teams yet.</div>
              )}
            </div>
          </div>

          <div style={{ height: 30 }} />
        </div>
      </main>

      <style jsx global>{`
        .podium {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 14px;
        }
        .podium-card {
          display: block;
          border: 1px solid var(--rank-color, var(--border));
          border-radius: 16px;
          padding: 20px 16px;
          background: rgba(0, 0, 0, 0.2);
          text-decoration: none;
          color: inherit;
          transition: background 0.15s, transform 0.1s;
        }
        .podium-card:hover {
          background: rgba(255, 255, 255, 0.04);
          transform: translateY(-2px);
        }
        .podium-rank {
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--rank-color, var(--muted2));
          margin-bottom: 6px;
        }
        .podium-name {
          font-size: 18px;
          font-weight: 950;
          line-height: 1.2;
          margin-bottom: 8px;
        }
        .podium-score {
          font-size: 36px;
          font-weight: 950;
          line-height: 1;
        }

        .lb-table {
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          overflow: hidden;
        }
        .lb-head {
          display: grid;
          grid-template-columns: 40px 1fr 80px 1fr 100px;
          gap: 10px;
          padding: 10px 14px;
          background: rgba(0, 0, 0, 0.3);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: rgba(255, 255, 255, 0.5);
        }
        .lb-row {
          display: grid;
          grid-template-columns: 40px 1fr 80px 1fr 100px;
          gap: 10px;
          padding: 12px 14px;
          align-items: center;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .lb-row:hover {
          background: rgba(255, 255, 255, 0.02);
        }
        .lb-rank {
          font-size: 16px;
          font-weight: 900;
          color: rgba(255, 255, 255, 0.4);
        }
        @media (max-width: 600px) {
          .lb-head,
          .lb-row {
            grid-template-columns: 32px 1fr 60px 100px;
          }
          .lb-head > *:nth-child(5),
          .lb-row > *:nth-child(5) {
            display: none;
          }
        }
      `}</style>
    </>
  );
}
