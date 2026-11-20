# Construir desde la raíz del repo:  docker build -f apps/worker/Dockerfile .
# Binario estático de gitleaks (fuente `gitleaks`); versión fijada para builds reproducibles.
FROM ghcr.io/gitleaks/gitleaks:v8.21.2 AS gitleaks

FROM node:24-slim
# git: el colector gitleaks clona repos públicos de github.com.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks
RUN gitleaks version
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile --filter "@warden/worker..."

ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@warden/worker", "start"]
