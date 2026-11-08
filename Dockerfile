FROM node:22-slim

# Claude Code CLI (needed for agent runs)
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm install

# Copy source
COPY shared/ shared/
COPY server/ server/
COPY client/ client/

# Build the client for production
RUN npm run build -w client

# The server serves the API; nginx or a static server handles the client build.
# For simplicity, we add a small express static handler in production mode.
EXPOSE 3710

ENV API_HOST=0.0.0.0
ENV API_PORT=3710
ENV NODE_ENV=production

CMD ["npx", "tsx", "server/src/main.ts"]
