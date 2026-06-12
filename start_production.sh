#!/bin/bash
# Production startup script for maloomatech.com

# Load environment variables
export $(grep -v '^#' .env | xargs)

echo "🚀 Starting TaskFlow for ${DOMAIN:-maloomatech.com}..."
echo "📡 Binding to ${HOST:-0.0.0.0}:${PORT:-5001}"
echo ""

# Initialize database before starting gunicorn to avoid locking issues with multiple workers
echo "🛠️ Initializing database..."
python -c "from utils.database import init_db, init_admin_user; init_db(); init_admin_user()"

# Start with gunicorn for production
gunicorn \
    --bind ${HOST:-0.0.0.0}:${PORT:-5001} \
    --workers 4 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    --log-level info \
    app:app
