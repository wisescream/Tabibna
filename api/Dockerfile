# Production image for API
# Pinned digest for node:20-bookworm-slim (update periodically)
FROM node:20-bookworm-slim@sha256:d38efce970505168e50665d2350ae7d102204235d7072a1076afbdf227c1ea17 AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install deps
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN if [ -f package-lock.json ]; then npm ci; elif [ -f yarn.lock ]; then yarn --frozen-lockfile; elif [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm i --frozen-lockfile; else npm i; fi

# Build
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate && npm run build

# Runtime
FROM node:20-bookworm-slim@sha256:d38efce970505168e50665d2350ae7d102204235d7072a1076afbdf227c1ea17
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/prisma ./prisma
EXPOSE 4000
CMD ["node", "dist/index.js"]
