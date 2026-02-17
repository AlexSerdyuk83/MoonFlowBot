FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-distutils make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-distutils make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json .
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
