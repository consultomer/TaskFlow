#!/bin/bash
# Production startup script for maloomatech.com

# Load environment variables
export $(grep -v '^#' .env | xargs)

echo "🚀 Starting TaskFlow for ${DOMAIN:-maloomatech.com}..."
echo "📡 Binding to ${HOST:-0.0.0.0}:${PORT:-5001}"
echo ""

# Start with gunicorn for production
gunicorn \
    --bind ${HOST:-0.0.0.0}:${PORT:-5001} \
    --workers 4 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    --log-level info \
    app:app
