# TaskFlow - Focus Dashboard

A modern task management and time tracking dashboard with authentication, built with Flask and SQLite.

![TaskFlow Dashboard](https://img.shields.io/badge/Flask-3.1-blue) ![Python](https://img.shields.io/badge/Python-3.12-blue) ![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

- 🔐 **Secure Authentication** - Login/registration with session-based auth
- 📊 **Task Management** - Create, edit, delete, and organize tasks by category
- ⏱️ **Focus Timer** - Start, pause, resume, and stop with accurate time tracking
- 📈 **Productivity Stats** - Real-time statistics and progress tracking
- 🏷️ **Categories** - Organize tasks by Design, Development, Review, or Bugs
- 📱 **Responsive Design** - Works on desktop, tablet, and mobile
- 💾 **SQLite Database** - Persistent data storage with user isolation
- 👥 **Multi-user Support** - Each user has their own isolated task data
- 👑 **Admin Panel** - User management with role-based access control

---

## 🚀 Quick Start

### Option 1: Docker (Recommended for Production)

```bash
# Clone and navigate to project
cd TaskFlow

# Copy environment file
cp .env.example .env

# Edit .env with your settings
nano .env

# Build and run with Docker Compose
docker compose up -d

# Visit http://localhost:5001
```

### Option 2: Local Development

```bash
# Install dependencies with uv
uv sync

# Copy environment file
cp .env.example .env

# Run the app
python main.py

# Visit http://localhost:5001
```

---

## 📋 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Project Structure](#-project-structure)
- [Development Setup](#-development-setup)
- [Production Deployment](#-production-deployment)
  - [Docker Deployment](#-docker-deployment)
  - [Systemd + Nginx Deployment](#-systemd--nginx-deployment)
- [API Endpoints](#-api-endpoints)
- [Environment Variables](#-environment-variables)
- [Database Schema](#-database-schema)
- [Security Features](#-security-features)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

---

## 📁 Project Structure

```
TaskFlow/
├── app.py                  # Flask app configuration & startup
├── main.py                 # Application entry point
├── Dockerfile              # Docker build instructions
├── docker-compose.yml      # Docker Compose configuration
├── .env                    # Environment variables (DO NOT COMMIT)
├── .env.example            # Environment template
├── .dockerignore           # Docker ignore rules
├── .gitignore              # Git ignore rules
├── pyproject.toml          # Project dependencies (uv)
├── uv.lock                 # Dependency lock file
├── start_production.sh     # Production startup script
├── taskflow.service        # Systemd service template
├── nginx.conf              # Nginx configuration template
│
├── routes/                 # Flask blueprints
│   ├── __init__.py         # Blueprint exports
│   ├── auth.py             # Authentication routes
│   ├── pages.py            # Page routes
│   ├── tasks.py            # Task API routes
│   ├── timer.py            # Timer API routes
│   ├── user.py             # User profile routes
│   └── admin.py            # Admin panel routes
│
├── templates/              # Jinja2 templates
│   ├── dashboard.html      # Main dashboard
│   ├── login.html          # Login page
│   ├── register.html       # Registration page
│   └── logout_warning.html # Logout confirmation
│
├── static/                 # Static assets
│   ├── css/
│   │   ├── style.css       # Main styles
│   │   └── auth.css        # Auth page styles
│   └── js/
│       └── app.js          # Client-side logic
│
└── utils/                  # Utility modules
    ├── __init__.py         # Package init
    └── database.py         # SQLite database operations
```

---

## 💻 Development Setup

### Prerequisites

- Python 3.12+
- [uv](https://github.com/astral-sh/uv) package manager

### Installation

```bash
# 1. Clone the repository
git clone <repository-url>
cd TaskFlow

# 2. Install dependencies
uv sync

# 3. Configure environment
cp .env.example .env

# 4. Edit .env (use development settings)
# HOST=127.0.0.1
# FLASK_DEBUG=1

# 5. Run the application
python main.py

# 6. Visit http://localhost:5001
```

### Default Credentials

After first run, an admin user is created automatically:
- **Username:** `admin`
- **Password:** `admin1234` (from `.env`)

**⚠️ Change these immediately in production!**

---

## 🌐 Production Deployment

### Option 1: Docker Deployment (Recommended)

#### Quick Start with Docker

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with production values

# 2. Build and run
docker compose up -d

# 3. Check logs
docker compose logs -f

# 4. Visit http://your-domain:5001
```

#### Docker Compose Configuration

The `docker-compose.yml` file includes:
- **App service** with Gunicorn WSGI server
- **Volume mount** for database persistence (`db_data`)
- **Restart policy** (`unless-stopped`)
- **Health check** for container monitoring

#### Production Docker Setup

```bash
# 1. Create production .env
cat > .env << EOF
SECRET_KEY=your-super-secret-key-here
FLASK_ENV=production
FLASK_DEBUG=0
DATABASE_PATH=/app/data/tasks.db
HOST=0.0.0.0
PORT=5001
DOMAIN=maloomatech.com
REGISTRATION_TOKEN=your-secure-token
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
EOF

# 2. Build image
docker compose build

# 3. Run in detached mode
docker compose up -d

# 4. View running containers
docker ps

# 5. Check logs
docker compose logs -f taskflow
```

#### Docker with Nginx Reverse Proxy

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: taskflow
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - db_data:/app/data
    expose:
      - "5001"
    networks:
      - app-network

  nginx:
    image: nginx:alpine
    container_name: taskflow-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    depends_on:
      - web
    networks:
      - app-network

volumes:
  db_data:
    driver: local

networks:
  app-network:
    driver: bridge
```

Run with production config:

```bash
docker compose -f docker-compose.prod.yml up -d
```

#### SSL with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot

# Get SSL certificate
sudo certbot certonly --webroot \
  -w /var/www/certbot \
  -d maloomatech.com \
  -d www.maloomatech.com

# Update nginx.conf with SSL paths (see nginx.conf template)

# Restart containers
docker compose -f docker-compose.prod.yml up -d
```

---

### Option 2: Systemd + Nginx Deployment

#### 1. Upload Project to Server

```bash
scp -r TaskFlow user@your-server:/opt/
```

#### 2. Server Setup (Ubuntu/Debian)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y python3 python3-pip nginx certbot python3-certbot-nginx

# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh
```

#### 3. Configure Environment

```bash
cd /opt/TaskFlow

# Edit .env for production
nano .env

# Should contain:
# SECRET_KEY=your-super-secret-key
# FLASK_ENV=production
# FLASK_DEBUG=0
# HOST=0.0.0.0
# PORT=5001
# DOMAIN=maloomatech.com
```

#### 4. Install Dependencies

```bash
uv sync
```

#### 5. Setup Systemd Service

```bash
# Edit paths in taskflow.service
sudo cp taskflow.service /etc/systemd/system/taskflow.service

# Reload systemd
sudo systemctl daemon-reload

# Enable and start service
sudo systemctl enable taskflow
sudo systemctl start taskflow

# Check status
sudo systemctl status taskflow
```

#### 6. Setup Nginx

```bash
# Edit nginx.conf with correct paths
sudo cp nginx.conf /etc/nginx/sites-available/taskflow

# Enable site
sudo ln -s /etc/nginx/sites-available/taskflow /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

#### 7. Setup SSL (Let's Encrypt)

```bash
sudo certbot --nginx -d maloomatech.com -d www.maloomatech.com

# Auto-renewal is configured automatically
```

---

## 🔌 API Endpoints

All API endpoints require authentication (session-based cookies).

### Tasks API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks` | Get all tasks for current user |
| `POST` | `/api/tasks` | Create a new task |
| `PUT` | `/api/tasks/<id>` | Update a task |
| `DELETE` | `/api/tasks/<id>/delete` | Delete a task |
| `POST` | `/api/tasks/<id>/complete` | Toggle task completion |

**Create Task Example:**
```bash
curl -X POST http://localhost:5001/api/tasks \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<your-session-cookie>" \
  -d '{
    "name": "New Task",
    "description": "Task details",
    "category": "dev",
    "due_date": "2024-12-31"
  }'
```

### Timer API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/timer/current` | Get current timer state |
| `POST` | `/api/tasks/<id>/timer/start` | Start/resume timer |
| `POST` | `/api/tasks/<id>/timer/pause` | Pause timer |
| `POST` | `/api/tasks/<id>/timer/stop` | Stop timer completely |

### User API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/user/profile` | Get current user profile |

### Admin API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/users` | List all users |
| `POST` | `/api/admin/users` | Create new user |
| `PUT` | `/api/users/<id>` | Update user |
| `DELETE` | `/api/users/<id>` | Delete user |
| `PUT` | `/api/users/<id>/password` | Change user password |

---

## ⚙️ Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SECRET_KEY` | Flask session secret key | - | ✅ Yes |
| `FLASK_ENV` | Environment (`development`/`production`) | `development` | - |
| `FLASK_DEBUG` | Enable debug mode (`0`/`1`) | `1` | - |
| `DATABASE_PATH` | SQLite database file path | `tasks.db` | - |
| `HOST` | Server bind address | `127.0.0.1` | - |
| `PORT` | Server port | `5001` | - |
| `DOMAIN` | Domain name for production | - | - |
| `REGISTRATION_TOKEN` | Token required for registration | - | - |
| `ADMIN_USERNAME` | Default admin username | `admin` | - |
| `ADMIN_PASSWORD` | Default admin password | `admin1234` | - |

---

## 🗄️ Database Schema

### Users Table

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT 0,
    registration_token TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tasks Table

```sql
CREATE TABLE tasks (
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
);
```

---

## 🔒 Security Features

- ✅ Password hashing with Werkzeug (bcrypt)
- ✅ Session-based authentication with secure cookies
- ✅ Login required decorator for all API routes
- ✅ User data isolation (users only see their own tasks)
- ✅ Admin role-based access control
- ✅ Registration token protection
- ✅ CSRF protection via Flask sessions
- ✅ Environment variables for sensitive configuration
- ✅ SQLite WAL mode for better concurrency

---

## 🐛 Troubleshooting

### Database Issues

```bash
# Reset database (WARNING: deletes all data)
rm tasks.db

# Restart the application
python main.py
```

### Authentication Issues

- Ensure `SECRET_KEY` is set in `.env`
- Clear browser cookies if session issues occur
- Check that `FLASK_DEBUG=0` in production

### Docker Issues

```bash
# View container logs
docker compose logs taskflow

# Restart container
docker compose restart

# Rebuild image
docker compose build --no-cache
```

### Port Already in Use

```bash
# Change PORT in .env to a different value
# Or find and kill the process:
lsof -i :5001
kill -9 <PID>
```

### Domain Not Working

- Ensure `HOST=0.0.0.0` in `.env` for production
- Check DNS settings point to server IP
- Verify firewall allows traffic on port 5001 (or 80/443 with Nginx)
- Check Nginx error logs: `sudo tail -f /var/log/nginx/error.log`

---

## 📝 License

MIT License - Feel free to use and modify!

---

## 🆘 Support

For issues or questions, please create an issue on GitHub.

---

## 🙏 Acknowledgments

- [Flask](https://flask.palletsprojects.com/) - Web framework
- [SQLite](https://www.sqlite.org/) - Database
- [uv](https://github.com/astral-sh/uv) - Python package manager
- [Tabler Icons](https://tabler.io/icons) - Icon library
- [Tailwind CSS](https://tailwindcss.com/) - CSS framework
