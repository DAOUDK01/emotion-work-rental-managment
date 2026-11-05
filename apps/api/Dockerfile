# E Motion Works API — multi-stage build (Node 20 LTS, per spec)
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
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
RUN pnpm install --frozen-lockfile --prod --filter @emotionfix/api --filter @emotionfix/shared
COPY packages/shared packages/shared
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && pnpm exec prisma generate
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
RUN mkdir -p uploads
EXPOSE 4000
# migrations + base seed run on every start (both are idempotent), then the API
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec tsx prisma/seed.ts && node dist/index.js"]
