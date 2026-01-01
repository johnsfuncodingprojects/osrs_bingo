import os
import re
import time
import secrets
import bcrypt
import jwt
from typing import Optional, Any, Dict, List
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from psycopg import connect
from psycopg.rows import dict_row
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL missing")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET missing")

app = FastAPI(title="OSRS Bingo API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS] if ALLOWED_ORIGINS != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RSN_RE = re.compile(r"^[A-Za-z0-9 _-]{1,12}$")  # OSRS-ish. Good enough.
TEAMCODE_RE = re.compile(r"^[A-Za-z0-9-]{4,24}$")  # e.g. ABCD-1234


def db():
    return connect(DATABASE_URL, row_factory=dict_row)


def norm_rsn(rsn: str) -> str:
    rsn = rsn.strip()
    if not RSN_RE.match(rsn):
        raise HTTPException(status_code=400, detail="Invalid RSN format")
    # keep original casing, but normalize whitespace
    rsn = re.sub(r"\s+", " ", rsn)
    return rsn


def sign_jwt(payload: dict) -> str:
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid session token")


def hash_text(value: str) -> str:
    return bcrypt.hashpw(value.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def check_hash(value: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(value.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def gen_plugin_key() -> str:
    return "rlp_" + secrets.token_urlsafe(24)


class JoinReq(BaseModel):
    rsn: str
    teamCode: str


class JoinResp(BaseModel):
    teamId: str
    teamName: str
    rsn: str
    sessionToken: str
    pluginKey: str


class CreateTeamReq(BaseModel):
    teamName: str = Field(min_length=1, max_length=64)
    teamCode: str = Field(min_length=4, max_length=24)


class CreateTeamResp(BaseModel):
    teamId: str
    teamName: str


class ClaimReq(BaseModel):
    squareCode: str


class PluginEventReq(BaseModel):
    rsn: str
    type: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    ts: Optional[int] = None


def require_session(authorization: Optional[str]) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing session token")
    token = authorization.split(" ", 1)[1].strip()
    return verify_jwt(token)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/teams/create", response_model=CreateTeamResp)
def create_team(req: CreateTeamReq):
    if not TEAMCODE_RE.match(req.teamCode.strip()):
        raise HTTPException(status_code=400, detail="Invalid team code format")
    code_hash = hash_text(req.teamCode.strip())

    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "insert into teams (name, join_code_hash) values (%s, %s) returning id, name",
                (req.teamName.strip(), code_hash),
            )
            row = cur.fetchone()
            return {"teamId": str(row["id"]), "teamName": row["name"]}


@app.post("/auth/join", response_model=JoinResp)
def auth_join(req: JoinReq):
    rsn = norm_rsn(req.rsn)
    team_code = req.teamCode.strip()
    if not TEAMCODE_RE.match(team_code):
        raise HTTPException(status_code=400, detail="Invalid team code format")

    with db() as conn:
        with conn.cursor() as cur:
            # find matching team by checking hashes
            cur.execute("select id, name, join_code_hash from teams")
            teams = cur.fetchall()
            team = None
            for t in teams:
                if check_hash(team_code, t["join_code_hash"]):
                    team = t
                    break
            if not team:
                raise HTTPException(status_code=403, detail="Bad team code")

            # upsert user
            cur.execute("select id, rsn from users where rsn=%s", (rsn,))
            u = cur.fetchone()
            if not u:
                cur.execute("insert into users (rsn) values (%s) returning id, rsn", (rsn,))
                u = cur.fetchone()

            # ensure membership
            cur.execute(
                "insert into team_members (team_id, user_id) values (%s, %s) on conflict do nothing",
                (team["id"], u["id"]),
            )

            # ensure plugin key
            cur.execute(
                "select key_hash from plugin_keys where team_id=%s and user_id=%s and revoked_at is null",
                (team["id"], u["id"]),
            )
            pk = cur.fetchone()
            plugin_key = None
            if pk:
                # can’t recover original key; rotate new key for simplicity
                plugin_key = gen_plugin_key()
                cur.execute(
                    "update plugin_keys set revoked_at=now() where team_id=%s and user_id=%s and revoked_at is null",
                    (team["id"], u["id"]),
                )
            else:
                plugin_key = gen_plugin_key()

            cur.execute(
                "insert into plugin_keys (team_id, user_id, key_hash) values (%s, %s, %s) "
                "on conflict (team_id, user_id) do update set key_hash=excluded.key_hash, revoked_at=null",
                (team["id"], u["id"], hash_text(plugin_key)),
            )

            session = sign_jwt(
                {"teamId": str(team["id"]), "userId": str(u["id"]), "rsn": rsn, "iat": int(time.time())}
            )

            return {
                "teamId": str(team["id"]),
                "teamName": team["name"],
                "rsn": rsn,
                "sessionToken": session,
                "pluginKey": plugin_key,
            }


@app.post("/teams/{team_id}/seed_squares")
def seed_squares(team_id: str, authorization: Optional[str] = Header(default=None)):
    sess = require_session(authorization)
    if sess["teamId"] != team_id:
        raise HTTPException(status_code=403, detail="Wrong team")

    squares = [
        ("COX_TBOW", "Get a tbow from a raid", {"type": "COLLOG_ITEM", "itemIds": [20997]}),
        ("BOSS_PET_ANY", "Get a boss pet", {"type": "ANY_BOSS_PET"}),
        ("CG_ENH_SEED", "Get an enhanced crystal seed drop", {"type": "COLLOG_ITEM", "itemIds": [23956]}),
        ("TOB_SCYTHE", "Get a scythe from a raid", {"type": "COLLOG_ITEM", "itemIds": [22486]}),
        ("SKILLING_PET_ANY", "Obtain a skilling pet", {"type": "ANY_SKILLING_PET"}),
        ("COX_10PPL", "Do a CoX raid with 10+ people", {"type": "RAID_COMPLETE", "raid": "COX", "minParty": 10}),
        ("GWD_EACH", "Get a GWD drop from each boss", {"type": "GWD_EACH_BOSS_UNIQUE"}),
        ("DK_RINGS_ALL", "All dagannoth king rings", {"type": "COLLOG_ALL", "itemIds": [6737, 6739, 6735]}),
        ("KBD_DRAGONSTONE", "Get a dragonstone from KBD", {"type": "LOOT_ITEM_FROM_NPC", "npc": "KBD", "itemId": 1615}),
        ("FIRST_INFERNAL", "Get infernal cape (first time)", {"type": "FIRST_ITEM", "itemId": 21295}),
    ]

    with db() as conn:
        with conn.cursor() as cur:
            for code, title, rules in squares:
                cur.execute(
                    "insert into squares (team_id, code, title, rules_json) values (%s, %s, %s, %s) "
                    "on conflict (team_id, code) do update set title=excluded.title, rules_json=excluded.rules_json",
                    (team_id, code, title, rules),
                )
    return {"ok": True, "count": len(squares)}


@app.get("/teams/{team_id}/board")
def get_board(team_id: str, authorization: Optional[str] = Header(default=None)):
    sess = require_session(authorization)
    if sess["teamId"] != team_id:
        raise HTTPException(status_code=403, detail="Wrong team")

    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select s.id as square_id, s.code, s.title, s.rules_json,
                       c.id as claim_id, c.status as claim_status, c.user_id as claim_user_id,
                       u.rsn as claim_rsn
                from squares s
                left join claims c on c.square_id = s.id and c.team_id = s.team_id and c.status in ('claimed','completed')
                left join users u on u.id = c.user_id
                where s.team_id=%s
                order by s.code
                """,
                (team_id,),
            )
            squares = cur.fetchall()

            cur.execute(
                """
                select comp.square_id, u.rsn, comp.completed_at
                from completions comp
                join users u on u.id = comp.user_id
                where comp.team_id=%s
                """,
                (team_id,),
            )
            completions = cur.fetchall()

    # group claims
    sq_map: Dict[str, dict] = {}
    for r in squares:
        sid = str(r["square_id"])
        if sid not in sq_map:
            sq_map[sid] = {
                "id": sid,
                "code": r["code"],
                "title": r["title"],
                "rules": r["rules_json"],
                "claims": [],
                "completions": [],
            }
        if r["claim_id"]:
            sq_map[sid]["claims"].append(
                {
                    "claimId": str(r["claim_id"]),
                    "status": r["claim_status"],
                    "rsn": r["claim_rsn"],
                    "userId": str(r["claim_user_id"]),
                }
            )

    for comp in completions:
        sid = str(comp["square_id"])
        if sid in sq_map:
            sq_map[sid]["completions"].append(
                {"rsn": comp["rsn"], "completedAt": comp["completed_at"].isoformat()}
            )

    return {"teamId": team_id, "squares": list(sq_map.values())}


@app.post("/teams/{team_id}/claims")
def create_claim(team_id: str, req: ClaimReq, authorization: Optional[str] = Header(default=None)):
    sess = require_session(authorization)
    if sess["teamId"] != team_id:
        raise HTTPException(status_code=403, detail="Wrong team")

    code = req.squareCode.strip()

    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("select id from squares where team_id=%s and code=%s", (team_id, code))
            sq = cur.fetchone()
            if not sq:
                raise HTTPException(status_code=404, detail="Square not found")

            cur.execute(
                "insert into claims (team_id, user_id, square_id, status) values (%s, %s, %s, 'claimed') returning id",
                (team_id, sess["userId"], sq["id"]),
            )
            claim_id = cur.fetchone()["id"]
            return {"ok": True, "claimId": str(claim_id)}


@app.post("/plugin/event")
def plugin_event(
    req: PluginEventReq,
    x_team_id: Optional[str] = Header(default=None),
    x_plugin_key: Optional[str] = Header(default=None),
):
    if not x_team_id or not x_plugin_key:
        raise HTTPException(status_code=401, detail="Missing plugin auth headers")

    rsn = norm_rsn(req.rsn)

    with db() as conn:
        with conn.cursor() as cur:
            # user lookup
            cur.execute("select id, rsn, had_infernal from users where rsn=%s", (rsn,))
            user = cur.fetchone()
            if not user:
                raise HTTPException(status_code=403, detail="Unknown RSN (join via website first)")

            # membership check
            cur.execute(
                "select 1 from team_members where team_id=%s and user_id=%s",
                (x_team_id, user["id"]),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=403, detail="Not a member of this team")

            # verify plugin key (hashed)
            cur.execute(
                "select key_hash from plugin_keys where team_id=%s and user_id=%s and revoked_at is null",
                (x_team_id, user["id"]),
            )
            pk = cur.fetchone()
            if not pk or not check_hash(x_plugin_key, pk["key_hash"]):
                raise HTTPException(status_code=403, detail="Bad plugin key")

            # store event
            cur.execute(
                "insert into evidence_events (team_id, user_id, type, payload) values (%s, %s, %s, %s) returning id",
                (x_team_id, user["id"], req.type.strip(), req.payload),
            )
            ev_id = cur.fetchone()["id"]

            # rules engine (MVP: only implement a couple clean ones)
            completed_codes = apply_rules(cur, team_id=x_team_id, user_id=str(user["id"]), rsn=rsn, ev_type=req.type.strip(), payload=req.payload, evidence_event_id=str(ev_id))

            return {"ok": True, "completed": completed_codes}


def apply_rules(cur, team_id: str, user_id: str, rsn: str, ev_type: str, payload: dict, evidence_event_id: str) -> List[str]:
    # Fetch squares for this team
    cur.execute("select id, code, rules_json from squares where team_id=%s", (team_id,))
    squares = cur.fetchall()
    completed: List[str] = []

    def complete(square_id: str, code: str):
        # insert completion (unique prevents dupes)
        cur.execute(
            """
            insert into completions (team_id, square_id, user_id, evidence_event_id)
            values (%s, %s, %s, %s)
            on conflict do nothing
            """,
            (team_id, square_id, user_id, evidence_event_id),
        )
        # mark claims completed for that square by this user
        cur.execute(
            """
            update claims set status='completed', completed_at=now()
            where team_id=%s and square_id=%s and user_id=%s and status='claimed'
            """,
            (team_id, square_id, user_id),
        )
        completed.append(code)

    for s in squares:
        square_id = str(s["id"])
        code = s["code"]
        rules = s["rules_json"] or {}
        rtype = rules.get("type")

        # 1) KBD dragonstone via LOOT event payload
        if rtype == "LOOT_ITEM_FROM_NPC" and ev_type == "LOOT":
            # expected: payload = {"npc":"KBD","items":[{"itemId":1615,"qty":1}, ...]}
            npc = rules.get("npc")
            item_id = rules.get("itemId")
            if payload.get("npc") == npc:
                for it in payload.get("items", []):
                    if int(it.get("itemId", -1)) == int(item_id):
                        complete(square_id, code)

        # 2) COX raid complete with party size
        if rtype == "RAID_COMPLETE" and ev_type == "RAID_COMPLETE":
            if payload.get("raid") == rules.get("raid") and int(payload.get("partySize", 0)) >= int(rules.get("minParty", 0)):
                complete(square_id, code)

        # 3) FIRST_INFERNAL: ITEM_OBTAINED
        if rtype == "FIRST_ITEM" and ev_type == "ITEM_OBTAINED":
            if int(payload.get("itemId", -1)) == int(rules.get("itemId")):
                # gate: only if user.had_infernal is false
                cur.execute("select had_infernal from users where rsn=%s", (rsn,))
                had = cur.fetchone()["had_infernal"]
                if not had:
                    cur.execute("update users set had_infernal=true where rsn=%s", (rsn,))
                    complete(square_id, code)

        # 4) Simple COLLOG_ITEM via snapshot event
        if rtype == "COLLOG_ITEM" and ev_type == "COLLOG_SNAPSHOT":
            # payload: {"itemIdsOwned":[20997, 22486, ...]} (your plugin will send this)
            owned = set(int(x) for x in payload.get("itemIdsOwned", []))
            for iid in rules.get("itemIds", []):
                if int(iid) in owned:
                    complete(square_id, code)

        # 5) COLLOG_ALL: must have all ids
        if rtype == "COLLOG_ALL" and ev_type == "COLLOG_SNAPSHOT":
            owned = set(int(x) for x in payload.get("itemIdsOwned", []))
            needed = [int(x) for x in rules.get("itemIds", [])]
            if needed and all(x in owned for x in needed):
                complete(square_id, code)

    return completed
