# Tabibna — Monorepo (MVP scaffold)

This repository scaffolds the Tabibna MVP per `instructions.md`:
- Backend API: Express + TypeScript + Prisma (MySQL)
- Worker stub for async jobs
- Docker Compose for local dev (MySQL + services)
- Basic CI build workflow

## Prerequisites
- Node.js LTS (>=18)
- Docker Desktop
- Windows PowerShell (commands below)

## Quick start (local without Docker)
```powershell
cd api
npm install
npx prisma generate
${env:PORT='4001'}; npm run dev
```
API listens on `http://localhost:4001` (override with `PORT`).

## Quick start (Docker Compose)
```powershell
copy api\.env.example api\.env
docker-compose up --build
```
MySQL runs on `localhost:3307` (user `root`, password `rootpass`, DB `tabibna_dev`).

To run Prisma migrations (first time):
```powershell
cd api
npx prisma migrate dev --name init
```

## Running with Docker

Use Docker Compose for local dev:

```sh
docker-compose up --build
```

Once up, verify the API:

```sh
curl http://localhost:4000/health
```

Notes on Prisma and OpenSSL inside Docker:

- The API container uses `node:20-bookworm-slim` (Debian). Prisma requires OpenSSL at runtime. We install `openssl` in the image and configured Prisma Client to bundle the proper query engine by setting `binaryTargets = ["debian-openssl-3.0.x", "native"]` in `api/prisma/schema.prisma`.
- If you pull changes that modify the Prisma `binaryTargets`, run `npx prisma generate` (happens in the Docker build) to regenerate the client.
- If you see an error mentioning `libssl.so.1.1` or `Unable to require(... openssl-1.1.x.so.node)`, ensure you rebuild images: `docker-compose build --no-cache api`.

### Security hygiene for container images

- The API Dockerfile pins `node:20-bookworm-slim` by digest. Periodically update this digest to pull in security fixes, or automate with a dependency bot.
- Consider building a production image on a minimal base (e.g., distroless or Wolfi) and running as a non-root user with read-only filesystem. If moving to distroless, ensure OpenSSL and the Prisma engine are compatible, or use Prisma's `binaryTargets` to match the new base.
- Enable image scanning in CI and fail builds on high/critical vulnerabilities when feasible.

## Env vars (API)
See `api/.env.example` for all variables.

JWT keys (RS256):
- Generate a keypair and paste PEM strings into `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`, or mount as Docker secrets.
- Example (Git Bash): `ssh-keygen -t rsa -b 2048 -m PEM -f jwtRS256.key && openssl rsa -in jwtRS256.key -pubout -outform PEM -out jwtRS256.key.pub`
- Ensure the env values include the full `-----BEGIN ...-----` / `-----END ...-----` blocks.

## Endpoints (MVP)
- `GET /health`
- Auth: `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/refresh`
- Practitioners: `GET /v1/practitioners`, `GET /v1/practitioners/:id`
- Availability: `GET /v1/practitioners/:id/availability?date=YYYY-MM-DD`
- Practitioners (me): `GET /v1/practitioners/me/reservations`, `POST /v1/practitioners/me/schedules`, `PUT /v1/practitioners/me/schedules/:id`, `GET /v1/practitioners/me/stats`
- Reservations: `POST /v1/reservations`, `PUT /v1/reservations/:id` (reschedule), `PUT /v1/reservations/:id/cancel`, `GET /v1/reservations/:id`

## Scripts
- API: `npm run dev`, `npm run build`, `npm start`
- Worker: `npm run dev`, `npm run build`, `npm start`

## Notes
- JWT uses RS256; provide `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`.
- For local DB with Docker, Prisma `DATABASE_URL` uses port 3307.
- Update Prisma schema and run migrations as needed.
- Rate limiting applied to `/v1/auth/*` (20 req/min per IP) in dev scaffold; tune in production.
- Server hardening: `trust proxy` enabled, JSON body limit set to `1mb`.
