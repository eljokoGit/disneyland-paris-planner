# --- étage 1 : construction du frontend -------------------------------------
FROM node:22-alpine AS build

WORKDIR /app
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci

# Le moteur de calcul est partagé entre le frontend et le backend : il doit être
# présent au build, le frontend l'importe depuis ../../shared.
COPY shared/ shared/
COPY frontend/ frontend/
RUN cd frontend && npm run build

# --- étage 2 : exécution -----------------------------------------------------
FROM node:22-alpine AS run

ENV NODE_ENV=production
ENV TZ=Europe/Paris
WORKDIR /app

COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev && npm cache clean --force

COPY shared/ shared/
COPY backend/ backend/
COPY collecteur/ collecteur/
COPY --from=build /app/frontend/dist frontend/dist

# data/ est un VOLUME monté depuis le répertoire de travail : plan.json et
# etat-courant.json doivent rester éditables avec des outils fichiers standard.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
WORKDIR /app/backend
CMD ["node", "server.js"]
