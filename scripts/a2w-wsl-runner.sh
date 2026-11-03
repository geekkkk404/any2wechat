#!/usr/bin/env bash
# a2w-wsl-runner.sh — 在 WSL 沙箱内执行：读 /tmp/.vpscred，把 /tmp/a2w-vps-setup.sh 经 stdin 送到 VPS 执行
set -e
eval "$(grep -E '^(IP|SSH_PORT|USER|PASSWORD)=' /tmp/.vpscred | tr -d '\r')"
SSHOPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${SSH_PORT:-22}"
sshpass -p "$PASSWORD" ssh $SSHOPTS "${USER:-root}@${IP}" "bash -s" < /tmp/a2w-vps-setup.sh
