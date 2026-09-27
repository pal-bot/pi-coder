#!/usr/bin/env bash
set -euo pipefail

action=${1:-install}
repository=${PIC_REPOSITORY:-https://github.com/pal-bot/pi-coder.git}
home=${PIC_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/pi-coder}
bin_dir=${PIC_BIN_DIR:-$HOME/.local/bin}
bun_bin=${PIC_BUN_BIN:-$(command -v bun || true)}
update_started=0
previous_head=

fail() {
  printf 'pic installer: %s\n' "$*" >&2
  exit 1
}

canonical_repository() {
  local value=$1
  case "$value" in
    https://github.com/*) value=${value#https://github.com/} ;;
    git@github.com:*) value=${value#git@github.com:} ;;
    ssh://git@github.com/*) value=${value#ssh://git@github.com/} ;;
    *)
      value=${value%/}
      printf '%s\n' "${value%.git}"
      return
      ;;
  esac
  printf '%s\n' "${value%.git}"
}

validate_origin() {
  local actual
  actual=$(git -C "$home" remote get-url origin 2>/dev/null) ||
    fail "$home has no origin remote"
  if [ "$(canonical_repository "$actual")" != "$(canonical_repository "$repository")" ]; then
    fail "unexpected origin for $home: $actual"
  fi
}

rollback_update() {
  local status=${1:-1}
  if [ "$update_started" = "1" ] && [ -n "$previous_head" ]; then
    printf 'pic installer: update failed; restoring %s\n' "$previous_head" >&2
    git -C "$home" reset --hard "$previous_head" >&2 || true
    rm -rf -- "$home/node_modules" "$home/dist"
    (cd "$home" && "$bun_bin" install --frozen-lockfile) >&2 || true
    (cd "$home" && "$bun_bin" run build) >&2 || true
  fi
  exit "$status"
}

[ -n "$bun_bin" ] || fail "Bun is required: https://bun.sh"

case "$action" in
  install)
    if [ ! -e "$home" ]; then
      mkdir -p "$(dirname "$home")"
      git clone --branch main --single-branch "$repository" "$home"
    elif [ ! -d "$home/.git" ]; then
      fail "$home exists but is not a Git checkout"
    fi
    validate_origin
    ;;
  update)
    [ -d "$home/.git" ] || fail "$home is not a managed Git checkout"
    validate_origin
    if [ "$(git -C "$home" symbolic-ref --short HEAD 2>/dev/null || true)" != "main" ]; then
      fail "managed checkout must be on main before update: $home"
    fi
    if [ -n "$(git -C "$home" status --porcelain)" ]; then
      fail "refusing to update a checkout with local changes: $home"
    fi
    previous_head=$(git -C "$home" rev-parse HEAD)
    git -C "$home" fetch --prune origin main
    git -C "$home" checkout main
    update_started=1
    git -C "$home" merge --ff-only origin/main || rollback_update $?
    ;;
  *)
    fail "usage: install.sh [install|update]"
    ;;
esac

destination=$bin_dir/pic
if [ -e "$destination" ] && [ ! -L "$destination" ]; then
  fail "refusing to replace non-symlink destination: $destination"
fi

if [ "$update_started" = "1" ]; then
  (cd "$home" && "$bun_bin" install --frozen-lockfile) || rollback_update $?
  (cd "$home" && "$bun_bin" run build) || rollback_update $?
else
  (cd "$home" && "$bun_bin" install --frozen-lockfile)
  (cd "$home" && "$bun_bin" run build)
fi
update_started=0

mkdir -p "$bin_dir"
ln -sfn "$home/bin/pic" "$destination"
printf 'pic installed at %s\n' "$destination"
case ":${PATH}:" in
  *:"$bin_dir":*) ;;
  *) printf 'add %s to PATH to run pic\n' "$bin_dir" ;;
esac
