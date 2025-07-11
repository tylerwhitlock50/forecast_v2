# 🧠 Forecast Model + AI Assistant — Technical Specification

## Overview
This document outlines the architecture, components, and key functionality of the AI Forecasting System. The goal is to provide an interactive, LLM-powered tool for financial modeling, cash flow forecasting, and scenario planning.

---

## 🧱 Architecture Overview

### Folder Structure
```
/project-root
│
├── app/                   # FastAPI backend
│   ├── main.py
│   ├── db/                # SQLite models + utils
│   ├── services/          # Business logic, transformers, and recalc
│   └── api/               # Route handlers
│
├── data/                  # CSV import/export for forecasts
│   ├── sales.csv
│   ├── bom.csv
│   ├── payroll.csv
│   └── ...
│
├── frontend/              # React frontend (form input, dashboards)
│   └── ...
│
├── models/                # LLM integration (e.g., LLaMA via Ollama)
│   └── assistant_chain.py (LangChain logic + tool calling)
│
├── docker-compose.yml     # Defines FastAPI, SQLite, Ollama, Whisper
└── README.md
```

---

## 🔑 Core Features

### Forecast Engine
- **Inputs**:
  - Sales records
  - BOM (Bill of Materials)
  - Payroll data
  - SG&A / Fixed cost tables
  - One-time expenses
- **Processing**:
  - Data transformation and scenario modeling
  - Cost allocation logic
  - Forecast income statements and cash flows
- **Outputs**:
  - Forecasted income statement
  - Gross margin by product/brand
  - Optional: Cash flow projection via pseudo-journal entries

### AI Assistant (LLM)
- **Modes**:
  - Text-based input (React frontend)
  - Voice input via Whisper
- **Capabilities**:
  - Tool calling with LangChain
  - Table modification suggestions
  - Scenario modeling
  - Review and approval loop

### SQLite Forecast Engine
- Lightweight and auditable
- SQL-driven transformations
- Versioned snapshots supported

---

## 🖥️ Frontend Features (React)

| Page | Description |
|------|-------------|
| Revenue Input | Add/edit sales forecast by SKU, customer, period |
| COGS Config | Manage BOMs and machine/labor assignments |
| SG&A / Payroll | Recurring and one-time costs input forms |
| Review & Approve | AI suggestions and audit review steps |
| Dashboard | Visualize forecasts, margin, cash flow |
| Quick Forms | Modals for adding standard forecast blocks |

---

## 🔁 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/chat` | POST | Accepts natural language input and returns SQL and explanation |
| `/apply_sql` | POST | Applies user-approved SQL transformation |
| `/forecast` | GET | Returns computed forecast state |
| `/recalculate` | POST | Re-runs all SQL to recalculate outputs |
| `/snapshot` | GET | Exports current SQLite DB file |

---

## 🔩 Tech Stack

| Component | Tech |
|----------|------|
| Backend | FastAPI, SQLAlchemy, SQLite |
| LLMs | LangChain + LLaMA 3.1 via Ollama |
| Voice Input | Whisper API (Dockerized) |
| Frontend | React (modals, dashboards) |
| DevOps | Docker Compose |

---

## 🐳 Docker Services

```yaml
services:
  fastapi:
    build: ./app
    ports: ["8000:8000"]
    volumes: ["./data:/data"]

  whisper:
    image: ghcr.io/openai/whisper-asr
    ports: ["9000:9000"]

  ollama:
    image: ollama/ollama
    volumes: ["./models:/models"]
```

---

## 📦 Scenario Management

- Forecast snapshots stored as `.sqlite` files
- Versions exportable for historical comparison
- Scenarios driven by natural language or quick forms

---

## ✅ Approval Workflow
- LLM generates SQL statements
- SQL preview + explanation returned to user
- User manually approves before execution
- Full recalculation run and updated forecast shown

---

## Future Extensions
- Real cash forecasting with journal entry simulation
- Integration with cloud DB or NetSuite connector
- Support for multiple scenarios and A/B comparisons
