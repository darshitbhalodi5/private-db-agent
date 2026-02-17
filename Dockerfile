FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY README.md ./README.md
EXPOSE 8080
ENV NODE_ENV=production
CMD ["npm", "run", "start"]
