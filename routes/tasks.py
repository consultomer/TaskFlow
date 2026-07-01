import logging
from datetime import datetime
from flask import Blueprint, jsonify, request, session

from routes.auth import login_required
from utils.database import (
    get_tasks_by_user,
    get_task_by_id,
    create_task,
    update_task,
    delete_task,
)

tasks_bp = Blueprint("tasks", __name__)
logger = logging.getLogger(__name__)

DATABASE_ERROR = "Database error"
TASK_NOT_FOUND_ERROR = "Task not found"


@tasks_bp.route("/api/tasks", methods=["GET"])
@login_required
def get_tasks():
    """API endpoint to get all tasks for current user"""
    user_id = session["user_id"]
    tasks = get_tasks_by_user(user_id)

    # Calculate current elapsed time for active timer
    for task in tasks:
        if task["timer_active"] and task["timer_start"]:
            start = datetime.fromisoformat(task["timer_start"])
            elapsed = int((datetime.now() - start).total_seconds()) + task["accumulated_time"]
            task["current_elapsed"] = elapsed
        elif task["timer_paused"]:
            task["current_elapsed"] = task["accumulated_time"]
        else:
            task["current_elapsed"] = task["total_time"]

    logger.info(f"User {session['username']} fetched {len(tasks)} tasks")
    return jsonify(tasks)


@tasks_bp.route("/api/tasks", methods=["POST"])
@login_required
def create_task_api():
    """Create a new task"""
    user_id = session["user_id"]
    data = request.json

    logger.info(f"Creating task for user {session['username']}: {data}")

    # Validate task name
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Task name is required"}), 400

    try:
        task = create_task(
            user_id=user_id,
            name=name,
            description=data.get("description", ""),
            category=data.get("category", "general"),
            due_date=data.get("due_date"),
        )

        if task:
            logger.info(f"Task created successfully: {task['id']}")
            return jsonify(task), 201
        else:
            logger.error("Failed to create task")
            return jsonify({"error": "Failed to create task"}), 500

    except Exception:
        logger.exception("Error creating task")
        return jsonify({"error": DATABASE_ERROR}), 500


@tasks_bp.route("/api/tasks/<int:task_id>", methods=["PUT"])
@login_required
def update_task_api(task_id):
    """Update a task"""
    user_id = session["user_id"]
    data = request.json

    logger.info(f"Updating task {task_id} for user {session['username']}: {data}")

    # Verify task belongs to user
    task = get_task_by_id(user_id, task_id)
    if not task:
        return jsonify({"error": TASK_NOT_FOUND_ERROR}), 404

    # Validate name if provided
    if "name" in data:
        name = data["name"].strip()
        if not name:
            return jsonify({"error": "Task name cannot be empty"}), 400

    try:
        updated_task = update_task(user_id, task_id, **data)
        if updated_task:
            logger.info(f"Task {task_id} updated successfully")
            return jsonify(updated_task)

        return jsonify({"error": TASK_NOT_FOUND_ERROR}), 404

    except Exception:
        logger.exception("Error updating task")
        return jsonify({"error": DATABASE_ERROR}), 500


@tasks_bp.route("/api/tasks/<int:task_id>/complete", methods=["POST"])
@login_required
def toggle_complete(task_id):
    """Toggle task completion"""
    user_id = session["user_id"]

    logger.info(f"Toggling completion for task {task_id} by user {session['username']}")

    task = get_task_by_id(user_id, task_id)
    if not task:
        return jsonify({"error": TASK_NOT_FOUND_ERROR}), 404

    try:
        new_completed = not task["completed"]

        if new_completed:
            # Complete the task
            completed_at = datetime.now().isoformat()

            # Stop timer if running or paused
            if task["timer_active"]:
                start = datetime.fromisoformat(task["timer_start"])
                elapsed = int((datetime.now() - start).total_seconds())
                accumulated = task["accumulated_time"] + elapsed
                total = accumulated

                update_task(
                    user_id,
                    task_id,
                    completed=True,
                    completed_at=completed_at,
                    timer_active=False,
                    timer_paused=False,
                    timer_start=None,
                    accumulated_time=accumulated,
                    total_time=total,
                )
            elif task["timer_paused"]:
                update_task(
                    user_id, task_id, completed=True, completed_at=completed_at, timer_paused=False
                )
            else:
                update_task(user_id, task_id, completed=True, completed_at=completed_at)
        else:
            # Reopen the task
            update_task(user_id, task_id, completed=False, completed_at=None)

        updated_task = get_task_by_id(user_id, task_id)
        logger.info(f"Task {task_id} completion toggled to {new_completed}")
        return jsonify(updated_task)

    except Exception:
        logger.exception("Error toggling task completion")
        return jsonify({"error": DATABASE_ERROR}), 500


@tasks_bp.route("/api/tasks/<int:task_id>/delete", methods=["DELETE"])
@login_required
def delete_task_api(task_id):
    """Delete a task"""
    user_id = session["user_id"]

    logger.info(f"Deleting task {task_id} by user {session['username']}")

    try:
        success = delete_task(user_id, task_id)
        if success:
            logger.info(f"Task {task_id} deleted successfully")
            return jsonify({"success": True})

        return jsonify({"error": TASK_NOT_FOUND_ERROR}), 404

    except Exception:
        logger.exception("Error deleting task")
        return jsonify({"error": DATABASE_ERROR}), 500
