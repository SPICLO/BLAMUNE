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
# Pour lever l'epingle (patches de securite, nouvelle version de Node) :
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
