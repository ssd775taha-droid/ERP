FROM node:22-slim
WORKDIR /app
# postgresql-client يوفّر pg_dump المستخدم في النسخ الاحتياطي
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY public ./public
ENV NODE_ENV=production PORT=3000
RUN mkdir -p /data/backups && chown -R node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
