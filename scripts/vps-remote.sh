#!/usr/bin/env bash
# vps-remote.sh — 在测试 VPS 上执行远程命令（读取 /tmp/.vpscred 的 KEY=VALUE）
# 用法: vps-remote.sh "<远程命令>"   —— 本脚本无任何秘密，凭证由调用方注入 /tmp/.vpscred
set -e
eval "$(grep -E '^(IP|SSH_PORT|USER|PASSWORD)=' /tmp/.vpscred | tr -d '\r')"
SSHOPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${SSH_PORT:-22}"
sshpass -p "$PASSWORD" ssh $SSHOPTS "${USER:-root}@${IP}" "$1"
