#!/bin/bash
# Tou, Câmara? no VPS (utilizador deploy, sem Docker nem sudo):
# Postgres 17 + pgvector (127.0.0.1:54331), API (3101), web (3102),
# Caddy (3100) e túnel público da Cloudflare para o Caddy.
# Tudo reinicia se cair. Arranque: setsid -f ~/toucamara/toucamara.sh
# (o crontab tem o mesmo em @reboot). O endereço público fica em ~/toucamara/url.txt.
T=~/toucamara

# Só mata o que ele próprio arrancou (o grupo guardado em run.pid).
[ -f $T/run.pid ] && kill -- -"$(cat $T/run.pid)" 2>/dev/null && sleep 2
echo $$ > $T/run.pid

export PATH=$T/bin:$PATH
PG=$T/mamba/envs/pg/bin

# O Postgres fica fora do grupo: reiniciar a app não o desliga.
$PG/pg_ctl -D $T/pgdata status >/dev/null ||
  setsid $PG/pg_ctl -D $T/pgdata -l $T/logs/pg.log -w start >/dev/null

# Túnel primeiro: o endereço vai para a API (links dos SMS).
: > $T/logs/tunel.log
( while true; do ~/.local/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3100 >> $T/logs/tunel.log 2>&1; sleep 3; done ) &
URL=
for _ in $(seq 60); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' $T/logs/tunel.log | tail -1)
  [ -n "$URL" ] && break
  sleep 1
done
echo "$URL" > $T/url.txt

( while true; do caddy run --config $T/Caddyfile --adapter caddyfile >> $T/logs/caddy.log 2>&1; sleep 3; done ) &
( cd $T/src/code/api && while true; do HOST=127.0.0.1 WEB_URL=$URL ALLOWED_ORIGINS=$URL bun dist/main.js >> $T/logs/api.log 2>&1; sleep 3; done ) &
( cd $T/src/code/web/.next/standalone && while true; do PORT=3102 HOSTNAME=127.0.0.1 bun server.js >> $T/logs/web.log 2>&1; sleep 3; done ) &
wait
