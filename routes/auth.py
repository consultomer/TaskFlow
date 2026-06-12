import os
import logging
from datetime import datetime
from flask import Blueprint, render_template, request, redirect, url_for, session, jsonify, abort
from werkzeug.security import check_password_hash, generate_password_hash

from utils.database import (
    get_user_by_username,
    get_user_by_id,
    create_user,
    get_active_timer,
    get_paused_timer,
)

auth_bp = Blueprint("auth", __name__)
logger = logging.getLogger(__name__)


def login_required(f):
    """Decorator to require login for a route"""
    from functools import wraps

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for("auth.login"))
        return f(*args, **kwargs)

    return decorated_function


def admin_required(f):
    """Decorator to require admin privileges for a route"""
    from functools import wraps

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for("auth.login"))

        # Check if user is admin
        user = get_user_by_id(session["user_id"])
        if not user or not user.get("is_admin"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Admin privileges required"}), 403
            abort(403)

        return f(*args, **kwargs)

    return decorated_function


def has_active_timer(user_id):
    """Check if user has an active or paused timer"""
    active = get_active_timer(user_id)
    paused = get_paused_timer(user_id)
    return active is not None or paused is not None


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    """Login page"""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if not username or not password:
            return render_template("login.html", error="Username and password are required")

        user = get_user_by_username(username)

        if user and check_password_hash(user["password_hash"], password):
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["is_admin"] = user.get("is_admin", False)
            logger.info(f"User logged in: {username}")
            return redirect(url_for("pages.dashboard"))

        return render_template("login.html", error="Invalid username or password")

    return render_template("login.html")


@auth_bp.route("/register", methods=["GET", "POST"])
@admin_required
def register():
    """Registration page with token authentication"""
    reg_token = os.getenv("REGISTRATION_TOKEN", "")

    if request.method == "POST":
        token = request.form.get("token", "")
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")

        # If registration token is set, validate it
        if reg_token and token != reg_token:
            return render_template(
                "register.html", error="Invalid registration token", reg_token_set=True
            )

        # Validation
        if not username or not password:
            return render_template(
                "register.html",
                error="Username and password are required",
                reg_token_set=bool(reg_token),
            )

        if len(username) < 3:
            return render_template(
                "register.html",
                error="Username must be at least 3 characters",
                reg_token_set=bool(reg_token),
            )

        if len(password) < 6:
            return render_template(
                "register.html",
                error="Password must be at least 6 characters",
                reg_token_set=bool(reg_token),
            )

        if password != confirm_password:
            return render_template(
                "register.html", error="Passwords do not match", reg_token_set=bool(reg_token)
            )

        # Check if username exists
        existing_user = get_user_by_username(username)
        if existing_user:
            return render_template(
                "register.html", error="Username already exists", reg_token_set=bool(reg_token)
            )

        # Create user
        password_hash = generate_password_hash(password)
        user = create_user(username, password_hash)

        if user:
            logger.info(f"New user registered: {username}")
            # Auto-login after registration
            session["user_id"] = user["id"]
            session["username"] = username
            session["is_admin"] = False
            return redirect(url_for("pages.dashboard"))

        return render_template(
            "register.html", error="Registration failed", reg_token_set=bool(reg_token)
        )

    return render_template("register.html", reg_token_set=bool(reg_token))


@auth_bp.route("/logout", methods=["GET", "POST"])
def logout():
    """Logout - check for active timers first"""
    user_id = session.get("user_id")
    username = session.get("username", "Unknown")

    # Check if user has active or paused timer
    if user_id and has_active_timer(user_id):
        if request.method == "POST":
            # Force logout on POST (confirmed)
            session.clear()
            logger.info(f"User logged out (forced): {username}")
            return redirect(url_for("auth.login"))
        else:
            # GET request - warn user
            active = get_active_timer(user_id)
            paused = get_paused_timer(user_id)

            timer_task = active["name"] if active else paused["name"] if paused else None
            timer_status = "running" if active else "paused"

            return render_template(
                "logout_warning.html", timer_task=timer_task, timer_status=timer_status
            )

    # No active timer, proceed with logout
    session.clear()
    logger.info(f"User logged out: {username}")
    return redirect(url_for("auth.login"))
