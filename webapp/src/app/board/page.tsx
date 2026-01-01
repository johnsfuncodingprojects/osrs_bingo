"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/hooks/useSession";
import { getMyTeams } from "@/lib/team";
import { useRouter } from "next/navigation";
import { uploadClaimImage, getSignedClaimUrl } from "@/lib/storage";

type Square = {
  id: string;
  team_id: string;
  code: string;
  title: string;
  requirement: string;
  description: string | null;
  image_url: string | null;
  rules_json: any;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
};

type Claim = {
  id: string;
  square_id: string;
  user_id: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  image_path: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

type InterestRow = {
  square_id: string;
  user_id: string;
  created_at: string;
};

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  rsn: string | null;
};

const DEFAULT_SQUARES: Array<{
  code: string;
  title: string;
  requirement: string;
  image_url: string | null;
}> = [
    { code: "S01", title: "Came for the Loot / Stayed for the Copium", requirement: "1x Mega Rare", image_url: null },
    { code: "S02", title: "Twisted Fate", requirement: "1x Elder Maul OR Kodai", image_url: null },

    { code: "S03", title: "Batz and Grats", requirement: "Sang AND Rapier", image_url: null },
    { code: "S04", title: "Wanna See a Magic Trick", requirement: "1x Dragon Hunter Wand AND 1x Twinflame Staff", image_url: null },
    { code: "S05", title: "Out Of The Frying Pan Into..", requirement: "3x Delve Uniques", image_url: null },
    { code: "S06", title: "It Burns When I PVM", requirement: "2x Any Burning Claw OR Synapses", image_url: null },
    { code: "S07", title: "Mole-Tiple Companions", requirement: "Giant Mole AND Any 2 Pets", image_url: null },
    { code: "S08", title: "Dust Off The Trim", requirement: "5x CM or HMT Kits OR Dusts", image_url: null },
    { code: "S09", title: "Put Me Out Of My Masoriii", requirement: "4x ToA Uniques (Not Shadow or Pet)", image_url: null },

    { code: "S10", title: "Peace Treaty II", requirement: "8x GWD Drops (from list)", image_url: null },
    { code: "S11", title: "Blow This Pipe", requirement: "6x Zulrah Uniques (not onyx/jar/pet)", image_url: null },
    { code: "S12", title: "Soul Returned", requirement: "7x Corp Uniques (not jar)", image_url: null },
    { code: "S13", title: "Pet Dat Dawg", requirement: "All 3 Cerb Crystals", image_url: null },
    { code: "S14", title: "Soul Snatched", requirement: "4x Any Soulreaper OR Virtus Pieces", image_url: null },
    { code: "S15", title: "Lets Start With Some L Movement", requirement: "4x Justiciar Pieces", image_url: null },
    { code: "S16", title: "The Best Defence is a Good Offense", requirement: "6x Avernics", image_url: null },

    { code: "S17", title: "Nex On The Agenda", requirement: "4x Nex Uniques", image_url: null },
    { code: "S18", title: "Episode I: The Fangtom Menace", requirement: "2x Araxyte Fangs", image_url: null },
    { code: "S19", title: "Frodo Dropped The Ring", requirement: "All 4 DK Rings", image_url: null },
    { code: "S20", title: "It Belongs in A Museum!", requirement: "3x Full Barrows Sets AND 4x Moons Pieces", image_url: null },
    { code: "S21", title: "Wetter Dreams", requirement: "3x Nightmare Unique", image_url: null },
    { code: "S22", title: "Toilet Paper Hoarding", requirement: "6x Prayer Scrolls", image_url: null },
    { code: "S23", title: "Arachnophobia", requirement: "2x Sarachnis Cudgels", image_url: null },

    { code: "S24", title: "Devils Advocate", requirement: "3x Yama Uniques", image_url: null },
    { code: "S25", title: "Bop It! Twist It! Zen It!", requirement: "4x Zenyte Shards", image_url: null },
    { code: "S26", title: "Are You NOT ENTERTAINED?", requirement: "15x Colo Uniques (Including Quiver)", image_url: null },
    { code: "S27", title: "The Hunger Gamers", requirement: "Voidwaker From Scratch", image_url: null },
    { code: "S28", title: "I've Got A Jar Of ...", requirement: "Any 2 Unique Jars", image_url: null },
    { code: "S29", title: "Crystal Armoury", requirement: "4x Crystal Armour OR Enhanced Seeds", image_url: null },
    { code: "S30", title: "Albus Dumbledore", requirement: "3x Ancestral Pieces", image_url: null },
  ];

function humanTime(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso ?? "";
  }
}

function safeJsonParse(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
}

function toNameFallback(userId: string) {
  return `User ${userId.slice(0, 6)}`;
}

function formatUserLabel(userId: string, p?: Profile) {
  const base = p?.display_name || toNameFallback(userId);
  const rsn = (p?.rsn || "").trim();
  return rsn ? `${base} (RSN: ${rsn})` : base;
}

export default function BoardPage() {
  const { session, loading } = useSession();
  const router = useRouter();

  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const teamOverride = searchParams?.get("team"); // admin-only

  const [teamId, setTeamId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminViewing, setAdminViewing] = useState(false);

  const [squares, setSquares] = useState<Square[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Interests
  const [interestMap, setInterestMap] = useState<Record<string, InterestRow[]>>({});
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [interestBusyId, setInterestBusyId] = useState<string | null>(null);

  // Modal
  const [openSquareId, setOpenSquareId] = useState<string | null>(null);

  // Modal edit fields (admin)
  const [editTitle, setEditTitle] = useState("");
  const [editReq, setEditReq] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");
  const [editRulesText, setEditRulesText] = useState("{}");

  // Modal claims
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimBusy, setClaimBusy] = useState(false);
  const [proofSignedUrl, setProofSignedUrl] = useState<string | null>(null);

  const squaresById = useMemo(() => {
    const m = new Map<string, Square>();
    for (const s of squares) m.set(s.id, s);
    return m;
  }, [squares]);

  const openSquare = openSquareId ? squaresById.get(openSquareId) ?? null : null;

  const byCode = useMemo(() => {
    const m = new Map<string, Square>();
    for (const s of squares) m.set(s.code, s);
    return m;
  }, [squares]);

  const floatingLeft = byCode.get("S01") ?? null;
  const floatingRight = byCode.get("S02") ?? null;

  const gridCodes = useMemo(() => {
    return Array.from({ length: 28 }, (_, i) => `S${String(i + 3).padStart(2, "0")}`);
  }, []);

  useEffect(() => {
    if (!session) return;

    (async () => {
      try {
        setMsg(null);

        // admin allowlist check
        const { data: adminRow, error: adminErr } = await supabase
          .from("app_admins")
          .select("user_id")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (adminErr) throw adminErr;
        setIsAdmin(!!adminRow);

        let tid: string | null = null;
        if (teamOverride && !!adminRow) {
          tid = teamOverride;
          setAdminViewing(true);
        } else {
          const teams = await getMyTeams();
          tid = teams[0]?.id ?? null;
          setAdminViewing(false);
        }

        if (!tid) {
          router.push("/team");
          return;
        }

        setTeamId(tid);
        await loadTeamData(tid);
      } catch (e: any) {
        setMsg(e.message ?? "Failed to load board.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Modal sync
  useEffect(() => {
    if (!openSquare) return;

    setEditTitle(openSquare.title ?? "");
    setEditReq(openSquare.requirement ?? "");
    setEditImageUrl(openSquare.image_url ?? "");
    setEditRulesText(openSquare.rules_json ? JSON.stringify(openSquare.rules_json, null, 2) : "{}");

    setClaims([]);
    setProofSignedUrl(null);

    loadClaimsForSquare(openSquare.id).catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSquare?.id]);

  // ESC closes modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenSquareId(null);
    };
    if (openSquareId) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSquareId]);

  async function loadTeamData(tid: string) {
    await loadSquares(tid);
    await loadInterestsAndProfiles(tid);
  }

  async function loadSquares(tid: string) {
    const { data, error } = await supabase
      .from("squares")
      .select("id,team_id,code,title,description,requirement,image_url,rules_json,completed,completed_by,completed_at")
      .eq("team_id", tid)
      .order("code", { ascending: true });

    if (error) throw error;
    setSquares((data ?? []) as Square[]);
  }

  async function loadInterestsAndProfiles(tid: string) {
    // 1) get square ids for this team
    const { data: sqIds, error: sqErr } = await supabase.from("squares").select("id").eq("team_id", tid);

    if (sqErr) throw sqErr;
    const ids = (sqIds ?? []).map((x: any) => x.id as string);
    if (ids.length === 0) {
      setInterestMap({});
      setProfilesById({});
      return;
    }

    // 2) interests (no join)
    const { data: ints, error: iErr } = await supabase
      .from("square_interests")
      .select("square_id,user_id,created_at")
      .in("square_id", ids);

    if (iErr) throw iErr;

    const grouped: Record<string, InterestRow[]> = {};
    const userIds = new Set<string>();

    for (const r of (ints ?? []) as any[]) {
      grouped[r.square_id] ??= [];
      grouped[r.square_id].push(r);
      userIds.add(r.user_id);
    }
    setInterestMap(grouped);

    // 3) profiles lookup (best-effort)
    const uidList = Array.from(userIds);
    if (uidList.length === 0) {
      setProfilesById({});
      return;
    }

    const { data: profs, error: pErr } = await supabase.from("profiles").select("id,display_name,avatar_url,rsn").in("id", uidList);

    if (pErr) {
      setProfilesById({});
      return;
    }

    const map: Record<string, Profile> = {};
    for (const p of (profs ?? []) as any[]) map[p.id] = p as Profile;
    setProfilesById(map);
  }

  function myInterested(squareId: string) {
    if (!session?.user?.id) return false;
    return (interestMap[squareId] ?? []).some((x) => x.user_id === session.user.id);
  }

  function interestedUsers(squareId: string) {
    const seen = new Set<string>();
    return (interestMap[squareId] ?? []).filter((r) => {
      if (seen.has(r.user_id)) return false;
      seen.add(r.user_id);
      return true;
    });
  }

  async function toggleInterest(squareId: string) {
    if (!session) return;
    setInterestBusyId(squareId);
    setMsg(null);

    try {
      const has = myInterested(squareId);

      if (has) {
        const { error } = await supabase.from("square_interests").delete().eq("square_id", squareId).eq("user_id", session.user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("square_interests").insert({
          square_id: squareId,
          user_id: session.user.id,
        });
        if (error) throw error;
      }

      if (teamId) await loadInterestsAndProfiles(teamId);
    } catch (e: any) {
      setMsg(e.message ?? "Failed to toggle interest.");
    } finally {
      setInterestBusyId(null);
    }
  }

  async function loadClaimsForSquare(squareId: string) {
    const { data, error } = await supabase
      .from("claims")
      .select("id,square_id,user_id,status,created_at,image_path,reviewed_by,reviewed_at")
      .eq("square_id", squareId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as Claim[];
    setClaims(rows);

    const myLatest = rows.find((c) => c.user_id === session?.user?.id);
    if (myLatest?.image_path) {
      try {
        const signed = await getSignedClaimUrl(myLatest.image_path, 60 * 30);
        setProofSignedUrl(signed);
      } catch {
        setProofSignedUrl(null);
      }
    }
  }

  async function submitClaim() {
    if (!openSquare || !session) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      setClaimBusy(true);
      setMsg(null);

      try {
        const path = await uploadClaimImage(file, session.user.id);

        const { error } = await supabase.rpc("create_claim", {
          square_id: openSquare.id,
          image_path: path,
        });
        if (error) throw error;

        await loadClaimsForSquare(openSquare.id);
        setMsg("Claim submitted (pending admin review).");
      } catch (e: any) {
        setMsg(e.message ?? "Claim failed.");
      } finally {
        setClaimBusy(false);
      }
    };

    input.click();
  }

  async function adminReviewClaim(claimId: string, newStatus: "approved" | "rejected") {
    if (!isAdmin) return;

    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.rpc("admin_review_claim", {
        claim_id: claimId,
        new_status: newStatus,
      });
      if (error) throw error;

      if (openSquare) await loadClaimsForSquare(openSquare.id);
      setMsg(`Claim ${newStatus}.`);
    } catch (e: any) {
      setMsg(e.message ?? "Failed to review claim.");
    } finally {
      setBusy(false);
    }
  }

  async function adminMarkCompleted(squareId: string, completed: boolean) {
    if (!isAdmin) return;

    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.rpc("admin_mark_square_completed", {
        square_id: squareId,
        completed: completed,
      });

      if (error) throw error;

      if (teamId) await loadSquares(teamId);
      setMsg(completed ? "Square marked completed." : "Square unmarked.");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to mark completed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSquareEdits() {
    if (!openSquare || !teamId) return;
    if (!isAdmin) {
      setMsg("Admins only.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const rulesObj = safeJsonParse(editRulesText);

      const { error } = await supabase
        .from("squares")
        .update({
          title: editTitle.trim() || openSquare.title,
          requirement: editReq.trim() || openSquare.requirement,
          image_url: editImageUrl.trim() || null,
          rules_json: rulesObj,
        })
        .eq("id", openSquare.id)
        .eq("team_id", teamId);

      if (error) throw error;

      await loadSquares(teamId);
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to save.");
    } finally {
      setBusy(false);
    }
  }

  async function applyDefaultsToThisTeam() {
    if (!session || !teamId) return;
    if (!isAdmin) {
      setMsg("Admins only.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const rows = DEFAULT_SQUARES.map((s) => ({
        team_id: teamId,
        code: s.code,
        title: s.title,
        requirement: s.requirement,
        image_url: s.image_url,
        description: "",
        rules_json: {},
        completed: false,
        completed_by: null,
        completed_at: null,
      }));

      const { error } = await supabase.from("squares").upsert(rows, { onConflict: "team_id,code" });
      if (error) throw error;

      await loadTeamData(teamId);
      setMsg("Applied default board to this team.");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to apply defaults.");
    } finally {
      setBusy(false);
    }
  }

  async function seedIfEmpty() {
    if (!session || !teamId) return;
    if (!isAdmin) {
      setMsg("Admins only.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const { count, error: countErr } = await supabase
        .from("squares")
        .select("*", { count: "exact", head: true })
        .eq("team_id", teamId);

      if (countErr) throw countErr;
      if ((count ?? 0) > 0) {
        setMsg("Already seeded.");
        return;
      }

      const rows = DEFAULT_SQUARES.map((s) => ({
        team_id: teamId,
        code: s.code,
        title: s.title,
        requirement: s.requirement,
        image_url: s.image_url,
        description: "",
        rules_json: {},
        completed: false,
        completed_by: null,
        completed_at: null,
      }));

      const { error } = await supabase.from("squares").insert(rows);
      if (error) throw error;

      await loadTeamData(teamId);
      setMsg("Seeded board.");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to seed board.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p style={{ padding: 40 }}>Loading...</p>;
  if (!session) return <p style={{ padding: 40 }}>Please log in.</p>;

  const renderTile = (square: Square | null, key: string, variant: "normal" | "floating") => {
    if (!square) {
      return (
        <button
          key={key}
          className={`btile ${variant === "floating" ? "btile--floating" : ""} btile--empty btile--noimg`}
          onClick={() => setMsg("Tile not seeded yet. Admin must seed/apply defaults.")}
        >
          <div className="btile__text btile__text--noimg">
            <div className="btile__title">Unassigned</div>
            <div className="btile__req">Admin hasn’t seeded this tile.</div>
          </div>

          <div className="btile__footer" onClick={(e) => e.stopPropagation()}>
            <span className="interested-count">Interested 0</span>
          </div>
        </button>
      );
    }

    const done = !!square.completed;
    const interested = interestedUsers(square.id);
    const me = myInterested(square.id);
    const hasImg = !!square.image_url;

    return (
      <button
        key={key}
        className={[
          "btile",
          variant === "floating" ? "btile--floating" : "",
          done ? "btile--done" : "",
          !hasImg ? "btile--noimg" : "",
        ].join(" ")}
        onClick={() => setOpenSquareId(square.id)}
      >
        {hasImg ? (
          <div className="btile__img">
            <img src={square.image_url} alt={square.title} />
          </div>
        ) : null}

        <div className={`btile__text ${!hasImg ? "btile__text--noimg" : ""}`}>
          <div className="btile__title">{square.title}</div>
          <div className="btile__req">{square.requirement}</div>
        </div>

        <div className="btile__footer" onClick={(e) => e.stopPropagation()}>
          <div className="btile__interest">
            <button
              type="button"
              className={`workbtn ${me ? "workbtn--on" : ""}`}
              onClick={() => toggleInterest(square.id)}
              disabled={interestBusyId === square.id}
              title="Toggle interest in this tile"
            >
              <span className="workbtn-label">Interested</span>
              <span className="workbtn-check" aria-hidden="true">
                {me ? "✓" : ""}
              </span>
            </button>

            <div className="btile__interestCount" title="Number of interested users">
              {interested.length} interested
            </div>
          </div>
        </div>

        {done && <div className="btile__check">✓</div>}
      </button>
    );
  };

  const openInterested = openSquare ? interestedUsers(openSquare.id) : [];

  return (
    <>
      <div className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <span className="dot" />
            OSRS Bingo
            <span className="badge">Board</span>
            {adminViewing && <span className="badge">Admin view</span>}
          </div>
          <div className="row">
            <a className="btn btn-ghost" href="/team">
              Team
            </a>
            <a className="btn btn-ghost" href="/admin">
              Admin
            </a>
            <a className="btn btn-ghost" href="/admin/claims">
              Claims
            </a>
          </div>
        </div>
      </div>

      <main className="page">
        <div className="container">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <h1 className="h1">Bingo board</h1>
              <p className="p" style={{ marginTop: 6 }}>
                Tap a tile for details & claims. Use <b>Interested</b> toggles directly on the board.
              </p>
            </div>

            <div className="row">
              <button className="btn" onClick={() => teamId && loadTeamData(teamId)} disabled={busy || !teamId}>
                Refresh
              </button>

              {isAdmin && (
                <>
                  <button className="btn" onClick={applyDefaultsToThisTeam} disabled={busy || !teamId}>
                    Apply defaults
                  </button>
                  <button className="btn btn-primary" onClick={seedIfEmpty} disabled={busy || !teamId}>
                    {busy ? "Working..." : "Seed board"}
                  </button>
                </>
              )}
            </div>
          </div>

          {msg && <div className="alert" style={{ marginTop: 14 }}>{msg}</div>}

          <div className="bgrid bgrid--floating" style={{ marginTop: 18 }}>
            {renderTile(floatingLeft, "float-left", "floating")}
            <div className="bspacer" />
            <div className="bspacer" />
            <div className="bspacer" />
            <div className="bspacer" />
            <div className="bspacer" />
            {renderTile(floatingRight, "float-right", "floating")}
          </div>

          <div className="bgrid bgrid--main" style={{ marginTop: 12 }}>
            {gridCodes.map((code) => {
              const sq = byCode.get(code) ?? null;
              return renderTile(sq, code, "normal");
            })}
          </div>
        </div>
      </main>

      {openSquareId && openSquare && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpenSquareId(null);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <div className="row" style={{ gap: 10 }}>
                  {openSquare.completed && <span className="badge badge-good">Completed</span>}
                  <span className="badge mono">{openSquare.code}</span>
                  <span className="badge">Interested: {openInterested.length}</span>
                </div>

                <div style={{ marginTop: 10, fontWeight: 950, fontSize: 22 }}>{openSquare.title}</div>

                <div className="p" style={{ marginTop: 6, fontSize: 14 }}>
                  {openSquare.requirement?.trim() ? openSquare.requirement : "No requirement yet."}
                </div>
              </div>

              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" onClick={() => setOpenSquareId(null)}>
                  Close
                </button>
              </div>
            </div>

            <div className="modal-body">
              <div className="hero">
                {openSquare.image_url ? (
                  <img src={openSquare.image_url} alt={openSquare.title} className="hero-img" />
                ) : (
                  <div style={{ padding: 40, color: "var(--muted2)", fontWeight: 800 }}>No image yet</div>
                )}
              </div>

              <div className="hr" />

              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h2 className="h2">Interested ({openInterested.length})</h2>

                <button
                  type="button"
                  className={`workbtn ${myInterested(openSquare.id) ? "workbtn--on" : ""}`}
                  onClick={() => toggleInterest(openSquare.id)}
                  disabled={interestBusyId === openSquare.id}
                  title="Toggle interest in this tile"
                >
                  <span className="workbtn-label">Interested</span>
                  <span className="workbtn-check" aria-hidden="true">
                    {myInterested(openSquare.id) ? "✓" : ""}
                  </span>
                </button>
              </div>

              <p className="p" style={{ marginTop: 6 }}>Planning/coordination only — claims are separate.</p>

              <div className="interest-list">
                {openInterested.length === 0 ? (
                  <div className="tiny" style={{ padding: 12 }}>
                    Nobody yet.
                  </div>
                ) : (
                  openInterested.slice(0, 50).map((u) => {
                    const p = profilesById[u.user_id];
                    const name = formatUserLabel(u.user_id, p);
                    const url = p?.avatar_url || "/avatar.png";
                    return (
                      <div key={`${openSquare.id}:${u.user_id}`} className="interest-row">
                        <img src={url} className="avatar-sm" alt="" />
                        <div style={{ fontWeight: 800 }}>{name}</div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="hr" />

              <h2 className="h2">Submit proof</h2>
              <p className="p" style={{ marginTop: 6 }}>
                Upload a screenshot as proof. Admins approve/reject claims, and separately mark the square completed.
              </p>

              {openSquare.completed && (
                <div className="alert alert-good" style={{ marginTop: 12 }}>
                  ✅ Marked completed {openSquare.completed_at ? `@ ${humanTime(openSquare.completed_at)}` : ""}
                </div>
              )}

              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" onClick={submitClaim} disabled={claimBusy}>
                  {claimBusy ? "Uploading..." : "Upload proof + submit"}
                </button>

                {proofSignedUrl && (
                  <a className="btn" href={proofSignedUrl} target="_blank" rel="noreferrer">
                    View my latest proof
                  </a>
                )}

                <button className="btn btn-ghost" onClick={() => loadClaimsForSquare(openSquare.id)}>
                  Refresh claims
                </button>
              </div>

              <div className="claims" style={{ marginTop: 12 }}>
                {claims.length === 0 ? (
                  <div className="alert">No claims yet.</div>
                ) : (
                  claims.map((c) => (
                    <div key={c.id} className="claim">
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 900 }}>
                            {formatUserLabel(c.user_id, profilesById[c.user_id])}
                          </div>
                          <div className="tiny">
                            {c.status.toUpperCase()} • submitted {humanTime(c.created_at)}
                            {c.reviewed_at ? ` • reviewed ${humanTime(c.reviewed_at)}` : ""}
                          </div>
                        </div>

                        <div className="row" style={{ gap: 8 }}>
                          <button
                            className="btn"
                            onClick={async () => {
                              const url = await getSignedClaimUrl(c.image_path, 60 * 30);
                              window.open(url, "_blank");
                            }}
                          >
                            View proof
                          </button>

                          {isAdmin && c.status === "pending" && (
                            <>
                              <button className="btn btn-primary" onClick={() => adminReviewClaim(c.id, "approved")} disabled={busy}>
                                Approve
                              </button>
                              <button className="btn" onClick={() => adminReviewClaim(c.id, "rejected")} disabled={busy}>
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {isAdmin && (
                <>
                  <div className="hr" />
                  <h2 className="h2">Admin controls</h2>
                  <p className="p" style={{ marginTop: 6 }}>
                    Approving claims does <b>not</b> mark the square completed. Use this toggle for the green state.
                  </p>

                  <div className="row" style={{ marginTop: 10, justifyContent: "space-between", alignItems: "center" }}>
                    <button
                      className={`btn ${openSquare.completed ? "" : "btn-primary"}`}
                      onClick={() => adminMarkCompleted(openSquare.id, !openSquare.completed)}
                      disabled={busy}
                    >
                      {openSquare.completed ? "Unmark completed" : "Mark completed (green)"}
                    </button>

                    <div className="tiny">{openSquare.completed ? `Completed @ ${humanTime(openSquare.completed_at)}` : "Not completed"}</div>
                  </div>

                  <details style={{ marginTop: 14 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 900 }}>Edit tile</summary>

                    <div className="col" style={{ marginTop: 12 }}>
                      <label className="tile-meta">Title</label>
                      <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />

                      <label className="tile-meta">Requirement</label>
                      <input className="input" value={editReq} onChange={(e) => setEditReq(e.target.value)} />

                      <label className="tile-meta">Image URL</label>
                      <input className="input" value={editImageUrl} onChange={(e) => setEditImageUrl(e.target.value)} />

                      <label className="tile-meta">rules_json</label>
                      <textarea className="textarea" value={editRulesText} onChange={(e) => setEditRulesText(e.target.value)} spellCheck={false} />

                      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                        <button className="btn btn-primary" onClick={saveSquareEdits} disabled={busy}>
                          {busy ? "Saving..." : "Save changes"}
                        </button>
                      </div>
                    </div>
                  </details>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .bgrid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 12px;
        }

        .btile--floating { height: 160px; }
        .bspacer { height: 160px; }
        .bgrid--main { padding-bottom: 40px; }

        .btile {
          position: relative;
          height: 176px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.10);
          background: linear-gradient(180deg, rgba(30,32,38,.92), rgba(18,20,24,.96));
          padding: 10px;
          text-align: left;
          cursor: pointer;

          display: grid;
          grid-template-rows: 70px 1fr 34px;
          gap: 8px;

          transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
        }
        .btile:hover {
          transform: translateY(-2px);
          border-color: rgba(255,255,255,0.18);
          box-shadow: 0 10px 25px rgba(0,0,0,.45);
        }
        .btile--done {
          background: linear-gradient(180deg, rgba(36,78,48,.92), rgba(24,56,34,.96));
          border-color: rgba(46,204,113,.35);
        }
        .btile--empty { opacity: 0.85; }

        .btile--noimg {
          grid-template-rows: 1fr 34px;
        }

        .btile__img {
          border-radius: 12px;
          background: rgba(0,0,0,.35);
          border: 1px solid rgba(255,255,255,.08);
          overflow: hidden;
        }

        .btile__img img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
          object-position: center;
          padding: 6px;
        }

        .btile__text {
          min-height: 0;
          padding: 2px 2px 0;
          overflow: hidden;
        }
        .btile__text--noimg {
          padding-top: 4px;
        }

        .btile__title {
          font-size: 12.5px;
          font-weight: 900;
          line-height: 1.25;
          color: rgba(255,255,255,.95);
          margin: 0;
          max-height: calc(1.25em * 2);
          overflow: hidden;
        }
        .btile__req {
          margin-top: 4px;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.25;
          color: rgba(255,255,255,.66);
          max-height: calc(1.25em * 2);
          overflow: hidden;
        }

        .btile__footer {
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          padding-top: 0;
          margin-top: -4px;
        }

        .btile__interest {
          display: flex;
          flex-direction: column;
          gap: 4px;
          align-items: flex-start;
        }

        .btile__interestCount {
          font-size: 11px;
          font-weight: 800;
          color: rgba(255,255,255,.62);
          line-height: 1;
          padding-left: 2px;
        }

        .interested-count {
          font-size: 11px;
          font-weight: 800;
          color: rgba(255,255,255,.62);
          white-space: nowrap;
        }

        .btile__check {
          position: absolute;
          top: 8px;
          right: 10px;
          font-size: 18px;
          font-weight: 900;
          color: #2ecc71;
          text-shadow: 0 6px 16px rgba(0,0,0,.6);
          pointer-events: none;
        }

        .avatar-sm {
          width: 18px !important;
          height: 18px !important;
          border-radius: 999px !important;
          object-fit: cover !important;
          flex: 0 0 auto !important;
          border: 1px solid rgba(255,255,255,.12) !important;
          background: rgba(0,0,0,.25);
        }

        .interest-list {
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .interest-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 0;
          line-height: 1.1;
        }

        /* make sure avatars don't act like inline text that can "float up" */
        .interest-row img,
        .avatar-sm {
          display: block !important;
        }

        @media (max-width: 1200px) {
          .bgrid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
          .bspacer { display: none; }
          .bgrid--floating { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 950px) {
          .bgrid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }
        @media (max-width: 700px) {
          .bgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .btile { height: 190px; grid-template-rows: 82px 1fr 34px; }
          .btile--noimg { grid-template-rows: 1fr 34px; }
        }
      `}</style>
    </>
  );
}
