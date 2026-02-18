# ============================================================
# Stage 1: Build the React frontend
# ============================================================
FROM node:18-alpine AS frontend-build

WORKDIR /app/frontend

# Copy package files first for better caching
COPY frontend/package.json frontend/package-lock.json* ./

# Install dependencies
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Copy frontend source
COPY frontend/ ./

# Build the production bundle
RUN npm run build

# ============================================================
# Stage 2: Python backend + built frontend
# ============================================================
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libportaudio2 \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .

# Install PyTorch CPU-only first (much smaller than GPU version)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install remaining Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy instruction files and other root-level resources
COPY Instructions/ ./Instructions/
COPY Call\ History/ ./Call\ History/
COPY instructions.txt* ./
COPY frontendvisualizationtemplate.html* ./
COPY .env.example* ./

# Copy built frontend into the "static" folder that main.py expects
COPY --from=frontend-build /app/frontend/dist ./static/

# Copy frontend public assets (customer images, PDFs) into static
COPY frontend/public/ ./static/

# Expose the port used by the FastAPI server
EXPOSE 8000

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Health check for Azure Container Apps
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the FastAPI application
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
