# ---- Build stage ---------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma
# postinstall runs `prisma generate`, which needs prisma/ to be present
RUN npm ci

COPY . .
RUN npx prisma generate && npx next build

# Drop dev-only packages. The Prisma CLI stays: entrypoint.sh runs
# `prisma migrate deploy` at startup, so `prisma` is a runtime dependency.
# Regenerate afterwards because pruning can remove node_modules/.prisma.
RUN npm prune --omit=dev && ./node_modules/.bin/prisma generate

# ---- Runner base ----------------------------------------------------------
FROM node:24-slim AS runner-base
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# Prisma's query engine needs a detectable OpenSSL; the slim image alone
# makes Prisma fall back to an engine variant that may not be shipped.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/server.ts ./server.ts
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/entrypoint.sh ./entrypoint.sh

# Uploads volume is created by Docker as root; the app runs as `node`.
# sed strips CRLF if the checkout used Windows line endings.
RUN sed -i 's/\r$//' ./entrypoint.sh \
    && chmod +x ./entrypoint.sh \
    && mkdir -p /data/uploads \
    && chown -R node:node /data

USER node

EXPOSE 3000

# ---- All-in-one stage: app + PostgreSQL in one container -----------------
# Optional image for small self-hosted setups: PostgreSQL lives in /data and
# is only reachable from inside the container. Build with:
#   docker build --target bundled -t meme-battle:bundled .
FROM runner-base AS bundled
USER root
RUN apt-get update && apt-get install -y --no-install-recommends postgresql \
    && rm -rf /var/lib/apt/lists/* /var/lib/postgresql/*/main /etc/postgresql/*/main \
    && for bin in /usr/lib/postgresql/*/bin/*; do ln -sf "$bin" /usr/local/bin/; done
COPY --chown=node:node entrypoint-bundled.sh ./entrypoint-bundled.sh
RUN sed -i 's/\r$//' ./entrypoint-bundled.sh \
    && chmod +x ./entrypoint-bundled.sh \
    && mkdir -p /data/pgdata \
    && chown -R node:node /data
USER node
ENTRYPOINT ["./entrypoint-bundled.sh"]

# ---- Default stage: app only (external PostgreSQL) ------------------------
FROM runner-base AS runner
ENTRYPOINT ["./entrypoint.sh"]
