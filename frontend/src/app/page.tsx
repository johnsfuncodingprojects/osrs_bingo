"use client";

import { useState } from "react";

export default function Home() {
  const [rsn, setRsn] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function join() {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/auth/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rsn, teamCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Join failed");

      localStorage.setItem("sessionToken", data.sessionToken);
      localStorage.setItem("teamId", data.teamId);
      localStorage.setItem("teamName", data.teamName);
      localStorage.setItem("rsn", data.rsn);
      localStorage.setItem("pluginKey", data.pluginKey);

      window.location.href = "/board";
    } catch (e: any) {
      setErr(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl shadow p-6 space-y-4">
        <h1 className="text-2xl font-bold">OSRS Team Bingo</h1>
        <p className="text-sm opacity-80">Enter RSN + Team Code to join.</p>

        <div className="space-y-2">
          <label className="text-sm">RSN</label>
          <input className="w-full border rounded-lg p-2" value={rsn} onChange={(e) => setRsn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="text-sm">Team Code</label>
          <input className="w-full border rounded-lg p-2" value={teamCode} onChange={(e) => setTeamCode(e.target.value)} />
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <button
          onClick={join}
          disabled={loading}
          className="w-full rounded-xl p-2 font-semibold border"
        >
          {loading ? "Joining..." : "Join"}
        </button>

        <p className="text-xs opacity-70">
          After joining, you’ll get a plugin key for RuneLite.
        </p>
      </div>
    </main>
  );
}
