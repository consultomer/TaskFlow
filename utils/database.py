import sqlite3
import os
import logging
from datetime import datetime
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Get database path from env
DATABASE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), os.getenv("DATABASE_PATH", "tasks.db")
)

logger.info(f"Database path configured: {DATABASE_PATH}")


def get_db_connection():
    """Get a database connection with row factory"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")  # Better concurrency
        conn.execute("PRAGMA synchronous=NORMAL")  # Balance safety and performance
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        raise


def init_admin_user():
    """Ensure an admin user exists. Creates default admin if none found."""
    from werkzeug.security import generate_password_hash

    admin_username = os.getenv("ADMIN_USERNAME", "admin")
    admin_password = os.getenv("ADMIN_PASSWORD", "admin123")

    # Check if any admin user already exists
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE is_admin = 1 LIMIT 1")
        existing_admin = cursor.fetchone()

        if existing_admin:
            logger.info(f"Admin user already exists (id: {existing_admin['id']})")
            return None

        # No admin found — create default admin user
        logger.info(f"Creating default admin user: {admin_username}")
        cursor.execute("SELECT id FROM users WHERE username = ?", (admin_username,))
        existing_user = cursor.fetchone()

        if existing_user:
            # User exists but is not admin — promote to admin
            cursor.execute("UPDATE users SET is_admin = 1 WHERE username = ?", (admin_username,))
            conn.commit()
            logger.info(f"Promoted existing user '{admin_username}' to admin")
            return {"id": existing_user["id"], "username": admin_username, "is_admin": True}

        # Create new admin user
        password_hash = generate_password_hash(admin_password)
        cursor.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
            (admin_username, password_hash, True),
        )
        conn.commit()
        admin_id = cursor.lastrowid
        logger.info(f"Default admin user created: {admin_username} (id: {admin_id})")
        return {"id": admin_id, "username": admin_username, "is_admin": True}

    except Exception as e:
        logger.error(f"Failed to initialize admin user: {e}")
        if conn:
            conn.rollback()
        return None
    finally:
        if conn:
            conn.close()


def init_db():
    """Initialize database tables"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Create users table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT 0,
                registration_token TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migrate existing users table if needed (add is_admin and registration_token columns)
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0")
            logger.info("Added is_admin column to users table")
        except sqlite3.OperationalError:
            pass  # Column already exists
            
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN registration_token TEXT")
            logger.info("Added registration_token column to users table")
        except sqlite3.OperationalError:
            pass  # Column already exists

        # Create tasks table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                category TEXT DEFAULT 'general',
                due_date TEXT,
                completed BOOLEAN DEFAULT 0,
                completed_at TEXT,
                timer_active BOOLEAN DEFAULT 0,
                timer_paused BOOLEAN DEFAULT 0,
                timer_start TEXT,
                accumulated_time INTEGER DEFAULT 0,
                total_time INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        """)

        # Migrate existing tasks table if needed (add description column)
        try:
            cursor.execute("ALTER TABLE tasks ADD COLUMN description TEXT DEFAULT ''")
            logger.info("Added description column to tasks table")
        except sqlite3.OperationalError:
            pass  # Column already exists

        # Create index for faster queries
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks (user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks (completed)")

        conn.commit()
        logger.info("Database initialized successfully")
        conn.close()
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


def create_user(username, password_hash, is_admin=False, registration_token=None):
    """Create a new user"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute(
            "INSERT INTO users (username, password_hash, is_admin, registration_token) VALUES (?, ?, ?, ?)", 
            (username, password_hash, is_admin, registration_token)
        )
        conn.commit()
        user_id = cursor.lastrowid
        logger.info(f"User created: {username} (id: {user_id})")
        return {"id": user_id, "username": username, "is_admin": is_admin}
    except sqlite3.IntegrityError as e:
        logger.warning(f"Username already exists: {username}")
        return None
    except Exception as e:
        logger.error(f"Failed to create user {username}: {e}")
        if conn:
            conn.rollback()
        return None
    finally:
        if conn:
            conn.close()


def get_user_by_username(username):
    """Get user by username"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()
        return dict(user) if user else None
    except Exception as e:
        logger.error(f"Failed to get user {username}: {e}")
        return None
    finally:
        if conn:
            conn.close()


def get_user_by_id(user_id):
    """Get user by ID (without password hash)"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, is_admin, created_at FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        return dict(user) if user else None
    except Exception as e:
        logger.error(f"Failed to get user by id {user_id}: {e}")
        return None
    finally:
        if conn:
            conn.close()


def get_all_users():
    """Get all users (for admin)"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC")
        users = cursor.fetchall()
        return [dict(user) for user in users]
    except Exception as e:
        logger.error(f"Failed to get all users: {e}")
        return []
    finally:
        if conn:
            conn.close()


def update_user(user_id, **kwargs):
    """Update a user (for admin)"""
    allowed_fields = ["username", "is_admin"]
    
    # Filter allowed fields
    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}
    
    if not updates:
        logger.warning(f"No valid fields to update for user {user_id}")
        return None
    
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Build UPDATE query
        set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
        values = list(updates.values()) + [user_id]
        
        cursor.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
        conn.commit()
        
        if cursor.rowcount == 0:
            logger.warning(f"No user found to update: id={user_id}")
            return None
        
        cursor.execute("SELECT id, username, is_admin, created_at FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        
        if user:
            logger.info(f"User updated: {user_id}")
            return dict(user)
        else:
            logger.error(f"User not found after update: {user_id}")
            return None
            
    except Exception as e:
        logger.error(f"Failed to update user {user_id}: {e}")
        if conn:
            conn.rollback()
        return None
    finally:
        if conn:
            conn.close()


def delete_user(user_id):
    """Delete a user (for admin)"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        
        if deleted:
            logger.info(f"User deleted: {user_id}")
        else:
            logger.warning(f"User not found for deletion: {user_id}")
            
        return deleted
    except Exception as e:
        logger.error(f"Failed to delete user {user_id}: {e}")
        if conn:
            conn.rollback()
        return False
    finally:
        if conn:
            conn.close()


def change_user_password(user_id, new_password_hash):
    """Change user password (for admin)"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_password_hash, user_id))
        conn.commit()
        
        if cursor.rowcount == 0:
            logger.warning(f"No user found to change password: id={user_id}")
            return False
        
        logger.info(f"Password changed for user: {user_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to change password for user {user_id}: {e}")
        if conn:
            conn.rollback()
        return False
    finally:
        if conn:
            conn.close()


def get_user_with_password(user_id):
    """Get user by ID (with password hash for verification)"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        return dict(user) if user else None
    except Exception as e:
        logger.error(f"Failed to get user by id {user_id}: {e}")
        return None
    finally:
        if conn:
            conn.close()


def create_task(user_id, name, category="general", due_date=None, description=""):
    """Create a new task"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO tasks (user_id, name, description, category, due_date)
            VALUES (?, ?, ?, ?, ?)
        """,
            (user_id, name, description or '', category, due_date),
        )

        conn.commit()
        task_id = cursor.lastrowid

        # Get the created task
        cursor.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        task = cursor.fetchone()
        
        if task:
            logger.info(f"Task created: {name} (id: {task_id}, user: {user_id})")
            return dict(task)
        else:
            logger.error(f"Task creation failed for user {user_id}")
            return None
            
    except Exception as e:
        logger.error(f"Failed to create task: {e}")
        if conn:
            conn.rollback()
        return None
    finally:
        if conn:
            conn.close()


def get_tasks_by_user(user_id):
    """Get all tasks for a user"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
        tasks = cursor.fetchall()
        result = [dict(task) for task in tasks]
        logger.debug(f"Retrieved {len(result)} tasks for user {user_id}")
        return result
    except Exception as e:
        logger.error(f"Failed to get tasks for user {user_id}: {e}")
        return []
    finally:
        if conn:
            conn.close()


def get_task_by_id(user_id, task_id):
    """Get a specific task by ID (ensure it belongs to the user)"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        task = cursor.fetchone()
        return dict(task) if task else None
    except Exception as e:
        logger.error(f"Failed to get task {task_id} for user {user_id}: {e}")
        return None
    finally:
        if conn:
            conn.close()


def update_task(user_id, task_id, **kwargs):
    """Update a task"""
    allowed_fields = [
        "name",
        "description",
        "category",
        "due_date",
        "completed",
        "completed_at",
        "timer_active",
        "timer_paused",
        "timer_start",
        "accumulated_time",
        "total_time",
    ]

    # Filter allowed fields
    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}

    if not updates:
        logger.warning(f"No valid fields to update for task {task_id}")
        return None

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Build UPDATE query
        set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
        values = list(updates.values()) + [task_id, user_id]

        cursor.execute(f"UPDATE tasks SET {set_clause} WHERE id = ? AND user_id = ?", values)
        conn.commit()

        # Check if any row was updated
        if cursor.rowcount == 0:
            logger.warning(f"No task found to update: id={task_id}, user={user_id}")
            return None

        # Get updated task
        cursor.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        task = cursor.fetchone()
        
        if task:
            logger.info(f"Task updated: {task_id} (user: {user_id})")
            return dict(task)
        else:
            logger.error(f"Task not found after update: {task_id}")
            return None
            
    except Exception as e:
        logger.error(f"Failed to update task {task_id}: {e}")
        if conn:
            conn.rollback()
        return None
    finally:
        if conn:
            conn.close()


def delete_task(user_id, task_id):
    """Delete a task (ensure it belongs to the user)"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        deleted = cursor.rowcount > 0
        conn.commit()
        
        if deleted:
            logger.info(f"Task deleted: {task_id} (user: {user_id})")
        else:
            logger.warning(f"Task not found for deletion: {task_id} (user: {user_id})")
            
        return deleted
    except Exception as e:
        logger.error(f"Failed to delete task {task_id}: {e}")
        if conn:
            conn.rollback()
        return False
    finally:
        if conn:
            conn.close()


def get_active_timer(user_id):
    """Get the active timer for a user"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks WHERE user_id = ? AND timer_active = 1", (user_id,))
        task = cursor.fetchone()
        return dict(task) if task else None
    except Exception as e:
        logger.error(f"Failed to get active timer for user {user_id}: {e}")
        return None
    finally:
        if conn:
            conn.close()


def get_paused_timer(user_id):
    """Get the paused timer for a user"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks WHERE user_id = ? AND timer_paused = 1", (user_id,))
        task = cursor.fetchone()
        return dict(task) if task else None
    except Exception as e:
        logger.error(f"Failed to get paused timer for user {user_id}: {e}")
        return None
    finally:
        if conn:
            conn.close()


def migrate_json_to_sqlite(json_file_path):
    """Migrate data from tasks.json to SQLite (one-time use)"""
    import json

    if not os.path.exists(json_file_path):
        print(f"JSON file not found: {json_file_path}")
        return False

    try:
        with open(json_file_path, "r") as f:
            tasks_data = json.load(f)
    except Exception as e:
        print(f"Failed to read JSON file: {e}")
        return False

    if not tasks_data:
        print("No tasks to migrate")
        return False

    # Create a default admin user if not exists
    from werkzeug.security import generate_password_hash

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Check if admin user exists
        cursor.execute("SELECT id FROM users WHERE username = ?", ("admin",))
        admin = cursor.fetchone()

        if not admin:
            cursor.execute(
                "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
                ("admin", generate_password_hash("changeme"), 1),
            )
            admin_id = cursor.lastrowid
            print("Created default admin user: admin / changeme")
        else:
            admin_id = admin["id"]
            # Ensure existing admin user is admin
            cursor.execute("UPDATE users SET is_admin = 1 WHERE username = ?", ("admin",))

        # Migrate tasks
        migrated_count = 0
        for task in tasks_data:
            try:
                cursor.execute(
                    """
                    INSERT INTO tasks (user_id, name, description, category, due_date, completed, completed_at,
                                      timer_active, timer_paused, timer_start, accumulated_time, total_time, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        admin_id,
                        task.get("name", ""),
                        task.get("description", ""),
                        task.get("category", "general"),
                        task.get("due_date"),
                        1 if task.get("completed") else 0,
                        task.get("completed_at"),
                        1 if task.get("timer_active") else 0,
                        0,  # timer_paused (new field)
                        task.get("timer_start"),
                        task.get("accumulated_time", 0),
                        task.get("total_time", 0),
                        task.get("created_at"),
                    ),
                )
                migrated_count += 1
            except Exception as e:
                print(f"Error migrating task {task.get('id')}: {e}")

        conn.commit()
        print(f"Migrated {migrated_count} tasks to SQLite")
        return migrated_count > 0
        
    except Exception as e:
        print(f"Migration failed: {e}")
        if conn:
            conn.rollback()
        return False
    finally:
        if conn:
            conn.close()
