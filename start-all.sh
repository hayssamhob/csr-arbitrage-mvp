#!/bin/bash
# Start all CSR Arbitrage Monitoring services

echo "🚀 Starting CSR Arbitrage Monitoring System..."
echo ""

# Kill any existing processes on our ports
echo "Cleaning up existing processes..."
pkill -f "ts-node-dev" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true
kill "$(lsof -t -i:3001 2>/dev/null)" 2>/dev/null || true
kill "$(lsof -t -i:3002 2>/dev/null)" 2>/dev/null || true
kill "$(lsof -t -i:3003 2>/dev/null)" 2>/dev/null || true
kill "$(lsof -t -i:8001 2>/dev/null)" 2>/dev/null || true
kill "$(lsof -t -i:5173 2>/dev/null)" 2>/dev/null || true
kill "$(lsof -t -i:8080 2>/dev/null)" 2>/dev/null || true
sleep 2

# Start LBank Gateway
echo "📊 Starting LBank Gateway (port 3001)..."
cd "$(dirname "$0")/services/lbank-gateway" && npm run dev &
LBANK_PID=$!
sleep 3

# Start Uniswap Quote Service (CSR25)
echo "Starting Uniswap Quote Service (CSR25)..."
cd services/uniswap-quote || exit 1
npm run dev &
UNISWAP_PID=$!
cd ../..

# Start Uniswap Quote Service (CSR)
echo "Starting Uniswap Quote Service (CSR)..."
cd services/uniswap-quote-csr || exit 1
npm run dev &
UNISWAP_CSR_PID=$!
cd ../..

# Start Strategy Engine
echo "🧠 Starting Strategy Engine (port 3003)..."
cd "$(dirname "$0")/services/strategy" && npm run dev &
STRATEGY_PID=$!
sleep 3

# Start Backend API
echo "🔌 Starting Backend API (port 8001)..."
cd "$(dirname "$0")/backend" || exit 1
if [ ! -d "node_modules" ]; then
    npm install
fi
npm run dev &
API_PID=$!
sleep 2

# Start Frontend
echo "🖥️  Starting Frontend (port 5173)..."
cd "$(dirname "$0")/frontend" || exit 1 && npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ All services started!"
echo ""
echo "📍 Access the dashboard at: http://localhost:5173"
echo ""
echo "Services:"
echo "  - LBank Gateway:       http://localhost:3001"
echo "  - Uniswap Quote (CSR25): http://localhost:3002"
echo "  - Uniswap Quote (CSR):  http://localhost:3005"
echo "  - Strategy Engine:     http://localhost:3003"
echo "  - Backend API:         http://localhost:8001"
echo "  - Frontend:            http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for Ctrl+C
trap 'echo "Stopping all services..."; kill $LBANK_PID $UNISWAP_PID $UNISWAP_CSR_PID $STRATEGY_PID $API_PID $FRONTEND_PID 2>/dev/null; exit' INT
wait
