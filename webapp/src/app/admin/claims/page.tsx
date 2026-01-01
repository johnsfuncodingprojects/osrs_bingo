"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/hooks/useSession";
import { useRouter } from "next/navigation";
import { getSignedClaimUrl } from "@/lib/storage";

type PendingClaim = {
  claim_id: string;
  status: string;
  created_at: string;
  image_path: string;
  user_id: string;
  display_name: string;
  team_id: string;
  team_name: string;
  square_id: string;
  square_code: string;
  square_title: string;
};

export default function AdminClaimsPage() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<PendingClaim[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/");
      return;
    }

    (async () => {
      const { data } = await supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!data) {
        setIsAdmin(false);
        setMsg("Admins only.");
        return;
      }

      setIsAdmin(true);
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session]);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.rpc("admin_list_pending_claims");
      if (error) throw error;
      setRows((data ?? []) as PendingClaim[]);
    } catch (e: any) {
      setMsg(e.message ?? "Failed to load pending claims.");
    } finally {
      setBusy(false);
    }
  }

  async function viewImage(path: string) {
    const url = await getSignedClaimUrl(path, 60 * 10);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function approve(claimId: string) {
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.rpc("admin_approve_claim", { claim_id: claimId });
      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e.message ?? "Approve failed.");
    } finally {
      setBusy(false);
    }
  }

  async function reject(claimId: string) {
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.rpc("admin_reject_claim", { claim_id: claimId });
      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e.message ?? "Reject failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p style={{ padding: 40 }}>Loading...</p>;
  if (!session) return <p style={{ padding: 40 }}>Please log in.</p>;
  if (!isAdmin) return <p style={{ padding: 40 }}>{msg ?? "Admins only."}</p>;

  return (
    <>
      <div className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--brand)" }} />
            OSRS Bingo
            <span className="badge">Admin</span>
            <span className="badge">Claims</span>
          </div>
          <div className="row">
            <a className="btn btn-ghost" href="/admin">Admin</a>
            <a className="btn btn-ghost" href="/team">Team</a>
            <a className="btn btn-ghost" href="/board">Board</a>
            <button className="btn btn-primary" onClick={refresh} disabled={busy}>
              {busy ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      <main className="page">
        <div className="container">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h1 className="h1">Pending claims</h1>
              <p className="p" style={{ marginTop: 6 }}>
                Review proof screenshots and approve/reject.
              </p>
            </div>
            <div className="pill">
              Pending: <b>{rows.length}</b>
            </div>
          </div>

          {msg && <div className="alert alert-bad" style={{ marginTop: 14 }}>{msg}</div>}

          <div className="table" style={{ marginTop: 18 }}>
            <div className="thead" style={{ gridTemplateColumns: "1.4fr 1.2fr 1.4fr" }}>
              <div>Claim</div>
              <div>Team / Square</div>
              <div>Actions</div>
            </div>

            {rows.length === 0 ? (
              <div className="trow" style={{ gridTemplateColumns: "1.4fr 1.2fr 1.4fr", color: "var(--muted)" }}>
                <div>No pending claims.</div><div /><div />
              </div>
            ) : (
              rows.map((r) => (
                <div key={r.claim_id} className="trow" style={{ gridTemplateColumns: "1.4fr 1.2fr 1.4fr" }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>{r.display_name}</div>
                    <div className="tile-meta mono">
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                    <div className="tile-meta mono">claim: {r.claim_id}</div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 900 }}>{r.team_name}</div>
                    <div className="tile-meta">
                      <span className="kbd mono">{r.square_code}</span>{" "}
                      {r.square_title}
                    </div>
                  </div>

                  <div className="row">
                    <button className="btn" onClick={() => viewImage(r.image_path)} disabled={busy}>
                      View image
                    </button>
                    <a
                      className="btn"
                      href={`/board?team=${r.team_id}&square=${encodeURIComponent(r.square_code)}`}
                    >
                      Open square
                    </a>
                    <button className="btn btn-primary" onClick={() => approve(r.claim_id)} disabled={busy}>
                      Approve
                    </button>
                    <button className="btn" onClick={() => reject(r.claim_id)} disabled={busy}>
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </>
  );
}
