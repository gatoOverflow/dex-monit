# Dex Monitoring Platform

A comprehensive, self-hosted observability platform for error tracking, log management, session analytics, and performance monitoring. Built with modern technologies and designed for production use.

![Platform](https://img.shields.io/badge/Platform-Node.js-green)
![Frontend](https://img.shields.io/badge/Frontend-Next.js-black)
![Backend](https://img.shields.io/badge/Backend-NestJS-red)
![Database](https://img.shields.io/badge/Database-PostgreSQL%20%7C%20ClickHouse-blue)
![Cache](https://img.shields.io/badge/Cache-Redis-orange)

---

## 🎯 Features

### Error Tracking
- Real-time error capture and alerting
- Stack trace parsing with source code context
- Fingerprinting and issue grouping
- Breadcrumbs for debugging
- User context and tags

### Log Management
- Structured JSON logging
- Log levels (DEBUG, INFO, WARNING, ERROR)
- Full-text search
- Log filtering by project, environment, level

### Session Analytics
- Real-time active users tracking
- Session duration and page views
- Device and browser detection
- Geographic location tracking
- User journey visualization

### HTTP Tracing
- Request/response monitoring
- Latency percentiles (P50, P95, P99)
- Error rate tracking
- Request filtering and search

### Alerting System
- Custom alert rules
- Multi-channel notifications (Slack, Email, Webhook, Discord)
- Alert cooldowns
- Threshold-based triggers

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

## 📦 Packages

| Package | Description | npm |
|---------|-------------|-----|
| `@dex-monit/observability-sdk-node` | SDK for NestJS/Node.js backends | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-sdk-node)](https://www.npmjs.com/package/@dex-monit/observability-sdk-node) |
| `@dex-monit/observability-sdk-browser` | SDK for React/Next.js apps | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-sdk-browser)](https://www.npmjs.com/package/@dex-monit/observability-sdk-browser) |
| `@dex-monit/observability-sdk-react-native` | SDK for React Native/Expo apps | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-sdk-react-native)](https://www.npmjs.com/package/@dex-monit/observability-sdk-react-native) |
| `@dex-monit/observability-contracts` | Shared TypeScript interfaces | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-contracts)](https://www.npmjs.com/package/@dex-monit/observability-contracts) |
| `@dex-monit/observability-logger` | Pino-based structured logger | [![npm](https://img.shields.io/npm/v/@dex-monit/observability-logger)](https://www.npmjs.com/package/@dex-monit/observability-logger) |

---

## 🚀 Prerequisites

### Required
- **Node.js** >= 20.x
- **npm** >= 10.x
- **PostgreSQL** >= 14
- **ClickHouse** >= 23.x (for time-series data)
- **Redis** >= 7.x (for caching and queues)

### Optional
- **Docker** & **Docker Compose** (for local development)

---

## ⚙️ Installation

### 1. Clone the repository

```bash
git clone https://github.com/DEXCHANGE-GROUP/dex-monit.git
cd dex-monit
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start infrastructure (Docker)

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port `5432`
- ClickHouse on port `8123` (HTTP) / `9000` (Native)
- Redis on port `6379`

### 4. Configure environment variables

**API (`packages/monitoring-api/.env`):**

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
REDIS_PASSWORD=

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d

# Server
PORT=3000
NODE_ENV=development
```

**Frontend (`packages/monitoring-web/.env.local`):**

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

### 5. Initialize the database

```bash
cd packages/monitoring-api
npx prisma generate
npx prisma db push
```

### 6. Run the applications

**In separate terminals:**

```bash
# Terminal 1 - API
npx nx serve monitoring-api

# Terminal 2 - Frontend
npx nx dev monitoring-web
```

Or run both in parallel:

```bash
npx nx run-many -t serve,dev -p monitoring-api,monitoring-web
```

### 7. Access the platform

- **Frontend:** http://localhost:3001
- **API:** http://localhost:3000/api
- **API Docs:** http://localhost:3000/api/docs (Swagger)

---

## 🔧 Development

### Project Structure

```
dex-monit/
├── packages/
│   ├── monitoring-api/          # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/        # Authentication (JWT)
│   │   │   │   ├── ingest/      # Data ingestion endpoints
│   │   │   │   ├── issues/      # Issue management
│   │   │   │   ├── logs/        # Log management
│   │   │   │   ├── traces/      # HTTP traces
│   │   │   │   ├── sessions/    # Session tracking
│   │   │   │   ├── alerts/      # Alert rules & notifications
│   │   │   │   ├── projects/    # Projects & API keys
│   │   │   │   ├── teams/       # Team management
│   │   │   │   ├── clickhouse/  # ClickHouse service
│   │   │   │   └── redis/       # Redis service
│   │   │   └── prisma/          # Prisma schema
│   │   └── package.json
│   │
│   ├── monitoring-web/          # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/             # App Router pages
│   │   │   ├── components/      # React components
│   │   │   └── lib/             # Utilities & API client
│   │   └── package.json
│   │
│   └── observability/           # SDK packages
│       ├── contracts/           # Shared interfaces
│       ├── sdk-node/            # NestJS SDK
│       ├── sdk-browser/         # React/Next.js SDK
│       ├── sdk-react-native/    # React Native SDK
│       ├── logger/              # Pino logger
│       ├── request-context/     # AsyncLocalStorage context
│       └── scrubber/            # Sensitive data scrubber
│
├── docker-compose.yml           # Local infrastructure
├── Dockerfile.api               # API production build
├── Dockerfile.web               # Frontend production build
└── nx.json                      # Nx workspace config
```

### Useful Commands

```bash
# Build all packages
npx nx run-many -t build --all

# Build specific package
npx nx build monitoring-api
npx nx build monitoring-web
npx nx build sdk-node

# Run tests
npx nx run-many -t test --all

# Lint
npx nx run-many -t lint --all

# Generate Prisma client
cd packages/monitoring-api && npx prisma generate

# Run migrations
cd packages/monitoring-api && npx prisma db push

# Open Prisma Studio
cd packages/monitoring-api && npx prisma studio
```

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

// After login
setUser({ id: user.id, email: user.email });
```

---

## 🚢 Production Deployment

### Docker Build

```bash
# Build API
docker build -f Dockerfile.api -t dex-monitoring-api .

# Build Frontend
docker build -f Dockerfile.web -t dex-monitoring-web .
```

### Environment Variables (Production)

**API:**
```env
DATABASE_URL=postgresql://user:pass@db-host:5432/dex_monitoring
CLICKHOUSE_HOST=clickhouse-host
CLICKHOUSE_PORT=8443
CLICKHOUSE_PROTOCOL=https
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=secure-password
REDIS_HOST=redis-host
REDIS_PASSWORD=secure-password
JWT_SECRET=super-long-random-secret-key
PORT=3000
NODE_ENV=production
```

**Frontend:**
```env
NEXT_PUBLIC_API_URL=https://api.your-domain.com/api
NEXT_PUBLIC_REGISTRATION_ENABLED=false
```

### Health Checks

- `GET /health` - Overall health
- `GET /health/live` - Liveness probe
- `GET /health/ready` - Readiness probe

---

## 📊 Database Schema

### PostgreSQL (Configuration)
- Users, Teams, Projects
- API Keys
- Alert Rules
- Team Settings

### ClickHouse (Time-series)
- Events (errors)
- Logs
- HTTP Traces
- Sessions
- Page Views
- User Activity

---

## 🔐 Authentication

### User Authentication
- JWT-based authentication
- Registration and login
- Password hashing with bcrypt

### API Key Authentication
- Project-scoped API keys
- Used by SDKs for data ingestion
- Supports multiple keys per project

---

## 📈 Monitoring Your Platform

The platform monitors itself! Use the SDKs to send data to another instance or use the built-in health endpoints for external monitoring.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

## 🙏 Acknowledgments

- [NestJS](https://nestjs.com/) - Backend framework
- [Next.js](https://nextjs.org/) - Frontend framework
- [ClickHouse](https://clickhouse.com/) - Time-series database
- [Prisma](https://prisma.io/) - ORM
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [Tailwind CSS](https://tailwindcss.com/) - Styling
