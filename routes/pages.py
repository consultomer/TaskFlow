import logging
from datetime import datetime
from flask import Blueprint, render_template, redirect, url_for, session

from routes.auth import login_required
from utils.database import get_user_by_id, get_tasks_by_user, get_active_timer

pages_bp = Blueprint("pages", __name__)
logger = logging.getLogger(__name__)


@pages_bp.route("/")
@login_required
def dashboard():
    """Main dashboard page"""
    # Ensure session has is_admin set
    if "is_admin" not in session:
        user = get_user_by_id(session["user_id"])
        if user:
            session["is_admin"] = user.get("is_admin", False)

    user_id = session["user_id"]
    tasks = get_tasks_by_user(user_id)
    active_timer = get_active_timer(user_id)

    # Calculate stats - consistent with frontend logic
    total_tasks = len(tasks)
    completed_today = sum(
        1
        for t in tasks
        if t["completed"]
        and t["completed_at"]
        and datetime.fromisoformat(t["completed_at"]).date() == datetime.now().date()
    )

    total_time = sum(t["total_time"] for t in tasks)
    hours = total_time // 3600
    minutes = (total_time % 3600) // 60

    # In progress = tasks that are not completed (consistent with frontend)
    in_progress = sum(1 for t in tasks if not t["completed"])
    overdue = sum(
        1
        for t in tasks
        if not t["completed"]
        and t["due_date"]
        and datetime.fromisoformat(t["due_date"]) < datetime.now()
    )

    return render_template(
        "dashboard.html",
        tasks=tasks,
        active_timer=active_timer,
        total_tasks=total_tasks,
        completed_today=completed_today,
        hours=hours,
        minutes=minutes,
        in_progress=in_progress,
        overdue=overdue,
        username=session.get("username", "User"),
    )


@pages_bp.route("/favicon.ico")
def favicon():
    """Serve favicon or return 204 to prevent 404 errors"""
    return "", 204
