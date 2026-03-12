#!/usr/bin/env bash
set -euo pipefail
USERNAME="eugene"

if ! id -u "$USERNAME" >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G sudo "$USERNAME"
fi

TEMP_PASS=$(cat /proc/sys/kernel/random/uuid | tr -d '-' | cut -c1-18)
echo "$USERNAME:$TEMP_PASS" | chpasswd
usermod -aG sudo "$USERNAME"

if [ -f /etc/wsl.conf ]; then
  if grep -q '^\[user\]' /etc/wsl.conf; then
    if grep -q '^default=' /etc/wsl.conf; then
      sed -i "s/^default=.*/default=$USERNAME/" /etc/wsl.conf
    else
      printf "\n[user]\ndefault=%s\n" "$USERNAME" >> /etc/wsl.conf
    fi
  else
    printf "\n[user]\ndefault=%s\n" "$USERNAME" >> /etc/wsl.conf
  fi
else
  printf "[boot]\nsystemd=true\n\n[user]\ndefault=%s\n" "$USERNAME" > /etc/wsl.conf
fi

echo "TEMP_PASS=$TEMP_PASS"
echo "--- /etc/wsl.conf ---"
cat /etc/wsl.conf
id "$USERNAME"