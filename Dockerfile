# The server and the site, built on vps2 by the Komodo stack (deploy/compose.yaml).
#
# /api/health reports the commit: the GIT_SHA build arg if given, otherwise
# the HEAD of the clone being built (Komodo passes no build args), read from
# the `git` build context (the repo's .git, kept out of the main context):
#
#   docker build --build-context git=.git .

FROM alpine/git:v2.49.1 AS sha
ARG GIT_SHA
COPY --from=git . /repo/.git
RUN if [ -n "$GIT_SHA" ]; then echo "$GIT_SHA"; \
    else git -c safe.directory='*' -C /repo rev-parse HEAD; fi > /git-sha

FROM node:22-alpine
WORKDIR /app
RUN npm install -g pnpm@9 && npm cache clean --force
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY . .
COPY --from=sha /git-sha ./.git-sha
ENV NODE_ENV=production STORAGE_DIR=/data/storage PORT=8090
USER node
EXPOSE 8090
CMD ["node", "server/index.js"]
