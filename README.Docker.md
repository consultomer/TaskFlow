# TaskFlow

A modern, self-hosted task management and time-tracking dashboard with authentication, built with **Flask** and **SQLite**.

![Python](https://img.shields.io/badge/Python-3.12-blue) ![Flask](https://img.shields.io/badge/Flask-3.1-blue) ![License](https://img.shields.io/badge/License-MIT-green)

## Features

- 🔐 Secure, session-based authentication (login/registration)
- 📊 Task management with categories (Design, Development, Review, Bugs)
- ⏱️ Focus timer — start, pause, resume, and stop with accurate time tracking
- 📈 Real-time productivity stats
- 👥 Multi-user support with per-user data isolation
- 👑 Admin panel with role-based access control
- 💾 SQLite storage that persists across container restarts via a volume

## Quick Start

### Run with `docker run`

```bash
docker run -d \
  --name taskflow \
  -p 5001:5001 \
  -e SECRET_KEY=change-this-to-a-random-secret \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=change-this-password \
  -v taskflow_data:/app/data \
  consultomer/taskflow:latest
```

Then open **http://localhost:5001**.

### Run with Docker Compose

```yaml
services:
  web:
    image: consultomer/taskflow:latest
    container_name: taskflow
    ports:
      - "5001:5001"
    environment:
      - SECRET_KEY=change-this-to-a-random-secret
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=change-this-password
    volumes:
      - taskflow_data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5001/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

volumes:
  taskflow_data:
    driver: local
```

```bash
docker compose up -d
```

You can also use an env file instead of inline `environment:` values — see [Environment Variables](#environment-variables) below.

## Default Admin Account

On first startup, if no admin user exists, one is created automatically from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (defaults: `admin` / `admin1234`).

**⚠️ Set a strong `ADMIN_PASSWORD` and `SECRET_KEY` before exposing this container to the internet.**

## Environment Variables

| Variable | Description | Default | Required |
|---|---|---|---|
| `SECRET_KEY` | Flask session signing key | — | ✅ Yes |
| `ADMIN_USERNAME` | Username for the auto-created admin account | `admin` | — |
| `ADMIN_PASSWORD` | Password for the auto-created admin account | `admin1234` | — |
| `REGISTRATION_TOKEN` | If set, required to self-register a new account; leave empty for open registration | — | — |
| `DATABASE_PATH` | Path to the SQLite database file inside the container | `/app/data/tasks.db` | — |
| `HOST` | Bind address inside the container | `0.0.0.0` | — |
| `PORT` | Port the app listens on inside the container | `5001` | — |
| `DOMAIN` | Domain name, used when running behind a reverse proxy | — | — |
| `FLASK_ENV` | `development` or `production` | `production` | — |
| `FLASK_DEBUG` | Enable Flask debug mode (`0`/`1`) — keep `0` in production | `0` | — |

## Volumes

| Container Path | Purpose |
|---|---|
| `/app/data` | SQLite database storage — mount a volume here so tasks and users survive container restarts/upgrades |

## Ports

| Port | Description |
|---|---|
| `5001` | HTTP — served by Gunicorn |

## Health Check

The image serves `GET /` for basic liveness checks, used by the built-in Docker `HEALTHCHECK`/Compose `healthcheck`.

## Reverse Proxy / HTTPS

This image serves plain HTTP on port 5001. For production deployments over HTTPS, put it behind a reverse proxy (e.g. Nginx, Caddy, Traefik) that terminates TLS and forwards to the container.

## Tags

| Tag | Description |
|---|---|
| `latest` | Most recent build from the `main` branch |

## Source

Source code, issue tracker, and full documentation: see the project repository.

## License

MIT License.
