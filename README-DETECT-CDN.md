# Detect CDN for Customer URLs

Script to detect which **CDN** (Content Delivery Network) a customer site uses by requesting the site and inspecting HTTP response headers. No need to know the “most popular” CDNs in advance—detection is **on the fly** using a broad set of header patterns.

## Quick start

```bash
# Single URL
./detect-cdn.sh https://www.example.com

# Multiple URLs
./detect-cdn.sh https://site1.com https://site2.com

# From a file (one URL per line; lines starting with # are skipped)
./detect-cdn.sh -f customer-urls.txt

# From stdin (e.g. paste or pipe)
cat urls.txt | ./detect-cdn.sh
```

**Output:** TSV with columns `URL` and `CDN` (e.g. `Cloudflare`, `Akamai`, `Fastly`, `unknown`, or `error (no response)`).

## How it works

1. For each URL, the script runs **`curl -sI -L`** (HEAD request, follow redirects) with a browser-like User-Agent.
2. Response headers are matched against known CDN signatures (header names and values).
3. The first matching CDN is returned; if none match, result is **unknown**.

Detection uses **headers only** (no DNS CNAME lookup). That’s enough for most enterprise sites because CDNs typically add identifying headers (e.g. Cloudflare’s `cf-ray`, Akamai’s `x-akamai-*`, Fastly’s `x-served-by`, CloudFront’s `x-amz-cf-id`).

## CDNs detected

| CDN | Example headers |
|-----|-----------------|
| **Cloudflare** | `cf-ray`, `cf-cache-status`, `server: cloudflare` |
| **Akamai** | `x-akamai-*`, `akamai-origin-hop`, `server: AkamaiGHost` |
| **Fastly** | `x-served-by`, `x-fastly-request-id`, `via: ... Fastly` |
| **AWS CloudFront** | `x-amz-cf-id`, `x-amz-cf-pop`, `via: ... CloudFront` |
| **Azure Front Door / Azure CDN** | `x-azure-ref`, `x-ec-debug`, `x-fd-healthprobe` |
| **Google Cloud CDN** | `via: ... Google`, `x-goog-*` |
| **Imperva** | `x-iinfo`, `x-cdn: Incapsula/Imperva` |
| **Vercel** | `x-vercel-id`, `server: Vercel` |
| **Netlify** | `x-nf-request-id`, `server: Netlify` |
| **KeyCDN** | `x-edge-location`, `server: keycdn` |
| **Limelight** | `x-llid`, `x-llrid` |
| **CDNetworks** | `x-cdn-request-id` |
| **Bunny CDN** | `x-bunny-*` |
| **StackPath** | `server: NetDNA` |
| **Sucuri** | `x-sucuri-id` |

You can extend the script by adding more `grep -qiE` checks in `detect_cdn()`.

## Customer list input

- **Manual file:** Put one base URL per line in a text file (e.g. `customer-urls.txt`), then run `./detect-cdn.sh -f customer-urls.txt`.
- **From Spacecat/API:** If you export your customer/site list (e.g. from the backoffice or an API that returns `baseURL`), save the URLs to a file and use `-f` as above.
- **Single / few URLs:** Pass them as arguments or pipe them in.

## Options and env vars

| Option | Description |
|--------|-------------|
| `-f FILE` | Read URLs from `FILE` (one per line). |

| Env var | Default | Description |
|---------|---------|-------------|
| `TIMEOUT` | `10` | Curl timeout in seconds per URL. |
| `USER_AGENT` | Chrome-like string | User-Agent sent with the request (some CDNs vary headers by UA). |

Example with a longer timeout:

```bash
TIMEOUT=15 ./detect-cdn.sh -f urls.txt
```

## Making the script executable

If needed:

```bash
chmod +x detect-cdn.sh
```
