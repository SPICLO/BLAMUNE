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
#
# Image epinglee par digest : le tag seul peut etre repousse, et deux builds
# du meme commit doivent produire la meme base. Le digest est celui de
# l'INDEX multi-plateforme (linux/amd64 et linux/arm64), donc portable : le
# build choisit le bon enfant selon la machine.
#
# Pourquoi "22-slim" et non "22.23-slim", alors que les deux designent
# aujourd'hui le meme digest ? Parce que le role du tag est de documenter
# l INTENTION ("Node 22, derniers correctifs"), et celui du digest est
# d'imposer l'EXACTITUDE. Au prochain rafraîchissement, remplacer le digest
# de "22-slim" redonne la toute derniere version 22.x, correctifs de
# securite compris. Avec "22.23-slim", il faudrait penser a changer le tag en
# meme temps ; si on l oublie, on reste epingle sur une base perimee sans
# aucun avertissement. Le tag flottant epingle est donc le bon couple.
#
# Pour lever l'epingle :
#   docker buildx imagetools inspect node:22-slim
# puis remplacer le digest ci-dessous, en gardant le commentaire a jour.
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

ENV NODE_ENV=production

WORKDIR /app

# On installe d'abord les dependances (cache Docker) puis on copie le reste.
# npm ci, et non npm install : le build suit package-lock.json au lieu de
# resoudre les plages de versions au moment du build. C'est ce qui rend deux
# builds identiques a partir du meme commit.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ping || exit 1

CMD ["node", "server.js"]
