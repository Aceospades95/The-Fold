# ---- build the web app ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared ./shared
COPY server ./server
COPY web ./web
RUN npm run build -w web

# ---- runtime ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    FOLD_DB=/data/the-fold.db \
    STATIC_DIR=/app/web/dist \
    PORT=8484
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev
COPY shared ./shared
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
VOLUME /data
EXPOSE 8484
CMD ["npm", "run", "start", "-w", "server"]
