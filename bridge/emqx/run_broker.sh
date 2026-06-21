#!/usr/bin/env bash
# Stand up the FCC EMQX broker with mTLS + topic ACLs (dev).
#   - SSL listener :8883 with verify_peer + fail_if_no_peer_cert (mutual TLS)
#   - plaintext :1883 kept for the transition; disable in production
#   - dashboard :18083 (admin/public by default)
# Prereq: bash gen_certs.sh   (generates the CA + server + client certs)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
CERTS="$HERE/../certs"
VENV_PY="$HERE/../.venv/bin/python"
[ -f "$CERTS/server.crt" ] || { echo "missing certs — run: bash $HERE/../gen_certs.sh"; exit 1; }
chmod 644 "$CERTS"/*.crt "$CERTS"/*.key

docker rm -f fcc-emqx >/dev/null 2>&1 || true
docker run -d --name fcc-emqx \
  -p 1883:1883 -p 8883:8883 -p 18083:18083 \
  -v "$CERTS":/opt/emqx/etc/fcc-certs:ro \
  -e EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__CACERTFILE=/opt/emqx/etc/fcc-certs/ca.crt \
  -e EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__CERTFILE=/opt/emqx/etc/fcc-certs/server.crt \
  -e EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__KEYFILE=/opt/emqx/etc/fcc-certs/server.key \
  -e EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__VERIFY=verify_peer \
  -e EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__FAIL_IF_NO_PEER_CERT=true \
  emqx/emqx:5.8 >/dev/null

echo "fcc-emqx starting; waiting for :8883 ..."
for _ in $(seq 1 45); do nc -z 127.0.0.1 8883 2>/dev/null && break; read -r -t 1 </dev/null || true; done
echo "waiting for dashboard API ..."
for _ in $(seq 1 45); do curl -sf -m 2 http://127.0.0.1:18083/status >/dev/null 2>&1 && break; read -r -t 1 </dev/null || true; done

"$VENV_PY" "$HERE/configure_acl.py"
echo "broker up: mTLS :8883 (verify_peer), plaintext :1883, dashboard :18083"
