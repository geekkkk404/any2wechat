#!/usr/bin/env bash
# a2w-wsl-exec.sh — 在 VPS 上执行一条命令（命令从 stdin 读入，规避多层引号转义）
# 用法（WSL 内）: echo '<远程命令>' | bash a2w-wsl-exec.sh
set -e
eval "$(grep -E '^(IP|SSH_PORT|USER|PASSWORD)=' /tmp/.vpscred | tr -d '\r')"
SSHOPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${SSH_PORT:-22}"
CMD=$(cat)
sshpass -p "$PASSWORD" ssh $SSHOPTS "${USER:-root}@${IP}" "$CMD"
