import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_BASE_URL!;

async function getBearer() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not logged in");
  return token;
}

export async function createClaim(squareId: string, imagePath: string) {
  const token = await getBearer();

  const res = await fetch(`${API}/claims`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ squareId, imagePath }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}
