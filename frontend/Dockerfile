# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Vite, VITE_* değişkenlerini build anında gömerek statik çıktıya yazar
# (runtime'da değiştirilemez — üretim imajı ayrı build edilir).
ARG VITE_API_BASE_URL=http://localhost:8000/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# Kanonik URL / OG etiketleri (lib/seo.ts). Verilmezse runtime origin kullanılır.
ARG VITE_SITE_URL=""
ENV VITE_SITE_URL=$VITE_SITE_URL
# Google Analytics 4 ve Meta Pixel — boşsa yüklenmez (src/lib/analytics.ts).
ARG VITE_GA_ID=""
ENV VITE_GA_ID=$VITE_GA_ID
ARG VITE_META_PIXEL_ID=""
ENV VITE_META_PIXEL_ID=$VITE_META_PIXEL_ID
RUN npm run build

# ── Serve stage ───────────────────────────────────────────────
FROM nginx:alpine
# Güvenlik başlıkları snippet'i conf.d DIŞINDA durmalı: conf.d/*.conf nginx
# tarafından http bağlamına otomatik include edilir ve `add_header`-only bir
# dosya orada geçerli bir sunucu tanımı olmadığından açılışta hata verir.
COPY nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
