ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.15
FROM ${BUILD_FROM}

# Install required packages
RUN apk add --no-cache \
    nodejs \
    npm \
    git \
    python3 \
    py3-pip \
    wget \
    curl \
    xorg-server \
    xf86-video-fbdev \
    ttf-freefont \
    openbox \
    chromium

# Copy S6 overlay and other rootfs items
COPY rootfs /

# Set permissions for S6 scripts
RUN chmod a+x /etc/services.d/*/run \
    && chmod a+x /etc/cont-init.d/*

# Set the working directory for the application build
WORKDIR /app

# Copy package.json and package-lock.json (if it exists)
# Only copy these first to leverage Docker layer caching for npm install
COPY package.json package-lock.json* ./
# Ensure options.json is also available in /app, as index.js reads it from __dirname
COPY options.json ./

# Install Node.js dependencies
# This installs dependencies based on package.json in /app
RUN npm install

# Copy the rest of the application source code into /app
# This will copy index.js, public/, etc.
COPY . .

# Build the client-side assets (Webpack)
# This uses the package.json scripts from /app/package.json
RUN npm run build

# /app now contains the fully built application and its dependencies.
# The S6 init system will start, and its services should run from /app.

ENTRYPOINT ["/init"]

# Labels
LABEL \
    io.hass.name="Daylight Calendar" \
    io.hass.description="A beautiful fullscreen calendar display for Home Assistant" \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="armhf|armv7|aarch64|amd64|i386" 