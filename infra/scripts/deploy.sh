#!/bin/bash
# ============================================
# DEX-MONIT - Deployment Script
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 DEX-MONIT Deployment Script${NC}"
echo "================================"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "Copy infra/env.template to .env and fill in the values"
    exit 1
fi

# Load environment variables
export $(cat .env | grep -v '#' | xargs)

# Function to deploy API
deploy_api() {
    echo -e "${YELLOW}📦 Building API...${NC}"
    docker build -f infra/docker/Dockerfile.api -t dex-monit-api:latest .
    
    echo -e "${YELLOW}🚀 Deploying API...${NC}"
    docker-compose -f infra/docker-compose.prod.yml up -d monitoring-api
    
    echo -e "${GREEN}✅ API deployed!${NC}"
}

# Function to deploy Web
deploy_web() {
    echo -e "${YELLOW}📦 Building Web...${NC}"
    docker build -f infra/docker/Dockerfile.web \
        --build-arg NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
        -t dex-monit-web:latest .
    
    echo -e "${YELLOW}🚀 Deploying Web...${NC}"
    docker-compose -f infra/docker-compose.prod.yml up -d monitoring-web
    
    echo -e "${GREEN}✅ Web deployed!${NC}"
}

# Function to deploy all
deploy_all() {
    echo -e "${YELLOW}📦 Building all services...${NC}"
    docker-compose -f infra/docker-compose.prod.yml build
    
    echo -e "${YELLOW}🚀 Deploying all services...${NC}"
    docker-compose -f infra/docker-compose.prod.yml up -d
    
    echo -e "${GREEN}✅ All services deployed!${NC}"
}

# Function to run database migrations
run_migrations() {
    echo -e "${YELLOW}🔄 Running database migrations...${NC}"
    docker-compose -f infra/docker-compose.prod.yml exec monitoring-api npx prisma db push
    echo -e "${GREEN}✅ Migrations completed!${NC}"
}

# Function to show logs
show_logs() {
    docker-compose -f infra/docker-compose.prod.yml logs -f
}

# Function to show status
show_status() {
    echo -e "${YELLOW}📊 Service Status:${NC}"
    docker-compose -f infra/docker-compose.prod.yml ps
}

# Main menu
case "$1" in
    api)
        deploy_api
        ;;
    web)
        deploy_web
        ;;
    all)
        deploy_all
        ;;
    migrate)
        run_migrations
        ;;
    logs)
        show_logs
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 {api|web|all|migrate|logs|status}"
        echo ""
        echo "Commands:"
        echo "  api      - Deploy only the API"
        echo "  web      - Deploy only the Web frontend"
        echo "  all      - Deploy all services"
        echo "  migrate  - Run database migrations"
        echo "  logs     - Show service logs"
        echo "  status   - Show service status"
        exit 1
        ;;
esac
