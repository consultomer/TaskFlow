"""Daily planner: a weekly routine of time blocks, fitted around work shifts.

The routine holds a list of blocks per weekday. A day's plan is the routine for
its weekday with the Minijob work shifts placed on top: goal blocks (German,
Kubernetes, job search) that clash with work are moved into free time, taking
the place of "free" blocks; other clashing blocks are dropped. Editing a single
day stores a copy of that day's blocks (an override), so the routine stays as it is.
"""

import json
import logging
import re
import uuid
from datetime import date, timedelta

from utils.database import get_db_connection
from utils.minijob import get_shifts

logger = logging.getLogger(__name__)

CATEGORIES = ("german", "k8s", "jobs", "routine", "free", "other")
GOAL_CATEGORIES = ("german", "k8s", "jobs")
PLACEMENT_ORDER = ("german", "jobs", "k8s")  # who gets free time first when work clashes
TRAVEL_MINUTES = 30  # get ready / travel time added before and after each shift
TASK_CATEGORY = {"k8s": "dev"}  # TaskFlow category for tasks created from a block
DAILY_GERMAN_TARGET_MINUTES = 120
MIN_MOVED_MINUTES = 30  # a moved block is never squeezed below this
MIN_FREE_PIECE_MINUTES = 15  # leftover free time shorter than this is dropped
MAX_BLOCKS = 40

TIME_RE = re.compile(r"^([01]?\d|2[0-4]):([0-5]\d)$")

_WEEKDAY = [
    ("07:00", "07:30", "Wake up & morning routine", "routine"),
    ("07:30", "08:00", "Breakfast & plan the day", "routine"),
    ("08:00", "09:30", "German: lesson & grammar", "german"),
    ("09:30", "09:45", "Break", "free"),
    ("09:45", "11:15", "CKA: theory (course / docs)", "k8s"),
    ("11:15", "12:30", "Job applications", "jobs"),
    ("12:30", "13:30", "Lunch & walk", "routine"),
    ("13:30", "15:00", "CKA: hands-on labs", "k8s"),
    ("15:00", "16:00", "Exercise / errands", "free"),
    ("16:00", "18:00", "Free time", "free"),
    ("18:00", "19:00", "Dinner", "routine"),
    ("19:00", "19:30", "German: vocab & listening", "german"),
    ("19:30", "21:00", "Free time", "free"),
    ("21:00", "21:30", "Review today & plan tomorrow", "routine"),
    ("21:30", "23:00", "Wind down (no screens)", "routine"),
]
_SUNDAY = [
    ("07:00", "08:00", "Slow morning & breakfast", "routine"),
    ("08:00", "09:30", "German: lesson & grammar", "german"),
    ("09:30", "10:00", "Break", "free"),
    ("10:00", "11:30", "CKA: weekly review / practice exam", "k8s"),
    ("11:30", "12:00", "Job search: save new postings for the week", "jobs"),
    ("12:00", "13:00", "Lunch", "routine"),
    ("13:00", "19:00", "Free time", "free"),
    ("19:00", "19:30", "German: vocab & listening", "german"),
    ("19:30", "21:00", "Free time", "free"),
    ("21:00", "21:30", "Weekly review & plan next week", "routine"),
    ("21:30", "23:00", "Wind down (no screens)", "routine"),
]


def default_routine(weekday):
    rows = _SUNDAY if weekday == 6 else _WEEKDAY
    return [
        {"id": f"d{i}", "start": start, "end": end, "title": title, "category": category}
        for i, (start, end, title, category) in enumerate(rows)
    ]


def init_planner_tables():
    conn = get_db_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS planner_routine (
                user_id INTEGER NOT NULL,
                weekday INTEGER NOT NULL,
                blocks TEXT NOT NULL,
                PRIMARY KEY (user_id, weekday),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS planner_days (
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                blocks TEXT,
                applications INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, day),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS planner_done (
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                block_id TEXT NOT NULL,
                PRIMARY KEY (user_id, day, block_id),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        """)
        columns = [row[1] for row in conn.execute("PRAGMA table_info(tasks)")]
        if "planned_block" not in columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN planned_block TEXT")
            logger.info("Added planned_block column to tasks table")
        conn.commit()
    finally:
        conn.close()


# ---------- time helpers ----------


def to_minutes(value):
    """'HH:MM' (00:00-24:00) -> minutes, or None."""
    match = TIME_RE.match(str(value or "").strip())
    if not match:
        return None
    minutes = int(match.group(1)) * 60 + int(match.group(2))
    return minutes if minutes <= 24 * 60 else None


def fmt_time(minutes):
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def validate_blocks(raw):
    """Clean a client-sent block list; raises ValueError with a message."""
    if not isinstance(raw, list) or len(raw) > MAX_BLOCKS:
        raise ValueError(f"Expected a list of at most {MAX_BLOCKS} blocks")
    blocks = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Invalid block")
        title = str(item.get("title") or "").strip()[:80]
        start = to_minutes(item.get("start"))
        end = to_minutes(item.get("end"))
        if end == 0:
            end = 24 * 60  # "00:00" as an end time means midnight
        if not title:
            raise ValueError("Every block needs a title")
        if start is None or end is None:
            raise ValueError(f"{title}: use times like 08:00")
        if end <= start:
            raise ValueError(f"{title}: end must be after start")
        category = item.get("category")
        if category not in CATEGORIES:
            raise ValueError(f"{title}: unknown category")
        block_id = str(item.get("id") or "")[:40] or uuid.uuid4().hex[:8]
        blocks.append(
            {
                "id": block_id,
                "start": fmt_time(start),
                "end": fmt_time(end),
                "title": title,
                "category": category,
            }
        )
    if len({b["id"] for b in blocks}) != len(blocks):
        raise ValueError("Duplicate block ids")
    return sorted(blocks, key=lambda b: b["start"])


# ---------- storage ----------


def get_routine(user_id, weekday):
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT blocks FROM planner_routine WHERE user_id = ? AND weekday = ?",
            (user_id, weekday),
        ).fetchone()
    finally:
        conn.close()
    return json.loads(row["blocks"]) if row else default_routine(weekday)


def save_routine(user_id, weekday, blocks):
    conn = get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO planner_routine (user_id, weekday, blocks) VALUES (?, ?, ?)
            ON CONFLICT (user_id, weekday) DO UPDATE SET blocks = excluded.blocks
            """,
            (user_id, weekday, json.dumps(blocks)),
        )
        conn.commit()
    finally:
        conn.close()


def reset_routine(user_id, weekday):
    conn = get_db_connection()
    try:
        conn.execute(
            "DELETE FROM planner_routine WHERE user_id = ? AND weekday = ?", (user_id, weekday)
        )
        conn.commit()
    finally:
        conn.close()


def get_day_record(user_id, day):
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT blocks, applications FROM planner_days WHERE user_id = ? AND day = ?",
            (user_id, day),
        ).fetchone()
        done = {
            r["block_id"]
            for r in conn.execute(
                "SELECT block_id FROM planner_done WHERE user_id = ? AND day = ?", (user_id, day)
            )
        }
    finally:
        conn.close()
    override = json.loads(row["blocks"]) if row and row["blocks"] else None
    return override, (row["applications"] if row else 0), done


def _upsert_day(user_id, day, column, value):
    conn = get_db_connection()
    try:
        conn.execute(
            f"""
            INSERT INTO planner_days (user_id, day, {column}) VALUES (?, ?, ?)
            ON CONFLICT (user_id, day) DO UPDATE SET {column} = excluded.{column}
            """,
            (user_id, day, value),
        )
        conn.commit()
    finally:
        conn.close()


def save_day_blocks(user_id, day, blocks):
    """Store an edited day; None goes back to the routine."""
    _upsert_day(user_id, day, "blocks", json.dumps(blocks) if blocks is not None else None)


def save_applications(user_id, day, count):
    _upsert_day(user_id, day, "applications", count)


def set_block_done(user_id, day, block_id, done):
    conn = get_db_connection()
    try:
        if done:
            conn.execute(
                "INSERT OR IGNORE INTO planner_done (user_id, day, block_id) VALUES (?, ?, ?)",
                (user_id, day, block_id),
            )
        else:
            conn.execute(
                "DELETE FROM planner_done WHERE user_id = ? AND day = ? AND block_id = ?",
                (user_id, day, block_id),
            )
        conn.commit()
    finally:
        conn.close()


def get_open_tasks(user_id):
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, name, category, due_date, completed, timer_active, timer_paused, planned_block
            FROM tasks WHERE user_id = ?
            ORDER BY due_date IS NULL, due_date, created_at
            """,
            (user_id,),
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


def plan_task(user_id, task_id, day, block_id):
    """Put a task into a block of a day (or take it out with block_id=None)."""
    conn = get_db_connection()
    try:
        cursor = conn.execute(
            "UPDATE tasks SET due_date = ?, planned_block = ? WHERE id = ? AND user_id = ?",
            (day, block_id, task_id, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


# ---------- fitting the routine around work ----------


def work_blocks(user_id, day):
    """Work time on `day` from the Minijob tracker, incl. a shift from the night before."""
    prev = day - timedelta(days=1)
    shifts = get_shifts(user_id, prev, day)
    blocks = []
    for shift_day, block_id in ((prev, "work-prev"), (day, "work")):
        shift = shifts.get(shift_day.isoformat())
        if not shift or shift.get("is_off"):
            continue
        start, end = to_minutes(shift.get("start_time")), to_minutes(shift.get("end_time"))
        if start is None or end is None:
            continue
        overnight = end <= start
        if shift_day == prev:
            if not overnight:
                continue
            start = 0  # the part after midnight
        elif overnight:
            end = 24 * 60
        blocks.append(
            {
                "id": block_id,
                "start": fmt_time(start),
                "end": fmt_time(end),
                "title": "Work",
                "category": "work",
                "source": "minijob",
            }
        )
        if TRAVEL_MINUTES and shift_day == day and start > 0:
            blocks.append(_travel_block(f"{block_id}-before", start - TRAVEL_MINUTES, start, "Get ready & travel"))
        if TRAVEL_MINUTES and end < 24 * 60:
            blocks.append(_travel_block(f"{block_id}-after", end, end + TRAVEL_MINUTES, "Travel home"))
    return blocks


def _travel_block(block_id, start, end, title):
    return {
        "id": block_id,
        "start": fmt_time(max(start, 0)),
        "end": fmt_time(min(end, 24 * 60)),
        "title": title,
        "category": "travel",
        "source": "minijob",
    }


def _span(block):
    return to_minutes(block["start"]), to_minutes(block["end"])


def _overlaps(a, b):
    a0, a1 = _span(a)
    b0, b1 = _span(b)
    return a0 < b1 and b0 < a1


def _find_slot(busy, day_start, day_end, duration):
    """Earliest gap that fits `duration`, else the largest gap of at least MIN_MOVED_MINUTES."""
    gaps = []
    cursor = day_start
    for b0, b1 in sorted(_span(b) for b in busy):
        if b0 > cursor:
            gaps.append((cursor, min(b0, day_end)))
        cursor = max(cursor, b1)
    if cursor < day_end:
        gaps.append((cursor, day_end))
    gaps = [(g0, g1) for g0, g1 in gaps if g1 > g0]
    for g0, g1 in gaps:
        if g1 - g0 >= duration:
            return g0, g0 + duration
    largest = max(gaps, key=lambda g: g[1] - g[0], default=None)
    if largest and largest[1] - largest[0] >= MIN_MOVED_MINUTES:
        return largest
    return None


def _cut_free_time(blocks, start, end):
    """Remove [start, end) from free blocks, keeping leftovers that are long enough."""
    result = []
    for block in blocks:
        b0, b1 = _span(block)
        if block["category"] != "free" or b1 <= start or b0 >= end:
            result.append(block)
            continue
        pieces = [(b0, start), (end, b1)]
        for p0, p1 in pieces:
            if p1 - p0 < MIN_FREE_PIECE_MINUTES:
                continue
            # Pieces never overlap, so their start makes the id unique
            piece_id = block["id"] if p0 == b0 else f"{block['id']}@{p0}"
            result.append({**block, "id": piece_id, "start": fmt_time(p0), "end": fmt_time(p1)})
    return result


def make_room(blocks):
    """Trim free time that overlaps any other block (used when a day is edited)."""
    for block in [b for b in blocks if b["category"] != "free"]:
        blocks = _cut_free_time(blocks, *_span(block))
    return sorted(blocks, key=lambda b: b["start"])


def fit_around_work(blocks, work):
    """Return (blocks, missed).

    Free time is trimmed around work; goal blocks clashing with work are moved
    into free time; other clashing blocks (meals, routine) are dropped.
    """
    if not work or not blocks:
        return blocks, []
    day_start = min(_span(b)[0] for b in blocks)
    day_end = max(_span(b)[1] for b in blocks)
    for w in work:
        blocks = _cut_free_time(blocks, *_span(w))
    kept = [b for b in blocks if not any(_overlaps(b, w) for w in work)]
    displaced = [b for b in blocks if any(_overlaps(b, w) for w in work)]
    missed = []
    for category in PLACEMENT_ORDER:
        for block in (b for b in displaced if b["category"] == category):
            b0, b1 = _span(block)
            busy = work + [k for k in kept if k["category"] != "free"]
            slot = _find_slot(busy, day_start, day_end, b1 - b0)
            if slot is None:
                missed.append(block)
                continue
            s0, s1 = slot
            kept = _cut_free_time(kept, s0, s1)
            kept.append(
                {**block, "start": fmt_time(s0), "end": fmt_time(s1),
                 "moved_from": block["start"], "shortened": s1 - s0 < b1 - b0}
            )
    return sorted(kept, key=lambda b: b["start"]), missed


# ---------- day / week summaries ----------


def _stats(blocks, done):
    stats = {c: {"planned": 0, "done": 0} for c in (*GOAL_CATEGORIES, "work")}
    for block in blocks:
        if block.get("source") == "minijob":
            continue  # work time comes from the shift itself, see below
        if block["category"] not in stats:
            continue
        b0, b1 = _span(block)
        stats[block["category"]]["planned"] += b1 - b0
        if block["id"] in done:
            stats[block["category"]]["done"] += b1 - b0
    for block in blocks:
        if block["category"] == "work":
            b0, b1 = _span(block)
            stats["work"]["planned"] += b1 - b0
    goal_blocks = [b for b in blocks if b["category"] in GOAL_CATEGORIES]
    stats["goal_blocks"] = len(goal_blocks)
    stats["goal_blocks_done"] = sum(1 for b in goal_blocks if b["id"] in done)
    return stats


def build_day_plan(user_id, day, today=None, tasks=None):
    """Everything the planner shows for one day."""
    today = today or date.today()
    iso = day.isoformat()
    override, applications, done = get_day_record(user_id, iso)
    work = work_blocks(user_id, day)

    if override is not None:
        blocks = override
        missed = []
        for block in blocks:
            block["clash"] = any(_overlaps(block, w) for w in work)
    else:
        blocks, missed = fit_around_work(get_routine(user_id, day.weekday()), work)

    blocks = sorted(blocks + work, key=lambda b: (b["start"], b["end"]))
    block_ids = {b["id"] for b in blocks}

    tasks = get_open_tasks(user_id) if tasks is None else tasks
    by_block = {}
    unplanned = []
    for task in tasks:
        planned_here = task["due_date"] == iso and task["planned_block"] in block_ids
        if planned_here:
            by_block.setdefault(task["planned_block"], []).append(task)
        elif not task["completed"] and (
            task["due_date"] == iso
            or (day == today and (task["due_date"] is None or task["due_date"] < iso))
        ):
            unplanned.append(task)

    for block in blocks:
        block["done"] = block["id"] in done
        block["tasks"] = by_block.get(block["id"], [])

    return {
        "date": iso,
        "label": day.strftime("%A, %d %B %Y"),
        "weekday": day.weekday(),
        "is_today": day == today,
        "overridden": override is not None,
        "has_work": bool(work),
        "blocks": blocks,
        "missed": [
            {"title": b["title"], "category": b["category"], "minutes": _span(b)[1] - _span(b)[0]}
            for b in missed
        ],
        "applications": applications,
        "stats": _stats(blocks, done),
        "german_target": DAILY_GERMAN_TARGET_MINUTES,
        "unplanned_tasks": unplanned,
    }


def build_week(user_id, day, today=None):
    """Mon-Sun summary of the week containing `day`."""
    today = today or date.today()
    monday = day - timedelta(days=day.weekday())
    tasks = get_open_tasks(user_id)
    days = []
    totals = {c: {"planned": 0, "done": 0} for c in (*GOAL_CATEGORIES, "work")}
    totals["applications"] = 0
    for offset in range(7):
        current = monday + timedelta(days=offset)
        plan = build_day_plan(user_id, current, today, tasks)
        stats = plan["stats"]
        for category in (*GOAL_CATEGORIES, "work"):
            totals[category]["planned"] += stats[category]["planned"]
            totals[category]["done"] += stats[category]["done"]
        totals["applications"] += plan["applications"]
        days.append(
            {
                "date": plan["date"],
                "weekday": current.strftime("%a"),
                "is_today": plan["is_today"],
                "is_past": current < today,
                "has_work": plan["has_work"],
                "overridden": plan["overridden"],
                "applications": plan["applications"],
                "missed": len(plan["missed"]),
                "stats": stats,
            }
        )
    return {
        "from": monday.isoformat(),
        "to": (monday + timedelta(days=6)).isoformat(),
        "days": days,
        "totals": totals,
        "german_target": DAILY_GERMAN_TARGET_MINUTES * 7,
    }
