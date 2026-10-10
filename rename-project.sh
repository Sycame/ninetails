#!/usr/bin/env bash
# Renames the whole project (text, folders and files) from "ninetails" to a new name.
# For RHEL 8/9 (bash 4+, GNU sed/find/grep/tar); also works in Git Bash.
#
# Does everything RENAME-PROJECT.md lists for the repository itself:
#   1. optional backup of the project (without node_modules)
#   2. replaces the name inside every text file (4 forms, below)
#   3. deletes generated folders that contain the old name (dist, .angular next to angular.json)
#   4. renames folders and files whose NAME contains the old name (deepest first)
#   5. checks for leftovers and, if Go is installed, builds and vets the API
#   6. optionally renames the root folder itself (--rename-root)
#
# The four forms replaced (case-sensitive), shown for old name "ninetails" and new name "foo-bar":
#   NinetailsApp  -> FooBarApp      (Angular page-title form)
#   NINETAILS     -> FOO_BAR        (environment prefix: NINETAILS_AUTH -> FOO_BAR_AUTH)
#   ninetails     -> foo-bar        (folders, go module, npm name, paths, storage keys)
#   Ninetails     -> Foo Bar        (display name)
#
# This script, rename-project.ps1 and RENAME-PROJECT.md are not edited (they describe the old name).
# Things outside this folder (server, GitLab, DNS) are not touched: see RENAME-PROJECT.md section 7.
#
# Usage:
#   ./rename-project.sh NEW_NAME [options]
#     --display "Foo Bar"     name shown to people (default: NEW_NAME in Title Case)
#     --env-name FOO_BAR      environment variable prefix without the trailing "_" (default: upper case, - -> _)
#     --old-name NAME         only if the project was renamed before (default: ninetails)
#     --old-display TEXT      "    "
#     --old-env-name TEXT     "    "
#     --dry-run               show what would change; change nothing
#     --yes                   do not ask for confirmation
#     --no-backup             skip the backup (made next to the project folder: <folder>-backup-<timestamp>.tar.gz)
#     --rename-root           also rename the project's root folder (run it from the parent folder or anywhere;
#                             your shell's current folder will need a `cd` afterwards)
#   Example:  bash rename-project.sh foo-bar --dry-run
#             bash rename-project.sh foo-bar --display "Foo Bar" --rename-root

set -euo pipefail

usage() { sed -n '2,38p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------- arguments --
NEW_NAME=""; DISPLAY_NAME=""; ENV_NAME=""
OLD_NAME="ninetails"; OLD_DISPLAY=""; OLD_ENV=""
DRY=0; YES=0; BACKUP=1; RENAME_ROOT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --display)      DISPLAY_NAME="${2:?--display needs a value}"; shift 2 ;;
    --env-name)     ENV_NAME="${2:?--env-name needs a value}"; shift 2 ;;
    --old-name)     OLD_NAME="${2:?--old-name needs a value}"; shift 2 ;;
    --old-display)  OLD_DISPLAY="${2:?--old-display needs a value}"; shift 2 ;;
    --old-env-name) OLD_ENV="${2:?--old-env-name needs a value}"; shift 2 ;;
    --dry-run)      DRY=1; shift ;;
    --yes|-y)       YES=1; shift ;;
    --no-backup)    BACKUP=0; shift ;;
    --rename-root)  RENAME_ROOT=1; shift ;;
    -h|--help)      usage 0 ;;
    -*)             die "unknown option $1 (see --help)" ;;
    *)              [ -z "$NEW_NAME" ] || die "unexpected argument $1"; NEW_NAME="$1"; shift ;;
  esac
done
[ -n "$NEW_NAME" ] || { usage 1; }

# -------------------------------------------------------------------- names --
words()   { local s="$1" w out=(); IFS='-' read -ra parts <<<"$s"; for w in "${parts[@]}"; do out+=("${w^}"); done; printf '%s\n' "${out[@]}"; }
display() { words "$1" | paste -sd' ' -; }
pascal()  { words "$1" | paste -sd'\0' - | tr -d '\0'; }
envname() { local s="${1^^}"; printf '%s' "${s//-/_}"; }

[ -n "$DISPLAY_NAME" ] || DISPLAY_NAME="$(display "$NEW_NAME")"
[ -n "$ENV_NAME" ]     || ENV_NAME="$(envname "$NEW_NAME")"
[ -n "$OLD_DISPLAY" ]  || OLD_DISPLAY="$(display "$OLD_NAME")"
[ -n "$OLD_ENV" ]      || OLD_ENV="$(envname "$OLD_NAME")"
NEW_TITLE="$(pascal "$NEW_NAME")App"
OLD_TITLE="$(pascal "$OLD_NAME")App"

[[ "$NEW_NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || die "NEW_NAME '$NEW_NAME' must be lowercase letters, digits and single hyphens, starting with a letter."
[[ "$DISPLAY_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9\ .-]*$ ]] || die "display name '$DISPLAY_NAME' may only contain letters, digits, spaces, '.' and '-'."
[[ "$ENV_NAME" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "env name '$ENV_NAME' must be upper case letters, digits and underscores."
[ "$NEW_NAME" != "$OLD_NAME" ] || die "the new name is the same as the old name."

# Replacement table, applied in this order to each file (most specific first).
OLDS=("$OLD_TITLE" "$OLD_ENV" "$OLD_NAME" "$OLD_DISPLAY")
NEWS=("$NEW_TITLE" "$ENV_NAME" "$NEW_NAME" "$DISPLAY_NAME")
for n in "${NEWS[@]}"; do
  for o in "${OLDS[@]}"; do
    case "$n" in *"$o"*) die "new value '$n' contains the old text '$o'. Choose a different name." ;; esac
  done
done

# Escape a literal for the sed pattern / replacement.
esc_re()  { printf '%s' "$1" | sed -e 's/[][\.*^$/]/\\&/g'; }
esc_rep() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }
SED_ARGS=()
for i in "${!OLDS[@]}"; do SED_ARGS+=(-e "s/$(esc_re "${OLDS[$i]}")/$(esc_rep "${NEWS[$i]}")/g"); done
GREP_ALT="$(printf '%s\n' "${OLDS[@]}" | paste -sd'|' -)"

# ----------------------------------------------------------------- settings --
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF_FILES=(rename-project.ps1 rename-project.sh RENAME-PROJECT.md)

echo
echo "Project folder : $ROOT"
echo "Replacements   :"
for i in "${!OLDS[@]}"; do printf '  %-22s -> %s\n' "${OLDS[$i]}" "${NEWS[$i]}"; done
[ "$DRY" -eq 0 ] || echo "DRY RUN: nothing will be changed."

# find, never entering node_modules / .git / dist / .angular
PRUNE=(-name node_modules -o -name .git -o -name dist -o -name .angular)

self_filter() { # reads NUL-separated paths, drops the three top-level helper files
  local p
  while IFS= read -r -d '' p; do
    local skip=0 s
    for s in "${SELF_FILES[@]}"; do [ "$p" = "$ROOT/$s" ] && skip=1; done
    [ "$skip" -eq 1 ] || printf '%s\0' "$p"
  done
}

# ------------------------------------------------------------- content plan --
mapfile -d '' CONTENT_FILES < <(
  find "$ROOT" \( "${PRUNE[@]}" \) -prune -o -type f -print0 \
    | self_filter \
    | xargs -0 -r grep -lIZi -- "$OLD_NAME" 2>/dev/null || true )

# ---------------------------------------------------------------- name plan --
# -depth lists children before their parents, so renames never invalidate a later path.
mapfile -d '' RENAME_PATHS < <(
  find "$ROOT" -depth ! -path "$ROOT" \
       ! -path '*/node_modules' ! -path '*/node_modules/*' ! -path '*/.git' ! -path '*/.git/*' \
       ! -path '*/dist' ! -path '*/dist/*' ! -path '*/.angular' ! -path '*/.angular/*' \
       -name "*${OLD_NAME}*" -print0 )

# generated folders next to angular.json
GENERATED=()
while IFS= read -r -d '' aj; do
  d="$(dirname "$aj")"
  for g in dist .angular; do [ -d "$d/$g" ] && GENERATED+=("$d/$g"); done
done < <(find "$ROOT" \( -name node_modules -o -name .git \) -prune -o -name angular.json -print0)

ROOT_LEAF="$(basename "$ROOT")"
NEW_ROOT_LEAF=""
if [ "$RENAME_ROOT" -eq 1 ]; then
  case "$ROOT_LEAF" in
    *"$OLD_NAME"*) NEW_ROOT_LEAF="${ROOT_LEAF//$OLD_NAME/$NEW_NAME}" ;;
    *) echo "Root folder '$ROOT_LEAF' does not contain '$OLD_NAME'; --rename-root ignored." ;;
  esac
fi

rel() { local p="$1"; if [ "$p" = "$ROOT" ]; then echo .; else echo "${p#"$ROOT"/}"; fi; }

# ------------------------------------------------------------------- report --
echo
echo "Text files to edit: ${#CONTENT_FILES[@]}"
for f in "${CONTENT_FILES[@]}"; do
  n="$(grep -oE -- "$GREP_ALT" "$f" | wc -l)"
  printf '  %4s x  %s\n' "$n" "$(rel "$f")"
done
echo
echo "Generated folders to delete (rebuilt later): ${#GENERATED[@]}"
for g in "${GENERATED[@]}"; do echo "  $(rel "$g")"; done
echo
echo "Folders and files to rename: ${#RENAME_PATHS[@]}$([ -n "$NEW_ROOT_LEAF" ] && echo ' + the root folder')"
for p in "${RENAME_PATHS[@]}"; do b="$(basename "$p")"; echo "  $(rel "$p")  ->  ${b//$OLD_NAME/$NEW_NAME}"; done
[ -z "$NEW_ROOT_LEAF" ] || echo "  [root] $ROOT_LEAF  ->  $NEW_ROOT_LEAF"

if [ "$DRY" -eq 1 ]; then echo; echo "Dry run finished. Nothing was changed."; exit 0; fi

if [ "$YES" -eq 0 ]; then
  echo
  read -r -p 'Type "yes" to make these changes: ' answer
  [ "$answer" = "yes" ] || { echo "Cancelled. Nothing was changed."; exit 0; }
fi

# ------------------------------------------------------------------- backup --
if [ "$BACKUP" -eq 1 ]; then
  parent="$(dirname "$ROOT")"
  backup="$parent/${ROOT_LEAF}-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
  echo
  echo "Backing up to $backup ..."
  tar -czf "$backup" --exclude=node_modules --exclude=.angular --exclude=dist --exclude=.git -C "$parent" "$ROOT_LEAF" \
    || die "backup failed; nothing was changed."
fi

# ------------------------------------------------------------------ content --
echo
echo "Editing text files ..."
for f in "${CONTENT_FILES[@]}"; do sed -i "${SED_ARGS[@]}" -- "$f"; done
echo "  edited ${#CONTENT_FILES[@]} files"

# ---------------------------------------------------------------- generated --
for g in "${GENERATED[@]}"; do rm -rf -- "$g"; echo "  deleted $(rel "$g")"; done

# -------------------------------------------------------------------- names --
echo "Renaming folders and files (deepest first) ..."
for p in "${RENAME_PATHS[@]}"; do
  dir="$(dirname "$p")"; b="$(basename "$p")"; nb="${b//$OLD_NAME/$NEW_NAME}"
  [ ! -e "$dir/$nb" ] || die "cannot rename '$p': '$dir/$nb' already exists."
  mv -- "$p" "$dir/$nb"
  echo "  $(rel "$p")  ->  $nb"
done

# ---------------------------------------------------------------- leftovers --
echo
echo "Checking for leftovers (case-insensitive) ..."
left=0
while IFS= read -r -d '' p; do echo "  name: $(rel "$p")"; left=$((left+1)); done < <(
  find "$ROOT" \( "${PRUNE[@]}" \) -prune -o ! -path "$ROOT" -iname "*${OLD_NAME}*" -print0 | self_filter )
while IFS= read -r -d '' p; do echo "  text: $(rel "$p")"; left=$((left+1)); done < <(
  find "$ROOT" \( "${PRUNE[@]}" \) -prune -o -type f -print0 | self_filter | xargs -0 -r grep -lIZi -- "$OLD_NAME" 2>/dev/null || true )
if [ "$left" -eq 0 ]; then echo "  none found"; else echo "  $left leftover(s): check them by hand (other capitalisations of the old name?)"; fi

# ----------------------------------------------------------------- go check --
if command -v go >/dev/null 2>&1; then
  for d in "$ROOT"/*/; do
    [ -f "$d/go.mod" ] || continue
    echo
    echo "Go check in $(basename "$d") ..."
    if ( cd "$d" && go build ./... && go vet ./... && [ -z "$(gofmt -l .)" ] ); then
      echo "  go build, go vet and gofmt are clean"
    else
      echo "  PROBLEM: go build/vet/gofmt reported errors (run them in $d to see)"
    fi
  done
else
  echo
  echo "Go is not installed here; skipped the API build check (run go build ./... and go vet ./... yourself)."
fi

# -------------------------------------------------------------- root folder --
if [ -n "$NEW_ROOT_LEAF" ]; then
  parent="$(dirname "$ROOT")"
  cd "$parent"   # a folder cannot be renamed from inside on every platform
  if mv -- "$ROOT" "$parent/$NEW_ROOT_LEAF"; then
    echo
    echo "Renamed the root folder to $parent/$NEW_ROOT_LEAF"
    echo "Your shell may still be in the old path: run   cd \"$parent/$NEW_ROOT_LEAF\""
  else
    echo "Could not rename the root folder; rename '$ROOT' to '$NEW_ROOT_LEAF' by hand."
  fi
fi

cat <<EOF

Done. Next:
  1. cd to the app folder and run: npm install   (confirms package-lock.json), then npm run build
  2. Start the API and the app and look at the page title, header and footer.
  3. Things outside this folder are NOT changed: server paths and service names, the settings file
     (every ${OLD_ENV}_ variable must become ${ENV_NAME}_), the GitLab Application name, DNS.
     See RENAME-PROJECT.md section 7.
  Backup (if made): next to the project folder, named '*-backup-*'. Delete it when you are happy.
EOF
