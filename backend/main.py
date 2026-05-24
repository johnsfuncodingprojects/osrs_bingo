from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import csv
import io
import jwt
import os
import httpx
from supabase import create_client, Client
from uuid import UUID
from datetime import datetime, timezone

app = FastAPI()

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]

SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "1BQGJ9-2YI2F5bB_5h5Ng_07evRvlSIWNe8gZoUgzfZg")
SHEET_GID = os.environ.get("GOOGLE_SHEET_GID", "1106581426")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- Auth ----------

def get_user_id(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth header")
    token = authorization[len("Bearer "):]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience="authenticated")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")
    return user_id


# ---------- Admin guards ----------

def assert_app_admin(user_id: str):
    """Gate on the app_admins table — consistent with how the frontend checks admin."""
    res = (
        supabase.table("app_admins")
        .select("user_id")
        .eq("user_id", user_id)
        .maybeSingle()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=403, detail="Admin only")


def assert_admin_for_square(user_id: str, square_id: str):
    sq = supabase.table("squares").select("team_id").eq("id", square_id).single().execute()
    if not sq.data:
        raise HTTPException(status_code=404, detail="Square not found")
    team_id = sq.data["team_id"]
    mem = (
        supabase.table("team_members")
        .select("role")
        .eq("team_id", team_id)
        .eq("user_id", user_id)
        .maybeSingle()
        .execute()
    )
    if not mem.data or mem.data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")


# ---------- Request schemas ----------

class ClaimCreate(BaseModel):
    squareId: UUID
    imagePath: str


class ClaimApprove(BaseModel):
    claimId: UUID


# ---------- Routes ----------

@app.post("/claims")
def create_claim(data: ClaimCreate, user_id: str = Depends(get_user_id)):
    square = (
        supabase.table("squares")
        .select("id, claimed_by")
        .eq("id", str(data.squareId))
        .single()
        .execute()
    )
    if not square.data:
        raise HTTPException(status_code=404, detail="Square not found")
    if square.data.get("claimed_by"):
        raise HTTPException(status_code=409, detail="Square already claimed")

    supabase.table("claims").insert({
        "square_id": str(data.squareId),
        "user_id": user_id,
        "image_path": data.imagePath,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    return {"status": "ok"}


@app.get("/admin/claims/pending")
def list_pending_claims(user_id: str = Depends(get_user_id)):
    assert_app_admin(user_id)

    res = (
        supabase.table("claims")
        .select("id, square_id, user_id, image_path, status, created_at")
        .eq("status", "pending")
        .order("created_at", desc=True)
        .execute()
    )

    return {"claims": res.data or []}


@app.post("/admin/claims/approve")
def approve_claim(data: ClaimApprove, user_id: str = Depends(get_user_id)):
    claim = (
        supabase.table("claims")
        .select("id, square_id, status, image_path")
        .eq("id", str(data.claimId))
        .single()
        .execute()
    )
    if not claim.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.data["status"] != "pending":
        raise HTTPException(status_code=409, detail="Claim is not pending")

    square_id = claim.data["square_id"]
    assert_admin_for_square(user_id, str(square_id))

    now = datetime.now(timezone.utc).isoformat()

    supabase.table("claims").update({
        "status": "approved",
        "approved_by": user_id,
        "approved_at": now,
    }).eq("id", str(data.claimId)).execute()

    supabase.table("squares").update({
        "approved": True,
        "approved_by": user_id,
        "approved_at": now,
        "image_path": claim.data["image_path"],
    }).eq("id", str(square_id)).execute()

    return {"status": "ok"}


@app.post("/admin/sync-tiles")
def sync_tiles(user_id: str = Depends(get_user_id)):
    assert_app_admin(user_id)

    url = (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
        f"/export?format=csv&gid={SHEET_GID}"
    )
    try:
        resp = httpx.get(url, timeout=20, follow_redirects=True)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Sheet fetch error: {e}")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Sheet fetch failed: {resp.status_code}")

    reader = csv.reader(io.StringIO(resp.text))
    tiles: list[dict] = []
    for row in reader:
        if len(row) < 8:
            continue
        try:
            num = int(row[4])
        except (ValueError, TypeError):
            continue
        if 1 <= num <= 30:
            tiles.append({
                "code": f"S{num:02d}",
                "title": row[6].strip(),
                "requirement": row[7].strip(),
                "description": row[5].strip(),
            })

    if not tiles:
        raise HTTPException(status_code=422, detail="No tiles parsed from sheet")

    teams_res = supabase.table("teams").select("id").execute()
    teams = teams_res.data or []

    upserted = 0
    for team in teams:
        rows = [{"team_id": team["id"], **t} for t in tiles]
        supabase.table("squares").upsert(
            rows,
            on_conflict="team_id,code",
        ).execute()
        upserted += len(rows)

    return {
        "status": "ok",
        "tiles_parsed": len(tiles),
        "rows_upserted": upserted,
        "teams": len(teams),
    }
