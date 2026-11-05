# E Motion Works API — multi-stage build (Node 20 LTS, per spec)
FROM node:20-alpine AS base
# Prisma's query engine needs OpenSSL, which the Alpine image does not ship
RUN apk add --no-cache openssl \
  && corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @emotionfix/api --filter @emotionfix/shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @emotionfix/api db:generate && pnpm --filter @emotionfix/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --prod --filter @emotionfix/api --filter @emotionfix/shared
COPY packages/shared packages/shared
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && pnpm exec prisma generate
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
RUN mkdir -p uploads
EXPOSE 4000
# migrations + base seed run on every start (both are idempotent), then the API.
# SEED_DEMO=true also (re)loads the [DEMO] sample data on start — for demos only;
# remove the variable afterwards, because each start replaces the [DEMO] rows.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec tsx prisma/seed.ts && if [ \"$SEED_DEMO\" = \"true\" ]; then pnpm exec tsx prisma/demo-seed.ts; fi && node dist/index.js"]
