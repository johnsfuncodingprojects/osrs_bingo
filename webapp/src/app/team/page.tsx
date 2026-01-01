"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/hooks/useSession";
import { useRouter } from "next/navigation";

type Team = {
  id: string;
  name: string;
  join_code: string;
  created_at?: string | null;
};

type Membership = {
  team_id: string;
  role: string;
  created_at: string | null;
};

type MyProfile = {
  id: string;
  rsn: string | null;
};

const ACTIVE_TEAM_KEY = "osrs_active_team_id";

export default function TeamPage() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState(false);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [teamsById, setTeamsById] = useState<Record<string, Team>>({});
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  const [teamName, setTeamName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  // ✅ RSN
  const [myRsn, setMyRsn] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const displayName = useMemo(() => {
    const md: any = session?.user?.user_metadata;
    return (
      md?.full_name ??
      md?.name ??
      md?.preferred_username ??
      md?.user_name ??
      md?.username ??
      session?.user?.email ??
      "Unknown"
    );
  }, [session]);

  // ---------- helpers ----------
  function saveActiveTeam(id: string | null) {
    setActiveTeamId(id);
    try {
      if (typeof window !== "undefined") {
        if (!id) localStorage.removeItem(ACTIVE_TEAM_KEY);
        else localStorage.setItem(ACTIVE_TEAM_KEY, id);
      }
    } catch {
      // ignore
    }
  }

  function loadSavedActiveTeam(): string | null {
    try {
      if (typeof window === "undefined") return null;
      return localStorage.getItem(ACTIVE_TEAM_KEY);
    } catch {
      return null;
    }
  }

  const activeTeam: Team | null = activeTeamId ? teamsById[activeTeamId] ?? null : null;

  // ---------- admin check ----------
  useEffect(() => {
    if (!session) return;

    (async () => {
      const { data, error } = await supabase.from("app_admins").select("user_id").eq("user_id", session.user.id).maybeSingle();

      if (error) {
        console.error("admin check error:", error);
        setIsAdmin(false);
        return;
      }
      setIsAdmin(!!data);
    })();
  }, [session]);

  // ---------- load my profile (RSN) ----------
  useEffect(() => {
    if (!session) return;

    (async () => {
      try {
        const { data, error } = await supabase.from("profiles").select("id,rsn").eq("id", session.user.id).maybeSingle();
        if (error) throw error;
        const p = data as MyProfile | null;
        setMyRsn(p?.rsn ?? "");
      } catch {
        setMyRsn("");
      }
    })();
  }, [session]);

  async function saveRsn() {
    if (!session) return;
    setBusy(true);
    setMsg(null);
    try {
      // Prefer RPC if you created it:
      const rpc = await supabase.rpc("set_my_rsn", { p_rsn: myRsn });
      if (!rpc.error) {
        setMsg("RSN saved.");
        return;
      }

      // Fallback if RPC doesn't exist:
      const { error } = await supabase.from("profiles").update({ rsn: myRsn.trim() || null }).eq("id", session.user.id);
      if (error) throw error;

      setMsg("RSN saved.");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to save RSN.");
    } finally {
      setBusy(false);
    }
  }

  // ---------- load memberships + teams ----------
  useEffect(() => {
    if (!session) return;

    (async () => {
      setMsg(null);

      try {
        const { data: mems, error: memErr } = await supabase
          .from("team_members")
          .select("team_id, role, created_at")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false });

        if (memErr) throw memErr;

        const m = (mems ?? []) as Membership[];
        setMemberships(m);

        if (!m.length) {
          setTeamsById({});
          saveActiveTeam(null);
          return;
        }

        const ids = Array.from(new Set(m.map((x) => x.team_id)));
        const { data: teams, error: tErr } = await supabase.from("teams").select("id,name,join_code,created_at").in("id", ids).order("created_at", { ascending: false });

        if (tErr) throw tErr;

        const map: Record<string, Team> = {};
        for (const t of (teams ?? []) as any[]) map[t.id] = t as Team;
        setTeamsById(map);

        const saved = loadSavedActiveTeam();
        const savedOk = saved && ids.includes(saved);
        const firstExisting = ids.find((id) => !!map[id]) ?? ids[0];

        saveActiveTeam((savedOk ? saved : firstExisting) ?? null);
      } catch (e: any) {
        setMsg(e.message ?? "Failed to load teams.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function refreshMemberships() {
    if (!session) return;

    setMsg(null);
    try {
      const { data: mems, error: memErr } = await supabase
        .from("team_members")
        .select("team_id, role, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });
      if (memErr) throw memErr;

      const m = (mems ?? []) as Membership[];
      setMemberships(m);

      const ids = Array.from(new Set(m.map((x) => x.team_id)));
      if (!ids.length) {
        setTeamsById({});
        saveActiveTeam(null);
        return;
      }

      const { data: teams, error: tErr } = await supabase.from("teams").select("id,name,join_code,created_at").in("id", ids).order("created_at", { ascending: false });
      if (tErr) throw tErr;

      const map: Record<string, Team> = {};
      for (const t of (teams ?? []) as any[]) map[t.id] = t as Team;
      setTeamsById(map);

      const current = activeTeamId;
      const next = current && ids.includes(current) ? current : ids[0];
      saveActiveTeam(next ?? null);
    } catch (e: any) {
      setMsg(e.message ?? "Failed to refresh teams.");
    }
  }

  // ---------- actions ----------
  const createTeam = async () => {
    if (!session) return;

    if (!isAdmin) {
      setMsg("Only admins can create teams.");
      return;
    }
    if (!teamName.trim()) {
      setMsg("Team name required.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const { data: team, error } = await supabase.rpc("create_team_admin", {
        team_name: teamName.trim(),
      });
      if (error) throw error;

      const created = team as Team;

      await refreshMemberships();
      if (created?.id) saveActiveTeam(created.id);

      setTeamName("");
      setMsg("Team created!");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to create team.");
    } finally {
      setBusy(false);
    }
  };

  const joinTeam = async () => {
    if (!session) return;

    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setMsg("Join code required.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const { data: team, error } = await supabase.rpc("join_team", { team_code: code });

      if (error) throw error;
      if (!team?.id) {
        setMsg("Invalid join code.");
        return;
      }

      await refreshMemberships();
      saveActiveTeam(team.id);

      setJoinCode("");
      setMsg("Joined team!");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to join team.");
    } finally {
      setBusy(false);
    }
  };

  const leaveTeam = async (teamId: string) => {
    if (!session) return;

    setBusy(true);
    setMsg(null);

    try {
      const { error } = await supabase.from("team_members").delete().eq("team_id", teamId).eq("user_id", session.user.id);
      if (error) throw error;

      await refreshMemberships();
      if (teamId === activeTeamId) {
        const remaining = memberships.filter((m) => m.team_id !== teamId).map((m) => m.team_id);
        saveActiveTeam(remaining[0] ?? null);
      }

      setMsg("Left team.");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to leave team.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p style={{ padding: 40 }}>Loading...</p>;
  if (!session) return <p style={{ padding: 40 }}>Please log in.</p>;

  const myTeams = memberships
    .map((m) => ({ m, team: teamsById[m.team_id] }))
    .filter((x) => !!x.team)
    .map((x) => ({ ...x, team: x.team! }));

  return (
    <>
      <div className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--brand)" }} />
            OSRS Bingo
            <span className="badge">Team</span>
          </div>
          <div className="row">
            <a className="btn btn-ghost" href="/team">
              Team
            </a>
            <a className="btn btn-ghost" href="/board">
              Board
            </a>
            <a className="btn btn-ghost" href="/admin">
              Admin
            </a>
            <span className="pill">
              Signed in as <b>{displayName}</b>
            </span>
          </div>
        </div>
      </div>

      <main className="page">
        <div className="container">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <h1 className="h1">Team setup</h1>
              <p className="p" style={{ marginTop: 6 }}>
                Join as many teams as you want. Pick an <b>active team</b> for the Board.
              </p>
            </div>

            <div className="row">
              <button className="btn" onClick={refreshMemberships} disabled={busy}>
                Refresh
              </button>
              <button
                className="btn btn-primary"
                onClick={() => router.push("/board")}
                disabled={!activeTeamId}
                title={!activeTeamId ? "Join a team first" : "Go to the board"}
              >
                Go to Board
              </button>
            </div>
          </div>

          {msg && (
            <div
              className={`alert ${msg.toLowerCase().includes("fail") || msg.toLowerCase().includes("only") ? "alert-bad" : ""}`}
              style={{ marginTop: 14 }}
            >
              {msg}
            </div>
          )}

          {/* ✅ Profile / RSN */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-inner">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h2 className="h2">Profile</h2>
                  <p className="p" style={{ marginTop: 6 }}>
                    Add your OSRS RSN so teammates can tell who’s who.
                  </p>
                </div>
                <span className="badge">You</span>
              </div>

              <div className="row" style={{ marginTop: 12, alignItems: "stretch" }}>
                <input
                  className="input"
                  value={myRsn}
                  onChange={(e) => setMyRsn(e.target.value)}
                  placeholder="RSN (e.g., Zezima)"
                  style={{ maxWidth: 360 }}
                />
                <button className="btn btn-primary" onClick={saveRsn} disabled={busy}>
                  {busy ? "Saving..." : "Save RSN"}
                </button>
              </div>

              <div className="tiny" style={{ marginTop: 10 }}>
                Display format: <span className="mono">DiscordName (RSN: YourRSN)</span>
              </div>
            </div>
          </div>

          {/* Active team picker */}
          {myTeams.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-inner">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h2 className="h2">Active team</h2>
                    <p className="p" style={{ marginTop: 6 }}>
                      This is the team your <b>/board</b> should use by default.
                    </p>
                  </div>

                  <div className="row" style={{ alignItems: "center" }}>
                    <select
                      className="input"
                      value={activeTeamId ?? ""}
                      onChange={(e) => saveActiveTeam(e.target.value)}
                      style={{ minWidth: 260 }}
                    >
                      {myTeams.map(({ team }) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>

                    <a className="btn" href="/board">
                      Open Board
                    </a>
                  </div>
                </div>

                {activeTeam && (
                  <div className="alert" style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 900 }}>{activeTeam.name}</div>
                    <div style={{ marginTop: 6 }}>
                      Join code: <span className="kbd mono">{activeTeam.join_code}</span>
                    </div>
                  </div>
                )}

                <div className="teamTable" style={{ marginTop: 14 }}>
                  <div className="teamHead">
                    <div>Team</div>
                    <div>Role</div>
                    <div style={{ textAlign: "right" }}>Action</div>
                  </div>

                  {myTeams.map(({ team, m }) => {
                    const isActive = team.id === activeTeamId;

                    return (
                      <div className={`teamRow ${isActive ? "teamRowActive" : ""}`} key={team.id}>
                        <div className="teamCell">
                          <div className="teamName">
                            {team.name}
                            {isActive && <span className="badge badge-good">Active</span>}
                          </div>
                          <div className="teamSub mono">{team.id.slice(0, 8)}…</div>
                        </div>

                        <div className="teamCell">
                          <span className="badge">{m.role}</span>
                        </div>

                        <div className="teamActions">
                          {!isActive && (
                            <button className="btn btn-ghost" onClick={() => saveActiveTeam(team.id)} disabled={busy}>
                              Set active
                            </button>
                          )}
                          <button className="btn" onClick={() => leaveTeam(team.id)} disabled={busy}>
                            Leave
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="tiny" style={{ marginTop: 10 }}>
                  Tip: You can be on multiple teams. The Board reads your active team.
                </div>
              </div>
            </div>
          )}

          {/* Create / Join */}
          <div className="split" style={{ marginTop: 16 }}>
            {isAdmin && (
              <div className="card">
                <div className="card-inner">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <h2 className="h2">Create a team</h2>
                      <p className="p" style={{ marginTop: 6 }}>
                        Admins only. Creates the team + adds you as an owner/member.
                      </p>
                    </div>
                    <span className="badge">Admin</span>
                  </div>

                  <div style={{ marginTop: 12 }} className="col">
                    <input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" />
                    <button className="btn btn-primary" disabled={busy} onClick={createTeam}>
                      {busy ? "Working..." : "Create team"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-inner">
                <h2 className="h2">Join a team</h2>
                <p className="p" style={{ marginTop: 6 }}>
                  Enter the join code your admin gave you.
                </p>

                <div style={{ marginTop: 12 }} className="col">
                  <input
                    className="input mono"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="JOIN CODE"
                  />
                  <button className="btn" disabled={busy} onClick={joinTeam}>
                    {busy ? "Working..." : "Join team"}
                  </button>
                </div>

                {!isAdmin && (
                  <p className="p" style={{ marginTop: 12, fontSize: 13 }}>
                    Need a team created? Ask an admin and get a join code.
                  </p>
                )}
              </div>
            </div>
          </div>

          <style jsx global>{`
            .tiny {
              font-size: 12px;
              color: rgba(255, 255, 255, 0.55);
            }

            .teamTable {
              border: 1px solid rgba(255, 255, 255, 0.10);
              border-radius: 14px;
              overflow: hidden;
              background: rgba(255, 255, 255, 0.02);
            }

            .teamHead {
              display: grid;
              grid-template-columns: 2fr 0.8fr 1.4fr;
              gap: 12px;
              padding: 12px 14px;
              font-weight: 900;
              font-size: 12px;
              background: rgba(255, 255, 255, 0.03);
              border-bottom: 1px solid rgba(255, 255, 255, 0.10);
              color: rgba(255, 255, 255, 0.75);
            }

            .teamRow {
              display: grid;
              grid-template-columns: 2fr 0.8fr 1.4fr;
              gap: 12px;
              padding: 12px 14px;
              align-items: center;
              border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            }
            .teamRow:last-child {
              border-bottom: none;
            }

            .teamRowActive {
              background: rgba(88, 101, 242, 0.10);
            }

            .teamName {
              display: flex;
              align-items: center;
              gap: 8px;
              font-weight: 900;
            }

            .teamSub {
              margin-top: 4px;
              font-size: 12px;
              color: rgba(255, 255, 255, 0.55);
            }

            .teamActions {
              display: flex;
              justify-content: flex-end;
              gap: 10px;
              flex-wrap: wrap;
            }

            @media (max-width: 820px) {
              .teamHead {
                display: none;
              }
              .teamRow {
                grid-template-columns: 1fr;
                gap: 10px;
              }
              .teamActions {
                justify-content: flex-start;
              }
            }
          `}</style>

          <div style={{ height: 30 }} />
        </div>
      </main>
    </>
  );
}
