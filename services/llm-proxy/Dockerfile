# Build context: services/llm-proxy only (pnpm workspace root is not available here),
# so the image uses npm against this package.json alone.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json tsconfig.docker.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npx tsc -p tsconfig.docker.json

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
