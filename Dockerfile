# NOT BUILT OR RUN on the development machine (no Docker available). Provided for staging.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production WW_ENV=staging PORT=4400 HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY docs/openapi.json ./docs/openapi.json
RUN mkdir -p /data && chown -R node:node /data /app
USER node
ENV WW_DB_PATH=/data/waterwatch.sqlite WW_DATA_DIR=/data/files
EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4400/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.ts"]
