# MilJor

**MilJor** is a Lahore-first B2B Collective Food Procurement Marketplace connecting restaurants, caterers, and small food businesses with verified suppliers for bulk wholesale commodity purchasing.

---

## Repository Structure

```text
MilJor/
├── backend/                  # Node.js + Express backend service
│   ├── src/                  # Controllers, routes, services, middleware, models
│   ├── database/             # Schema, migrations, seeds, backups
│   ├── tests/                # Verification gates and regression runner
│   ├── docs/                 # Architectural & protocol documentation
│   ├── server.js             # Main API server entry point
│   ├── package.json
│   └── .env.example          # Environment template
├── frontend/                 # React + Vite frontend application
│   ├── src/                  # React components, assets, pages
│   ├── index.html            # Vite HTML template
│   ├── vite.config.js        # Vite config with API proxy
│   └── package.json
├── AGENTS.md                 # Agent instructions & invariants
├── package.json              # Root workspace management
└── README.md                 # Project documentation
```

---

## Getting Started

### Prerequisites

- **Node.js**: v20+ (v22 recommended)
- **npm**: v10+
- **MySQL**: 8.0+

### Installation

1. Install backend dependencies:
   ```bash
   cd backend
   npm install
   ```

2. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```

3. Setup environment variables for backend:
   ```bash
   cp backend/.env.example backend/.env
   # Update backend/.env with your MySQL credentials and JWT secret
   ```

---

## Running the Application

### Development Mode

Run backend:
```bash
npm run dev:backend
# Or: cd backend && npm run dev
```

Run frontend:
```bash
npm run dev:frontend
# Or: cd frontend && npm run dev
```

Frontend will run at `http://localhost:3000` (with `/api` proxied to `http://localhost:5000`).  
Backend will run at `http://localhost:5000`.

### Testing

Run backend regression test suite:
```bash
npm run test:backend
# Or: cd backend && npm test
```

### Building Frontend

```bash
npm run build:frontend
# Or: cd frontend && npm run build
```
