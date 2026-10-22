import logging
from datetime import date
from flask import Blueprint, jsonify, render_template, request, session

from routes.auth import login_required
from utils.minijob import (
    build_month_summary,
    build_year_summary,
    parse_duration,
    parse_month,
    save_settings,
    save_shift,
    time_to_minutes,
)

minijob_bp = Blueprint("minijob", __name__)
logger = logging.getLogger(__name__)

INVALID_MONTH = "Invalid month, expected YYYY-MM"


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


@minijob_bp.route("/api/minijob/day/<day>", methods=["PUT"])
@login_required
def update_day(day):
    try:
        parsed_day = date.fromisoformat(day)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400

    data = request.get_json(silent=True) or {}
    start_time = (data.get("start_time") or "").strip() or None
    end_time = (data.get("end_time") or "").strip() or None
    for value in (start_time, end_time):
        if value is not None and time_to_minutes(value) is None:
            return jsonify({"error": f"Invalid time: {value}"}), 400

    try:
        break_minutes = parse_duration(data.get("break"))
        tips = float(data.get("tips") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid break or tips"}), 400
    if tips < 0:
        return jsonify({"error": "Tips cannot be negative"}), 400

    is_off = bool(data.get("is_off"))
    notes = (data.get("notes") or "").strip()[:500]
    if is_off:
        start_time = end_time = None
        break_minutes = 0

    save_shift(
        session["user_id"],
        parsed_day.isoformat(),
        is_off,
        start_time,
        end_time,
        break_minutes,
        tips,
        notes,
    )
    return jsonify(
        build_month_summary(session["user_id"], parsed_day.year, parsed_day.month)
    )
