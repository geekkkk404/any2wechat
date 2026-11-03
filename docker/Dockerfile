# any2wechat — 零依赖，无 npm install 步骤
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY bin ./bin
ENV NODE_ENV=production
EXPOSE 8788
CMD ["node", "src/main.mjs"]
