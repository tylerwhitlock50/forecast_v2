# Forecast AI Frontend

A modern React-based interface for the AI-powered financial modeling and cash flow forecasting system.

## Features

- **Interactive Dashboard**: Charts and data visualization for forecast analysis
- **Expandable Chat Panel**: AI assistant with multiple service types (LLM, Agent, Plan & Execute)
- **6-Step Forecasting Wizard**: Guided process for creating comprehensive forecasts
- **Real-time Data Tables**: Sortable and filterable data views
- **CRUD Operations**: Create, read, update, and delete forecast data
- **Responsive Design**: Works on desktop and mobile devices

## Quick Start

### Using Docker (Recommended)

1. **From the project root, start all services:**
   ```bash
   docker-compose up --build
   ```

2. **Access the frontend:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Documentation: http://localhost:8000/docs

### Local Development

1. **Install dependencies:**
   ```bash
   cd frontend
   npm install
   ```

2. **Start the development server:**
   ```bash
   npm start
   ```

3. **Build for production:**
   ```bash
   npm run build
   ```

## Project Structure

```
frontend/
├── public/                 # Static files
│   └── index.html         # Main HTML file
├── src/                   # Source code
│   ├── components/        # React components
│   │   ├── Dashboard.js   # Main dashboard with charts
│   │   ├── ChatPanel.js   # AI chat interface
│   │   ├── DataTable.js   # Reusable data table
│   │   └── ForecastingWizard.js # 6-step wizard
│   ├── App.js            # Main application component
│   ├── index.js          # React entry point
│   └── index.css         # Global styles
├── package.json          # Dependencies and scripts
└── Dockerfile           # Docker configuration
```

## Components

### Dashboard
- **Overview Tab**: Revenue charts by period, customer, and product
- **Revenue Tab**: Detailed sales forecast data
- **Costs Tab**: Bill of materials information
- **Labor Tab**: Employee and payroll data

### Chat Panel
- **Expandable Interface**: Collapsible chat panel
- **Multiple AI Services**: 
  - Chat (LLM): Direct language model interaction
  - Agent (LangChain): Advanced agent with tools
  - Plan & Execute: Multi-step planning and execution
- **Real-time Messaging**: Live chat with typing indicators

### Forecasting Wizard
A 6-step guided process for creating comprehensive forecasts:

1. **Revenue**: Customer and product selection with flat or growth-based forecasting
2. **Bill of Materials**: Material costs and routing information
3. **Labor**: Employee details, hours, and rates
4. **Recurring Expenses**: Monthly, quarterly, or yearly expenses
5. **Loans**: Principal, interest rates, and terms
6. **Non-Recurring Expenses**: One-time expenses

### Data Table
- **Sortable Columns**: Click headers to sort data
- **Formatted Values**: Currency and number formatting
- **CRUD Operations**: Edit and delete functionality
- **Responsive Design**: Works on all screen sizes

## API Integration

The frontend communicates with the FastAPI backend through the following endpoints:

- `GET /forecast` - Get current forecast data
- `POST /forecast/create` - Create new forecast via wizard
- `POST /forecast/update` - Update existing forecast data
- `DELETE /forecast/delete/{table}/{id}` - Delete forecast records
- `GET /data/{table}` - Get table data
- `POST /chat` - LLM chat interaction
- `POST /agent` - LangChain agent interaction
- `POST /plan_execute` - Plan and execute workflow

## Styling

The application uses CSS custom properties for theming:

```css
:root {
  --primary-color: #2563eb;
  --secondary-color: #64748b;
  --success-color: #10b981;
  --warning-color: #f59e0b;
  --error-color: #ef4444;
  --background-color: #f8fafc;
  --surface-color: #ffffff;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --border-color: #e2e8f0;
}
```

## Development

### Adding New Components

1. Create the component file in `src/components/`
2. Add corresponding CSS file if needed
3. Import and use in the main App component

### Adding New API Endpoints

1. Update the API calls in the relevant components
2. Add error handling and loading states
3. Update the data flow in the parent components

### Styling Guidelines

- Use CSS custom properties for colors and spacing
- Follow the existing design system
- Ensure responsive design for mobile devices
- Use semantic HTML and accessible components

## Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure port 3000 is available
2. **API connection**: Check that the backend is running on port 8000
3. **Build errors**: Clear node_modules and reinstall dependencies
4. **Docker issues**: Rebuild the frontend container

### Development Tips

- Use React Developer Tools for debugging
- Check the browser console for API errors
- Use the Network tab to monitor API calls
- Test on different screen sizes for responsiveness

## Contributing

1. Follow the existing code style and patterns
2. Add proper error handling and loading states
3. Test on multiple browsers and devices
4. Update documentation for new features 