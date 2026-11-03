# preset: TrendRadar → any2wechat

让 [TrendRadar](https://github.com/sansan0/TrendRadar)（热点聚合监控）的热点日报直达你的个人微信。

## 原理

TrendRadar 自带"通用 webhook"推送渠道（`GENERIC_WEBHOOK_URL`/`GENERIC_WEBHOOK_TEMPLATE`），
每次抓取周期把日报 POST 到任意 URL。把 URL 指向 any2wechat 的 `/webhook` 即完成接线——
TrendRadar 无需任何改造。

```
TrendRadar 容器 ──POST /webhook──▶ any2wechat 容器 ──▶ 你的个人微信
```

## 手动接线（已用官方 compose 跑着 TrendRadar 的情况）

1. 部署 any2wechat（见仓库根 `docker/docker-compose.yml`），与 TrendRadar 同一 docker 网络
2. 完成 any2wechat 侧登录 + 绑定（`docker logs` 看授权链接 → 微信确认 → 发"绑定"）
3. 给 TrendRadar 的环境变量追加两行（.env 或 compose environment）：

```env
GENERIC_WEBHOOK_URL=http://any2wechat:8788/webhook
GENERIC_WEBHOOK_TEMPLATE={"title":"{title}","content":"{content}"}
```

4. `docker compose up -d` 重建 TrendRadar 容器使其读取新变量。容器默认 `IMMEDIATE_RUN=true`，
   启动即推一轮——微信收到日报即验收通过。

要点：URL 用**容器名** `any2wechat` 而不是 `127.0.0.1`（跨容器回环不通，走 compose 网络）。

## compose 片段

见同目录 [`docker-compose.snippet.yml`](docker-compose.snippet.yml)——把 wechat-bridge 服务
并入你现有的 TrendRadar compose 栈的最小改法。

## 一键路径

TrendRadar 侧的一键安装脚本（`--wechat-bridge` 模式）正在另一仓库推进：
`https://gitee.com/geekkkk404/fast_install_trendradar`——零基础读者推荐走那条路。
