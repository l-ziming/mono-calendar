FROM node:24-bookworm-slim

WORKDIR /opt/mono-calendar
COPY config.example.json ./
COPY server ./server
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/addon.mjs"]
