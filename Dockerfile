FROM python:3.11-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Create logs dir (used by scheduler health file)
RUN mkdir -p /app/logs

EXPOSE 8000

# Migrate then start API
CMD python scripts/migrate.py && \
    uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --log-level info
