#!/usr/bin/env bash
# Generate a dev CA + EMQX server cert + per-client certs for the FCC mTLS broker.
# Client CN encodes identity: fcc-bridge (the bridge), MARK1-001 (a rover).
# Dev/test only — never use these certs in production.
set -e
D="$(cd "$(dirname "$0")" && pwd)/certs"
mkdir -p "$D"
cd "$D"

# --- CA ---
openssl genrsa -out ca.key 2048 2>/dev/null
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=Friday CC Dev CA" -out ca.crt 2>/dev/null

# --- server cert (SAN for localhost / 127.0.0.1) ---
openssl genrsa -out server.key 2048 2>/dev/null
openssl req -new -key server.key -subj "/CN=localhost" -out server.csr 2>/dev/null
printf "subjectAltName=DNS:localhost,IP:127.0.0.1\n" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 3650 -sha256 -extfile server.ext 2>/dev/null

# --- client certs (CN = identity) ---
for pair in "bridge:fcc-bridge" "rover:MARK1-001" "gateway:fcc-gateway" "dispatch:fcc-dispatch"; do
  name="${pair%%:*}"; cn="${pair##*:}"
  openssl genrsa -out "$name.key" 2048 2>/dev/null
  openssl req -new -key "$name.key" -subj "/CN=$cn" -out "$name.csr" 2>/dev/null
  openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "$name.crt" -days 3650 -sha256 2>/dev/null
done

rm -f ./*.csr server.ext
echo "generated certs in $D:"
ls -1 "$D"
