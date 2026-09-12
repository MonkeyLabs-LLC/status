# Status page — self-host image (the @astrojs/node standalone server).
#
# This is the instance's deploy seam (NOT part of the generic Bananapulse engine):
# it builds the Astro SSR app with the node adapter and runs the standalone
# server. The Netlify path is unaffected — it never uses this file.
#
# Build:  docker build -t status .
# Run:    docker run -e PORT=8080 -e DATABASE_URL=... -p 8080:8080 status
#
# Served behind traefik (Let's Encrypt) + Cloudflare; see deploy/status/.

FROM node:22-slim AS build

WORKDIR /workspace

# This URL and checksum are generated from bananapulse.lock.json. The checksum
# makes the remote release payload immutable from this build's perspective.
ADD --checksum=sha256:f7a68691a04f5f140787c7f8fecfa7b94479a47d9eaf6b4e982de29bf32b1795 https://github.com/BananaLabs-OSS/Bananapulse/releases/download/source-v1.0.1/bananapulse-source.tar.gz /tmp/bananapulse-source.tar.gz
RUN mkdir /tmp/bananapulse-source \
    && tar -xzf /tmp/bananapulse-source.tar.gz -C /tmp/bananapulse-source --strip-components=1

COPY . /instance
RUN node /instance/scripts/compose-bananapulse.mjs \
    --engine /tmp/bananapulse-source \
    --instance /instance \
    --output /app

WORKDIR /app
RUN npm ci

# Build with the node adapter selected (default flag is netlify, so we set it
# explicitly here). Produces ./dist/server/entry.mjs (standalone server).
ENV STATUS_ADAPTER=node
RUN STATUS_ADAPTER=node npm run build

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

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
# Netlify). Inherited from the ENV above.
CMD ["node", "./dist/server/entry.mjs"]
