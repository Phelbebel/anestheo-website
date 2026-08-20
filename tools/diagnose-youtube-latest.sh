#!/usr/bin/env bash
# ============================================================================
# diagnose-youtube-latest.sh
#
# WHY THIS EXISTS
# ---------------
# The homepage's "latest videos" section renders a channel fallback whenever
# the feed is unavailable. The Edge Function answers HTTP 200 with { error: … }
# so it can never break a page, which is right — but it means the difference
# between "no API key", "restricted key", "not deployed" and "handle does not
# resolve" is invisible from the outside unless you actually read the body.
#
# This reads it, and says which of those it is.
#
# USAGE
#   tools/diagnose-youtube-latest.sh                # uses the project defaults
#   YT_KEY=AIza… tools/diagnose-youtube-latest.sh   # also tests the key directly
#
# Needs outbound access to *.supabase.co and www.googleapis.com.
# ============================================================================
set -uo pipefail

SUPA="${SUPA_URL:-https://zaptzjohvgwayvytntyb.supabase.co}"
CHANNEL="${YT_CHANNEL:-@anestheo}"
ANON="${SUPA_ANON:-$(sed -n "s/.*SUPA_ANON *= *'\([^']*\)'.*/\1/p" "$(dirname "$0")/../supabase.js" | head -1)}"
EP="$SUPA/functions/v1/youtube-latest?channel=$CHANNEL&max=3"

echo "endpoint: $EP"
echo

BODY=$(mktemp); CODE=$(curl -sS -o "$BODY" -w '%{http_code}' --max-time 30 \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "$EP" 2>&1) || CODE=000

echo "HTTP $CODE"
echo "--- body ---"
head -c 2000 "$BODY"; echo; echo "------------"
echo

case "$CODE" in
  000)
    echo "VERDICT: could not reach the endpoint at all."
    echo "  Network, DNS or an egress policy. Nothing can be concluded about the"
    echo "  function from here. Re-run from a host that can reach *.supabase.co." ;;
  404)
    echo "VERDICT: the function is NOT DEPLOYED (or is named differently)."
    echo "  FIX (Supabase, not GitHub):"
    echo "    supabase functions deploy youtube-latest --no-verify-jwt" ;;
  401|403)
    echo "VERDICT: the request was REJECTED BEFORE the function ran."
    echo "  Almost always JWT verification still being on."
    echo "  FIX (Supabase, not GitHub):"
    echo "    supabase functions deploy youtube-latest --no-verify-jwt" ;;
  200)
    if grep -q '"error"[[:space:]]*:[[:space:]]*"not_configured"' "$BODY"; then
      echo "VERDICT: the YOUTUBE_API_KEY secret is MISSING."
      echo "  FIX (Supabase, not GitHub):"
      echo "    supabase secrets set YOUTUBE_API_KEY=AIza…"
      echo "    supabase functions deploy youtube-latest --no-verify-jwt   # reload secrets"
    elif grep -q 'invalid_channel_id' "$BODY"; then
      echo "VERDICT: YOUTUBE_CHANNEL_ID is malformed. A channel id is UC plus 22"
      echo "  characters, 24 in total. The body above gives the length it received."
      echo "  FIX (Supabase, not GitHub): re-copy the id from the channel's About"
      echo "  page or its URL, then re-set the secret and redeploy."
    elif grep -qE 'channel_not_found|handle_not_found' "$BODY"; then
      echo "VERDICT: the key works, but the channel could not be found."
      echo "  Check the id/handle in the body above against the real channel."
    elif grep -q '"error"' "$BODY"; then
      echo "VERDICT: the function ran and the YOUTUBE DATA API refused it."
      echo "  A 403 here is normally one of:"
      echo "    · the key is HTTP-referrer restricted. A Supabase Edge Function is a"
      echo "      SERVER, it sends no Referer, so a referrer restriction can never"
      echo "      match. Use an unrestricted-by-referrer key restricted instead to"
      echo "      the YouTube Data API v3 only (API restriction, not application)."
      echo "    · YouTube Data API v3 is not enabled on the project."
      echo "    · the daily quota is exhausted."
      echo "  A 400 normally means the key itself is invalid."
    elif [ "$(tr -d '[:space:]' < "$BODY")" = "[]" ]; then
      echo "VERDICT: the function ran, the API answered, and the CHANNEL HANDLE"
      echo "  DID NOT RESOLVE. channels?forHandle=${CHANNEL#@} returned no items."
      echo "  Check the handle is exactly right, or set the channel id instead."
    else
      N=$(grep -o '"id"' "$BODY" | wc -l | tr -d ' ')
      echo "VERDICT: WORKING. $N video(s) returned."
      echo "  IDs:"; grep -o '"id":"[^"]*"' "$BODY" | sed 's/"id":"/    /;s/"$//'
    fi ;;
  *) echo "VERDICT: unexpected HTTP $CODE. Read the body above." ;;
esac
rm -f "$BODY"

# Optional: test the key directly, the same two calls the function makes.
if [ -n "${YT_KEY:-}" ]; then
  echo; echo "=== the key, tested directly against the YouTube Data API ==="
  H="${CHANNEL#@}"
  echo "--- channels?forHandle=$H"
  curl -sS --max-time 25 \
    "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=$H&key=$YT_KEY" \
    | head -c 1200; echo
  echo "  A 403 with reason 'ipRefererBlocked' confirms the referrer-restriction"
  echo "  diagnosis above: the restriction cannot be satisfied by a server."
fi
