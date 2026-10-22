"""Minijob monthly tracker: storage and calculations.

Shifts are stored per user and day. Settings (hourly wage, monthly minijob
limit, optional own target) are stored per user and month; a month without
its own settings inherits those of the most recent earlier month.
"""

import calendar
import logging
import re
from datetime import date, timedelta

from utils.database import get_db_connection

logger = logging.getLogger(__name__)

DEFAULT_HOURLY_WAGE = 13.00
DEFAULT_MONTHLY_LIMIT = 603.00

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def init_minijob_tables():
    """Create minijob tables if they don't exist."""
    conn = get_db_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS minijob_settings (
                user_id INTEGER NOT NULL,
                month TEXT NOT NULL,
                hourly_wage REAL NOT NULL,
                monthly_limit REAL NOT NULL,
                own_target_minutes INTEGER,
                PRIMARY KEY (user_id, month),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS minijob_shifts (
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                is_off BOOLEAN DEFAULT 0,
                start_time TEXT,
                end_time TEXT,
                break_minutes INTEGER DEFAULT 0,
                tips REAL DEFAULT 0,
                notes TEXT DEFAULT '',
                PRIMARY KEY (user_id, day),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        """)
        conn.commit()
    finally:
        conn.close()


# ---------- parsing helpers ----------


def parse_month(value):
    """Return (year, month) for 'YYYY-MM', or None if invalid."""
    if not value or not MONTH_RE.match(value):
        return None
    year, month = value.split("-")
    return int(year), int(month)


def time_to_minutes(value):
    """'HH:MM' -> minutes since midnight, or None."""
    if not value:
        return None
    match = TIME_RE.match(value.strip())
    if not match:
        return None
    return int(match.group(1)) * 60 + int(match.group(2))


def parse_duration(value):
    """Parse a duration such as '0:30', '30', '1.5h', 'No' or '' into minutes.

    Raises ValueError for anything unparseable.
    """
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        minutes = int(round(value))
    else:
        text = str(value).strip().lower()
        if text in ("", "no", "none", "-", "0"):
            return 0
        if ":" in text:
            hours, _, mins = text.partition(":")
            if not (hours.isdigit() and mins.isdigit()):
                raise ValueError(f"Invalid duration: {value}")
            minutes = int(hours) * 60 + int(mins)
        elif text.endswith("h"):
            minutes = int(round(float(text[:-1]) * 60))
        else:
            minutes = int(text)
    if minutes < 0:
        raise ValueError(f"Invalid duration: {value}")
    return minutes


def shift_net_minutes(start_time, end_time, break_minutes):
    """Net worked minutes; an end before the start is treated as overnight."""
    start = time_to_minutes(start_time)
    end = time_to_minutes(end_time)
    if start is None or end is None:
        return None
    gross = end - start
    if gross <= 0:
        gross += 24 * 60
    return max(gross - (break_minutes or 0), 0)


# ---------- storage ----------


def get_settings(user_id, month):
    """Settings for a month, inherited from the latest earlier month if unset."""
    conn = get_db_connection()
    try:
        row = conn.execute(
            """
            SELECT month, hourly_wage, monthly_limit, own_target_minutes
            FROM minijob_settings
            WHERE user_id = ? AND month <= ?
            ORDER BY month DESC LIMIT 1
            """,
            (user_id, month),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return {
            "hourly_wage": DEFAULT_HOURLY_WAGE,
            "monthly_limit": DEFAULT_MONTHLY_LIMIT,
            "own_target_minutes": None,
        }
    return {
        "hourly_wage": row["hourly_wage"],
        "monthly_limit": row["monthly_limit"],
        # The own target is month-specific, so don't inherit it
        "own_target_minutes": row["own_target_minutes"] if row["month"] == month else None,
    }


def save_settings(user_id, month, hourly_wage, monthly_limit, own_target_minutes):
    conn = get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO minijob_settings (user_id, month, hourly_wage, monthly_limit, own_target_minutes)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (user_id, month) DO UPDATE SET
                hourly_wage = excluded.hourly_wage,
                monthly_limit = excluded.monthly_limit,
                own_target_minutes = excluded.own_target_minutes
            """,
            (user_id, month, hourly_wage, monthly_limit, own_target_minutes),
        )
        conn.commit()
    finally:
        conn.close()


def get_shifts(user_id, first_day, last_day):
    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM minijob_shifts WHERE user_id = ? AND day BETWEEN ? AND ?",
            (user_id, first_day.isoformat(), last_day.isoformat()),
        ).fetchall()
    finally:
        conn.close()
    return {row["day"]: dict(row) for row in rows}


def save_shift(user_id, day, is_off, start_time, end_time, break_minutes, tips, notes):
    """Upsert a day's entry; an entirely empty entry deletes the row."""
    conn = get_db_connection()
    try:
        empty = not (is_off or start_time or end_time or break_minutes or tips or notes)
        if empty:
            conn.execute(
                "DELETE FROM minijob_shifts WHERE user_id = ? AND day = ?", (user_id, day)
            )
        else:
            conn.execute(
                """
                INSERT INTO minijob_shifts
                    (user_id, day, is_off, start_time, end_time, break_minutes, tips, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, day) DO UPDATE SET
                    is_off = excluded.is_off,
                    start_time = excluded.start_time,
                    end_time = excluded.end_time,
                    break_minutes = excluded.break_minutes,
                    tips = excluded.tips,
                    notes = excluded.notes
                """,
                (user_id, day, is_off, start_time, end_time, break_minutes, tips, notes),
            )
        conn.commit()
    finally:
        conn.close()


# ---------- month summary ----------


def build_month_summary(user_id, year, month, today=None):
    """Compute everything the tracker page shows for one month."""
    today = today or date.today()
    month_key = f"{year:04d}-{month:02d}"
    settings = get_settings(user_id, month_key)
    wage = settings["hourly_wage"]
    limit = settings["monthly_limit"]
    max_minutes = int(limit / wage * 60) if wage > 0 else 0
    target_minutes = settings["own_target_minutes"] or max_minutes

    days_in_month = calendar.monthrange(year, month)[1]
    first_day = date(year, month, 1)
    last_day = date(year, month, days_in_month)
    shifts = get_shifts(user_id, first_day, last_day)

    rows = []
    weeks = {}
    running_minutes = 0
    running_earned = 0.0
    total_break = 0
    total_tips = 0.0
    shift_count = 0

    for offset in range(days_in_month):
        day = first_day + timedelta(days=offset)
        iso = day.isoformat()
        entry = shifts.get(iso, {})
        kw = day.isocalendar()[1]

        is_off = bool(entry.get("is_off"))
        start_time = entry.get("start_time")
        end_time = entry.get("end_time")
        break_minutes = entry.get("break_minutes") or 0
        tips = entry.get("tips") or 0.0
        net = None if is_off else shift_net_minutes(start_time, end_time, break_minutes)

        earned = None
        status = "off" if is_off else ""
        if net is not None:
            earned = round(net / 60 * wage, 2)
            running_minutes += net
            running_earned += earned
            total_break += break_minutes
            shift_count += 1
            status = "logged"
        elif start_time and not is_off:
            status = "open"  # started but no end time yet
        total_tips += tips

        week = weeks.setdefault(
            kw,
            {
                "kw": kw,
                "from": (day - timedelta(days=day.weekday())).isoformat(),
                "minutes": 0,
                "earned": 0.0,
                "tips": 0.0,
            },
        )
        if net is not None:
            week["minutes"] += net
            week["earned"] += earned
        week["tips"] += tips

        rows.append(
            {
                "date": iso,
                "kw": kw,
                "weekday": day.strftime("%a"),
                "is_today": day == today,
                "is_off": is_off,
                "start_time": start_time,
                "end_time": end_time,
                "break_minutes": break_minutes,
                "net_minutes": net,
                "running_minutes": running_minutes if net is not None else None,
                "earned": earned,
                "running_earned": round(running_earned, 2) if net is not None else None,
                "status": status,
                "tips": tips,
                "notes": entry.get("notes") or "",
            }
        )

    earned_total = round(running_earned, 2)
    hours_worked = running_minutes / 60

    # Projection: extrapolate current pace over the whole month
    if today < first_day:
        elapsed_days = 0
    elif today > last_day:
        elapsed_days = days_in_month
    else:
        elapsed_days = today.day
    projected = earned_total / elapsed_days * days_in_month if elapsed_days else 0.0

    current_kw = today.isocalendar()[1] if first_day <= today <= last_day else None
    week_list = []
    for week in sorted(weeks.values(), key=lambda w: w["from"]):
        week["earned"] = round(week["earned"], 2)
        week["tips"] = round(week["tips"], 2)
        week["is_current"] = week["kw"] == current_kw
        week_list.append(week)

    return {
        "month": month_key,
        "month_label": first_day.strftime("%B %Y"),
        "settings": {
            "hourly_wage": wage,
            "monthly_limit": limit,
            "own_target_minutes": settings["own_target_minutes"],
            "max_minutes": max_minutes,
            "target_minutes": target_minutes,
        },
        "totals": {
            "worked_minutes": running_minutes,
            "earned": earned_total,
            "left_to_limit": round(limit - earned_total, 2),
            "minutes_left": max_minutes - running_minutes,
            "tips": round(total_tips, 2),
            "in_pocket": round(earned_total + total_tips, 2),
            "limit_pct": earned_total / limit * 100 if limit else 0,
            "target_pct": running_minutes / target_minutes * 100 if target_minutes else 0,
            "shifts": shift_count,
            "avg_shift_minutes": running_minutes // shift_count if shift_count else 0,
            "projected": round(projected, 2),
            "break_minutes": total_break,
            "tips_per_hour": round(total_tips / hours_worked, 2) if hours_worked else 0,
            "effective_wage": round((earned_total + total_tips) / hours_worked, 2)
            if hours_worked
            else 0,
        },
        "days": rows,
        "weeks": week_list,
    }


# ---------- year summary ----------


def build_year_summary(user_id, year, today=None):
    """Per-month totals for a whole year, plus the year's grand totals."""
    today = today or date.today()
    months = []
    for month in range(1, 13):
        summary = build_month_summary(user_id, year, month, today)
        t = summary["totals"]
        limit = summary["settings"]["monthly_limit"]
        months.append(
            {
                "month": summary["month"],
                "label": date(year, month, 1).strftime("%b"),
                "worked_minutes": t["worked_minutes"],
                "earned": t["earned"],
                "tips": t["tips"],
                "in_pocket": t["in_pocket"],
                "shifts": t["shifts"],
                "monthly_limit": limit,
                "limit_pct": t["limit_pct"],
                "over_limit": t["earned"] > limit,
                "is_current": year == today.year and month == today.month,
                "is_future": date(year, month, 1) > today,
            }
        )

    worked = sum(m["worked_minutes"] for m in months)
    earned = round(sum(m["earned"] for m in months), 2)
    tips = round(sum(m["tips"] for m in months), 2)
    annual_limit = round(sum(m["monthly_limit"] for m in months), 2)
    active = [m for m in months if m["shifts"]]

    return {
        "year": year,
        "months": months,
        "totals": {
            "worked_minutes": worked,
            "earned": earned,
            "tips": tips,
            "in_pocket": round(earned + tips, 2),
            "shifts": sum(m["shifts"] for m in months),
            "annual_limit": annual_limit,
            "left_to_limit": round(annual_limit - earned, 2),
            "limit_pct": earned / annual_limit * 100 if annual_limit else 0,
            "months_over_limit": sum(1 for m in months if m["over_limit"]),
            "avg_month_earned": round(earned / len(active), 2) if active else 0,
            "effective_wage": round((earned + tips) / (worked / 60), 2) if worked else 0,
        },
    }
