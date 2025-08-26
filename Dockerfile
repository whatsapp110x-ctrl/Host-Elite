FROM node:18-alpine

WORKDIR /app

COPY package.json ./

RUN npm install --no-package-lock

COPY . .

RUN npm run build

EXPOSE 5000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
