# Image de production du serveur BLAMUNE (Node.js + Express).
# Le bot C++ (bot.cpp) n'est PAS embarque : il tourne dans son propre
# conteneur (voir Dockerfile.bot et docker-compose.yml).
# La persistance des donnees est assuree par JSONBin (storage.js) ET par le
# volume SQLite du savoir (savoir.db).
#
# Base DEBIAN et non alpine : better-sqlite3 est un module natif. Alpine
# utilise musl, pour lequel il n'existe pas de binaire precompile : npm
# devrait le compiler sur place (python3 + make + g++ dans l'image). Sur
# Debian (glibc), le binaire precompile s'installe directement.
FROM node:20-slim

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
