#!/usr/bin/env bash
# a2w-wsl-n05-creds.sh — 把本地 any2wechat/data/ 的凭证+会话打包推到 VPS compose 卷目录
# 前提：本地 data/credentials.json、data/session.json 已先 base64 注入 WSL /tmp/a2w-cred.json、/tmp/a2w-session.json
set -e
eval "$(grep -E '^(IP|SSH_PORT|USER|PASSWORD)=' /tmp/.vpscred | tr -d '\r')"
SSHOPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${SSH_PORT:-22}"
tar czf - -C /tmp a2w-cred.json a2w-session.json \
  | sshpass -p "$PASSWORD" ssh $SSHOPTS "${USER:-root}@${IP}" \
    "mkdir -p /root/any2wechat/docker/data && tar xzf - -C /root/any2wechat/docker/data && cd /root/any2wechat/docker/data && mv a2w-cred.json credentials.json && mv a2w-session.json session.json && ls -la"
