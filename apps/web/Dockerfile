# E Motion Works web — build with Vite, serve with nginx
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @emotionfix/web --filter @emotionfix/shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @emotionfix/web build

FROM nginx:1.27-alpine
ENV PORT=80 \
    API_UPSTREAM=http://api:4000 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
