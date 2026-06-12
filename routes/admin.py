import logging
from flask import Blueprint, jsonify, request, session

from routes.auth import admin_required
from utils.database import (
    get_all_users,
    update_user,
    delete_user,
    change_user_password,
    get_user_by_username,
    create_user,
)
from werkzeug.security import generate_password_hash

admin_bp = Blueprint("admin", __name__)
logger = logging.getLogger(__name__)


@admin_bp.route("/api/users", methods=["GET"])
@admin_required
def list_users():
    """List all users (admin only)"""
    users = get_all_users()
    logger.info(f"Admin {session['username']} listed all users")
    return jsonify(users)


@admin_bp.route("/api/users/<int:user_id>", methods=["PUT"])
@admin_required
def update_user_api(user_id):
    """Update a user (admin only)"""
    data = request.json

    # Prevent admin from removing their own admin status
    if user_id == session["user_id"] and "is_admin" in data and not data["is_admin"]:
        return jsonify({"error": "Cannot remove your own admin privileges"}), 400

    updated_user = update_user(user_id, **data)
    if updated_user:
        logger.info(f"Admin {session['username']} updated user {user_id}")
        return jsonify(updated_user)

    return jsonify({"error": "User not found"}), 404


@admin_bp.route("/api/users/<int:user_id>", methods=["DELETE"])
@admin_required
def delete_user_api(user_id):
    """Delete a user (admin only)"""
    # Prevent admin from deleting themselves
    if user_id == session["user_id"]:
        return jsonify({"error": "Cannot delete your own account"}), 400

    success = delete_user(user_id)
    if success:
        logger.info(f"Admin {session['username']} deleted user {user_id}")
        return jsonify({"success": True})

    return jsonify({"error": "User not found"}), 404


@admin_bp.route("/api/users/<int:user_id>/password", methods=["PUT"])
@admin_required
def change_password_api(user_id):
    """Change user password (admin only)"""
    data = request.json
    new_password = data.get("password", "")

    if not new_password or len(new_password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    new_password_hash = generate_password_hash(new_password)
    success = change_user_password(user_id, new_password_hash)

    if success:
        logger.info(f"Admin {session['username']} changed password for user {user_id}")
        return jsonify({"success": True})

    return jsonify({"error": "User not found"}), 404


@admin_bp.route("/api/admin/users", methods=["POST"])
@admin_required
def admin_create_user():
    """Create a new user (admin only)"""
    data = request.json
    username = data.get("username", "").strip()
    password = data.get("password", "")
    is_admin = data.get("is_admin", False)

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    # Check if username exists
    existing_user = get_user_by_username(username)
    if existing_user:
        return jsonify({"error": "Username already exists"}), 400

    password_hash = generate_password_hash(password)
    user = create_user(username, password_hash, is_admin=is_admin)

    if user:
        logger.info(f"Admin {session['username']} created user {username}")
        return jsonify(user), 201

    return jsonify({"error": "Failed to create user"}), 500
