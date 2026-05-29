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
  - `viewer_agent_id=4` identifies the Halo agent using the board. It is sent as API context and used as the lookup key for that agent's Halo-backed preferences.
  - `current_agent_id=4` and `dispatch_agent_id=4` are accepted aliases.
- Query parameters do not directly set board preferences, filters, selected calendars, theme, or orientation.

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
   - `HALO_USER_PREF_REPORT_ID` and `HALO_SAVED_FILTER_REPORT_ID` point to the published Halo reports used to read shared storage.
   - `HALO_USER_PREF_TABLE_ID` and `HALO_SAVED_FILTER_TABLE_ID` point to the Halo custom tables used to write shared storage. Current defaults are `1015` and `1014`.
   - `DISPATCH_TEST_TOKEN` is an optional temporary shared token that protects Worker actions during testing.

5. Store secrets:

   ```powershell
   wrangler secret put HALO_CLIENT_ID
   wrangler secret put HALO_CLIENT_SECRET
   wrangler secret put HALO_REPORT_BEARER_TOKEN
   wrangler secret put DISPATCH_TEST_TOKEN
   ```

   `HALO_REPORT_BEARER_TOKEN` is the bearer token from the published Halo reports used for user preferences and saved filters.
   If `DISPATCH_TEST_TOKEN` is set, open the board with `?viewer_agent_id=4&dispatch_token=your-token`. The token is sent to the Worker as `X-Dispatch-Token` for dashboard actions.

6. Deploy:

   ```powershell
   wrangler deploy
   ```

7. The dashboard defaults to `https://halo-dispatch-api.chadbrewyet.workers.dev/` for live HaloPSA access. Open Settings only if you need to override the Worker URL or enable `Mock mode` for local UI testing without Halo calls.

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
- dispatch user preferences and saved filters: `GET /api/ReportData/{id}` for reads, `POST /api/CustomTable` for writes

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
- ticket list filters support categorical include/exclude conditions plus date and number operators such as before, after, on, greater than, less than, and between.

Technician and team display names are loaded from `GET /api/Agent`. A technician is included when the agent has a `teams` array entry where `in_section` is `true`; the Settings drawer filters agents by selected team memberships.

## Recommended Halo Storage Tables

The app can now sync local browser settings to Halo custom tables through the Worker. Storage reads use Halo reports because CustomTable reads may return the table schema without row data. Local storage remains the immediate fallback, so the board still works if a report or custom-table column name needs adjustment.

Current read reports:

- User preferences published report ID: `7ff3826a-f693-43dd-a7dc-333acf2d0a63`
- Saved filters published report ID: `267cb7b5-35de-48e6-baf8-936feaf90949`

### DispatchBoardUserPreferences

Current table ID: `1015`. One row per Halo agent.

- `CFDispatchAgentID` text/integer, unique by agent
- `CFDispatchTheme` text
- `CFDispatchOrientation` text
- `CFDispatchSelectedTeams` long text containing a JSON array
- `CFDispatchSelectedAgents` long text containing a JSON array
- `CFDispatchPanelPinned` checkbox
- `CFDispatchPanelWidth` text/integer
- `CFDispatchCalendarStartTime` text
- `CFDispatchCalendarEndTime` text
- `CFDispatchTechThemes` long text containing JSON
- `CFDispatchVisibleTickets` long text containing a JSON array
- `CFDispatchCreatedAt` text/date
- `CFDispatchUpdatedAt` text/date

### DispatchBoardSavedFilters

Current table ID: `1014`. Shared ticket-list definitions available to all dispatch users.

- `CFDispatchFilterName` text, unique
- `CFDispatchFilterTitle` text
- `CFDispatchFilterColor` text
- `CFDispatchFilterConditions` long text containing a JSON array
- `CFDispatchFilterCreatedBy` text/integer
- `CFDispatchFilterUpdatedBy` text/integer
- `CFDispatchFilterActive` checkbox
- `CFDispatchFilterCreatedAt` text/date
- `CFDispatchFilerUpdatedAt` text/date

The Worker defaults to those column names. If your Halo table uses different names, set these Worker variables:

- `HALO_PREF_AGENT_FIELD`
- `HALO_PREF_THEME_FIELD`
- `HALO_PREF_ORIENTATION_FIELD`
- `HALO_PREF_SELECTED_TEAMS_FIELD`
- `HALO_PREF_SELECTED_AGENTS_FIELD`
- `HALO_PREF_PANEL_PINNED_FIELD`
- `HALO_PREF_PANEL_WIDTH_FIELD`
- `HALO_PREF_CALENDAR_START_FIELD`
- `HALO_PREF_CALENDAR_END_FIELD`
- `HALO_PREF_TECH_THEMES_FIELD`
- `HALO_PREF_VISIBLE_TICKETS_FIELD`
- `HALO_FILTER_NAME_FIELD`
- `HALO_FILTER_TITLE_FIELD`
- `HALO_FILTER_COLOR_FIELD`
- `HALO_FILTER_CONDITIONS_FIELD`
- `HALO_FILTER_CREATED_BY_FIELD`
- `HALO_FILTER_UPDATED_BY_FIELD`
- `HALO_FILTER_ACTIVE_FIELD`
- `HALO_FILTER_CREATED_AT_FIELD`
- `HALO_STORAGE_CREATED_AT_FIELD`
- `HALO_STORAGE_UPDATED_AT_FIELD`

Example `CFDispatchFilterConditions`:

```json
[
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
```

## Production Hardening Notes

- Add a Worker-side authorization check before broad rollout. Good options are Cloudflare Access, a Halo-issued signed iframe token, or another short-lived server-side validation flow.
- Keep `HALO_DEBUG_LOGS` unset or false in production. Enable it temporarily only while troubleshooting Worker/Halo payload mappings.
- Confirm the custom-table row update shape in the live tenant. The Worker uses a conservative insert/update payload based on Halo Swagger, but custom table field names may need to be adjusted in Worker variables.

## Still Needed From HaloPSA

To finish the live ticket views, we still need:

- the custom field ID for `Service Zone` if Halo does not return it by name in normal ticket loads
