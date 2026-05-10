FROM apify/actor-node-playwright-chrome:22

# Base image sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, which makes camoufox-js postinstall
# skip downloading Camoufox + GeoIP (you then get "vnull" and a broken browser at runtime).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

# Base image runs as non-root `myuser`; npm install needs write access to WORKDIR.
USER root

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --include=dev

COPY . ./
RUN npm run build

RUN chown -R myuser:myuser /usr/src/app

USER myuser

CMD ["npm", "start"]
