#!/bin/sh
# Waits until <health url> reports <sha> (polls every 10 s, up to 10 minutes).
# Used by the GitHub workflows after they move the `deploy` branch.
#
#   deploy/wait-for-sha.sh https://apps.trplan.si/api/health <sha>
set -u
url=$1 sha=$2

for _ in $(seq 60); do
  live=$(curl -fsS --max-time 10 "$url" | jq -r .sha) || live=unreachable
  echo "$(date -u +%H:%M:%S) live: $live"
  [ "$live" = "$sha" ] && exit 0
  sleep 10
done
echo "::error::$url didn't report $sha within 10 minutes. Check the ai-apps stack in Komodo."
exit 1
