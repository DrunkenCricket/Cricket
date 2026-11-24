#!/usr/bin/env bash
# One-time setup for the always-on Rams bot on a Raspberry Pi (or any Debian/Ubuntu box).
#   curl -fsSL https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/bot/install.sh | bash
# Safe to re-run. Asks for the bot token once and stores it in /etc/rams-bot.env (root-only).
set -euo pipefail
DIR=/opt/rams-bot
RUN_AS=${SUDO_USER:-$USER}

echo "==> Installing git and Python venv"
sudo apt-get update -qq
sudo apt-get install -y -qq git python3-venv >/dev/null

echo "==> Getting the bot code"
if [ ! -d "$DIR/.git" ]; then
  sudo git clone -q https://github.com/DrunkenCricket/Cricket.git "$DIR"
fi
sudo chown -R "$RUN_AS": "$DIR"
python3 -m venv "$DIR/.venv"
"$DIR/.venv/bin/pip" install -q --upgrade pip
"$DIR/.venv/bin/pip" install -q -r "$DIR/bot/requirements.txt"

if ! sudo test -s /etc/rams-bot.env; then
  read -rsp "Paste the Discord bot token (input is hidden), then press Enter: " TOKEN </dev/tty; echo
  printf 'DISCORD_BOT_TOKEN=%s\n' "$TOKEN" | sudo tee /etc/rams-bot.env >/dev/null
  sudo chmod 600 /etc/rams-bot.env
fi

echo "==> Setting up the service (capped so it never slows down AdGuard)"
sudo tee /etc/systemd/system/rams-bot.service >/dev/null <<UNIT
[Unit]
Description=Rams Discord bot (chat triggers)
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_AS
WorkingDirectory=$DIR
EnvironmentFile=/etc/rams-bot.env
ExecStart=$DIR/.venv/bin/python bot/bot.py
Restart=always
RestartSec=10
Nice=10
CPUQuota=25%
MemoryMax=150M

[Install]
WantedBy=multi-user.target
UNIT

# Pull new code every 15 minutes; restart only if the bot itself changed.
sudo tee /etc/systemd/system/rams-bot-update.service >/dev/null <<UNIT
[Unit]
Description=Update the Rams bot from GitHub

[Service]
Type=oneshot
User=$RUN_AS
WorkingDirectory=$DIR
ExecStart=/bin/bash -c 'git fetch -q origin main && if ! git diff --quiet HEAD origin/main -- bot/; then git reset -q --hard origin/main && .venv/bin/pip install -q -r bot/requirements.txt && sudo systemctl restart rams-bot; else git reset -q --hard origin/main; fi'
UNIT
sudo tee /etc/systemd/system/rams-bot-update.timer >/dev/null <<UNIT
[Unit]
Description=Check GitHub for Rams bot updates

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
UNIT
# Let the updater restart the bot without a password prompt.
echo "$RUN_AS ALL=(root) NOPASSWD: /usr/bin/systemctl restart rams-bot" | sudo tee /etc/sudoers.d/rams-bot >/dev/null
sudo chmod 440 /etc/sudoers.d/rams-bot

sudo systemctl daemon-reload
sudo systemctl enable --now rams-bot rams-bot-update.timer
sleep 8
echo
sudo systemctl --no-pager --lines=5 status rams-bot || true
echo
echo "Done. Live log: journalctl -u rams-bot -f"
