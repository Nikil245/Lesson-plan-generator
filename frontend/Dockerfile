# =============================================================================
# Lessonwright Frontend Multi-Stage Dockerfile (React + Vite -> Nginx)
# =============================================================================

# --- Stage 1: Build the static React + TypeScript bundle ---------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first so this layer is cached unless lockfile changes
COPY package.json package-lock.json ./
RUN npm ci

# Copy frontend source files
COPY . .

# Configure the API base URL at build time (defaults to /api for Nginx proxy)
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}

RUN npm run build

# --- Stage 2: Serve /dist with Nginx and proxy /api/ to backend --------------
FROM nginx:alpine

# Replace default Nginx site config with our SPA + SSE proxy configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

