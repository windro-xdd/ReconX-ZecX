# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies either from requirements.txt or via editable install
COPY requirements.txt ./
RUN pip install --upgrade pip \
 && pip install -r requirements.txt || true

COPY pyproject.toml ./
COPY reconx ./reconx
RUN pip install -e . || true

EXPOSE 8000

CMD ["bash", "-lc", "uvicorn reconx.api.main:app --host 0.0.0.0 --port ${PORT}"]
