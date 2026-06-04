# --- build stage: compile the SPA bundle ---
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime: serves the app + runs the data refresh (same image, two commands) ---
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
# Production deps only (express + @duckdb/node-api use prebuilt binaries).
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# App code + built bundle. Seed JSON in public/ is the initial data; the refresh
# service overwrites it on a shared volume at runtime.
COPY --from=build /app/dist ./dist
COPY server.mjs ./
COPY scripts ./scripts
COPY db ./db
COPY public ./public
EXPOSE 8080
CMD ["node", "server.mjs"]
