from routes.auth import auth_bp
from routes.pages import pages_bp
from routes.tasks import tasks_bp
from routes.timer import timer_bp
from routes.user import user_bp
from routes.admin import admin_bp

__all__ = ["auth_bp", "pages_bp", "tasks_bp", "timer_bp", "user_bp", "admin_bp"]
