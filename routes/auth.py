import os
import logging
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

API_PREFIX = "/api/"
AUTH_LOGIN_ENDPOINT = "auth.login"
LOGIN_TEMPLATE = "login.html"
REGISTER_TEMPLATE = "register.html"


def login_required(f):
    """Decorator to require login for a route"""
    from functools import wraps

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith(API_PREFIX):
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for(AUTH_LOGIN_ENDPOINT))
        return f(*args, **kwargs)

    return decorated_function


def admin_required(f):
    """Decorator to require admin privileges for a route"""
    from functools import wraps

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith(API_PREFIX):
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for(AUTH_LOGIN_ENDPOINT))

        # Check if user is admin
        user = get_user_by_id(session["user_id"])
        if not user or not user.get("is_admin"):
            if request.path.startswith(API_PREFIX):
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
            return render_template(LOGIN_TEMPLATE, error="Username and password are required")

        user = get_user_by_username(username)

        if user and check_password_hash(user["password_hash"], password):
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["is_admin"] = user.get("is_admin", False)
            logger.info(f"User logged in: {username}")
            return redirect(url_for("pages.dashboard"))

        return render_template(LOGIN_TEMPLATE, error="Invalid username or password")

    return render_template(LOGIN_TEMPLATE)


def _render_register(reg_token, error=None):
    return render_template(REGISTER_TEMPLATE, error=error, reg_token_set=bool(reg_token))


def _validate_registration_input(username, password, confirm_password):
    """Validate registration fields; returns an error message, or None if valid."""
    if not username or not password:
        return "Username and password are required"
    if len(username) < 3:
        return "Username must be at least 3 characters"
    if len(password) < 6:
        return "Password must be at least 6 characters"
    if password != confirm_password:
        return "Passwords do not match"
    return None


@auth_bp.route("/register", methods=["GET", "POST"])
@admin_required
def register():
    """Registration page with token authentication"""
    reg_token = os.getenv("REGISTRATION_TOKEN", "")

    if request.method != "POST":
        return _render_register(reg_token)

    token = request.form.get("token", "")
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    confirm_password = request.form.get("confirm_password", "")

    # If registration token is set, validate it
    if reg_token and token != reg_token:
        return _render_register(reg_token, "Invalid registration token")

    error = _validate_registration_input(username, password, confirm_password)
    if error:
        return _render_register(reg_token, error)

    # Check if username exists
    if get_user_by_username(username):
        return _render_register(reg_token, "Username already exists")

    # Create user
    password_hash = generate_password_hash(password)
    user = create_user(username, password_hash)

    if not user:
        return _render_register(reg_token, "Registration failed")

    logger.info(f"New user registered: {username}")
    # Auto-login after registration
    session["user_id"] = user["id"]
    session["username"] = username
    session["is_admin"] = False
    return redirect(url_for("pages.dashboard"))


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
            return redirect(url_for(AUTH_LOGIN_ENDPOINT))
        else:
            # GET request - warn user
            active = get_active_timer(user_id)
            paused = get_paused_timer(user_id)

            if active:
                timer_task = active["name"]
            elif paused:
                timer_task = paused["name"]
            else:
                timer_task = None
            timer_status = "running" if active else "paused"

            return render_template(
                "logout_warning.html", timer_task=timer_task, timer_status=timer_status
            )

    # No active timer, proceed with logout
    session.clear()
    logger.info(f"User logged out: {username}")
    return redirect(url_for(AUTH_LOGIN_ENDPOINT))
