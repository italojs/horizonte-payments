FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS dependencies
WORKDIR /app
RUN npm install --global pnpm@10.25.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY backend/src ./backend/src
COPY backend/scripts ./backend/scripts
COPY database ./database
USER node
EXPOSE 3011
CMD ["node", "--import", "./backend/src/observability/instrument.ts", "backend/src/index.ts"]
