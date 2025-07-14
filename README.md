# 🧠 Forecast Model + AI Assistant

An AI-powered financial modeling and cash flow forecasting system built with FastAPI, SQLite, and LLM integration.

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose installed
- At least 4GB of RAM (for Ollama LLM service)
- Python 3.12+ (for local development)
- Node.js 18+ (for frontend development)

### Running the Application

#### Option 1: Docker (Recommended)
1. **Clone and navigate to the project directory**
   ```bash
   cd forecasting
   ```

2. **Start all services**
   ```bash
   docker-compose up --build
   ```

3. **Access the services**
   - **React Frontend**: http://localhost:3000
   - **FastAPI Backend**: http://localhost:8000
   - **API Documentation**: http://localhost:8000/docs
   - **Ollama LLM Service**: http://localhost:11434
   - **Whisper ASR Service**: http://localhost:9000

#### Option 2: Local Development
1. **Set up Python environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r app/requirements.txt
   ```

2. **Set up frontend**
   ```bash
   ./setup_frontend.sh
   ```

3. **Start Ollama separately**
   ```bash
   docker-compose up ollama
   ```

4. **Run the backend locally**
   ```bash
   python run_local.py
   ```

5. **Run the frontend locally**
   ```bash
   cd frontend
   npm start
   ```



## 📁 Project Structure

```
forecasting/
├── app/                   # FastAPI backend
│   ├── main.py           # Main application entry point
│   ├── requirements.txt  # Python dependencies
│   ├── Dockerfile        # FastAPI container configuration
│   ├── db/               # Database models and utilities
│   ├── services/         # Business logic and transformers
│   └── api/              # Route handlers
├── frontend/             # React frontend
│   ├── src/              # React source code
│   ├── public/           # Static files
│   ├── package.json      # Node.js dependencies
│   ├── Dockerfile        # Frontend container configuration
│   └── README.md         # Frontend documentation
├── data/                 # CSV data files and database
│   ├── sales.csv         # Sales forecast data
│   ├── bom.csv           # Bill of Materials
│   ├── payroll.csv       # Payroll data
│   └── forecast.db       # SQLite database (created automatically)
├── docker-compose.yml    # Service orchestration
└── README.md            # This file
```

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/schema` | GET | Get database schema information |
| `/chat` | POST | Natural language to SQL conversion (LLM-powered) |
| `/preview_sql` | POST | Preview SQL execution without applying changes |
| `/apply_sql` | POST | Execute approved SQL transformations |
| `/agent` | POST | Interact with the LangChain agent |
| `/plan_execute` | POST | Plan with DeepSeek and execute with Llama |
| `/voice` | POST | Voice commands via Whisper and agent |
| `/load_table` | POST | Upload CSV data into a table (append or replace) |
| `/data_quality` | GET | Check for unmatched or incomplete data |
| `/forecast` | GET | Get current forecast data |
| `/recalculate` | POST | Recalculate all forecasts |
| `/forecast/create` | POST | Create new forecast via wizard |
| `/forecast/update` | POST | Update existing forecast data |
| `/forecast/delete/{table}/{id}` | DELETE | Delete forecast records |
| `/snapshot` | GET | Export database snapshot |

The `/plan_execute` endpoint lets one model plan a sequence of actions using DeepSeek while another model (Llama) executes each step. The response includes the generated plan and the results from each execution step. A LangGraph state machine coordinates planning, approval, and execution, with a human review step before any potentially destructive SQL (UPDATE, DELETE, DROP, or TRUNCATE).

## 🐳 Docker Services

### React Frontend Service (`frontend`)
- **Port**: 3000
- **Purpose**: Modern web interface for forecasting
- **Features**: Interactive dashboard, AI chat, forecasting wizard, data tables

### FastAPI Service (`fastapi`)
- **Port**: 8000
- **Purpose**: Main API backend with forecast engine
- **Features**: SQLite database, REST API endpoints, CORS support

### Ollama Service (`ollama`)
- **Port**: 11434
- **Purpose**: LLM service for natural language processing
- **Features**: Local LLM inference, model management

### Whisper Service (`whisper`)
- **Port**: 9000
- **Purpose**: Speech-to-text transcription
- **Features**: Voice input processing for AI assistant

## 📊 Sample Data

The application comes with sample data files:
- `sales.csv`: Sample sales forecast data
- `bom.csv`: Bill of Materials for cost calculation
- `payroll.csv`: Employee payroll data

## 🔄 Development Workflow

1. **Start services**: `docker-compose up --build`
2. **Make changes**: Edit files in `app/` directory
3. **Auto-reload**: FastAPI will automatically reload on changes
4. **Test endpoints**: Use the interactive docs at http://localhost:8000/docs

## 🛠️ Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 8000, 11434, and 9000 are available
2. **Memory issues**: Ollama requires significant RAM for LLM models
3. **Database issues**: Check that the `/data` volume is properly mounted

### Logs
```bash
# View all service logs
docker-compose logs

# View specific service logs
docker-compose logs fastapi
docker-compose logs ollama
docker-compose logs whisper
```

### Reset Everything
```bash
# Stop and remove all containers, networks, and volumes
docker-compose down -v

# Rebuild and start fresh
docker-compose up --build
```

## 🧠 LLM Service Features

The application now includes a powerful LLM service that integrates with Ollama to provide natural language to SQL conversion:

### Natural Language Operations
- **Price Modifications**: "Increase unit prices by 10% for all sales in 2024-01"
- **Quantity Changes**: "Decrease sales quantity by 20% for customer CUST-001 in 2024-02"
- **Cost Updates**: "Set material cost to $50 for unit PROD-001"
- **Rate Adjustments**: "Update machine rate to $200 per hour for machine MACH-001"
- **Time Modifications**: "Increase labor minutes by 15 minutes for all router steps for unit PROD-002"

### Safety Features
- **SQL Preview**: Preview SQL before execution
- **Confidence Scoring**: LLM provides confidence levels for generated SQL
- **Approval Workflow**: All modifications require explicit approval
- **Error Handling**: Comprehensive error handling and validation

### Testing
Run the test script to verify LLM functionality:
```bash
python test_llm_service.py
```

## 🎨 Frontend Features

The application now includes a comprehensive React frontend with:

### Interactive Dashboard
- **Revenue Charts**: Line and bar charts showing revenue by period, customer, and product
- **Data Tables**: Sortable tables with CRUD operations for all forecast data
- **Summary Statistics**: Key metrics and KPIs at a glance

### AI Chat Assistant
- **Multiple AI Services**: Choose between LLM, LangChain Agent, or Plan & Execute
- **Expandable Interface**: Collapsible chat panel that doesn't interfere with dashboard
- **Real-time Messaging**: Live chat with typing indicators and message history

### 6-Step Forecasting Wizard
A guided process for creating comprehensive forecasts:

1. **Revenue Forecasting**: Customer/product selection with flat or growth-based models
2. **Bill of Materials**: Material costs and routing information
3. **Labor Planning**: Employee details, hours, and rates
4. **Recurring Expenses**: Monthly, quarterly, or yearly expense planning
5. **Loan Management**: Principal, interest rates, and payment terms
6. **Non-Recurring Expenses**: One-time expense planning

### Data Management
- **CRUD Operations**: Create, read, update, and delete forecast data
- **Real-time Updates**: Changes reflect immediately in charts and tables
- **Data Validation**: Form validation and error handling
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## 🔮 Next Steps

1. **Advanced Forecasting Models**: Add more sophisticated financial modeling algorithms
2. **Data Import/Export**: Implement CSV import/export functionality with validation
3. **Model Fine-tuning**: Customize LLM for specific forecasting scenarios
4. **User Management**: Add authentication and user-specific forecasts
5. **Advanced Analytics**: Add predictive analytics and trend analysis
6. **Integration**: Connect with external financial data sources

## 📝 License

This project is for educational and development purposes. 