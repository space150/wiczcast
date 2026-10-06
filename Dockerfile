FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Server + public front-end files only (see .dockerignore)
COPY server.js index.html sw.js manifest.webmanifest ./
COPY css ./css
COPY js ./js
COPY assets ./assets

USER node
EXPOSE 8080
CMD ["node", "server.js"]
