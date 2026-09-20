# UniversalRagPlatform

UniversalRagPlatform is a general-purpose RAG knowledge-base platform built with FastAPI, React, PostgreSQL, Redis, and a pluggable vector-store/provider layer.

## Quick start with Docker Compose

Prerequisite: Docker Desktop with Linux containers enabled.

```powershell
docker compose up --build -d
```

The first startup builds both application images, starts PostgreSQL and Redis, runs all Alembic migrations, and then starts the backend and frontend.

- Web UI: http://localhost:8080
- Backend API: http://localhost:18080/api/v1
- API documentation: http://localhost:18080/docs
- Health endpoint: http://localhost:18080/api/v1/health

Useful commands:

```powershell
# Follow application logs
docker compose logs -f backend frontend

# Show service status
docker compose ps

# Stop the stack without deleting data
docker compose down

# Stop the stack and delete local database/storage volumes
docker compose down -v
```

The default Compose setup uses the built-in local vector store and provider fallbacks, so external Milvus/Zilliz, embedding, LLM, reranking, and image-recognition services are optional.

To customize ports, credentials, or external providers, copy `.env.example` to `.env` and edit the values before starting the stack:

```powershell
Copy-Item .env.example .env
```

Never commit `.env`; it is intentionally ignored by Git.

## Local development

The supported Python version is recorded in `.python-version` (Python 3.11.13).

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 18080
```

Local development requires PostgreSQL and Redis matching the values in `.env`.

Run the frontend in a second terminal:

```powershell
Set-Location frontend
npm ci
npm run dev
```

The Vite development server is available at http://localhost:5180 and proxies `/api/v1` to the backend.

## Configuration

Application settings are defined in `app/core/config.py`. `.env.example` documents the supported local and Compose settings. At minimum, a non-Compose local run needs either `DATABASE_URL` or all four PostgreSQL connection values.

External provider credentials are optional in the default local configuration. When configured, keep all real tokens in `.env` only.

## Tests

Install pytest in the active development environment, then run:

```powershell
pip install pytest
pytest
```

## Project layout

```text
app/          FastAPI application
frontend/     React/Vite frontend
migrations/   Alembic database migrations
scripts/      Smoke and acceptance scripts
tests/        Backend test suite
```
