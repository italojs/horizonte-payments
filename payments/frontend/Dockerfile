FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /app
RUN npm install --global pnpm@10.25.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app
ENV NODE_ENV=production PORT=5173 API_PROXY=http://payments-api:3010
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY server.mjs ./
USER node
EXPOSE 5173
CMD ["node", "server.mjs"]
