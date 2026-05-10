FROM apify/actor-node-playwright-chrome:22

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --include=dev

COPY . ./
RUN npm run build

CMD ["npm", "start"]
