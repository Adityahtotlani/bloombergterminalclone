#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Bloomberg Terminal Dashboard ==="
echo ""

# --- Backend setup ---
echo "[1/4] Setting up Python backend..."
cd "$ROOT/backend"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt
deactivate

# --- Frontend setup ---
echo "[2/4] Setting up Node frontend..."
cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
  npm install --silent
fi

# --- Launch both ---
echo "[3/4] Starting backend on http://localhost:8000 ..."
cd "$ROOT/backend"
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
deactivate

echo "[4/4] Starting frontend on http://localhost:5173 ..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

cleanup() {
  echo ""
  echo "Stopping servers..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
  echo "Done."
}
trap cleanup INT TERM

wait $BACKEND_PID $FRONTEND_PID
