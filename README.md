# Halo Dispatch Board

Dispatch dashboard prototype for assigning HaloPSA service tickets to technicians.

## Current Structure

- `index.html` - GitHub Pages entry point.
- `assets/styles.css` - dashboard styling and themes.
- `assets/app.js` - dashboard interaction logic.
- `worker/halo-proxy.js` - Cloudflare Worker API proxy scaffold.
- `wrangler.toml.example` - starter Cloudflare Worker config.

## Recommended Deployment

Use GitHub Pages for the frontend and Cloudflare Workers for HaloPSA API calls.

The browser should never store the HaloPSA client secret. The Worker keeps HaloPSA credentials in Cloudflare secrets, retrieves OAuth tokens, and proxies approved API actions.

## Cloudflare Worker Setup

1. Install Wrangler locally or use Cloudflare's dashboard/deployment flow.
2. Copy `wrangler.toml.example` to `wrangler.toml`.
3. Fill in your HaloPSA API details from:

   `HaloPSA > Configuration > Integrations > HaloPSA API > API Details`

4. Store secrets:

   ```powershell
   wrangler secret put HALO_CLIENT_ID
   wrangler secret put HALO_CLIENT_SECRET
   ```

5. Deploy:

   ```powershell
   wrangler deploy
   ```

6. In the dashboard, open Settings and set `Worker API URL` to the deployed Worker URL.

## Still Needed From HaloPSA

To wire the real drag/drop actions, we need the tenant-specific `/apidoc` details for:

- report execution / report result endpoint
- ticket update endpoint and payload shape for assigning an agent
- appointment creation endpoint and payload shape
- all-day task creation endpoint and payload shape
- custom ticket date field ID and update shape
- ticket deep-link URL format

Until those endpoint mappings are added in `worker/halo-proxy.js`, the Worker accepts dashboard actions and returns an `unmapped` response instead of calling HaloPSA.
