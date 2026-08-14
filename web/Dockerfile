# Arayüz: Vite ile derlenir, nginx ile sunulur.
#
# Geliştirmede Vite'ın proxy'si /api isteklerini control-api'ye yönlendiriyordu;
# üretimde bu işi nginx yapıyor (aşağıdaki nginx.conf).

FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
