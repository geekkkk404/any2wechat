#!/usr/bin/env bash
# a2w-vps-setup.sh — 在测试 VPS 上执行：预检 → 克隆（Gitee）→ 后台构建 any2wechat 镜像
set -e
echo "== 预检"
uname -r; docker --version; git --version
echo "== 克隆 any2wechat（Gitee, depth 1）"
rm -rf /root/any2wechat /root/a2w-build.log
git clone --depth 1 https://gitee.com/geekkkk404/any2wechat.git /root/any2wechat 2>&1 | tail -2
cd /root/any2wechat
git log --oneline -1
ls
echo "== 后台构建镜像（nohup，日志 /root/a2w-build.log）"
nohup docker build -t any2wechat:0.1.0 -f docker/Dockerfile . > /root/a2w-build.log 2>&1 < /dev/null &
sleep 2
echo "== BUILD_LAUNCHED"
tail -3 /root/a2w-build.log
