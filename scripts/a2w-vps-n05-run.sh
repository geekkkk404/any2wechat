#!/usr/bin/env bash
# a2w-vps-n05-run.sh — N-05 第二阶段（VPS 上执行，前台跑）：
#   前提：镜像已构建、凭证已由 a2w-wsl-n05-creds.sh 推入 docker/data/
set -e -o pipefail
cd /root/any2wechat

echo "== 启动容器（compose 单独部署形态）"
docker compose -f docker/docker-compose.yml up -d 2>&1 | tail -3
sleep 4
docker ps -a --filter name=any2wechat --format '{{.Names}} | {{.Status}}'

echo "== /health（宿主机回环）"
curl -s -m 10 http://127.0.0.1:8788/health; echo

echo "== webhook 真实推送（来自 VPS 容器，验 VPS→iLink 链路）"
curl -s -m 20 -X POST http://127.0.0.1:8788/webhook -H "Content-Type: application/json" \
  -d '{"title":"any2wechat N-05 Docker 验收","content":"这条消息来自测试 VPS 上的 any2wechat 容器：镜像构建 → compose 编排 → 数据卷挂载 → iLink 发送，全链路在大陆 VPS 跑通。"}'
echo; sleep 4

echo "== 容器日志尾行（发送结果）"
docker logs any2wechat 2>&1 | tail -6
echo "== N05-RUN-DONE =="
