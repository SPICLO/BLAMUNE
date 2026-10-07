# Image de production du serveur BLAMUNE (Node.js + Express).
# Le bot C++ (bot.exe/bot.cpp) n'est PAS embarque : il tourne en local.
# La persistance des donnees est assuree par JSONBin (storage.js), donc pas
# de volume : le disque du conteneur peut etre ephemere sans consequence.
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# On installe d'abord les dependances (cache Docker) puis on copie le reste.
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ping || exit 1

CMD ["node", "server.js"]
