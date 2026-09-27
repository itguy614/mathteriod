#!/usr/bin/env bash
# Serve Mathteroid to the local network for playtesting.
#
# Opens the port in UFW for the LAN subnet only, runs the server, and removes the
# rule again when the server stops (Ctrl-C, crash, or terminal closed).
#
#   scripts/lan.sh preview   # build, then serve the production bundle (port 4173)
#   scripts/lan.sh dev       # Vite dev server with hot reload (port 5173)
set -euo pipefail

mode="${1:-preview}"
case "$mode" in
  preview) port=4173 ;;
  dev) port=5173 ;;
  *) echo "usage: $0 [preview|dev]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

# LAN subnet of the interface that carries the default route, e.g. 192.168.1.0/24.
iface="$(ip route show default | awk '{for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit }}')"
subnet="$(ip -4 route show dev "$iface" scope link | awk '$1 ~ /\// { print $1; exit }')"
addr="$(ip -4 -o addr show dev "$iface" | awk '{ split($4, a, "/"); print a[1]; exit }')"
if [[ -z "$subnet" ]]; then
  echo "Could not determine the LAN subnet (interface: ${iface:-none})." >&2
  exit 1
fi

rule=(from "$subnet" to any port "$port" proto tcp)

close_port() {
  trap - EXIT INT TERM HUP
  [[ -n "${keepalive_pid:-}" ]] && kill "$keepalive_pid" 2>/dev/null
  echo
  echo "Closing port $port in UFW..."
  sudo ufw delete allow "${rule[@]}" >/dev/null && echo "Port $port closed."
}

if [[ "$mode" == "preview" ]]; then
  npm run build
fi

echo "Opening port $port in UFW for $subnet (sudo)..."
sudo -v
sudo ufw allow "${rule[@]}" comment 'mathteroid playtest' >/dev/null
trap close_port EXIT INT TERM HUP
# Keep the sudo timestamp fresh so closing the port never needs a password prompt
# (which would fail if the terminal was closed).
while sleep 60; do sudo -n true 2>/dev/null || break; done &
keepalive_pid=$!

echo
echo "  Kids can play at: http://$addr:$port/"
echo "  Press Ctrl-C to stop and close the port."
echo

if [[ "$mode" == "preview" ]]; then
  npx vite preview --host --port "$port" --strictPort
else
  npx vite --host --port "$port" --strictPort
fi
