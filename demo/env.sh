# Source from the top-level demo directory's parent.
if [ ! -f ./demo/env.sh ] || [ ! -d ./payments/frontend ]; then
  echo 'Open the directory containing payments/, accounts/ and banks/ first.' >&2
  return 1
fi
if [ -z "${DOCKER_HOST:-}" ] && [ -S "$HOME/.colima/payments-pra/docker.sock" ]; then
  export DOCKER_HOST="unix://$HOME/.colima/payments-pra/docker.sock"
fi
if [ -z "${DOCKER_CONFIG:-}" ] && [ -x /opt/homebrew/lib/docker/cli-plugins/docker-compose ] && ! docker compose version >/dev/null 2>&1; then
  mkdir -p "$PWD/.runtime/docker-config"
  printf '%s\n' '{"cliPluginsExtraDirs":["/opt/homebrew/lib/docker/cli-plugins"]}' > "$PWD/.runtime/docker-config/config.json"
  export DOCKER_CONFIG="$PWD/.runtime/docker-config"
fi
if [ -x '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' ]; then
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
fi
if [ -d "$PWD/.runtime/playwright" ]; then export PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/playwright"; fi
export DEMO_CLI="$PWD/demo/scripts/operator.ts"
