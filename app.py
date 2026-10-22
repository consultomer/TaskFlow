import os
import hashlib
import logging
from functools import lru_cache
from flask import Flask
from dotenv import load_dotenv

from utils.database import init_db, init_admin_user, DATABASE_PATH, migrate_json_to_sqlite
from routes import auth_bp, pages_bp, tasks_bp, timer_bp, user_bp, admin_bp, minijob_bp, planner_bp

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "fallback-secret-key-change-in-production")


@lru_cache(maxsize=256)
def _static_version(path, _mtime):
    # _mtime is only part of the cache key, so an edited file gets a new hash
    with open(path, "rb") as f:
        return hashlib.md5(f.read(), usedforsecurity=False).hexdigest()[:10]


@app.url_defaults
def static_cache_busting(endpoint, values):
    """Add ?v=<content hash> to static URLs so browsers fetch new JS/CSS after a deploy."""
    if endpoint != "static" or "filename" not in values:
        return
    path = os.path.join(app.static_folder, values["filename"])
    if os.path.isfile(path):
        values["v"] = _static_version(path, os.path.getmtime(path))


# Domain configuration for production
DOMAIN = os.getenv("DOMAIN", "")
if DOMAIN:
    app.config["SERVER_NAME"] = DOMAIN

# Register Blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(pages_bp)
app.register_blueprint(tasks_bp)
app.register_blueprint(timer_bp)
app.register_blueprint(user_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(minijob_bp)
app.register_blueprint(planner_bp)


if __name__ == "__main__":
    # Initialize database on startup (for development)
    init_db()
    logger.info(f"Database initialized at: {DATABASE_PATH}")

    # Ensure admin user exists
    admin = init_admin_user()
    if admin:
        logger.info(f"Default admin user ready: {admin['username']}")

    # Auto-migrate from JSON if tasks.json exists
    json_file = os.path.join(os.path.dirname(__file__), "tasks.json")
    if os.path.exists(json_file):
        print("\n" + "=" * 60)
        print("Found tasks.json, migrating to SQLite...")
        print("=" * 60)
        if migrate_json_to_sqlite(json_file):
            print("Migration complete! You can now delete tasks.json")
        else:
            print("Migration skipped or failed")
        print("=" * 60 + "\n")

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", 5001))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    domain = os.getenv("DOMAIN", "")

    print(f"\n🚀 Starting TaskFlow on http://{host}:{port}")
    if domain:
        print(f"🌐 Domain: {domain}")
    print(f"📁 Database: {DATABASE_PATH}")
    print("👤 Default user: admin / changeme")

    app.run(host=host, port=port, debug=debug)
