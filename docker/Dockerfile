# any2wechat — 运行时依赖仅 qrcode（v0.4.3+，终端二维码渲染与 qr_content 发码；v0.4.8 起随镜像安装，N-14）
FROM node:22-slim
WORKDIR /app
# 先拷依赖清单装依赖（层缓存：src/bin 变更不触发重装）；--ignore-scripts 关掉 postinstall 供应链面
COPY package.json package-lock.json ./
# NPM_REGISTRY 构建参数：国内网络构建可传 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm ci --omit=dev --ignore-scripts --registry=${NPM_REGISTRY}
COPY src ./src
COPY bin ./bin
ENV NODE_ENV=production
EXPOSE 8788
CMD ["node", "src/main.mjs"]
