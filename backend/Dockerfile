# syntax=docker/dockerfile:1

# --- Build stage ---------------------------------------------------------
# Playwright base image ships the browsers + all system deps the scrapers need.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy AS build

WORKDIR /app

# Install only what's needed to build (leverage layer caching for deps).
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build:prod

# Prune dev dependencies so the runtime stage stays lean.
RUN npm prune --omit=dev

# --- Runtime stage -------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.60.0-jammy AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Media tooling required by the transcription / video pipeline.
# ffmpeg via apt; yt-dlp as a standalone static binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get purge -y curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

# Runs migrations on boot (see src/index.ts) then starts the API + cron.
CMD ["node", "dist/index.js"]
