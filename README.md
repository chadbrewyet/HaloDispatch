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
3. Confirm your HaloPSA API details from:

   `HaloPSA > Configuration > Integrations > HaloPSA API > API Details`

   The current tenant Swagger spec is available at:

   `https://gagepsa.halopsa.com/api/swagger/v2/swagger.json`

4. Update the Worker variables in `wrangler.toml`:

   - `TECHNICIAN_MAP_JSON` maps dashboard technician IDs to Halo agent IDs.
   - `HALO_DISPATCH_DATE_FIELD_ID` is the custom ticket date field used by the without-time section.
   - `HALO_APPOINTMENT_TYPE_ID` is optional if you want all dispatch appointments to use a specific Halo appointment type.

5. Store secrets:

   ```powershell
   wrangler secret put HALO_CLIENT_ID
   wrangler secret put HALO_CLIENT_SECRET
   ```

6. Deploy:

   ```powershell
   wrangler deploy
   ```

7. In the dashboard, open Settings and set `Worker API URL` to the deployed Worker URL.

## Implemented HaloPSA API Mappings

The Worker now maps dashboard actions to the HaloPSA Swagger endpoints:

- report refresh: `GET /api/ReportData/{publishedid}`
- timed appointment creation: `POST /api/Appointment`
- all-day task creation: `POST /api/Appointment`
- without-time assignment: `POST /api/Tickets`

Moving an already scheduled appointment to a new time or technician is ready in the UI, but the Worker intentionally returns `local-only` until the dashboard is loading and storing real Halo `appointment_id` values. That avoids creating duplicate appointments while testing.

## Still Needed From HaloPSA

To finish the live integration, we still need:

- real Halo agent IDs for each visible technician
- published report IDs for the ticket lists
- the custom ticket date field ID for without-time tasks
- the ticket deep-link URL format
- live appointment loading so scheduled cards include `appointment_id` for persisted rescheduling
