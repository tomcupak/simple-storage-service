#!/usr/bin/env bash
# Boots the standalone image configured purely through environment variables and drives both
# surfaces it publishes: the UI + management API (through nginx) and the S3 endpoint.
#
#   docker/standalone/smoke-test.sh [image]      (default: storage-standalone-smoke)
#
# Used by the `standalone-smoke` job in .github/workflows/ci.yml and runnable locally.
set -eu

IMAGE="${1:-storage-standalone-smoke}"
NAME="storage-smoke-$$"
VOLUME="storage-smoke-data-$$"
REGION="eu-smoke-1"
TIMEOUT="${SMOKE_TIMEOUT_SECONDS:-180}"

ADMIN_EMAIL="admin@storage.local"
ADMIN_PASSWORD="$(openssl rand -hex 16)"
WORK="$(mktemp -d)"

cleanup() {
	status=$?
	if [ "$status" -ne 0 ]; then
		echo "--- smoke test FAILED (exit $status); container logs follow" >&2
		docker logs "$NAME" 2>&1 | tail -n 200 >&2 || true
	fi
	docker rm -f -v "$NAME" >/dev/null 2>&1 || true
	docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
	rm -rf "$WORK"
	exit "$status"
}
trap cleanup EXIT

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

step() { echo "==> $*"; }

# Publishing to port 0 lets Docker pick free host ports, so the test cannot collide with
# anything already listening (a local dev stack, or 443 needing root).
step "starting $IMAGE"
docker volume create "$VOLUME" >/dev/null
docker run -d --name "$NAME" \
	-v "$VOLUME:/data" \
	-p 127.0.0.1::4242 \
	-p 127.0.0.1::443 \
	-e JWT_SECRET="$(openssl rand -base64 36)" \
	-e CRYPTOGRAPHIC_PASSWORD="$(openssl rand -base64 36)" \
	-e STORAGE_ENCRYPTION_KEY="$(openssl rand -base64 36)" \
	-e BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
	-e S3_PUBLIC_URL="https://s3.smoke.test" \
	-e S3_REGION="$REGION" \
	-e RATE_LIMIT_MAX=1234 \
	-e API_PUBLIC_URL="/api" \
	"$IMAGE" >/dev/null

host_port() { docker port "$NAME" "$1/tcp" | head -n 1 | sed 's/.*://'; }
WEB="http://127.0.0.1:$(host_port 4242)"
S3="http://127.0.0.1:$(host_port 443)"

step "waiting for the container to become healthy (up to ${TIMEOUT}s)"
deadline=$(( $(date +%s) + TIMEOUT ))
while :; do
	state="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$NAME")"
	case "$state" in
		running/healthy) break ;;
		exited/* | dead/*) fail "container stopped: $state" ;;
	esac
	[ "$(date +%s)" -lt "$deadline" ] || fail "not healthy after ${TIMEOUT}s (last state: $state)"
	sleep 2
done

step "UI serves HTML and config.json reflects API_PUBLIC_URL"
code="$(curl -s -o "$WORK/index.html" -w '%{http_code} %{content_type}' "$WEB/")"
case "$code" in "200 text/html"*) ;; *) fail "GET / returned: $code" ;; esac
grep -qi '<html' "$WORK/index.html" || fail "GET / did not return an HTML document"
curl -fsS "$WEB/config.json" | grep -q '"apiUrl": *"/api"' || fail "config.json does not carry API_PUBLIC_URL"

# Parses a flat JSON string field without jq (not guaranteed on every runner/dev machine).
json_field() { sed -n "s/.*\"$1\" *: *\"\([^\"]*\)\".*/\1/p" | head -n 1; }

step "management API: log in as the bootstrap admin"
login="$(curl -fsS -X POST "$WEB/api/v1/auth/login" -H 'Content-Type: application/json' \
	-d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")"
TOKEN="$(printf '%s' "$login" | json_field accessToken)"
[ -n "$TOKEN" ] || fail "login returned no accessToken: $login"

step "management API: create an S3 access key"
key="$(curl -fsS -X POST "$WEB/api/v1/access-keys" -H "Authorization: Bearer $TOKEN" \
	-H 'Content-Type: application/json' -d '{"description":"smoke test"}')"
KEY_ID="$(printf '%s' "$key" | json_field accessKeyId)"
KEY_SECRET="$(printf '%s' "$key" | json_field secretAccessKey)"
[ -n "$KEY_ID" ] && [ -n "$KEY_SECRET" ] || fail "access key response incomplete: $key"

step "S3: readiness"
curl -fsS "$S3/_ready" >/dev/null || fail "GET /_ready failed"

# The S3 listener is plain HTTP inside the container, whatever S3_PUBLIC_URL says.
s3curl() {
	curl -sS --aws-sigv4 "aws:amz:$REGION:s3" --user "$KEY_ID:$KEY_SECRET" "$@"
}

BUCKET="smoke-$(openssl rand -hex 4)"
printf 'hello from the standalone smoke test %s\n' "$(openssl rand -hex 8)" > "$WORK/payload.txt"

step "S3: create bucket, put object, get it back"
code="$(s3curl -o /dev/null -w '%{http_code}' -X PUT "$S3/$BUCKET")"
[ "$code" = 200 ] || fail "CreateBucket returned $code"
code="$(s3curl -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: text/plain' \
	--data-binary "@$WORK/payload.txt" "$S3/$BUCKET/dir/payload.txt")"
[ "$code" = 200 ] || fail "PutObject returned $code"
code="$(s3curl -o "$WORK/got.txt" -w '%{http_code}' "$S3/$BUCKET/dir/payload.txt")"
[ "$code" = 200 ] || fail "GetObject returned $code"
cmp "$WORK/payload.txt" "$WORK/got.txt" || fail "downloaded object differs from the uploaded one"

echo "OK: standalone image booted and served the UI, the management API and S3"
