# syntax=docker/dockerfile:1

# DevInsight MCP server — exposes the report tools to the OpenClaw agent over
# streamable-HTTP on :4100. NOT an npm workspace, so it installs its own deps.
# Built with this directory as the context (see docker-compose.prod.yml).
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4100
CMD ["node", "server.mjs"]
