# Logcraft AI

A full-stack application with a FastAPI backend and Next.js frontend, containerized with Docker.

## System Design

![System Design](./Workflow.png)

## Repository

[https://github.com/niravpatidar37/logcraft-ai](https://github.com/niravpatidar37/logcraft-ai)

## Project Structure

```bash
logcraft-ai/
├── .github/
│   └── workflows/
│       ├── ci.yml              # PR checks
│       ├── release.yml         # Main branch build
│       └── security.yml        # Scheduled scans
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── services/
│   │   └── dependencies/
│   ├── alembic/                # Migrations
│   ├── tests/
│   ├── Dockerfile
│   ├── pyproject.toml
│   └── requirements.txt
├── frontend/
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── public/
│   ├── tests/
│   ├── Dockerfile
│   ├── next.config.js
│   └── package.json
├── docker-compose.yml
├── docker-compose.prod.yml
├── prometheus/
│   └── prometheus.yml
├── grafana/
│   └── dashboards/
├── .env.example
├── Makefile
└── README.md
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Make (optional, for convenience commands)

### Running the Application

1.  Copy `.env.example` to `.env`:
    ```bash
    cp .env.example .env
    ```

2.  Build and start the containers:
    ```bash
    make up
    # OR
    docker-compose up --build
    ```

3.  Access the services:
    - Frontend: http://localhost:3000
    - Backend API: http://localhost:8000/docs
    - Prometheus: http://localhost:9090

## Manual Execution (Local)

If you don't have Docker, you can run locally:

1.  **Backend**:
    ```bash
    cd backend
    uv run uvicorn app.main:app --reload
    ```

2.  **Frontend**:
    ```bash
    cd frontend
    npm run dev
    ```