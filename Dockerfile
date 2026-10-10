# Image de production du serveur BLAMUNE (Node.js + Express).
# Le bot C++ (bot.cpp) n'est PAS embarque : il tourne dans son propre
# conteneur (voir Dockerfile.bot et docker-compose.yml).
# La persistance des donnees est assuree par JSONBin (storage.js) ET par le
# volume SQLite du savoir (savoir.db).
#
# Base DEBIAN et non alpine : node:sqlite est compile dans Node, mais la
# bibliotheque SQLite doit exister sur la distribution. Debian (glibc) est
# la cible la plus fiable.
# Node 22 : requis pour node:sqlite (source de verite du savoir).
FROM node:22-slim

ENV NODE_ENV=production

WORKDIR /app

# On installe d'abord les dependances (cache Docker) puis on copie le reste.
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ping || exit 1

CMD ["node", "server.js"]
