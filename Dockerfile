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
    uv sync

# ---- Runtime Stage ----
FROM python:3.12-slim

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/* \
    python -m venv /app/.venv

# Create virtual environment
ENV PATH="/app/.venv/bin:$PATH"

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code (exclude via .dockerignore)
COPY app.py main.py start_production.sh ./
COPY routes/ routes/
COPY static/ static/
COPY templates/ templates/
COPY utils/ utils/

# Make startup script executable
RUN chmod +x start_production.sh


# Create volume mount for database persistence
VOLUME ["/app/data"]

EXPOSE 5001

ENV DATABASE_PATH=/app/data/tasks.db
ENV HOST=0.0.0.0
ENV PORT=5001

# Use the startup script to ensure database initialization before gunicorn workers start
CMD ["./start_production.sh"]
