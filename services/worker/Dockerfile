# The worker, for Railway (or any container host). Build from the repo root:
#   docker build -f services/worker/Dockerfile .
FROM node:24-slim

RUN npm install -g pnpm@12.3.4
WORKDIR /app

# Every workspace manifest, so the lockfile matches; then install only what the worker needs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY services/worker/package.json services/worker/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter "@contractorsight/worker..."

COPY packages/shared packages/shared
COPY services/worker services/worker

# Settings come from the host's environment variables (see services/worker/.env.example).
# The host sets PORT; HOST defaults to 0.0.0.0.
ENV NODE_ENV=production
WORKDIR /app/services/worker
CMD ["/app/node_modules/.bin/tsx", "src/index.ts"]
