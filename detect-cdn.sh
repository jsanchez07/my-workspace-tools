#!/usr/bin/env bash
#
# Detect CDN for one or more customer URLs using HTTP response headers.
# Usage:
#   ./detect-cdn.sh https://example.com
#   ./detect-cdn.sh https://site1.com https://site2.com
#   cat urls.txt | ./detect-cdn.sh
#   ./detect-cdn.sh -f customer-urls.txt
#
# Output: URL <tab> CDN (or "unknown")
# Uses curl -sI and matches known CDN header patterns (on-the-fly detection).

set -e

USER_AGENT="${USER_AGENT:-Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36}"
TIMEOUT="${TIMEOUT:-10}"

# Read URLs from file or args or stdin
get_urls() {
  if [[ -n "$URL_FILE" ]]; then
    cat "$URL_FILE"
  elif [[ $# -gt 0 ]]; then
    printf '%s\n' "$@"
  else
    cat
  fi
}

# Normalize URL: ensure scheme, strip trailing slash for consistency
normalize_url() {
  local u="$1"
  if [[ "$u" != http://* && "$u" != https://* ]]; then
    u="https://$u"
  fi
  printf '%s' "$u"
}

# Fetch headers (one line per header, lowercase name: value)
fetch_headers() {
  local url="$1"
  curl -sI -L --max-time "$TIMEOUT" -A "$USER_AGENT" "$url" | sed 's/\r$//' | while IFS= read -r line; do
    if [[ "$line" =~ ^([^:]+):(.+)$ ]]; then
      key=$(echo "${BASH_REMATCH[1]}" | tr 'A-Z' 'a-z' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      val=$(echo "${BASH_REMATCH[2]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      printf '%s: %s\n' "$key" "$val"
    fi
  done
}

# Detect CDN from header map (we build a single string of "key:value" lines for matching)
detect_cdn() {
  local headers="$1"
  local cdn="unknown"

  # Cloudflare (very common)
  if echo "$headers" | grep -qiE '^cf-ray:'; then cdn="Cloudflare"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^cf-cache-status:'; then cdn="Cloudflare"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^server:.*cloudflare'; then cdn="Cloudflare"; fi

  # Akamai
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-akamai-'; then cdn="Akamai"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^akamai-origin-hop:'; then cdn="Akamai"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^server:.*akamaighost'; then cdn="Akamai"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-akamai-transformed:'; then cdn="Akamai"; fi

  # Fastly (AEM CS, Commerce, BYO)
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-served-by:'; then cdn="Fastly"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-fastly-request-id:'; then cdn="Fastly"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^fastly-ff:'; then cdn="Fastly"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^via:.*[Ff]astly'; then cdn="Fastly"; fi

  # AWS CloudFront
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-amz-cf-id:'; then cdn="CloudFront"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-amz-cf-pop:'; then cdn="CloudFront"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^via:.*[Cc]loud[Ff]ront'; then cdn="CloudFront"; fi

  # Azure Front Door / Azure CDN
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-azure-ref:'; then cdn="Azure Front Door / Azure CDN"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-ec-debug:'; then cdn="Azure CDN"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-fd-healthprobe:'; then cdn="Azure Front Door"; fi

  # Google Cloud CDN
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^via:.*[Gg]oogle'; then cdn="Google Cloud CDN"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-goog-'; then cdn="Google Cloud CDN"; fi

  # Imperva / Incapsula
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-iinfo:'; then cdn="Imperva"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-cdn:.*[Ii]ncapsula'; then cdn="Imperva"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-cdn:.*[Ii]mperva'; then cdn="Imperva"; fi

  # Other common enterprise / edge
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-vercel-id:'; then cdn="Vercel"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^server:.*[Vv]ercel'; then cdn="Vercel"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-nf-request-id:'; then cdn="Netlify"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^server:.*[Nn]etlify'; then cdn="Netlify"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-edge-location:'; then cdn="KeyCDN"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^server:.*[Kk]eycdn'; then cdn="KeyCDN"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-llid:'; then cdn="Limelight"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-llrid:'; then cdn="Limelight"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-cdn-request-id:'; then cdn="CDNetworks"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-bunny-'; then cdn="Bunny CDN"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^server:.*[Nn]etDNA'; then cdn="StackPath"; fi
  if [[ "$cdn" == "unknown" ]] && echo "$headers" | grep -qiE '^x-sucuri-id:'; then cdn="Sucuri"; fi

  echo "$cdn"
}

# Parse -f <file> if present
URL_FILE=""
while getopts "f:" opt; do
  case $opt in
    f) URL_FILE="$OPTARG" ;;
    *) exit 1 ;;
  esac
done
shift $((OPTIND - 1))

# Header row
printf '%s\t%s\n' "URL" "CDN"

get_urls "$@" | while IFS= read -r raw_url || [[ -n "$raw_url" ]]; do
  raw_url=$(echo "$raw_url" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [[ -z "$raw_url" ]] && continue
  [[ "$raw_url" == \#* ]] && continue
  url=$(normalize_url "$raw_url")
  headers=$(fetch_headers "$url" 2>/dev/null) || true
  if [[ -z "$headers" ]]; then
    printf '%s\t%s\n' "$url" "error (no response)"
  else
    cdn=$(detect_cdn "$headers")
    printf '%s\t%s\n' "$url" "$cdn"
  fi
done
