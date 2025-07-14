#!/bin/bash

echo "🚀 Setting up Forecast AI Frontend..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js and npm are installed"

# Navigate to frontend directory
cd frontend

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Check if backend is running
echo "🔍 Checking if backend is running..."
if curl -s http://localhost:8000/ > /dev/null; then
    echo "✅ Backend is running on http://localhost:8000"
else
    echo "⚠️  Backend is not running. Please start the backend first:"
    echo "   docker-compose up fastapi"
    echo "   or"
    echo "   python run_local.py"
fi

echo ""
echo "🎉 Frontend setup complete!"
echo ""
echo "To start the frontend:"
echo "   cd frontend"
echo "   npm start"
echo ""
echo "Or use Docker:"
echo "   docker-compose up --build"
echo ""
echo "Frontend will be available at: http://localhost:3000" 