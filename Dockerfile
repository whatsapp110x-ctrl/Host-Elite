FROM node:18-alpine

WORKDIR /app

COPY package.json ./

RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

RUN npm prune --production

RUN mkdir -p bots deployed_bots

EXPOSE 5000

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=300"

CMD ["node", "dist/index.js"]
