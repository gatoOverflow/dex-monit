# ==============================================================================
# DEX-MONIT - Makefile
# ==============================================================================
#
# Usage:
#   make dev          - Start full stack locally (all services in Docker)
#   make dev-apps     - Start only API + Web (use external databases)
#   make prod         - Build and start production containers
#   make prod-apps    - Production mode, apps only (external databases)
#
# ==============================================================================

.PHONY: help dev dev-apps dev-db prod prod-apps build clean logs ps stop restart

# Default target
help:
	@echo ""
	@echo "DEX-MONIT - Available commands:"
	@echo ""
	@echo "  Development:"
	@echo "    make dev          Start full stack (all services in Docker)"
	@echo "    make dev-apps     Start only API + Web (external databases)"
	@echo "    make dev-db       Start only databases (PostgreSQL, ClickHouse, Redis)"
	@echo ""
	@echo "  Production:"
	@echo "    make prod         Build and start all services for production"
	@echo "    make prod-apps    Build and start only API + Web (external databases)"
	@echo ""
	@echo "  Management:"
	@echo "    make build        Build Docker images"
	@echo "    make stop         Stop all containers"
	@echo "    make restart      Restart all containers"
	@echo "    make clean        Stop and remove containers, volumes, images"
	@echo "    make logs         View logs (all services)"
	@echo "    make logs-api     View API logs"
	@echo "    make logs-web     View Web logs"
	@echo "    make ps           List running containers"
	@echo ""
	@echo "  Database:"
	@echo "    make db-migrate   Run Prisma migrations"
	@echo "    make db-studio    Open Prisma Studio"
	@echo "    make db-reset     Reset database (WARNING: deletes all data)"
	@echo ""
	@echo "  Configuration:"
	@echo "    make env          Create .env file from template"
	@echo "    make env-prod     Create production .env file"
	@echo ""

# ==============================================================================
# DEVELOPMENT
# ==============================================================================

# Start everything locally (full stack)
dev:
	@echo "Starting full development stack..."
	docker-compose up --build

# Start only databases
dev-db:
	@echo "Starting databases only..."
	docker-compose up -d postgres clickhouse redis
	@echo ""
	@echo "Databases running:"
	@echo "  PostgreSQL: localhost:5432"
	@echo "  ClickHouse: localhost:8123"
	@echo "  Redis:      localhost:6379"

# Start only API + Web (for external databases)
dev-apps:
	@echo "Starting API and Web only..."
	@echo "Make sure your .env file is configured with external database URLs"
	docker-compose up --build api web

# ==============================================================================
# PRODUCTION
# ==============================================================================

# Build and start all services for production
prod:
	@echo "Building and starting production stack..."
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
	@echo ""
	@echo "Production stack running:"
	@echo "  API: http://localhost:3000"
	@echo "  Web: http://localhost:4200"

# Production - apps only (external databases)
prod-apps:
	@echo "Building and starting production apps only..."
	@echo "Make sure your .env file is configured with external database URLs"
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d api web

# ==============================================================================
# BUILD & MANAGEMENT
# ==============================================================================

# Build images
build:
	@echo "Building Docker images..."
	docker-compose build

# Stop all containers
stop:
	@echo "Stopping all containers..."
	docker-compose down

# Restart containers
restart: stop dev

# Clean everything (containers, volumes, images)
clean:
	@echo "Cleaning up..."
	docker-compose down -v --rmi local
	@echo "Cleanup complete"

# View logs
logs:
	docker-compose logs -f

logs-api:
	docker-compose logs -f api

logs-web:
	docker-compose logs -f web

logs-db:
	docker-compose logs -f postgres clickhouse redis

# List containers
ps:
	docker-compose ps

# ==============================================================================
# DATABASE
# ==============================================================================

# Run Prisma migrations
db-migrate:
	@echo "Running database migrations..."
	docker-compose exec api npx prisma db push

# Open Prisma Studio
db-studio:
	@echo "Opening Prisma Studio..."
	cd packages/monitoring-api && npx prisma studio

# Reset database (WARNING: deletes all data)
db-reset:
	@echo "WARNING: This will delete all data!"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	docker-compose down -v
	docker-compose up -d postgres
	sleep 5
	docker-compose exec api npx prisma db push --force-reset

# ==============================================================================
# CONFIGURATION
# ==============================================================================

# Create .env from template
env:
	@if [ -f .env ]; then \
		echo ".env already exists. Remove it first or edit manually."; \
	else \
		cp infra/env.template .env; \
		echo ".env created from template. Edit it with your configuration."; \
	fi

# Create production .env
env-prod:
	@echo "Creating production .env file..."
	@echo "# Production Environment" > .env.prod
	@echo "NODE_ENV=production" >> .env.prod
	@echo "" >> .env.prod
	@echo "# API Configuration" >> .env.prod
	@echo "API_PORT=3000" >> .env.prod
	@echo "JWT_SECRET=CHANGE_THIS_TO_A_SECURE_SECRET_MIN_32_CHARS" >> .env.prod
	@echo "JWT_EXPIRES_IN=7d" >> .env.prod
	@echo "" >> .env.prod
	@echo "# PostgreSQL (external)" >> .env.prod
	@echo "DATABASE_URL=postgresql://user:password@your-postgres-host:5432/dex_monitoring" >> .env.prod
	@echo "" >> .env.prod
	@echo "# ClickHouse (external)" >> .env.prod
	@echo "CLICKHOUSE_ENABLED=true" >> .env.prod
	@echo "CLICKHOUSE_HOST=your-clickhouse-host" >> .env.prod
	@echo "CLICKHOUSE_PORT=8443" >> .env.prod
	@echo "CLICKHOUSE_DATABASE=dex_monitoring" >> .env.prod
	@echo "CLICKHOUSE_USER=default" >> .env.prod
	@echo "CLICKHOUSE_PASSWORD=your-password" >> .env.prod
	@echo "CLICKHOUSE_PROTOCOL=https" >> .env.prod
	@echo "" >> .env.prod
	@echo "# Redis (external)" >> .env.prod
	@echo "REDIS_ENABLED=true" >> .env.prod
	@echo "REDIS_HOST=your-redis-host" >> .env.prod
	@echo "REDIS_PORT=6379" >> .env.prod
	@echo "REDIS_PASSWORD=your-password" >> .env.prod
	@echo "" >> .env.prod
	@echo "# Frontend" >> .env.prod
	@echo "NEXT_PUBLIC_API_URL=https://api.your-domain.com/api" >> .env.prod
	@echo "NEXT_PUBLIC_REGISTRATION_ENABLED=false" >> .env.prod
	@echo ""
	@echo ".env.prod created. Edit it with your production configuration."

# ==============================================================================
# HEALTH CHECKS
# ==============================================================================

# Check health of all services
health:
	@echo "Checking services health..."
	@echo ""
	@echo "API:"
	@curl -s http://localhost:3000/api/health || echo "  Not running"
	@echo ""
	@echo "PostgreSQL:"
	@docker-compose exec -T postgres pg_isready -U dex -d dex_monitoring || echo "  Not running"
	@echo ""
	@echo "ClickHouse:"
	@curl -s http://localhost:8123/ping || echo "  Not running"
	@echo ""
	@echo "Redis:"
	@docker-compose exec -T redis redis-cli ping || echo "  Not running"
