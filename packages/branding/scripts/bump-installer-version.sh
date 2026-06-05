#!/usr/bin/env bash
# [fork-only] DeskFox installer version bump (macOS/Linux) — semver YYYY.次.补
#
# 版本号规则(2026-06-05 起,详 docs/governance/版本号与发布渠道规范.md §三):
#   格式 YYYY.MINOR.PATCH(3 段合法 semver;旧 YYYY.M.D.N 日历号已废)
#     YYYY  = 年份(跨年自动 reset 到 <年>.1.0)
#     MINOR = 功能波次,大更新 +1(--bump minor),进位时 PATCH 归零
#     PATCH = 修补号,小更新 +1(--bump patch,默认)
#   起步 2026.6.0。例:小更 2026.6.0->2026.6.1;大更 ->2026.7.0;跨年 ->2027.1.0
#   各端独立计数(windows/macos/linux 各一条);env 不进版本号(见规范 §3.5),--env 仅兼容保留。
#
# Usage:
#   bash bump-installer-version.sh -Platform macOS                 # 小更(默认)
#   bash bump-installer-version.sh -Platform macOS --bump minor    # 大更
#   bash bump-installer-version.sh -Platform macOS --dry-run

set -e

PLATFORM=""
ENV="prod"
BUMP="patch"
DRY_RUN=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -Platform|--platform|-p) PLATFORM="$2"; shift 2 ;;
        -Env|--env|-e) ENV="$2"; shift 2 ;;          # 兼容保留,不影响版本号
        --bump|-Bump|-b) BUMP="$2"; shift 2 ;;
        --dry-run|-DryRun) DRY_RUN=1; shift ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

if [[ "$PLATFORM" != "Windows" && "$PLATFORM" != "macOS" && "$PLATFORM" != "Linux" ]]; then
    echo "Usage: $0 -Platform <Windows|macOS|Linux> [--bump patch|minor] [--dry-run]" >&2
    exit 1
fi
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" ]]; then
    echo "Invalid --bump: $BUMP (must be patch|minor)" >&2; exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRANDING_ROOT/../.." && pwd)"
LOG_FILE="$REPO_ROOT/docs/installer-versions.md"
JSON_FILE="$BRANDING_ROOT/installer-versions.json"

[[ -f "$LOG_FILE" ]] || { echo "version log not found: $LOG_FILE" >&2; exit 1; }
[[ -f "$JSON_FILE" ]] || { echo "installer-versions.json not found: $JSON_FILE" >&2; exit 1; }

case "$PLATFORM" in
    Windows) JSON_KEY="windows" ;;
    macOS)   JSON_KEY="macos" ;;
    Linux)   JSON_KEY="linux" ;;
esac

# 读当前版本(per-platform 独立)
CURRENT=$(grep -oE "\"$JSON_KEY\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$JSON_FILE" | sed -E 's/.*"([^"]*)"$/\1/')
if [[ -z "$CURRENT" ]]; then
    echo "installer-versions.json missing platform key '$JSON_KEY'" >&2; exit 1
fi
if [[ ! "$CURRENT" =~ ^([0-9]{4})\.([0-9]+)\.([0-9]+)$ ]]; then
    # 必须 3 段 semver;旧 4 段日历号已废,详见版本号规范 §三
    echo "version '$CURRENT' is not 3-part semver (YYYY.MINOR.PATCH). Old 4-part calendar scheme retired; set semver (e.g. 2026.6.0) in installer-versions.json." >&2
    exit 1
fi
CUR_YEAR=${BASH_REMATCH[1]}; CUR_MINOR=${BASH_REMATCH[2]}; CUR_PATCH=${BASH_REMATCH[3]}
THIS_YEAR=$(date +%Y)

if [[ "$THIS_YEAR" -gt "$CUR_YEAR" ]]; then
    NEW_VERSION="$THIS_YEAR.1.0"; HOW="year-rollover ($CUR_YEAR->$THIS_YEAR)"
elif [[ "$BUMP" == "minor" ]]; then
    NEW_VERSION="$CUR_YEAR.$((CUR_MINOR + 1)).0"; HOW="minor (feature wave, MINOR+1)"
else
    NEW_VERSION="$CUR_YEAR.$CUR_MINOR.$((CUR_PATCH + 1))"; HOW="patch (fix, PATCH+1)"
fi

echo "[bump] platform=$PLATFORM, $CURRENT -> $NEW_VERSION [$HOW]"

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[bump] DRY RUN, no files changed."
    echo "VERSION=$NEW_VERSION"
    exit 0
fi

# 1. Prepend 占位条目到台账
TIMESTAMP="$(date '+%Y-%m-%d %H:%M')"
PLACEHOLDER="
## [$PLATFORM] $NEW_VERSION - $TIMESTAMP

(to be filled: commits / plugin / installer path after ship)

---"
FIRST_HEADER_LINE=$(grep -n '^## ' "$LOG_FILE" | head -1 | cut -d: -f1)
if [[ -n "$FIRST_HEADER_LINE" ]]; then
    head -n $((FIRST_HEADER_LINE - 1)) "$LOG_FILE" > "$LOG_FILE.tmp"
    echo "$PLACEHOLDER" >> "$LOG_FILE.tmp"
    tail -n +"$FIRST_HEADER_LINE" "$LOG_FILE" >> "$LOG_FILE.tmp"
    mv "$LOG_FILE.tmp" "$LOG_FILE"
else
    echo "$PLACEHOLDER" >> "$LOG_FILE"
fi
echo "[bump] prepended placeholder to $LOG_FILE"

# 2. Update installer-versions.json 对应平台 key(surgical sed,保留格式)
sed -i.bak "s|\"$JSON_KEY\"[[:space:]]*:[[:space:]]*\"[^\"]*\"|\"$JSON_KEY\": \"$NEW_VERSION\"|" "$JSON_FILE"
rm -f "$JSON_FILE.bak"
if ! grep -q "\"$JSON_KEY\"[[:space:]]*:[[:space:]]*\"$NEW_VERSION\"" "$JSON_FILE"; then
    echo "[bump] ERROR: failed to update $JSON_FILE for key=$JSON_KEY" >&2; exit 1
fi
echo "[bump] updated $JSON_FILE -> $JSON_KEY=$NEW_VERSION"

# 3. Output new version (caller 解析)
echo "VERSION=$NEW_VERSION"
