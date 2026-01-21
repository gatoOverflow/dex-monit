# Dex Monitoring Platform

<div align="center">

![Dex Monit](assets/presentation.PNG)

**A powerful, open-source alternative to Sentry. Track errors, manage logs, and monitor your applications in real-time.**

[![Open Source](https://img.shields.io/badge/Open%20Source-100%25-green)](https://github.com/Denver-sn/dex-monit)
[![Self Hosted](https://img.shields.io/badge/Self--Hosted-Free-blue)](https://github.com/Denver-sn/dex-monit)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

![Platform](https://img.shields.io/badge/Platform-Node.js-green)
![Frontend](https://img.shields.io/badge/Frontend-Next.js-black)
![Backend](https://img.shields.io/badge/Backend-NestJS-red)
![Database](https://img.shields.io/badge/Database-PostgreSQL%20%7C%20ClickHouse-blue)
![Cache](https://img.shields.io/badge/Cache-Redis-orange)

[Features](#-features) • [Quick Start](#-quick-start) • [Screenshots](#-screenshots) • [SDKs](#-sdk-integration) • [Documentation](#-development)

</div>

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🐛 Error Tracking
- Real-time error capture and alerting
- Stack trace parsing with source code context
- Fingerprinting and issue grouping
- Breadcrumbs for debugging
- User context and tags

</td>
<td width="50%">

### 📝 Log Management
- Structured JSON logging
- Log levels (DEBUG, INFO, WARNING, ERROR)
- Full-text search
- Log filtering by project, environment, level

</td>
</tr>
<tr>
<td width="50%">

### 👥 Session Analytics
- Real-time active users tracking
- Session duration and page views
- Device and browser detection
- Geographic location tracking
- User journey visualization

</td>
<td width="50%">

### 🌐 HTTP Tracing
- Request/response monitoring
- Latency percentiles (P50, P95, P99)
- Error rate tracking
- Request filtering and search

</td>
</tr>
<tr>
<td width="50%">

### 🔔 Alerting System
- Custom alert rules
- Multi-channel notifications (Slack, Email, Webhook, Discord)
- Alert cooldowns
- Threshold-based triggers

</td>
<td width="50%">

### 🔒 Privacy First
- Self-hosted deployment
- Automatic PII scrubbing
- Full data control
- No third-party data sharing

</td>
</tr>
</table>

---

## 📸 Screenshots

### Dashboard
Get a complete overview of your application health with real-time metrics.

![Dashboard](assets/dahsboard-demo.PNG)

### Issue Details
Deep dive into errors with full stack traces, breadcrumbs, and context.

![Issue Details](assets/issues-demo.PNG)

### Session Analytics
Track user sessions, page views, and user journeys in real-time.

![Sessions](assets/sessions-demo.PNG)

---

## 🚀 Quick Start

### Prerequisites
- **Docker** & **Docker Compose**

### Option 1: One Command Start (Recommended)

```bash
git clone https://github.com/Denver-sn/dex-monit.git
cd dex-monit
docker-compose up --build
```

That's it! Everything starts automatically:
- PostgreSQL, ClickHouse, Redis
- Database migrations
- API and Web frontend

### Option 2: Using Make

```bash
git clone https://github.com/Denver-sn/dex-monit.git
cd dex-monit
make dev
```

### Access Your Instance

| Service | URL |
|---------|-----|
| 🌐 Frontend | http://localhost:4200 |
| ⚡ API | http://localhost:3000/api |
| 📊 Health | http://localhost:3000/api/health |

### First Steps

1. Open http://localhost:4200
2. Click **Register** to create an account
3. Create a **Project** to get an API key
4. Integrate an SDK in your application

---

## 📦 Published Packages

| Package | Description | npm |
|---------|-------------|-----|
| \`@dex-monit/observability-sdk-node\` | NestJS/Node.js SDK | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-sdk-node)](https://www.npmjs.com/package/@dex-monit/observability-sdk-node) |
| \`@dex-monit/observability-sdk-browser\` | React/Next.js SDK | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-sdk-browser)](https://www.npmjs.com/package/@dex-monit/observability-sdk-browser) |
| \`@dex-monit/observability-sdk-react-native\` | React Native/Expo SDK | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-sdk-react-native)](https://www.npmjs.com/package/@dex-monit/observability-sdk-react-native) |
| \`@dex-monit/observability-contracts\` | Shared TypeScript interfaces | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-contracts)](https://www.npmjs.com/package/@dex-monit/observability-contracts) |
| \`@dex-monit/observability-logger\` | Pino-based structured logger | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-logger)](https://www.npmjs.com/package/@dex-monit/observability-logger) |
| \`@dex-monit/observability-scrubber\` | Sensitive data scrubber | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-scrubber)](https://www.npmjs.com/package/@dex-monit/observability-scrubber) |

---

## 📱 SDK Integration

### NestJS Backend

```bash
npm install @dex-monit/observability-sdk-node
```

```typescript
// app.module.ts
import { SdkNodeModule } from '@dex-monit/observability-sdk-node';

@Module({
  imports: [
    SdkNodeModule.forRoot({
      apiKey: process.env.DEX_API_KEY,
      apiUrl: process.env.DEX_API_URL,
      environment: process.env.NODE_ENV,
      captureConsole: true,
      captureNestLogger: true,
      captureHttpRequests: true,
    }),
  ],
})
export class AppModule {}
```

### React / Next.js

```bash
npm install @dex-monit/observability-sdk-browser
```

```tsx
// app/providers.tsx
'use client';
import { DexProvider } from '@dex-monit/observability-sdk-browser/react';

export function Providers({ children }) {
  return (
    <DexProvider
      config={{
        apiKey: process.env.NEXT_PUBLIC_DEX_API_KEY!,
        apiUrl: process.env.NEXT_PUBLIC_DEX_API_URL!,
        environment: process.env.NODE_ENV,
      }}
    >
      {children}
    </DexProvider>
  );
}
```

### React Native / Expo

```bash
npm install @dex-monit/observability-sdk-react-native
npx expo install expo-device  # For device detection
```

```typescript
// App.tsx
import { init, setUser } from '@dex-monit/observability-sdk-react-native';

init({
  apiKey: 'your-api-key',
  apiUrl: 'https://your-monitoring-api.com/api',
  environment: 'production',
  debug: __DEV__,
});

// After user login
setUser({ id: user.id, email: user.email });
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SDKs                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ sdk-node    │  │ sdk-browser │  │ sdk-react-native        │  │
│  │ (NestJS)    │  │ (React/Next)│  │ (React Native/Expo)     │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          └────────────────┼─────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    monitoring-api (NestJS)                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Ingest  │ │ Issues  │ │  Logs   │ │ Traces  │ │Sessions │   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │
│       │           │           │           │           │         │
│       └───────────┴───────────┴───────────┴───────────┘         │
│                               │                                  │
│  ┌────────────────────────────┼────────────────────────────┐    │
│  │                            ▼                             │    │
│  │  ┌──────────┐  ┌───────────────┐  ┌──────────────────┐  │    │
│  │  │PostgreSQL│  │  ClickHouse   │  │      Redis       │  │    │
│  │  │ (Config) │  │ (Time-series) │  │ (Cache/Queue)    │  │    │
│  │  └──────────┘  └───────────────┘  └──────────────────┘  │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   monitoring-web (Next.js)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │Dashboard │ │  Issues  │ │   Logs   │ │ Sessions │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Development

### Project Structure

```
dex-monit/
├── packages/
│   ├── monitoring-api/          # NestJS backend
│   │   ├── src/modules/
│   │   │   ├── ingest/          # Data ingestion endpoints
│   │   │   ├── issues/          # Issue management
│   │   │   ├── logs/            # Log management
│   │   │   ├── traces/          # HTTP traces
│   │   │   ├── sessions/        # Session tracking
│   │   │   ├── alerts/          # Alert rules & notifications
│   │   │   ├── projects/        # Projects & API keys
│   │   │   ├── clickhouse/      # ClickHouse service
│   │   │   └── redis/           # Redis service
│   │   └── prisma/              # Prisma schema
│   │
│   ├── monitoring-web/          # Next.js frontend
│   │   └── src/
│   │       ├── app/             # App Router pages
│   │       ├── components/      # React components
│   │       └── lib/             # Utilities & API client
│   │
│   └── observability/           # SDK packages
│       ├── contracts/           # Shared interfaces
│       ├── sdk-node/            # NestJS SDK
│       ├── sdk-browser/         # React/Next.js SDK
│       ├── sdk-react-native/    # React Native SDK
│       ├── logger/              # Pino logger
│       └── scrubber/            # Sensitive data scrubber
│
├── assets/                      # Screenshots & images
├── docker-compose.yml           # Full stack (dev)
├── docker-compose.prod.yml      # Production overrides
├── docker-compose.apps.yml      # Apps only (external databases)
├── Dockerfile.api               # API production build
├── Dockerfile.web               # Frontend production build
├── Makefile                     # Make commands
└── nx.json                      # Nx workspace config
```

### Make Commands

```bash
make help           # Show all available commands

# Development
make dev            # Start full stack (everything in Docker)
make dev-db         # Start only databases
make dev-apps       # Start only API + Web (external databases)

# Production
make prod           # Full stack production
make prod-apps      # Apps only (external databases)

# Management
make stop           # Stop all containers
make restart        # Restart all containers
make logs           # View all logs
make logs-api       # View API logs
make logs-web       # View Web logs
make ps             # List running containers
make health         # Check health of all services
make clean          # Remove containers, volumes, images

# Database
make db-migrate     # Run Prisma migrations
make db-studio      # Open Prisma Studio
make db-reset       # Reset database (WARNING: deletes data)

# Configuration
make env            # Create .env from template
make env-prod       # Create production .env template
```

### Nx Commands

```bash
# Build all packages
npx nx run-many -t build --all

# Build specific package
npx nx build monitoring-api
npx nx build monitoring-web

# Type checking
npm run typecheck

# Linting
npm run lint
```

---

## ⚙️ Configuration

### API Environment Variables

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dex_monitoring

# ClickHouse
CLICKHOUSE_ENABLED=true
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_DATABASE=dex_monitoring
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_PROTOCOL=http

# Redis
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d

# Server
PORT=3000
NODE_ENV=development
```

### Frontend Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

---

## 🚢 Production Deployment

### Option 1: Full Stack (All in Docker)

```bash
make prod
# or
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

### Option 2: Apps Only (External Databases)

For production with managed databases (AWS RDS, ClickHouse Cloud, Redis Cloud, etc.):

```bash
# 1. Create production environment file
make env-prod
# Edit .env.prod with your external database URLs

# 2. Start apps only
docker-compose -f docker-compose.apps.yml --env-file .env.prod up --build -d
```

**Required environment variables for external databases:**

```env
# PostgreSQL (required)
DATABASE_URL=postgresql://user:pass@your-postgres-host:5432/dex_monitoring

# ClickHouse (required)
CLICKHOUSE_HOST=your-clickhouse-host
CLICKHOUSE_PORT=8443
CLICKHOUSE_PASSWORD=your-password
CLICKHOUSE_PROTOCOL=https

# Redis (required)
REDIS_HOST=your-redis-host
REDIS_PASSWORD=your-password

# JWT (required)
JWT_SECRET=your-super-secret-min-32-chars

# Frontend (required)
NEXT_PUBLIC_API_URL=https://api.your-domain.com/api
```

### Docker Build (Manual)

```bash
# Build API
docker build -f Dockerfile.api -t dex-monitoring-api .

# Build Frontend
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain.com/api \
  -t dex-monitoring-web .
```

### Health Checks

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Overall health |
| `GET /api/health/live` | Liveness probe |
| `GET /api/health/ready` | Readiness probe |

---

## 📊 Database Schema

### PostgreSQL (Configuration)
- Users, Teams, Projects
- API Keys
- Alert Rules

### ClickHouse (Time-series)
- Events (errors)
- Logs
- HTTP Traces
- Sessions & Page Views

---

## 🔐 Authentication

- **User Auth**: JWT-based with bcrypt password hashing
- **SDK Auth**: Project-scoped API keys for data ingestion

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (\`git checkout -b feature/amazing-feature\`)
3. Commit your changes (\`git commit -m 'Add amazing feature'\`)
4. Push to the branch (\`git push origin feature/amazing-feature\`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License**.

---

## 🙏 Acknowledgments

- [NestJS](https://nestjs.com/) - Backend framework
- [Next.js](https://nextjs.org/) - Frontend framework
- [ClickHouse](https://clickhouse.com/) - Time-series database
- [Prisma](https://prisma.io/) - ORM
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Nx](https://nx.dev/) - Monorepo tooling

---

<div align="center">

**[⬆ Back to Top](#dex-monitoring-platform)**

Made with ❤️ by [Denver-sn](https://github.com/Denver-sn)

</div>
