#!/usr/bin/env bash
# a2w-wsl-send.sh — 把本地（WSL 内）脚本发到 VPS 指定路径
# 用法（WSL 内）: bash a2w-wsl-send.sh <本地路径> <VPS目标路径>
set -e
LOCAL="${1:?用法: send <本地路径> <VPS目标路径>}"; REMOTE="${2:?缺 VPS 目标路径}"
eval "$(grep -E '^(IP|SSH_PORT|USER|PASSWORD)=' /tmp/.vpscred | tr -d '\r')"
SSHOPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${SSH_PORT:-22}"
sshpass -p "$PASSWORD" ssh $SSHOPTS "${USER:-root}@${IP}" "cat > '$REMOTE' && echo SENT \$(wc -c < '$REMOTE') bytes" < "$LOCAL"
