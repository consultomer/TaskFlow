import logging
from datetime import datetime
from flask import Blueprint, jsonify, request, session

from routes.auth import login_required
from utils.database import (
    get_task_by_id, get_active_timer, get_paused_timer, update_task
)

timer_bp = Blueprint('timer', __name__)
logger = logging.getLogger(__name__)


@timer_bp.route('/api/tasks/<int:task_id>/timer/start', methods=['POST'])
@login_required
def start_timer(task_id):
    """Start timer for a task (or resume from paused)"""
    user_id = session['user_id']

    logger.info(f"Starting timer for task {task_id} by user {session['username']}")

    # Verify task belongs to user
    task = get_task_by_id(user_id, task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404

    try:
        # Stop any active timer for this user
        active = get_active_timer(user_id)
        if active and active['id'] != task_id:
            start = datetime.fromisoformat(active['timer_start'])
            elapsed = int((datetime.now() - start).total_seconds())
            accumulated = active['accumulated_time'] + elapsed

            update_task(user_id, active['id'],
                        timer_active=False,
                        timer_start=None,
                        accumulated_time=accumulated,
                        total_time=accumulated)

        # Stop any paused timer for this user
        paused = get_paused_timer(user_id)
        if paused and paused['id'] != task_id:
            update_task(user_id, paused['id'],
                        timer_paused=False)

        # Start timer for target task
        timer_start = datetime.now().isoformat()
        updated_task = update_task(user_id, task_id,
                                   timer_active=True,
                                   timer_paused=False,
                                   timer_start=timer_start)

        logger.info(f"Timer started for task {task_id}")
        return jsonify(updated_task)

    except Exception as e:
        logger.error(f"Error starting timer: {str(e)}")
        return jsonify({'error': 'Database error'}), 500


@timer_bp.route('/api/tasks/<int:task_id>/timer/pause', methods=['POST'])
@login_required
def pause_timer(task_id):
    """Pause timer for a task (keeps accumulated time)"""
    user_id = session['user_id']

    logger.info(f"Pausing timer for task {task_id} by user {session['username']}")

    task = get_task_by_id(user_id, task_id)
    if not task or not task['timer_active']:
        return jsonify({'error': 'Task not found or timer not active'}), 404

    try:
        start = datetime.fromisoformat(task['timer_start'])
        elapsed = int((datetime.now() - start).total_seconds())
        accumulated = task['accumulated_time'] + elapsed

        updated_task = update_task(user_id, task_id,
                                   timer_active=False,
                                   timer_paused=True,
                                   timer_start=None,
                                   accumulated_time=accumulated,
                                   total_time=accumulated)

        logger.info(f"Timer paused for task {task_id}, accumulated: {accumulated}s")
        return jsonify(updated_task)

    except Exception as e:
        logger.error(f"Error pausing timer: {str(e)}")
        return jsonify({'error': 'Database error'}), 500


@timer_bp.route('/api/tasks/<int:task_id>/timer/stop', methods=['POST'])
@login_required
def stop_timer(task_id):
    """Stop timer for a task completely"""
    user_id = session['user_id']

    logger.info(f"Stopping timer for task {task_id} by user {session['username']}")

    task = get_task_by_id(user_id, task_id)
    if not task or (not task['timer_active'] and not task['timer_paused']):
        return jsonify({'error': 'Task not found or timer not active'}), 404

    try:
        if task['timer_active']:
            start = datetime.fromisoformat(task['timer_start'])
            elapsed = int((datetime.now() - start).total_seconds())
            accumulated = task['accumulated_time'] + elapsed
        else:
            accumulated = task['accumulated_time']

        updated_task = update_task(user_id, task_id,
                                   timer_active=False,
                                   timer_paused=False,
                                   timer_start=None,
                                   accumulated_time=accumulated,
                                   total_time=accumulated)

        logger.info(f"Timer stopped for task {task_id}, total: {accumulated}s")
        return jsonify(updated_task)

    except Exception as e:
        logger.error(f"Error stopping timer: {str(e)}")
        return jsonify({'error': 'Database error'}), 500


@timer_bp.route('/api/timer/current', methods=['GET'])
@login_required
def get_current_timer():
    """Get current timer state"""
    user_id = session['user_id']

    active = get_active_timer(user_id)
    if active:
        start = datetime.fromisoformat(active['timer_start'])
        elapsed = int((datetime.now() - start).total_seconds()) + active['accumulated_time']
        return jsonify({
            'task_id': active['id'],
            'task_name': active['name'],
            'elapsed': elapsed,
            'status': 'running'
        })

    # Check for paused timer
    paused = get_paused_timer(user_id)
    if paused:
        return jsonify({
            'task_id': paused['id'],
            'task_name': paused['name'],
            'elapsed': paused['accumulated_time'],
            'status': 'paused'
        })

    return jsonify({'elapsed': 0, 'status': 'stopped'})