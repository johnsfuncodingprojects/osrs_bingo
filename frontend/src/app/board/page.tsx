"use client";

import { useEffect, useMemo, useState } from "react";

type Square = {
  id: string;
  code: string;
  title: string;
  claims: { claimId: string; status: string; rsn: string; userId: string }[];
  completions: { rsn: string; completedAt: string }[];
};

export default function BoardPage() {
  const [squares, setSquares] = useState<Square[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const api = process.env.NEXT_PUBLIC_API_BASE!;
  const token = typeof window !== "undefined" ? localStorage.getItem("sessionToken") : null;
  const teamId = typeof window !== "undefined" ? localStorage.getItem("teamId") : null;
  const teamName = typeof window !== "undefined" ? localStorage.getItem("teamName") : null;
  const rsn = typeof window !== "undefined" ? localStorage.getItem("rsn") : null;
  const pluginKey = typeof window !== "undefined" ? localStorage.getItem("pluginKey") : null;

  const headers = useMemo(() => ({
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  }), [token]);

  async function loadBoard() {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`${api}/teams/${teamId}/board`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to load board");
      setSquares(data.squares);
    } catch (e: any) {
      setErr(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  async function seedSquares() {
    setErr("");
    try {
      const res = await fetch(`${api}/teams/${teamId}/seed_squares`, { method: "POST", headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to seed");
      await loadBoard();
    } catch (e: any) {
      setErr(e.message || "Error");
    }
  }

  async function claim(code: string) {
    setErr("");
    try {
      const res = await fetch(`${api}/teams/${teamId}/claims`, {
        method: "POST",
        headers,
        body: JSON.stringify({ squareCode: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Claim failed");
      await loadBoard();
    } catch (e: any) {
      setErr(e.message || "Error");
    }
  }

  useEffect(() => {
    if (!token || !teamId) window.location.href = "/";
    else loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token || !teamId) return null;

  return (
    <main className="min-h-screen p-6 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{teamName || "Team"} Board</h1>
          <div className="text-sm opacity-80">Logged in as <b>{rsn}</b></div>
          <div className="text-xs opacity-70">Plugin key (copy into RuneLite later): <code className="break-all">{pluginKey}</code></div>
        </div>
        <div className="flex gap-2">
          <button className="border rounded-xl px-4 py-2" onClick={loadBoard}>Refresh</button>
          <button className="border rounded-xl px-4 py-2" onClick={seedSquares}>Seed Default Squares</button>
        </div>
      </div>

      {err && <div className="text-red-600">{err}</div>}
      {loading && <div>Loading...</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {squares.map((sq) => (
          <div key={sq.id} className="border rounded-2xl p-4 shadow-sm space-y-2">
            <div className="font-semibold">{sq.title}</div>
            <div className="text-xs opacity-70">Code: {sq.code}</div>

            <div className="text-sm">
              <div className="font-medium">Claims</div>
              {sq.claims.length === 0 ? <div className="opacity-70">none</div> :
                <ul className="list-disc ml-5">
                  {sq.claims.map(c => <li key={c.claimId}>{c.rsn} ({c.status})</li>)}
                </ul>
              }
            </div>

            <div className="text-sm">
              <div className="font-medium">Completions</div>
              {sq.completions.length === 0 ? <div className="opacity-70">none</div> :
                <ul className="list-disc ml-5">
                  {sq.completions.map((c, idx) => <li key={idx}>{c.rsn} @ {new Date(c.completedAt).toLocaleString()}</li>)}
                </ul>
              }
            </div>

            <button className="border rounded-xl px-3 py-2 w-full" onClick={() => claim(sq.code)}>
              Claim this
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
