FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV TZ=America/Maceio \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    DATA_DIR=/app/data \
    NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=160
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY bot.js servidor.js ./
COPY lib ./lib
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "servidor.js"]
