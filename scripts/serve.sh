#!/usr/bin/env bash
# Dev-server wrapper for automated checks: start/stop a Vite dev server on a
# fixed port with a pidfile, and wait for readiness without `sleep`.
#
#   scripts/serve.sh start 5199   # returns once http://localhost:5199 answers (≤30 s)
#   scripts/serve.sh stop 5199    # kills the server (pidfile, then anything on the port)
#   scripts/serve.sh status 5199
#
# Heavy: run it inside the machine lock together with the screenshot step, e.g.
#   ~/dev/dw3-lock bash -c 'scripts/serve.sh start 5199 && node scripts/shot.mjs ...; scripts/serve.sh stop 5199'
set -u
cd "$(dirname "$0")/.."

cmd="${1:-}"
port="${2:-5199}"
dir="node_modules/.serve"
pidfile="$dir/$port.pid"
logfile="$dir/$port.log"
mkdir -p "$dir"

is_up() { curl -s -o /dev/null --max-time 2 "http://localhost:$port/"; }

case "$cmd" in
  start)
    if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
      echo "serve: already running on $port (pid $(cat "$pidfile"))"
      exit 0
    fi
    if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "serve: port $port is taken by another process" >&2
      exit 1
    fi
    nohup node node_modules/vite/bin/vite.js --port "$port" --strictPort >"$logfile" 2>&1 &
    echo $! >"$pidfile"
    # readiness: curl retries on refused connections, 1 s apart, 30 tries
    if curl -s -o /dev/null --retry 30 --retry-delay 1 --retry-connrefused --max-time 60 "http://localhost:$port/"; then
      echo "serve: up on http://localhost:$port (pid $(cat "$pidfile"))"
    else
      echo "serve: not ready after 30 s; log follows" >&2
      cat "$logfile" >&2
      exit 1
    fi
    ;;
  stop)
    if [ -f "$pidfile" ]; then
      pid="$(cat "$pidfile")"
      kill "$pid" 2>/dev/null
      # wait for exit (bounded, ~3 s)
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$pid" 2>/dev/null || break
        perl -e 'select(undef, undef, undef, 0.3)'
      done
      kill -9 "$pid" 2>/dev/null
      rm -f "$pidfile"
    fi
    left="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null)"
    [ -n "$left" ] && kill $left 2>/dev/null
    echo "serve: stopped $port"
    ;;
  status)
    if is_up; then echo "serve: up on $port"; else echo "serve: down on $port"; exit 1; fi
    ;;
  *)
    echo "usage: scripts/serve.sh start|stop|status [port]" >&2
    exit 2
    ;;
esac
