from fastapi import FastAPI, Depends, HTTPException, Header
from pydantic import BaseModel
import jwt
import os
from supabase import create_client, Client
from uuid import UUID
from datetime import datetime
from typing import List
from fastapi.middleware.cors import CORSMiddleware

# --------------------
# App
# --------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://YOUR-VERCEL-DOMAIN.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

# --------------------
# Supabase
# --------------------
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --------------------
# Helper Classes
# --------------------
class ClaimApprove(BaseModel):
    claimId: UUID

# --------------------
# Auth helper
# --------------------
def get_user_id(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth header")

    token = authorization.replace("Bearer ", "")

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    return user_id

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

# --------------------
# Request schema
# --------------------
class ClaimCreate(BaseModel):
    squareId: UUID
    imagePath: str

# --------------------
# Routes
# --------------------
@app.post("/claims")
def create_claim(data: ClaimCreate, user_id: str = Depends(get_user_id)):
    # 1) Verify square exists
    square = (
        supabase.table("squares")
        .select("id, claimed_by")
        .eq("id", str(data.squareId))
        .single()
        .execute()
    )

    if not square.data:
        raise HTTPException(status_code=404, detail="Square not found")

    if square.data["claimed_by"]:
        raise HTTPException(status_code=409, detail="Square already claimed")

    # 2) Insert claim (pending)
    res = (
        supabase.table("claims")
        .insert({
            "square_id": str(data.squareId),
            "user_id": user_id,
            "image_path": data.imagePath,
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
        })
        .execute()
    )

    if res.error:
        raise HTTPException(status_code=500, detail=res.error.message)

    return {"status": "ok"}

@app.get("/admin/claims/pending")
def list_pending_claims(user_id: str = Depends(get_user_id)):
    # TODO: replace with your real "is admin of team" check
    # For now you can temporarily allow all authed users during dev.

    res = (
        supabase.table("claims")
        .select("id, square_id, user_id, image_path, status, created_at")
        .eq("status", "pending")
        .order("created_at", desc=True)
        .execute()
    )

    if res.error:
        raise HTTPException(status_code=500, detail=res.error.message)

    return {"claims": res.data or []}

@app.post("/admin/claims/approve")
def approve_claim(data: ClaimApprove, user_id: str = Depends(get_user_id)):
    # 1) Load claim
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

    # 2) Update claim -> approved
    upd_claim = (
        supabase.table("claims")
        .update({
            "status": "approved",
            "approved_by": user_id,
            "approved_at": datetime.utcnow().isoformat(),
        })
        .eq("id", str(data.claimId))
        .execute()
    )
    if upd_claim.error:
        raise HTTPException(status_code=500, detail=upd_claim.error.message)

    # 3) Update square -> approved
    upd_square = (
        supabase.table("squares")
        .update({
            "approved": True,
            "approved_by": user_id,
            "approved_at": datetime.utcnow().isoformat(),
            "image_path": claim.data["image_path"],
        })
        .eq("id", str(square_id))
        .execute()
    )
    if upd_square.error:
        raise HTTPException(status_code=500, detail=upd_square.error.message)

    return {"status": "ok"}
