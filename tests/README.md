# 🧪 Testing Guide

This directory contains comprehensive tests for the Forecast Model + AI Assistant application.

## 📁 Test Structure

```
tests/
├── __init__.py              # Test package
├── conftest.py              # Pytest configuration and fixtures
├── test_api_endpoints.py    # API endpoint tests
├── test_database.py         # Database functionality tests
└── README.md               # This file
```

## 🚀 Running Tests

### Quick Start
```bash
# Run all tests
python run_tests.py

# Or use pytest directly
pytest tests/ -v
```

### Specific Test Options
```bash
# Run specific test file
python run_tests.py tests/test_api_endpoints.py

# Run specific test class
pytest tests/test_api_endpoints.py::TestAPIEndpoints -v

# Run specific test method
pytest tests/test_api_endpoints.py::TestAPIEndpoints::test_health_check -v

# Run only database tests
pytest tests/test_database.py -v

# Run only API tests
pytest tests/test_api_endpoints.py -v
```

### Test Categories
```bash
# Run only unit tests
pytest -m unit

# Run only integration tests
pytest -m integration

# Skip slow tests
pytest -m "not slow"
```

## 🧩 Test Components

### 1. API Endpoint Tests (`test_api_endpoints.py`)
Tests all FastAPI endpoints:
- ✅ Health check endpoint
- ✅ Data table endpoints (all 8 tables)
- ✅ Chat endpoint (natural language to SQL)
- ✅ SQL execution endpoint
- ✅ Forecast data endpoint
- ✅ Recalculation endpoint
- ✅ Snapshot endpoint
- ✅ API documentation endpoints

### 2. Database Tests (`test_database.py`)
Tests database functionality:
- ✅ Database initialization
- ✅ CSV data loading
- ✅ Table creation
- ✅ SQL execution (SELECT, INSERT, UPDATE)
- ✅ Error handling
- ✅ Connection management
- ✅ Path detection (local vs Docker)

### 3. Test Fixtures (`conftest.py`)
Provides test infrastructure:
- ✅ Temporary test database
- ✅ Test CSV files
- ✅ FastAPI test client
- ✅ Isolated test environment

## 🔧 Test Configuration

### Pytest Configuration (`pytest.ini`)
- **Test Discovery**: Automatically finds test files
- **Verbose Output**: Shows detailed test results
- **Markers**: Categorizes tests (unit, integration, slow)
- **Error Reporting**: Short tracebacks for readability

### Test Data
Tests use minimal, isolated test data:
- 2 customers, 2 units, 2 sales records
- Complete normalized structure
- Temporary files (cleaned up automatically)

## 📊 Test Coverage

### API Endpoints Covered
| Endpoint | Method | Test Status |
|----------|--------|-------------|
| `/` | GET | ✅ Health check |
| `/data/{table}` | GET | ✅ All 8 tables |
| `/chat` | POST | ✅ Natural language |
| `/apply_sql` | POST | ✅ SQL execution |
| `/forecast` | GET | ✅ Joined data |
| `/recalculate` | POST | ✅ Recalculation |
| `/snapshot` | GET | ✅ Database export |
| `/docs` | GET | ✅ Documentation |
| `/openapi.json` | GET | ✅ OpenAPI schema |

### Database Operations Covered
| Operation | Test Status |
|-----------|-------------|
| Database initialization | ✅ |
| Table creation | ✅ |
| CSV data loading | ✅ |
| SELECT queries | ✅ |
| INSERT operations | ✅ |
| UPDATE operations | ✅ |
| Error handling | ✅ |
| Connection management | ✅ |
| Path detection | ✅ |

## 🛠️ Test Environment

### Isolation
- **Temporary Databases**: Each test uses isolated database files
- **Clean Data**: Fresh test data for each test run
- **No Side Effects**: Tests don't affect production data

### Dependencies
- **pytest**: Test framework
- **pytest-asyncio**: Async test support
- **httpx**: HTTP client for API testing
- **tempfile**: Temporary file management

### Environment Detection
Tests automatically detect:
- **Local Development**: Uses `./data/` paths
- **Docker Environment**: Uses `/data/` paths
- **Custom Paths**: Configurable via parameters

## 🚨 Troubleshooting

### Common Issues

1. **Import Errors**
   ```bash
   # Make sure you're in the project root
   cd /path/to/forecasting
   python run_tests.py
   ```

2. **Database Path Issues**
   ```bash
   # Check if data directory exists
   ls -la data/
   
   # Create if missing
   mkdir -p data
   ```

3. **Permission Issues**
   ```bash
   # Make test runner executable
   chmod +x run_tests.py
   ```

4. **Dependency Issues**
   ```bash
   # Install test dependencies
   pip install -r app/requirements.txt
   ```

### Debug Mode
```bash
# Run with maximum verbosity
pytest tests/ -vvv --tb=long

# Run with print statements
pytest tests/ -s

# Run single test with debugger
pytest tests/test_api_endpoints.py::TestAPIEndpoints::test_health_check -s --pdb
```

## 📈 Adding New Tests

### API Test Template
```python
def test_new_endpoint(self, client: TestClient):
    """Test new endpoint"""
    response = client.get("/new-endpoint")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
```

### Database Test Template
```python
def test_new_database_operation(self, temp_db_manager):
    """Test new database operation"""
    temp_db_manager.initialize()
    result = temp_db_manager.new_operation()
    assert result["status"] == "success"
```

## 🎯 Best Practices

1. **Test Isolation**: Each test should be independent
2. **Descriptive Names**: Use clear test method names
3. **Assertion Messages**: Include helpful error messages
4. **Cleanup**: Always clean up test resources
5. **Coverage**: Test both success and error cases
6. **Documentation**: Document complex test scenarios

## 📝 Continuous Integration

Tests are designed to run in CI/CD environments:
- **Docker Compatible**: Works in containerized environments
- **No External Dependencies**: Self-contained test data
- **Fast Execution**: Optimized for quick feedback
- **Reliable Results**: Deterministic test outcomes 