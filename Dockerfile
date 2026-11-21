# Status page — self-host image (the @astrojs/node standalone server).
#
# This is the instance's deploy seam (NOT part of the generic Bananapulse engine):
# it builds the Astro SSR app with the node adapter and runs the standalone
# server. The Netlify path is unaffected — it never uses this file.
#
# Build:  docker build -t status .
# Run with the native owners using deploy/status/docker-compose.yml.
#
# Served behind traefik (Let's Encrypt) + Cloudflare; see deploy/status/.

FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Build with the node adapter selected (default flag is netlify, so we set it
# explicitly here). Produces ./dist/server/entry.mjs (standalone server).
ENV STATUS_ADAPTER=node
RUN STATUS_ADAPTER=node npm run build

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV STATUS_ADAPTER=node

COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# The standalone server binds HOST:PORT. traefik talks to it over the compose
# network; expose the app port (compose/.env supplies PORT).
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

# STATUS_ADAPTER must stay 'node' at runtime too — the internal scheduler is
# guarded on it (so the 5-min sweep + uptimerobot poll only run here, never on
# Netlify).
CMD ["node", "./dist/server/entry.mjs"]
