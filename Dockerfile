FROM node:22-slim AS builder
WORKDIR /app
ENV NODE_ENV=development
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
# Force Railway to rebuild the source layer after SPR security hardening.
ARG SOURCE_REV=railway-security-hardening-20260819-v3
RUN test -n "$SOURCE_REV"
COPY . ./
RUN npm run typecheck && npm test && npm run build
RUN npm run build:owner-bootstrap
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* && groupadd --system --gid 10001 spr && useradd --system --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin spr

COPY --from=builder --chown=10001:10001 /app/package.json ./
COPY --from=builder --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /app/dist ./dist
COPY --from=builder --chown=10001:10001 /app/migrations ./migrations
COPY --from=builder --chown=10001:10001 /app/index.html ./index.html

RUN ! find /app -type f \( -name 'firebase-applet-config.json' -o -name '.env' -o -name '*.pem' -o -name '*.key' -o -name 'secret*.json' \) -print -quit | grep -q .

EXPOSE 8080
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS "http://127.0.0.1:${PORT:-8080}/health" || exit 1
CMD ["sh", "-c", "case \"$PROCESS_ROLE\" in worker) exec node dist/worker.cjs ;; bootstrap) exec node dist/bootstrap-initial-owner.cjs ;; migrate) exec node dist/migrate.cjs ;; *) exec node dist/server.cjs ;; esac"]