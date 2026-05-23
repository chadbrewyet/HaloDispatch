# Halo Dispatch Board

Dispatch dashboard prototype for assigning HaloPSA service tickets to technicians.

## Current Structure

- `index.html` - GitHub Pages entry point.
- `assets/styles.css` - dashboard styling and themes.
- `assets/app.js` - dashboard interaction logic.
- `worker/halo-proxy.js` - Cloudflare Worker API proxy scaffold.
- `wrangler.toml.example` - starter Cloudflare Worker config.

## Architecture Notes

- The frontend stores temporary board preferences in browser `localStorage`.
- The Cloudflare Worker is the only component that should call HaloPSA with API credentials.
- The Worker intentionally exposes only explicit dashboard actions. Do not add a generic Halo API passthrough route.
- The dashboard accepts iframe query parameters for initial context:
  - `agent_id=14` or `agent_ids=14,17`
  - `team_id=3` or `team_ids=1,3`
  - `theme=light|dark`
  - `orientation=horizontal|vertical`
- Query parameters seed the local board state. Long-term shared/user settings should move into Halo-backed storage.

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

   - `TECHNICIAN_MAP_JSON` is optional; numeric dashboard agent IDs are sent directly to Halo.
   - `HALO_DISPATCH_DATE_FIELD_ID` is the custom ticket date field used by the without-time section.
   - `HALO_APPOINTMENT_TYPE_ID` is optional if you want all dispatch appointments to use a specific Halo appointment type.
   - `HALO_DISPLAY_TIME_ZONE` controls how Halo calendar times are shown on the dispatch board.
   - `HALO_PAGE_SIZE` and `HALO_MAX_PAGES` control paginated Halo reads. The default page size is `100`.
   - `HALO_USER_PREF_TABLE_ID` and `HALO_SAVED_FILTER_TABLE_ID` point to the Halo custom tables used for shared storage. Current defaults are `1013` and `1014`.

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

## Automatic Worker Deploys

The repository includes a GitHub Actions workflow that deploys the Cloudflare Worker when changes are pushed to `main` under `worker/**`, `wrangler.toml`, or the workflow file itself.

Add these GitHub repository secrets before relying on automatic deploys:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The API token should have permission to edit Workers for the Cloudflare account that owns `halo-dispatch-api`.

## Implemented HaloPSA API Mappings

The Worker now maps dashboard actions to the HaloPSA Swagger endpoints:

- ticket type filter load: `GET /api/TicketType`
- open ticket load: `GET /api/Tickets`
- calendar appointment load: `GET /api/Appointment`
- without-time task load: `GET /api/Tickets`
- timed appointment creation: `POST /api/Appointment`
- all-day task creation: `POST /api/Appointment`
- without-time assignment: `POST /api/Tickets`
- scheduled-to-without-time moves: `DELETE /api/Appointment/{id}` then `POST /api/Tickets`
- dispatch user preferences and saved filters: `GET /api/CustomTable/{id}?includedetails=true` and `POST /api/CustomTable`

Moving an already scheduled appointment to a new time, technician, all-day section, or without-time section uses the loaded Halo `appointment_id` and updates Halo directly.

Appointment refresh can be configured in Settings. The default is every 5 minutes, with a manual-only option available.
Ticket list refresh can also be configured in Settings. The default is every 2 minutes, with a manual-only option available.

Ticket, ticket type, appointment, and without-time task loads use paginated Halo reads so the board is not capped at the first response page.

Write actions are optimistic for responsiveness, but the frontend now snapshots the dispatch state before a Halo write. If Halo rejects the update, the board restores the previous local state and displays a failure toast.

Current Halo configuration:

- agent/team selection is loaded from `GET /api/Agent`
- ticket lists are loaded from `GET /api/Tickets`
- ticket type filters are loaded from `GET /api/TicketType`
- without-time task date field: `CFTaskWithoutTimeDate` / `486`
- ticket URL prefix: `https://gagepsa.halopsa.com/ticket?id=`

Technician and team display names are loaded from `GET /api/Agent`. A technician is included when the agent has a `teams` array entry where `in_section` is `true`; the Settings drawer filters agents by selected team memberships.

## Recommended Halo Storage Tables

The app can now sync local browser settings to Halo custom tables through the Worker. Local storage remains the immediate fallback, so the board still works if a custom-table column name needs adjustment.

### DispatchBoardUserPreferences

Current table ID: `1013`. One row per Halo agent.

- `agent_id` integer, unique
- `preferences_json` long text
- `updated_at` date/time

### DispatchBoardSavedFilters

Current table ID: `1014`. Shared ticket-list definitions available to all dispatch users.

- `filter_name` text, unique
- `list_title` text
- `color` text
- `filter_json` long text
- `deleted` boolean
- `updated_by_agent_id` integer
- `updated_at` date/time

The Worker defaults to those column names. If your Halo table uses different names, set these Worker variables:

- `HALO_PREF_AGENT_FIELD`
- `HALO_PREF_JSON_FIELD`
- `HALO_FILTER_NAME_FIELD`
- `HALO_FILTER_TITLE_FIELD`
- `HALO_FILTER_COLOR_FIELD`
- `HALO_FILTER_JSON_FIELD`
- `HALO_FILTER_DELETED_FIELD`
- `HALO_FILTER_UPDATED_BY_FIELD`
- `HALO_STORAGE_UPDATED_AT_FIELD`

Example `filter_json`:

```json
{
  "name": "Dispatch Triage",
  "title": "Dispatch Triage",
  "color": "#1976a3",
  "conditions": [
    {
      "joiner": "and",
      "mode": "include",
      "field": "team",
      "values": ["3", "11"]
    },
    {
      "joiner": "and",
      "mode": "exclude",
      "field": "status",
      "values": ["Closed", "Completed"]
    }
  ]
}
```

## Production Hardening Notes

- Add a Worker-side authorization check before broad rollout. Good options are Cloudflare Access, a Halo-issued signed iframe token, or another short-lived server-side validation flow.
- Keep `HALO_DEBUG_LOGS` unset or false in production. Enable it temporarily only while troubleshooting Worker/Halo payload mappings.
- Confirm the custom-table row update shape in the live tenant. The Worker uses a conservative insert/update payload based on Halo Swagger, but custom table field names may need to be adjusted in Worker variables.

## Still Needed From HaloPSA

To finish the live ticket views, we still need:

- the custom field ID for `Service Zone` if Halo does not return it by name in normal ticket loads
