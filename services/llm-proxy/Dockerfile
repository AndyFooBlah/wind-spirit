# Build context: NOT this directory. Stage it with scripts/build-context.sh, which copies this package
# and adds a pnpm-lock.yaml pruned from the workspace lockfile (the one Dependabot maintains), so the
# image installs exactly the pinned versions (AndyFooBlah/andy-private-docs#57).
FROM node:25-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g --no-audit --no-fund "$(node -p 'require("./package.json").packageManager')" \
 && pnpm install --frozen-lockfile
COPY tsconfig.docker.json ./
COPY src ./src
RUN pnpm exec tsc -p tsconfig.docker.json \
 && rm -rf node_modules \
 && pnpm install --frozen-lockfile --prod --offline

FROM node:25-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
