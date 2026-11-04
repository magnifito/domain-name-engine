# How to get API keys

Checked: 2026-11-04

All keys are optional. The plugin works without them. Each key unlocks one extra feature. Get only the keys you want.

Some steps changed recently or sit behind pages we could not read. Where a step is unverified, the guide says "Not verified:" and tells you what to look for. Provider sites change often, so trust the screen in front of you over this guide.

## Where to put the keys

1. Export each key in the shell that starts `claude`. Add the lines to `~/.zshrc` or `~/.bashrc`, or load them from a secrets manager.

   ```sh
   export SPACESHIP_API_KEY="<your-key>"
   export SPACESHIP_API_SECRET="<your-secret>"
   ```

2. Open a new terminal so the shell reads the new values.
3. Start `claude` from that terminal.

The plugin's `.mcp.json` lists every variable as `"NAME": "${NAME:-}"`. Claude Code expands `${NAME}` to the shell value. `${NAME:-}` expands to an empty string when the variable is unset, so a missing key causes no warning. An empty string counts as set, so the server treats a blank value as "no key". The server reads the keys from its own environment only.

Rules:

- Never commit keys. Never put them in a project file.
- Never paste a key into the chat.
- Run `registrar_status` to see which keys the server found. It shows set or not set, never the values.

Official source: https://code.claude.com/docs/en/mcp (section "Environment variable expansion in .mcp.json").

## Summary

| Platform | Env vars | Cost | Approval wait | What the key unlocks |
|---|---|---|---|---|
| Spaceship | `SPACESHIP_API_KEY`, `SPACESHIP_API_SECRET` | Free | None | Live prices and availability. Premium name detection. |
| Namecheap | `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_CLIENT_IP` | Free to use, but your account needs 20 domains, USD 50 balance, or USD 50 spent in 2 years | Key appears almost immediately once eligible | Live prices and availability. Premium name detection. |
| Cloudflare | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Free | None | Live prices and availability for the TLDs the beta API supports. |
| GitHub | `GITHUB_TOKEN` | Free | None | Rate limit for the GitHub handle check rises from 60 to 5000 requests per hour. |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Free for approved non-commercial use | Reddit approval. Length not published. | Reddit username check. |
| YouTube | `YOUTUBE_API_KEY` | Free within quota | None | YouTube handle check. |
| EUIPO | `EUIPO_CLIENT_ID`, `EUIPO_CLIENT_SECRET`, `EUIPO_ENV` | Free | Sandbox: up to a week. Production: longer. | EU trademark search. |

Without the registrar keys, `registrar_quote` returns prices from the bundled table only, and premium names cannot be detected. Without the research keys, the matching checks return `unknown` with a reason.

---

## 1. Spaceship

Unlocks live availability and prices for `registrar_quote`. Without it, the bundled price table answers.

Docs: https://docs.spaceship.dev/

### Prerequisites

- A Spaceship account.

### Steps

1. Open the API Manager: https://www.spaceship.com/application/api-manager/
2. Click **New API key** and follow the guide.
3. Give the key the `domains:read` scope. Do not grant `domains:billing`.
4. Copy the key and the secret. Spaceship shows them on the API Manager page.
5. Export them:
   - `SPACESHIP_API_KEY` = the API key
   - `SPACESHIP_API_SECRET` = the API secret

### Least privilege

The plugin calls these endpoints under `https://spaceship.dev/api`:

- `POST /v1/domains/available` (availability)
- `POST /v1/domains/pricing/query` (domain prices)
- `GET /v1/tlds/pricing` (TLD price list, used by `pnpm refresh:tlds`)

The docs list `domains:read` for the first two. `domains:billing` is only for register, renew, restore and transfer. The plugin never calls those.

Not verified: the scope of `GET /v1/tlds/pricing`. The docs page was cut off before that section. If `pnpm refresh:tlds` fails with 403, look for that endpoint on https://docs.spaceship.dev/ and check its scope.

### Rate limits

Pricing calls are limited to 25 per 5 seconds per user. Over the limit you get HTTP 429.

### Verify

Restart Claude Code and ask: "Run `registrar_status`." Spaceship should show as set. Then ask for a quote on a domain and look for "live price from Spaceship API".

### Common errors

- 401 or 403: the key or secret is wrong, or the key lacks `domains:read`.
- 429: too many pricing calls. Wait a few seconds.

---

## 2. Namecheap

Unlocks live availability and prices. Without it, the bundled table answers.

Docs: https://www.namecheap.com/support/api/intro/ and https://www.namecheap.com/support/knowledgebase/article.aspx/9739/63/api-faq/

Note: Namecheap blocked automated reads of the first page (HTTP 403). The facts below come from the second page and from search results of Namecheap's official pages.

### Prerequisites

Your account must meet one of these:

- At least 20 domains.
- At least USD 50 account balance.
- At least USD 50 spent in the last 2 years.

If you meet none, you can contact Namecheap support. There is no extra fee for the API.

### Steps

1. Sign in to Namecheap.
2. Go to **Profile**, then **Tools**.
3. Under **Business & Dev Tools**, find **Namecheap API Access** and click **MANAGE**.
4. Switch API access on. Accept the terms. Enter your account password.
5. Copy the API key. It appears almost immediately.
6. Find your public IPv4 address (see below).
7. On the same page, click **Edit** next to **Whitelisted IPs**, then **Add IP**. Enter the IPv4 address and save.
8. Export:
   - `NAMECHEAP_API_USER` = your Namecheap account username
   - `NAMECHEAP_API_KEY` = the API key
   - `NAMECHEAP_CLIENT_IP` = the same IPv4 address you whitelisted

Not verified: the exact button labels in the current Namecheap UI. Look for "Namecheap API Access" and "Whitelisted IPs" under Profile, Tools.

### Find your public IPv4

Run this in a terminal:

```sh
curl -4 https://api.ipify.org
```

This is a third-party service, not an official Namecheap tool. Namecheap only accepts IPv4. If your ISP changes your address, update the allow list and `NAMECHEAP_CLIENT_IP`. Use a static IP or a VPN with a fixed exit address if your address changes often.

### Sandbox

The plugin does not support the Namecheap sandbox. It always calls `https://api.namecheap.com/xml.response`. Sandbox keys will not work.

### Least privilege

Namecheap API keys have no scopes. The plugin only calls `namecheap.domains.check`, `namecheap.users.getPricing` and `namecheap.domains.gettldlist`. All three only read data.

### Verify

Restart Claude Code and ask Claude to run `registrar_status`. Namecheap should show as set. Then ask for a quote.

### Common errors

- An error about an invalid or non-whitelisted IP: `NAMECHEAP_CLIENT_IP` does not match the allow list, or your public IP changed.
- Invalid API key or user: check `NAMECHEAP_API_USER` is your username.
- API access not available: your account does not meet the requirements above.

---

## 3. Cloudflare

Unlocks live availability and prices through the Cloudflare Registrar API. Without it, the bundled table answers.

Docs:

- https://developers.cloudflare.com/registrar/registrar-api/
- https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/

### Limits of the beta

The Registrar API is in beta. It supports only some extensions. For others, the check returns `extension_not_supported_via_api`, and the plugin shows the result as unknown. README lists .lol, .sh and .cc as examples.

### Steps: create the token

1. Sign in to the Cloudflare dashboard.
2. Open **My Profile**, then **API Tokens**. For an account-owned token, use **Manage Account**, then **API Tokens**.
3. Click **Create Token**. Choose a custom token, not a template.
4. Name it, for example `domain-name-engine`.
5. Set the permission to the Registrar permission (see below).
6. Limit the resources to your account.
7. Optional: set a TTL and Client IP Address Filtering.
8. Click **Continue to summary**, then **Create Token**.
9. Copy the token now. Cloudflare shows it once.

### Least privilege

The plugin calls one endpoint: `POST /accounts/{account_id}/registrar/domain-check`. It only reads data. It never registers a domain.

Cloudflare's Registrar API guide asks for "an API token with Registrar write permissions". That requirement covers the whole guide, including registration.

Not verified: whether a read-only Registrar permission is enough for `domain-check`. The docs do not say. The permissions reference does not list a Registrar group by name. To find the exact name, look in the token form for a Registrar entry under Account permissions, or call the List permission groups endpoint (`GET /accounts/{account_id}/tokens/permission_groups`). Try the lowest level that offers it. If the check fails with a permission error, raise it one level.

### Steps: find the account ID

Use any of these:

- Account home, press `Cmd/Ctrl + K`, type "Copy account ID", pick the result.
- **Domains**, open a domain, scroll to the **API** section on the Overview page, copy **Account ID**.
- **Workers & Pages**, find **Account Details**, copy **Account ID**.

### Env vars

- `CLOUDFLARE_API_TOKEN` = the token
- `CLOUDFLARE_ACCOUNT_ID` = the account ID

### Verify

Check the token without touching any domain:

```sh
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify
```

Cloudflare documents this endpoint. A good token returns `"success": true`. An account-owned token may need `/accounts/<account-id>/tokens/verify` instead. Not verified: which URL applies to your token type. Check the token page for the right one.

Then restart Claude Code, run `registrar_status`, and ask for a quote.

### Common errors

- 403 or an authentication error: the token lacks the Registrar permission, or the account ID is wrong.
- `extension_not_supported_via_api`: the beta does not cover that extension. This is not a key problem.

---

## 4. GitHub

Raises the rate limit of the GitHub handle check from 60 to 5000 requests per hour. Without it, the check still runs at the anonymous limit of 60 requests per hour. Once that runs out, expect `unknown` results with an HTTP status in the reason.

Docs:

- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

### Steps

1. Click your profile picture, then **Settings**.
2. In the left sidebar, click **Developer settings**.
3. Under **Personal access tokens**, click **Fine-grained tokens**.
4. Click **Generate new token**.
5. Enter a **Token name**, for example `domain-name-engine`.
6. Set a short **Expiration**. GitHub recommends one.
7. Set **Repository access** to the smallest option. Tokens always include read-only access to all public repositories, so no repository needs to be selected.
8. Add no permissions.
9. Click **Generate token** and copy it.
10. Export `GITHUB_TOKEN` = the token.

Not verified: the exact label of the "no repositories" option under **Repository access**. The docs name only **Only select repositories**. Look for an option for public repositories only, and pick it.

### Least privilege

The plugin only reads public user profiles (`GET https://api.github.com/users/<name>`). It needs no permissions.

### Verify

```sh
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/rate_limit
```

`core.limit` should read 5000. GitHub documents that this endpoint needs no permissions for fine-grained tokens.

### Common errors

- 401 Bad credentials: the token expired or was copied wrong. Create a new one.

---

## 5. Reddit

Enables the Reddit username check. Without it, the check returns `unknown`.

Docs:

- https://github.com/reddit-archive/reddit/wiki/OAuth2 (read OK)
- https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki (blocked, HTTP 403)
- https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy (blocked, HTTP 403)

Reddit's help centre blocked automated reads. The approval rules below come from search results of those official pages. Read the pages yourself before you apply.

### What the plugin uses

The plugin uses the application-only OAuth grant `client_credentials`. It posts to `https://www.reddit.com/api/v1/access_token` with the client ID and secret as HTTP Basic auth. Then it calls `https://oauth.reddit.com/user/<name>/about`. It acts for no user, so no user login is needed.

Per the OAuth2 wiki, `client_credentials` is for confidential clients: web apps and script apps. An installed app has no secret, so it cannot work here. Create a **script** app (or a **web** app).

### Access and approval

Reddit now requires explicit approval before you use the Data API, including for non-commercial use. You request access through a support ticket, and you must read the Responsible Builder Policy first. Key points from the policy:

- Say honestly how and why you use the data. Do not register several accounts or send several requests for one use case.
- Do not sell, license or commercialize Reddit data without written approval.
- Do not use the data to train machine learning or AI models.

The plugin only checks whether a username exists. It stores no Reddit content.

Not verified: how long approval takes, and whether new accounts can still create an app at https://www.reddit.com/prefs/apps without approval. Check the ticket form and the Data API Wiki.

### Steps

1. Sign in to Reddit.
2. Read the Responsible Builder Policy.
3. Submit the access request ticket. Describe the use case: checking whether usernames are free, a few requests per session.
4. After approval, open https://www.reddit.com/prefs/apps.
5. Click **are you a developer? create an app...**.
6. Enter a name and description. Choose **script**. Fill the redirect URI with `http://localhost` (the plugin never uses it).
7. Create the app.
8. Copy the client ID and the client secret from the app's entry.
9. Export:
   - `REDDIT_CLIENT_ID` = the client ID
   - `REDDIT_CLIENT_SECRET` = the client secret

Not verified: where the client ID sits on the app page. The wiki only says the secret is marked on the app's info screen. The client ID is normally the short string under the app's name. Never share the secret.

### Verify

Restart Claude Code, run `registrar_status`, then run `check_handles` for a name and look for the `reddit-api` source in the result.

### Common errors

- "Reddit token request returned HTTP 401": wrong ID or secret, or you pasted the ID into the secret.
- HTTP 403 or 429: access not approved, or rate limit hit.

---

## 6. YouTube

Enables the YouTube handle check. Without it, the check returns `unknown`.

Docs:

- https://developers.google.com/youtube/v3/getting-started
- https://docs.cloud.google.com/docs/authentication/api-keys

### Prerequisites

- A Google account.

### Steps

1. Open the Google Cloud console and create a project.
2. Open the API Library, search for **YouTube Data API v3**, and click **Enable**. Select your new project first.
3. Open the **Credentials** page.
4. Click **Create credentials**, then **API key**.
5. Add an API restriction: select **YouTube Data API v3** only. The console asks for at least one restriction before it creates the key.
6. Click **Create** and copy the key.
7. Export `YOUTUBE_API_KEY` = the key.

If the key exists already, open its name on the Credentials page, go to **API restrictions**, click **Restrict key**, pick **YouTube Data API v3**, and click **Save**. The API must be enabled in the project first.

Application restrictions (websites, IPs) do not fit a desktop tool well. API restriction alone is enough here.

Not verified: the exact name of the console menu that leads to the API Library. Look for "APIs & Services" or a search box for "API Library".

### Quota

The default quota is 10,000 units per day for most endpoints. The plugin uses `channels.list`, which costs 1 unit per call. Google says the default may change. Check the Quotas page in the console.

### Least privilege

The key is limited to one API and the plugin only reads public data.

### Verify

```sh
curl -s -H "x-goog-api-key: $YOUTUBE_API_KEY" \
  "https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=@YouTube"
```

You should get JSON with an `items` list. Do not put the key in the URL.

### Common errors

- 403 `API_KEY_SERVICE_BLOCKED` or "not enabled": enable YouTube Data API v3 in the project, or the key is restricted to a different API.
- 400 `API key not valid`: the key was copied wrong.
- 403 `quotaExceeded`: the daily quota ran out. Wait for the reset.

---

## 7. EUIPO

Enables the EU trademark search (`search_trademarks`). Without it, you only get search links for USPTO and WIPO, and no EUIPO results.

Docs:

- https://dev.euipo.europa.eu/getting-started
- https://dev.euipo.europa.eu/security
- https://dev.euipo.europa.eu

### Sandbox or production

- Sandbox (`https://dev-sandbox.euipo.europa.eu/`): test data. Newcomers start here. Subscription approval can take up to a week.
- Production: real trademark data. You apply after sandbox testing. Approval may take longer.

The plugin defaults to production. Set `EUIPO_ENV=sandbox` to use the sandbox. Sandbox results are test data and are not a real clearance search. Sandbox and production use separate apps and separate credentials.

### Steps

1. Register an EUIPO account on the EUIPO website. The portal links to the registration page under **Create account**.
2. Open the portal (sandbox or production) and click **Sign in**.
3. Open **Apps** in the top menu and register an app.
4. Copy the **Client ID** and **Client Secret** it shows.
5. Open **API Products**, find the **Trademark Search API**, and request a subscription to a plan. Accept the conditions of use and click **Next**.
6. Wait for approval. Most subscriptions need it.
7. Export:
   - `EUIPO_CLIENT_ID` = the client ID
   - `EUIPO_CLIENT_SECRET` = the client secret
   - `EUIPO_ENV=sandbox` while you test. Remove it or set it to `production` for real data.

Not verified: the production portal address and how the production application form looks. Open https://dev.euipo.europa.eu and look for a production apply step or a link to the production portal.

### OAuth flow and scope

The plugin uses the client credentials flow. It posts `grant_type=client_credentials`, the client ID and secret, and `scope=uid` to the token URL:

- Sandbox: `https://auth-sandbox.euipo.europa.eu/oidc/accessToken`
- Production: `https://euipo.europa.eu/cas-server-webapp/oidc/accessToken`

It then calls `/trademark-search/trademarks` with a bearer token and an `X-IBM-Client-Id` header. The sandbox access token lasts 8 hours. The `uid` scope is the only scope the plugin asks for. Not verified: the production token URL in the docs. The sandbox URL is documented on https://dev.euipo.europa.eu/security. Compare the production URL there.

### Verify

Restart Claude Code, run `registrar_status`, then ask Claude to search a trademark. The result names the environment it used.

### Common errors

- Token request HTTP 401: wrong ID or secret, or you used sandbox credentials with production (or the reverse). Check `EUIPO_ENV`.
- Search HTTP 401 or 403: the Trademark Search subscription is not approved yet.
- HTTP 429: you hit the plan's call limit.

---

## After you set the keys

1. Restart Claude Code from the shell that holds the exports.
2. Ask Claude to run `registrar_status`. Check each key you set shows as set.
3. Fill the price table. The Spaceship and Namecheap rows need their keys. The Cloudflare rows come from a public price file and need no key:

   ```sh
   cd server && pnpm refresh:tlds
   ```

   The script reads the keys from your environment only and never prints them. A registrar without keys is skipped and keeps its current rows. A failed or suspiciously small fetch also keeps the current rows.

Do not paste keys into the chat to debug. If something fails, check the "Common errors" part of the platform.
