# gateway ve control-api ortak imaj.
#
# İkisi de Node + CBM binary'sine ihtiyaç duyuyor. Ayrı imajlar yapmak 297 MB'lık
# binary'yi iki kez saklamak demekti; tek imaj kurup compose'da farklı komutlarla
# çalıştırıyoruz.

FROM node:22-slim AS base

# git: control-api repoları klonlar/fetch eder
# procps: daemon kurtarma için pkill
# ca-certificates: Azure DevOps'a HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates procps \
 && rm -rf /var/lib/apt/lists/*

ARG CBM_VERSION=0.10.3
RUN npm install -g "codebase-memory-mcp@${CBM_VERSION}" \
 && codebase-memory-mcp --version

# ── Bağımlılıklar ve derleme ────────────────────────────────────────────────
FROM base AS build
WORKDIR /src

COPY gateway/package.json gateway/package-lock.json ./gateway/
RUN cd gateway && npm ci

COPY control-api/package.json control-api/package-lock.json ./control-api/
RUN cd control-api && npm ci

COPY gateway ./gateway
COPY control-api ./control-api
RUN cd gateway && npm run build \
 && cd ../control-api && npm run build

# ── Çalışma imajı ───────────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app

COPY --from=build /src/gateway/package.json ./gateway/
COPY --from=build /src/gateway/package-lock.json ./gateway/
COPY --from=build /src/gateway/dist ./gateway/dist
RUN cd gateway && npm ci --omit=dev && npm cache clean --force

COPY --from=build /src/control-api/package.json ./control-api/
COPY --from=build /src/control-api/package-lock.json ./control-api/
COPY --from=build /src/control-api/dist ./control-api/dist
RUN cd control-api && npm ci --omit=dev && npm cache clean --force

# CBM'in veritabanı ve klonlar burada; compose'da volume bağlanır.
# $HOME yazılabilir olmayabileceği için CBM_CACHE_DIR açıkça sabitlenir —
# OpenShift rastgele UID ile çalıştığında bu şart.
ENV CBM_BINARY=/usr/local/bin/codebase-memory-mcp \
    CBM_CACHE_DIR=/data/cbm \
    CLONE_ROOT=/data/repos \
    NODE_ENV=production

# ‼️ CBM cache dizini SAHİBİNE ÖZEL (0700) olmak zorunda.
# Dünyaya açık bırakılırsa şu hatayla reddediyor:
#   "secure CLI coordination could not be created (cache-private)"
# Bu yüzden 777 değil, node kullanıcısına ait 0700 veriyoruz. Docker adlandırılmış
# volume ilk bağlanışta bu sahiplik ve izinleri devralır.
RUN mkdir -p /data/cbm /data/repos \
 && chown -R node:node /data \
 && chmod 700 /data/cbm \
 && chmod 755 /data/repos

USER node

CMD ["node", "gateway/dist/index.js"]
