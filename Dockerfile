# ---- Build Stage ----
FROM python:3.12-slim AS builder

WORKDIR /app

# Install uv for fast dependency resolution
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy project files
COPY . .

# Create virtual environment and install dependencies
RUN uv venv && \
    . .venv/bin/activate && \
    uv sync --frozen

# ---- Runtime Stage ----
FROM python:3.12-slim

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code (exclude via .dockerignore)
COPY app.py main.py ./
COPY routes/ routes/
COPY static/ static/
COPY templates/ templates/
COPY utils/ utils/

# Copy env file if available, otherwise create empty
COPY .env.example .env

# Create volume mount for database persistence
VOLUME ["/app/data"]

EXPOSE 5001

ENV DATABASE_PATH=/app/data/tasks.db
ENV HOST=0.0.0.0
ENV PORT=5001

# Use gunicorn for production
CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--workers", "4", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "--log-level", "info", "app:app"]
