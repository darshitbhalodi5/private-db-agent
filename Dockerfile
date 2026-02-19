FROM node:22-alpine AS base
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/agent-api/package.json ./apps/agent-api/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json

RUN npm ci --omit=dev --workspace packages/shared-types --workspace apps/agent-api

COPY apps/agent-api/src ./apps/agent-api/src
COPY apps/agent-api/public ./apps/agent-api/public
COPY packages/shared-types/src ./packages/shared-types/src
COPY README.md ./README.md

EXPOSE 8080
ENV NODE_ENV=production

CMD ["npm", "run", "start", "-w", "apps/agent-api"]
