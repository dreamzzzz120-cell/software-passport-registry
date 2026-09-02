FROM node:26-slim AS builder
WORKDIR /app
ENV NODE_ENV=development
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
ARG SOURCE_REV=railway-security-hardening-20260826-v1
RUN test -n "$SOURCE_REV"

# vite.config.ts inlines the Firebase browser config at build time via `define`,
# reading process.env inside the build. A Dockerfile build only sees variables
# declared as ARG, and these were not -- so `vite build` ran with none of them
# and shipped the "spr-missing-firebase-config" fallback. The visible effect was
# an app that rendered but reported "Authentication is disabled": nobody could
# sign in or sign up.
#
# These are Firebase *browser* config values, not secrets. They are compiled
# into client JavaScript and readable by anyone who loads the page; Firebase
# treats them as public identifiers. Access is controlled by Firebase security
# rules and by server-side ID-token verification in requireAuth, not by hiding
# these.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MEASUREMENT_ID
ENV SPR_REQUIRE_FIREBASE_CONFIG=true \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID

COPY . ./
RUN npm run typecheck && npm test && npm run build

# The Firebase requirement itself is enforced inside vite.config.ts, which holds
# the actual values; this only confirms the client build produced something to
# serve, so a missing bundle fails the build instead of the healthcheck.
RUN test -f dist/index.html || (echo 'FATAL: vite build produced no dist/index.html' && exit 1)
RUN npm run build:owner-bootstrap
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:26-slim AS runtime
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