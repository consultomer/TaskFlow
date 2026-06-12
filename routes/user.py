import logging
from flask import Blueprint, jsonify, session

from routes.auth import login_required
from utils.database import get_user_by_id

user_bp = Blueprint('user', __name__)
logger = logging.getLogger(__name__)


@user_bp.route('/api/user/profile', methods=['GET'])
@login_required
def get_user_profile():
    """Get current user profile"""
    user = get_user_by_id(session['user_id'])
    if user:
        return jsonify({
            'id': user['id'],
            'username': user['username'],
            'is_admin': user.get('is_admin', False),
            'created_at': user['created_at']
        })
    return jsonify({'error': 'User not found'}), 404