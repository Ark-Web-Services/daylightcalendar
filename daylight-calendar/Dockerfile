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

# Copy script files
COPY rootfs /

# Set permissions
RUN chmod a+x /etc/services.d/*/run \
    && chmod a+x /etc/cont-init.d/*

# Install node modules
WORKDIR /app
COPY package.json .
RUN npm install

# Copy the app
COPY . .

# Build the app
RUN npm run build

# Set entrypoint
ENTRYPOINT ["/init"]

# Labels
LABEL \
    io.hass.name="Daylight Calendar" \
    io.hass.description="A beautiful fullscreen calendar display for Home Assistant" \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="armhf|armv7|aarch64|amd64|i386" 