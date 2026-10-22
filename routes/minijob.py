import logging
from datetime import date
from flask import Blueprint, jsonify, render_template, request, session

from routes.auth import login_required
from utils.minijob import (
    build_month_summary,
    build_year_summary,
    get_shifts,
    parse_duration,
    parse_month,
    save_settings,
    save_shift,
    time_to_minutes,
)

minijob_bp = Blueprint("minijob", __name__)
logger = logging.getLogger(__name__)

INVALID_MONTH = "Invalid month, expected YYYY-MM"
MAX_BULK_ENTRIES = 62


@minijob_bp.route("/minijob", methods=["GET"])
@login_required
def minijob_page():
    """Minijob monthly tracker page"""
    month = request.args.get("month") or date.today().strftime("%Y-%m")
    if not parse_month(month):
        month = date.today().strftime("%Y-%m")
    view = "year" if request.args.get("view") == "year" else "month"
    return render_template(
        "minijob.html",
        month=month,
        view=view,
        today_month=date.today().strftime("%Y-%m"),
        username=session.get("username", "User"),
    )


@minijob_bp.route("/api/minijob/year/<int:year>", methods=["GET"])
@login_required
def get_year(year):
    if not 2000 <= year <= 2100:
        return jsonify({"error": "Invalid year"}), 400
    return jsonify(build_year_summary(session["user_id"], year))


@minijob_bp.route("/api/minijob/<month>", methods=["GET"])
@login_required
def get_month(month):
    parsed = parse_month(month)
    if not parsed:
        return jsonify({"error": INVALID_MONTH}), 400
    return jsonify(build_month_summary(session["user_id"], *parsed))


@minijob_bp.route("/api/minijob/<month>/settings", methods=["PUT"])
@login_required
def update_settings(month):
    parsed = parse_month(month)
    if not parsed:
        return jsonify({"error": INVALID_MONTH}), 400

    data = request.get_json(silent=True) or {}
    try:
        wage = float(data.get("hourly_wage"))
        limit = float(data.get("monthly_limit"))
        target = data.get("own_target")
        target_minutes = parse_duration(target) or None
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid settings"}), 400
    if wage <= 0 or limit <= 0:
        return jsonify({"error": "Wage and limit must be positive"}), 400

    save_settings(session["user_id"], month, wage, limit, target_minutes)
    return jsonify(build_month_summary(session["user_id"], *parsed))


def parse_shift_payload(data):
    """Validate one day's entry from the client; raises ValueError with a message."""
    start_time = (data.get("start_time") or "").strip() or None
    end_time = (data.get("end_time") or "").strip() or None
    for value in (start_time, end_time):
        if value is not None and time_to_minutes(value) is None:
            raise ValueError(f"Invalid time: {value}")

    try:
        break_minutes = parse_duration(data.get("break"))
        tips = float(data.get("tips") or 0)
    except (TypeError, ValueError):
        raise ValueError("Invalid break or tips") from None
    if tips < 0:
        raise ValueError("Tips cannot be negative")

    is_off = bool(data.get("is_off"))
    if is_off:
        start_time = end_time = None
        break_minutes = 0
    return {
        "is_off": is_off,
        "start_time": start_time,
        "end_time": end_time,
        "break_minutes": break_minutes,
        "tips": tips,
        "notes": (data.get("notes") or "").strip()[:500],
    }


@minijob_bp.route("/api/minijob/day/<day>", methods=["PUT"])
@login_required
def update_day(day):
    try:
        parsed_day = date.fromisoformat(day)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400

    try:
        shift = parse_shift_payload(request.get_json(silent=True) or {})
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    save_shift(session["user_id"], parsed_day.isoformat(), **shift)
    return jsonify(
        build_month_summary(session["user_id"], parsed_day.year, parsed_day.month)
    )


@minijob_bp.route("/api/minijob/<month>/bulk", methods=["POST"])
@login_required
def bulk_update(month):
    """Save several days at once (paste / quick add).

    Tips and notes left out of an entry keep the day's existing values.
    Nothing is saved if any entry is invalid.
    """
    parsed = parse_month(month)
    if not parsed:
        return jsonify({"error": INVALID_MONTH}), 400

    entries = (request.get_json(silent=True) or {}).get("entries")
    if not isinstance(entries, list) or not entries:
        return jsonify({"error": "No entries"}), 400
    if len(entries) > MAX_BULK_ENTRIES:
        return jsonify({"error": f"At most {MAX_BULK_ENTRIES} days at once"}), 400

    shifts = {}
    for entry in entries:
        if not isinstance(entry, dict):
            return jsonify({"error": "Invalid entry"}), 400
        try:
            day = date.fromisoformat(str(entry.get("date"))).isoformat()
        except ValueError:
            return jsonify({"error": f"Invalid date: {entry.get('date')}"}), 400
        try:
            shift = parse_shift_payload(entry)
        except ValueError as err:
            return jsonify({"error": f"{entry.get('date')}: {err}"}), 400
        shifts[day] = (shift, "tips" in entry, "notes" in entry)

    user_id = session["user_id"]
    existing = get_shifts(
        user_id, date.fromisoformat(min(shifts)), date.fromisoformat(max(shifts))
    )
    for day, (shift, has_tips, has_notes) in shifts.items():
        old = existing.get(day, {})
        if not has_tips:
            shift["tips"] = old.get("tips") or 0
        if not has_notes:
            shift["notes"] = old.get("notes") or ""
        save_shift(user_id, day, **shift)

    summary = build_month_summary(user_id, *parsed)
    summary["saved"] = len(shifts)
    return jsonify(summary)
