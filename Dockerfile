FROM apify/actor-node-playwright-chrome:22

# Base image sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD; Camoufox needs this off for fetch.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

# Base image runs as non-root `myuser`; npm install needs write access to WORKDIR.
USER root

WORKDIR /usr/src/app

COPY package*.json ./
# Skip postinstall: it would run as root and write Camoufox to /root/.cache, but the
# Actor runs as `myuser` and expects /home/myuser/.cache/camoufox (see pkgman.js).
RUN npm install --include=dev --ignore-scripts

COPY . ./
RUN npm run build

RUN chown -R myuser:myuser /usr/src/app \
  && mkdir -p /home/myuser/.cache \
  && chown -R myuser:myuser /home/myuser

USER myuser
WORKDIR /usr/src/app
ENV HOME=/home/myuser

# Download Camoufox + GeoIP into myuser's cache (runtime user).
RUN npx camoufox-js fetch

CMD ["npm", "start"]
