import logging
from datetime import date

from flask import Blueprint, jsonify, render_template, request, session

from routes.auth import login_required
from utils.database import create_task, get_task_by_id
from utils.planner import (
    TASK_CATEGORY,
    build_day_plan,
    build_week,
    get_routine,
    make_room,
    plan_task,
    reset_routine,
    save_applications,
    save_day_blocks,
    save_routine,
    set_block_done,
    validate_blocks,
)

planner_bp = Blueprint("planner", __name__)
logger = logging.getLogger(__name__)

INVALID_DATE = "Invalid date, expected YYYY-MM-DD"


def parse_day(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


@planner_bp.route("/planner", methods=["GET"])
@login_required
def planner_page():
    """Daily planner page"""
    day = parse_day(request.args.get("day")) or date.today()
    view = request.args.get("view")
    if view not in ("day", "week", "routine"):
        view = "day"
    return render_template(
        "planner.html",
        day=day.isoformat(),
        today=date.today().isoformat(),
        view=view,
        username=session.get("username", "User"),
    )


@planner_bp.route("/api/planner/day/<day>", methods=["GET"])
@login_required
def get_day(day):
    parsed = parse_day(day)
    if not parsed:
        return jsonify({"error": INVALID_DATE}), 400
    return jsonify(build_day_plan(session["user_id"], parsed))


@planner_bp.route("/api/planner/day/<day>/blocks", methods=["PUT", "DELETE"])
@login_required
def update_day_blocks(day):
    """PUT stores an edited copy of this day; DELETE goes back to the routine."""
    parsed = parse_day(day)
    if not parsed:
        return jsonify({"error": INVALID_DATE}), 400
    if request.method == "DELETE":
        save_day_blocks(session["user_id"], parsed.isoformat(), None)
    else:
        try:
            blocks = validate_blocks((request.get_json(silent=True) or {}).get("blocks"))
        except ValueError as err:
            return jsonify({"error": str(err)}), 400
        save_day_blocks(session["user_id"], parsed.isoformat(), make_room(blocks))
    return jsonify(build_day_plan(session["user_id"], parsed))


@planner_bp.route("/api/planner/day/<day>/done", methods=["PUT"])
@login_required
def update_done(day):
    parsed = parse_day(day)
    data = request.get_json(silent=True) or {}
    block_id = str(data.get("block_id") or "")[:40]
    if not parsed or not block_id:
        return jsonify({"error": "Invalid request"}), 400
    set_block_done(session["user_id"], parsed.isoformat(), block_id, bool(data.get("done")))
    return jsonify(build_day_plan(session["user_id"], parsed))


@planner_bp.route("/api/planner/day/<day>/applications", methods=["PUT"])
@login_required
def update_applications(day):
    parsed = parse_day(day)
    if not parsed:
        return jsonify({"error": INVALID_DATE}), 400
    try:
        count = int((request.get_json(silent=True) or {}).get("count"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid count"}), 400
    if not 0 <= count <= 999:
        return jsonify({"error": "Count must be between 0 and 999"}), 400
    save_applications(session["user_id"], parsed.isoformat(), count)
    return jsonify(build_day_plan(session["user_id"], parsed))


@planner_bp.route("/api/planner/day/<day>/tasks", methods=["POST"])
@login_required
def add_block_task(day):
    """Create a TaskFlow task inside a block of this day."""
    parsed = parse_day(day)
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()[:200]
    block_id = str(data.get("block_id") or "")[:40]
    if not parsed or not name or not block_id:
        return jsonify({"error": "Task name and block are required"}), 400

    task = create_task(
        user_id=session["user_id"],
        name=name,
        category=TASK_CATEGORY.get(data.get("category"), "general"),
        due_date=parsed.isoformat(),
    )
    if not task:
        return jsonify({"error": "Failed to create task"}), 500
    plan_task(session["user_id"], task["id"], parsed.isoformat(), block_id)
    return jsonify(build_day_plan(session["user_id"], parsed)), 201


@planner_bp.route("/api/planner/tasks/<int:task_id>", methods=["PUT"])
@login_required
def move_task(task_id):
    """Plan an existing task into a block (block_id null takes it out of the block)."""
    data = request.get_json(silent=True) or {}
    parsed = parse_day(data.get("day"))
    if not parsed:
        return jsonify({"error": INVALID_DATE}), 400
    if not get_task_by_id(session["user_id"], task_id):
        return jsonify({"error": "Task not found"}), 404
    block_id = str(data.get("block_id") or "")[:40] or None
    plan_task(session["user_id"], task_id, parsed.isoformat(), block_id)
    return jsonify(build_day_plan(session["user_id"], parsed))


@planner_bp.route("/api/planner/week/<day>", methods=["GET"])
@login_required
def get_week(day):
    parsed = parse_day(day)
    if not parsed:
        return jsonify({"error": INVALID_DATE}), 400
    return jsonify(build_week(session["user_id"], parsed))


@planner_bp.route("/api/planner/routine", methods=["GET"])
@login_required
def get_full_routine():
    return jsonify({"days": [get_routine(session["user_id"], wd) for wd in range(7)]})


@planner_bp.route("/api/planner/routine/<int:weekday>", methods=["PUT", "DELETE"])
@login_required
def update_routine(weekday):
    """PUT saves one weekday's routine; DELETE restores the default for it."""
    if not 0 <= weekday <= 6:
        return jsonify({"error": "Weekday must be 0 (Mon) to 6 (Sun)"}), 400
    if request.method == "DELETE":
        reset_routine(session["user_id"], weekday)
    else:
        try:
            blocks = validate_blocks((request.get_json(silent=True) or {}).get("blocks"))
        except ValueError as err:
            return jsonify({"error": str(err)}), 400
        save_routine(session["user_id"], weekday, blocks)
    return jsonify({"days": [get_routine(session["user_id"], wd) for wd in range(7)]})
