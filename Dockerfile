# ---- Build stage ---------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma
# postinstall runs `prisma generate`, which needs prisma/ to be present
RUN npm install

COPY . .
RUN npx prisma generate && npx next build

# ---- Runner stage ---------------------------------------------------------
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
# Prisma's query engine needs a detectable OpenSSL; the slim image alone
# makes Prisma fall back to an engine variant that may not be shipped.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && mkdir -p /data/uploads

EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
