#!/usr/bin/env bash
# Usage: upsert-comment.sh MARKER PR_NUMBER BODY_FILE
# Edits the pull request comment whose body starts with <!-- MARKER -->, or posts it if there is none,
# so each bot comment stays one comment however many times CI runs.
set -euo pipefail
marker="<!-- $1 -->"
pr="$2"
body="$3"
id=$(gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" --paginate --jq ".[] | select(.body | startswith(\"$marker\")) | .id" | head -n 1)
if [ -n "$id" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -F "body=@$body" > /dev/null
else
  gh pr comment "$pr" --body-file "$body"
fi
