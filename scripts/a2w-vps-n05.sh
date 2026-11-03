#!/usr/bin/env bash
# a2w-vps-n05.sh — N-05 主脚本（VPS 上执行）：装 Docker（P-07 镜像源方案）
#   → registry-mirrors（P-09/P-11 链）→ 克隆 any2wechat（Gitee）→ 构建镜像
# 由 nohup 拉起，日志 /root/a2w-n05.log，完成打 N05-BUILD-DONE 标记
set -e -o pipefail

echo "== [1/4] Docker 安装（境内镜像源 apt 直装）"
if command -v docker >/dev/null 2>&1; then
  echo "  docker 已存在: $(docker --version)"
else
  export DEBIAN_FRONTEND=noninteractive
  distro="$(. /etc/os-release && echo "$ID")"
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
  mkdir -p /etc/apt/keyrings
  GOT=0
  for base in https://mirrors.cloud.tencent.com/docker-ce https://mirrors.aliyun.com/docker-ce; do
    echo "  尝试 $base"
    curl -fsSL --connect-timeout 8 "$base/linux/$distro/gpg" -o /etc/apt/keyrings/docker.asc 2>/dev/null || continue
    echo "deb [signed-by=/etc/apt/keyrings/docker.asc] $base/linux/$distro $codename stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null 2>&1 && GOT=1 && break
    rm -f /etc/apt/sources.list.d/docker.list
  done
  if [ "$GOT" != "1" ]; then
    echo "  镜像源失败，回退官方脚本（--mirror Aliyun）"
    curl -fsSL https://get.docker.com -o /tmp/getdocker.sh
    sh /tmp/getdocker.sh --mirror Aliyun
    rm -f /tmp/getdocker.sh
  fi
fi
systemctl enable --now docker >/dev/null 2>&1 || service docker start
docker info >/dev/null
echo "  OK Docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
docker compose version >/dev/null 2>&1 \
  && echo "  OK compose $(docker compose version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" \
  || { echo "  FAIL compose 插件缺失"; exit 1; }

echo "== [2/4] registry-mirrors 配置"
if [ -f /etc/docker/daemon.json ] && grep -q registry-mirrors /etc/docker/daemon.json 2>/dev/null; then
  echo "  daemon.json 已配置，跳过"
else
  # 腾讯内网镜像无条件收录（CVM 白赚，轻量机 ~100ms 失败代价）+ 社区加速链（P-11 实证 1ms.run 命中）
  printf '{ "registry-mirrors": ["https://mirror.ccs.tencentyun.com", "https://docker.1ms.run", "https://hub.rat.dev", "https://docker.m.daocloud.io", "https://dockerproxy.net"] }\n' > /etc/docker/daemon.json
  systemctl restart docker
  sleep 2
  echo "  已写入 daemon.json 并重启 docker"
fi

echo "== [3/4] 克隆 any2wechat（Gitee, depth 1）"
rm -rf /root/any2wechat
git clone --depth 1 https://gitee.com/geekkkk404/any2wechat.git /root/any2wechat 2>&1 | tail -1
cd /root/any2wechat
git log --oneline -1

echo "== [4/4] 构建镜像（node:22-slim 拉取走加速链，可能数分钟）"
docker build -t any2wechat:0.1.0 -f docker/Dockerfile . 2>&1 | tail -4
docker images | grep any2wechat
echo "== N05-BUILD-DONE =="
