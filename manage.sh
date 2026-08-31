#!/bin/bash

# Colors for beautiful output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get absolute path of the project root
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

show_menu() {
    clear
    echo -e "${CYAN}=========================================${NC}"
    echo -e "${CYAN}       🚀 PROJECT COMMAND CENTER        ${NC}"
    echo -e "${CYAN}=========================================${NC}"
    echo -e "${BLUE}[1]${NC} Start Development (Backend + Frontend)"
    echo -e "${BLUE}[2]${NC} Stop Everything"
    echo -e "${BLUE}[3]${NC} Run Backend Unit Tests"
    echo -e "${BLUE}[4]${NC} Run Frontend E2E Tests"
    echo -e "${BLUE}[5]${NC} Check System Status"
    echo -e "${BLUE}[6]${NC} Start Backend Only"
    echo -e "${BLUE}[7]${NC} Start Frontend Only"
    echo -e "${BLUE}[8]${NC} First-Time Setup (install deps + migrate DB)"
    echo -e "${BLUE}[9]${NC} Set User Role (client/staff/admin)"
    echo -e "${BLUE}[10]${NC} Reset Database ${RED}(⚠️  deletes all data)${NC}"
    echo -e "${BLUE}[11]${NC} Exit"
    echo -e "${CYAN}=========================================${NC}"
}

# start_service <Name> <dir> <port> — checks the port is free, backgrounds
# `npm run dev` in <dir>, writes its PID to <dir>/<dir-basename>.pid.
start_service() {
    local name="$1" dir="$2" port="$3"
    if lsof -i:"$port" >/dev/null 2>&1; then
        echo -e "${RED}❌ Port $port is already in use${NC}"
        return 1
    fi
    echo -e "${BLUE}▶ Starting $name...${NC}"
    (cd "$ROOT_DIR/$dir" && npm run dev) &
    echo $! > "$ROOT_DIR/$dir/$dir.pid"
}

start_all() {
    echo -e "\n${YELLOW}Starting full stack environment...${NC}"
    start_service "Backend" backend 3000

    # Wait a moment for backend to initialize
    sleep 3

    start_service "Frontend" frontend 5173

    echo -e "\n${GREEN}✅ Both services are launching!${NC}"
    echo "Keep this terminal open or run './manage.sh' to manage them."
}

stop_all() {
    echo -e "\n${YELLOW}Stopping all services...${NC}"

    # 1. Kill Backend via Port 3000 (The most reliable way)
    echo -e "${BLUE}▶ Cleaning up Backend (Port 3000)...${NC}"
    PID_3000=$(lsof -t -i:3000)
    if [ -n "$PID_3000" ]; then
        echo "Killing processes on port 3000: $PID_3000"
        kill -9 $PID_3000 2>/dev/null
        echo -e "${GREEN}✅ Backend port cleared.${NC}"
    else
        echo "No process found on port 3000."
    fi

    # 2. Kill Frontend via Port 5173
    echo -e "${BLUE}▶ Cleaning up Frontend (Port 5173)...${NC}"
    PID_5173=$(lsof -t -i:5173)
    if [ -n "$PID_5173" ]; then
        echo "Killing processes on port 5173: $PID_5173"
        kill -9 $PID_5173 2>/dev/null
        echo -e "${GREEN}✅ Frontend port cleared.${NC}"
    else
        echo "No process found on port 5173."
    fi

    # 3. Clean up PID files
    rm -f "$ROOT_DIR/backend/backend.pid"
    rm -f "$ROOT_DIR/frontend/frontend.pid"
    echo -e "${GREEN}✅ Cleanup complete.${NC}"
}

start_backend_only() {
    echo -e "\n${YELLOW}Starting Backend only...${NC}"
    start_service "Backend" backend 3000 || return 1
    echo -e "${GREEN}✅ Backend started on Port 3000${NC}"
    echo "Keep this terminal open or run './manage.sh' to stop it."
}

start_frontend_only() {
    echo -e "\n${YELLOW}Starting Frontend only...${NC}"
    start_service "Frontend" frontend 5173 || return 1
    echo -e "${GREEN}✅ Frontend started on Port 5173${NC}"
    echo "Keep this terminal open or run './manage.sh' to stop it."
}

run_unit_tests() {
    echo -e "\n${YELLOW}Running Backend Unit Tests...${NC}"
    cd "$ROOT_DIR/backend" && npm test || {
        echo -e "${RED}❌ Unit tests failed${NC}"
        return 1
    }
    echo -e "${GREEN}✅ Unit tests completed successfully${NC}"
}

run_e2e_tests() {
    echo -e "\n${YELLOW}Running Frontend E2E Tests...${NC}"
    cd "$ROOT_DIR/frontend" && npm run test:e2e || {
        echo -e "${RED}❌ E2E tests failed${NC}"
        return 1
    }
    echo -e "${GREEN}✅ E2E tests completed successfully${NC}"
}

check_status() {
    echo -e "\n${CYAN}--- System Status ---${NC}"
    if lsof -i:3000 >/dev/null 2>&1; then
        echo -e "Backend:  ${GREEN}RUNNING (Port 3000)${NC}"
    else
        echo -e "Backend:  ${RED}STOPPED${NC}"
    fi

    if lsof -i:5173 >/dev/null 2>&1; then
        echo -e "Frontend: ${GREEN}RUNNING (Port 5173)${NC}"
    else
        echo -e "Frontend: ${RED}STOPPED${NC}"
    fi
    echo -e "${CYAN}-------------------------------${NC}"
    echo -e "PID Files:"
    if [ -f "$ROOT_DIR/backend/backend.pid" ]; then
        echo -e "  Backend PID:  $(cat "$ROOT_DIR/backend/backend.pid")"
    else
        echo -e "  Backend PID:  ${RED}Not found${NC}"
    fi
    if [ -f "$ROOT_DIR/frontend/frontend.pid" ]; then
        echo -e "  Frontend PID: $(cat "$ROOT_DIR/frontend/frontend.pid")"
    else
        echo -e "  Frontend PID: ${RED}Not found${NC}"
    fi
}

first_time_setup() {
    echo -e "\n${YELLOW}Running first-time setup...${NC}"
    (cd "$ROOT_DIR/backend" && npm install) || return 1
    (cd "$ROOT_DIR/frontend" && npm install) || return 1
    echo -e "${BLUE}▶ Applying database migrations...${NC}"
    (cd "$ROOT_DIR/backend" && npx prisma migrate deploy) || return 1
    git -C "$ROOT_DIR" config core.hooksPath .githooks
    echo -e "${GREEN}✅ Setup complete. Run option 1 to start the app.${NC}"
}

set_user_role() {
    echo -e "\n${YELLOW}Set a user's role${NC}"
    read -p "User email: " email
    read -p "Role (client/staff/admin): " role
    (cd "$ROOT_DIR/backend" && node scripts/set-role.js "$email" "$role")
}

reset_database() {
    echo -e "\n${RED}⚠️  This deletes ALL data in backend/dev.db and re-applies migrations.${NC}"
    read -p "Type 'yes' to confirm: " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Cancelled."
        return 0
    fi
    (cd "$ROOT_DIR/backend" && npx prisma migrate reset --force) || return 1
    echo -e "${GREEN}✅ Database reset to a fresh, empty state.${NC}"
}

# Main loop
while true; do
    show_menu
    read -p "Select an option [1-11]: " opt
    case $opt in
        1) start_all ;;
        2) stop_all ;;
        3) run_unit_tests ;;
        4) run_e2e_tests ;;
        5) check_status ;;
        6) start_backend_only ;;
        7) start_frontend_only ;;
        8) first_time_setup ;;
        9) set_user_role ;;
        10) reset_database ;;
        11) echo "Goodbye!"; exit 0 ;;
        *) echo -e "${RED}Invalid option.${NC}" ;;
    esac
    echo -e "\nPress [Enter] to return to menu..."
    read
done
