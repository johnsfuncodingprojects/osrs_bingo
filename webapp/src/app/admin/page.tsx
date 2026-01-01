"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/hooks/useSession";
import { useRouter } from "next/navigation";

type TeamRow = {
  id: string;
  name: string;
  join_code: string;
  created_at: string | null;
};

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  rsn: string | null;
};

type MemberRow = {
  team_id: string;
  user_id: string;
  role: string;
  created_at: string | null;
};

type ClaimRow = {
  id: string;
  team_id: string | null;
  square_id: string;
  user_id: string;
  status: string;
  created_at: string | null;
  image_path: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

type SquareRow = {
  id: string;
  team_id: string;
  code: string;
  title: string;
  requirement: string;
  completed: boolean;
  completed_at: string | null;
};

type AdminRow = {
  user_id: string;
};

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function downloadCSV(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toNameFallback(id: string) {
  return `User ${id.slice(0, 6)}`;
}

function formatUserLabel(userId: string, p?: Profile) {
  const base = p?.display_name || toNameFallback(userId);
  const rsn = (p?.rsn || "").trim();
  return rsn ? `${base} (RSN: ${rsn})` : base;
}

export default function AdminPage() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});

  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [squares, setSquares] = useState<SquareRow[]>([]);

  const [selectedTeamId, setSelectedTeamId] = useState<string | "ALL">("ALL");

  // Create team
  const [newTeamName, setNewTeamName] = useState("");

  // Admin management
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [adminUserIdInput, setAdminUserIdInput] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/");
      return;
    }

    (async () => {
      try {
        setMsg(null);

        const { data, error } = await supabase.rpc("is_admin");
        if (error) throw error;

        const ok = !!data;
        setIsAdmin(ok);

        if (!ok) {
          setMsg("Admins only.");
          return;
        }

        await refreshAll();
      } catch (e: any) {
        setIsAdmin(false);
        setMsg(e.message ?? "Admins only.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session]);

  async function refreshAll() {
    setBusy(true);
    setMsg(null);
    try {
      // Teams
      const t = await supabase.from("teams").select("id,name,join_code,created_at").order("created_at", { ascending: false });
      if (t.error) throw t.error;
      setTeams((t.data ?? []) as TeamRow[]);

      // Members
      const m = await supabase.from("team_members").select("team_id,user_id,role,created_at");
      if (m.error) throw m.error;
      setMembers((m.data ?? []) as MemberRow[]);

      // Squares
      const s = await supabase.from("squares").select("id,team_id,code,title,requirement,completed,completed_at");
      if (s.error) throw s.error;
      setSquares((s.data ?? []) as SquareRow[]);

      // Claims
      const c = await supabase
        .from("claims")
        .select("id,team_id,square_id,user_id,status,created_at,image_path,reviewed_by,reviewed_at")
        .order("created_at", { ascending: false });
      if (c.error) throw c.error;
      setClaims((c.data ?? []) as ClaimRow[]);

      // Admin list (best effort)
      const a = await supabase.from("app_admins").select("user_id");
      if (!a.error) setAdmins((a.data ?? []) as AdminRow[]);

      // Profiles for any users referenced
      const userIds = new Set<string>();
      for (const r of (m.data ?? []) as any[]) userIds.add(r.user_id);
      for (const r of (c.data ?? []) as any[]) userIds.add(r.user_id);
      for (const r of (c.data ?? []) as any[]) if (r.reviewed_by) userIds.add(r.reviewed_by);
      for (const r of (a.data ?? []) as any[]) if (r.user_id) userIds.add(r.user_id);

      const ids = Array.from(userIds);
      if (ids.length) {
        const p = await supabase.from("profiles").select("id,display_name,avatar_url,rsn").in("id", ids);
        if (!p.error && p.data) {
          const map: Record<string, Profile> = {};
          for (const pr of p.data as any[]) map[pr.id] = pr as Profile;
          setProfilesById(map);
        } else {
          setProfilesById({});
        }
      } else {
        setProfilesById({});
      }
    } catch (e: any) {
      setMsg(e.message ?? "Failed to load admin data.");
    } finally {
      setBusy(false);
    }
  }

  async function createTeam() {
    const name = newTeamName.trim();
    if (!name) {
      setMsg("Team name is required.");
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.from("teams").insert({ name });
      if (error) throw error;

      setNewTeamName("");
      await refreshAll();
      setMsg("Team created.");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to create team.");
    } finally {
      setBusy(false);
    }
  }

  async function setAdmin(makeAdmin: boolean, userId: string) {
    const target = userId.trim();
    if (!target) return;

    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.rpc("admin_set_admin", {
        target_user_id: target,
        make_admin: makeAdmin,
      });
      if (error) throw error;

      setAdminUserIdInput("");
      await refreshAll();
      setMsg(makeAdmin ? "Admin added." : "Admin removed.");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to update admins.");
    } finally {
      setBusy(false);
    }
  }

  const membersByTeam = useMemo(() => {
    const g: Record<string, MemberRow[]> = {};
    for (const m of members) {
      g[m.team_id] ??= [];
      g[m.team_id].push(m);
    }
    return g;
  }, [members]);

  const claimsFiltered = useMemo(() => {
    if (selectedTeamId === "ALL") return claims;
    return claims.filter((c) => c.team_id === selectedTeamId);
  }, [claims, selectedTeamId]);

  const teamsForDropdown = useMemo(() => {
    return [{ id: "ALL", name: "All teams" } as any].concat(teams.map((t) => ({ id: t.id, name: t.name })));
  }, [teams]);

  function labelFor(id: string) {
    return formatUserLabel(id, profilesById[id]);
  }

  if (loading) return <p style={{ padding: 40 }}>Loading...</p>;
  if (!session) return <p style={{ padding: 40 }}>Please log in.</p>;

  if (!isAdmin) {
    return (
      <main style={{ padding: 40 }}>
        <h1>Admin</h1>
        <p>{msg ?? "Admins only."}</p>
      </main>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <span className="dot" />
            OSRS Bingo
            <span className="badge">Admin</span>
          </div>
          <div className="row">
            <a className="btn btn-ghost" href="/board">
              Board
            </a>
            <a className="btn btn-ghost" href="/team">
              Team
            </a>
            <a className="btn btn-ghost" href="/admin/claims">
              Claims
            </a>
          </div>
        </div>
      </div>

      <main className="page">
        <div className="container">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h1 className="h1">Admin Console</h1>
              <p className="p" style={{ marginTop: 6 }}>Control teams (tables), users, boards, and exports.</p>
            </div>

            <div className="row" style={{ alignItems: "center" }}>
              <select
                className="input"
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value as any)}
                style={{ minWidth: 220 }}
              >
                {teamsForDropdown.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <button className="btn btn-primary" onClick={refreshAll} disabled={busy}>
                {busy ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          {msg && (
            <div className="alert" style={{ marginTop: 14 }}>
              {msg}
            </div>
          )}

          {/* Create Team + Admin Management */}
          <div className="grid2" style={{ marginTop: 16 }}>
            <div className="panel">
              <div className="panel-title">Create team (Create table)</div>
              <div className="tiny" style={{ marginTop: 6 }}>
                This creates a new team row. (The board/squares are separate.)
              </div>

              <div className="row" style={{ marginTop: 12, alignItems: "stretch" }}>
                <input
                  className="input"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="e.g. Rancour Bingo 2026"
                />
                <button className="btn btn-primary" onClick={createTeam} disabled={busy}>
                  Create
                </button>
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">Admins</div>
              <div className="tiny" style={{ marginTop: 6 }}>
                Add/remove by user UUID.
              </div>

              <div className="row" style={{ marginTop: 12, alignItems: "stretch" }}>
                <input
                  className="input mono"
                  value={adminUserIdInput}
                  onChange={(e) => setAdminUserIdInput(e.target.value)}
                  placeholder="user uuid"
                />
                <button
                  className="btn btn-primary"
                  onClick={() => setAdmin(true, adminUserIdInput)}
                  disabled={busy}
                  title="Add admin"
                >
                  Add
                </button>
              </div>

              <div className="list" style={{ marginTop: 12, maxHeight: 220 }}>
                {(admins ?? []).length === 0 ? (
                  <div className="tiny" style={{ padding: 12 }}>
                    Admin list not available (RLS) or none found.
                  </div>
                ) : (
                  admins.map((a) => (
                    <div className="list-row" key={a.user_id}>
                      <img className="avatar" src={profilesById[a.user_id]?.avatar_url ?? "/avatar.png"} alt="" />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 900 }}>{labelFor(a.user_id)}</div>
                        <div className="tiny mono">{a.user_id}</div>
                      </div>
                      <button className="btn" onClick={() => setAdmin(false, a.user_id)} disabled={busy} title="Remove admin">
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid2" style={{ marginTop: 16 }}>
            <div className="panel">
              <div className="panel-title">Exports</div>
              <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  onClick={() =>
                    downloadCSV(
                      `claims_${selectedTeamId}.csv`,
                      claimsFiltered.map((c) => ({
                        id: c.id,
                        team_id: c.team_id,
                        square_id: c.square_id,
                        user: labelFor(c.user_id),
                        user_id: c.user_id,
                        status: c.status,
                        created_at: c.created_at,
                        reviewed_by: c.reviewed_by ? labelFor(c.reviewed_by) : "",
                        reviewed_by_id: c.reviewed_by ?? "",
                        reviewed_at: c.reviewed_at ?? "",
                        image_path: c.image_path ?? "",
                      }))
                    )
                  }
                >
                  Export claims CSV
                </button>

                <button
                  className="btn"
                  onClick={() => {
                    const rows = squares
                      .filter((s) => selectedTeamId === "ALL" || s.team_id === selectedTeamId)
                      .map((s) => ({
                        team_id: s.team_id,
                        square_id: s.id,
                        code: s.code,
                        title: s.title,
                        requirement: s.requirement,
                        completed: s.completed,
                        completed_at: s.completed_at ?? "",
                      }));
                    downloadCSV(`tiles_${selectedTeamId}.csv`, rows);
                  }}
                >
                  Export tiles CSV
                </button>

                <button
                  className="btn"
                  onClick={() => {
                    const rows = members
                      .filter((m) => selectedTeamId === "ALL" || m.team_id === selectedTeamId)
                      .map((m) => ({
                        team_id: m.team_id,
                        user: labelFor(m.user_id),
                        user_id: m.user_id,
                        role: m.role,
                        joined_at: m.created_at ?? "",
                      }));
                    downloadCSV(`users_${selectedTeamId}.csv`, rows);
                  }}
                >
                  Export users CSV
                </button>
              </div>

              <div className="tiny" style={{ marginTop: 10 }}>
                Tip: filter a team first to export only that team’s data.
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">Teams overview</div>
              <div className="tiny" style={{ marginTop: 6 }}>
                Click a join code to copy. Open a team’s board directly.
              </div>

              <div className="table" style={{ marginTop: 10 }}>
                <div className="thead">
                  <div>Team</div>
                  <div>Join Code</div>
                  <div>Members</div>
                  <div>Board</div>
                </div>

                {teams.map((t) => {
                  const memCount = (membersByTeam[t.id] ?? []).length;
                  return (
                    <div className="trow" key={t.id}>
                      <div>
                        <div style={{ fontWeight: 900 }}>{t.name}</div>
                        <div className="tiny mono">{t.id}</div>
                      </div>

                      <button
                        className="btn btn-ghost mono"
                        onClick={() => navigator.clipboard.writeText(t.join_code)}
                        title="Copy join code"
                      >
                        {t.join_code}
                      </button>

                      <div className="tiny">{memCount}</div>

                      <a className="btn" href={`/board?team=${t.id}`}>
                        Open board
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Team detail panels */}
          <div className="grid2" style={{ marginTop: 16 }}>
            <div className="panel">
              <div className="panel-title">Users & membership</div>
              <div className="tiny" style={{ marginTop: 6 }}>
                Shows members for the selected team filter.
              </div>

              <div className="list" style={{ marginTop: 10 }}>
                {members
                  .filter((m) => selectedTeamId === "ALL" || m.team_id === selectedTeamId)
                  .slice(0, 500)
                  .map((m) => {
                    const p = profilesById[m.user_id];
                    return (
                      <div className="list-row" key={`${m.team_id}:${m.user_id}`}>
                        <img className="avatar" src={p?.avatar_url ?? "/avatar.png"} alt="" />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 900 }}>{formatUserLabel(m.user_id, p)}</div>
                          <div className="tiny mono">{m.user_id}</div>
                        </div>
                        <span className="badge">{m.role}</span>
                        <span className="tiny mono">{m.team_id.slice(0, 8)}…</span>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">Tiles status</div>
              <div className="tiny" style={{ marginTop: 6 }}>
                Completed tiles are those explicitly marked by admin.
              </div>

              <div className="list" style={{ marginTop: 10 }}>
                {squares
                  .filter((s) => selectedTeamId === "ALL" || s.team_id === selectedTeamId)
                  .slice(0, 500)
                  .map((s) => (
                    <div className="list-row" key={s.id}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 900 }}>
                          {s.title}
                          {s.completed ? (
                            <span className="badge badge-good" style={{ marginLeft: 8 }}>
                              Completed
                            </span>
                          ) : null}
                        </div>
                        <div className="tiny">{s.requirement}</div>
                      </div>
                      <span className="tiny mono">{s.code}</span>
                      <span className="tiny mono">{s.completed_at ? s.completed_at.slice(0, 10) : ""}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-title">Claims feed</div>
            <div className="tiny" style={{ marginTop: 6 }}>
              Latest claims (filtered by team dropdown).
            </div>

            <div className="list" style={{ marginTop: 10 }}>
              {claimsFiltered.slice(0, 200).map((c) => (
                <div className="list-row" key={c.id}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 900 }}>
                      {labelFor(c.user_id)} <span className="badge">{c.status}</span>
                    </div>
                    <div className="tiny mono">
                      square: {c.square_id.slice(0, 8)}… • {c.created_at?.slice(0, 19) ?? ""}
                      {c.reviewed_at ? ` • reviewed ${c.reviewed_at.slice(0, 19)}` : ""}
                    </div>
                  </div>
                  <span className="tiny mono">{c.team_id ? c.team_id.slice(0, 8) + "…" : ""}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 30 }} />
        </div>
      </main>

      <style jsx global>{`
        .grid2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        @media (max-width: 950px) {
          .grid2 {
            grid-template-columns: 1fr;
          }
        }

        .panel {
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          padding: 14px;
          background: rgba(0, 0, 0, 0.18);
        }
        .panel-title {
          font-weight: 950;
          font-size: 14px;
        }

        .table {
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          overflow: hidden;
        }
        .thead {
          display: grid;
          grid-template-columns: 2fr 1fr 0.6fr 0.8fr;
          gap: 10px;
          padding: 10px;
          background: rgba(0, 0, 0, 0.25);
          font-weight: 900;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.8);
        }
        .trow {
          display: grid;
          grid-template-columns: 2fr 1fr 0.6fr 0.8fr;
          gap: 10px;
          padding: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          align-items: center;
        }

        .list {
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          overflow: hidden;
          max-height: 520px;
          overflow: auto;
        }
        .list-row {
          display: flex;
          gap: 10px;
          padding: 10px;
          align-items: center;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .list-row:first-child {
          border-top: none;
        }
        .avatar {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.25);
          object-fit: cover;
        }
      `}</style>
    </>
  );
}
