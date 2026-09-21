#!/bin/sh
set -e

# The UI is a static bundle, so the management API's address cannot be baked in at build time -
# the same image has to run in staging and in production. `config.json` is read by the app at
# startup (see `web/shared/window.d.ts`) and is written here from the environment.
: "${API_URL:=http://localhost:10410}"

cat > /usr/share/nginx/html/config.json <<JSON
{
	"apiUrl": "${API_URL}"
}
JSON

echo "storage-web: API URL set to ${API_URL}"
