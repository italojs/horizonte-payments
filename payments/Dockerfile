FROM postgres:18@sha256:eb63372c1e05c755f55fa30cbd07aecc443676fc6c0fa90b9002d01537841e1a AS postgres
COPY infra/bootstrap.sql /docker-entrypoint-initdb.d/01.sql
COPY infra/payments.sql /bootstrap/payments.sql

FROM rabbitmq:4.4-management@sha256:61f90c401a5b5ed2486771973ea92ad66046471eacab9c9149f1a6e091c91677 AS rabbitmq
COPY infra/rabbitmq.conf /etc/rabbitmq/conf.d/80-payments.conf
COPY infra/rabbitmq-definitions.json /etc/rabbitmq/bootstrap.json

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS base
WORKDIR /app
RUN npm install --global pnpm@10.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY worker/package.json worker/
COPY backend/runtime/package.json backend/runtime/

FROM base AS api
RUN pnpm --filter @horizonte/payments-api... install --prod --frozen-lockfile
COPY backend/runtime/ backend/runtime/
COPY backend/src/ backend/src/
USER node
EXPOSE 3010
CMD ["node", "--import", "./backend/runtime/instrument.ts", "backend/src/index.ts"]

FROM base AS worker
RUN pnpm --filter @horizonte/payments-worker... install --prod --frozen-lockfile
COPY backend/runtime/ backend/runtime/
COPY worker/src/ worker/src/
COPY backend/scripts/ backend/scripts/

COPY infra/payments.sql infra/
USER node
CMD ["node", "--import", "./backend/runtime/instrument.ts", "worker/src/index.ts"]
