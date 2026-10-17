FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY public ./public
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/erp.sqlite
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
