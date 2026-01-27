FROM node:23 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .

RUN npm run build

FROM node:23
WORKDIR /app
RUN npm i -g serve
COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["serve", "-s", "dist", "-l", "8080"]
