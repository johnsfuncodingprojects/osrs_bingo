import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL env var is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY env var is not set");
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = adminClient();
    const { data: { user }, error: authErr } = await db.auth.getUser(auth.slice(7));
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: adminRow } = await db
      .from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { code, imageUrl } = await req.json();
    if (!code || !imageUrl) {
      return NextResponse.json({ error: "Missing code or imageUrl" }, { status: 400 });
    }

    const { error } = await db.from("squares").update({ image_url: imageUrl }).eq("code", code);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ status: "ok" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal server error" }, { status: 500 });
  }
}
