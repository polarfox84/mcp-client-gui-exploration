# Use Node 20
FROM node:20-alpine AS base

WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN npm install --production=false || true \
 && [ -f package-lock.json ] && npm ci || npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8000

# Production image
FROM base AS prod
CMD ["npm", "start"]

# Dev image with tsx watch
FROM base AS dev
ENV NODE_ENV=development
CMD ["npm", "run", "dev"]
