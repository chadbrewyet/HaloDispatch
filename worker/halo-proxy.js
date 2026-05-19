const tokenCache = {
  accessToken: "",
  expiresAt: 0
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "halo-dispatch-api" });
      }

      if (url.pathname === "/api/halo/action" && request.method === "POST") {
        const body = await request.json();
        return json(await handleDashboardAction(body, env));
      }

      if (url.pathname.startsWith("/api/halo/") && request.method === "GET") {
        const haloPath = url.pathname.replace("/api/halo", "/api");
        return json(await haloRequest(env, haloPath + url.search, { method: "GET" }));
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      return json({ ok: false, error: error.message || String(error) }, 500);
    }
  }
};

async function handleDashboardAction(body, env) {
  const { action, payload = {} } = body || {};

  if (action === "refreshReports") {
    return handleReportRefresh(payload, env);
  }

  const mapped = mapDashboardAction(action, payload, env);

  if (!mapped) {
    return {
      ok: true,
      mode: "unmapped",
      message: "Action received by Worker. Add the Halo endpoint mapping after confirming tenant /apidoc fields.",
      action,
      payload
    };
  }

  if (mapped.localOnly) {
    return {
      ok: true,
      mode: "local-only",
      action: mapped.action,
      message: mapped.message
    };
  }

  return haloRequest(env, mapped.path, {
    method: mapped.method,
    body: mapped.body
  });
}

function mapDashboardAction(action, payload, env) {
  switch (action) {
    case "createAppointment":
      return {
        method: "POST",
        path: "/api/Appointment",
        body: [appointmentPayload(payload, env, { allDay: false })]
      };
    case "updateAppointment":
      if (!payload.appointmentId) {
        return {
          localOnly: true,
          action,
          message: "Halo appointment updates need the existing appointment_id. Load live Halo appointments before enabling persisted drag-to-reschedule."
        };
      }
      return {
        method: "POST",
        path: "/api/Appointment",
        body: [appointmentPayload(payload, env, { appointmentId: payload.appointmentId, allDay: false })]
      };
    case "createAllDayTask":
    case "moveToAllDayTask":
      return {
        method: "POST",
        path: "/api/Appointment",
        body: [appointmentPayload(payload, env, { appointmentId: payload.appointmentId, allDay: true })]
      };
    case "assignTicketDateOnly":
    case "moveToDateOnlyTask":
      return {
        method: "POST",
        path: "/api/Tickets",
        body: [ticketAssignmentPayload(payload, env)]
      };
    default:
      return null;
  }
}

async function handleReportRefresh(payload, env) {
  const reports = (payload.reports || [])
    .map(reportPublishedId)
    .filter(Boolean);

  if (!reports.length) {
    return {
      ok: true,
      mode: "configuration-needed",
      message: "Add Halo published report IDs in the dashboard settings before loading live report data.",
      reports: []
    };
  }

  const results = [];
  for (const publishedId of reports) {
    const result = await haloRequest(env, `/api/ReportData/${encodeURIComponent(publishedId)}`, { method: "GET" });
    results.push({ publishedId, data: result.data });
  }

  return { ok: true, reports: results };
}

function appointmentPayload(payload, env, options = {}) {
  const startTime = payload.startTime || "00:00";
  const duration = Number(payload.durationMinutes || 30);
  const startDate = options.allDay ? `${payload.date}T00:00:00` : combineDateTime(payload.date, startTime);
  const endDate = options.allDay ? `${payload.date}T23:59:59` : combineDateTime(payload.date, addMinutes(startTime, duration));

  return compactObject({
    id: options.appointmentId ? Number(options.appointmentId) : undefined,
    ticket_id: Number(payload.ticketId),
    agent_id: haloAgentId(payload.technicianId, env),
    start_date: startDate,
    end_date: endDate,
    allday: Boolean(options.allDay),
    note: payload.notes || undefined,
    status: payload.status || undefined,
    appointment_type_id: env.HALO_APPOINTMENT_TYPE_ID ? Number(env.HALO_APPOINTMENT_TYPE_ID) : undefined,
    reassign_ticket: payload.assignTicket !== false
  });
}

function ticketAssignmentPayload(payload, env) {
  const dateFieldId = env.HALO_DISPATCH_DATE_FIELD_ID;
  if (!dateFieldId) {
    throw new Error("Missing Worker variable: HALO_DISPATCH_DATE_FIELD_ID");
  }

  return {
    id: Number(payload.ticketId),
    agent_id: haloAgentId(payload.technicianId, env),
    customfields: [
      {
        id: Number(dateFieldId),
        name: env.HALO_DISPATCH_DATE_FIELD_NAME || "CFTaskWithoutTimeDate",
        value: payload.dateFieldValue || payload.date
      }
    ]
  };
}

function haloAgentId(technicianId, env) {
  const mappedAgents = parseJsonEnv(env.TECHNICIAN_MAP_JSON, {});
  const mapped = mappedAgents[technicianId];
  if (mapped) return Number(mapped);

  if (/^\d+$/.test(String(technicianId))) {
    return Number(technicianId);
  }

  throw new Error(`No Halo agent ID mapped for dashboard technician "${technicianId}"`);
}

function reportPublishedId(value) {
  const match = String(value || "").match(/\d+/);
  return match ? match[0] : "";
}

function combineDateTime(date, time) {
  if (!date || !time) {
    throw new Error("Appointments require both date and startTime.");
  }
  return `${date}T${time}:00`;
}

function addMinutes(time, minutes) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour * 60) + minute + minutes;
  const nextHour = Math.floor(total / 60) % 24;
  const nextMinute = total % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("TECHNICIAN_MAP_JSON is not valid JSON.");
  }
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

async function haloRequest(env, path, options = {}) {
  const accessToken = await getAccessToken(env);
  const response = await fetch(new URL(path, env.HALO_RESOURCE_SERVER).toString(), {
    method: options.method || "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const data = text ? safeJson(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `HaloPSA API returned ${response.status}`);
  }

  return { ok: true, data };
}

async function getAccessToken(env) {
  validateEnv(env);
  const now = Date.now();

  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60000) {
    return tokenCache.accessToken;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.HALO_CLIENT_ID,
    client_secret: env.HALO_CLIENT_SECRET,
    scope: env.HALO_SCOPE || "all"
  });

  const response = await fetch(env.HALO_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Unable to authenticate with HaloPSA");
  }

  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = now + ((data.expires_in || 3600) * 1000);
  return tokenCache.accessToken;
}

function validateEnv(env) {
  const missing = ["HALO_AUTH_URL", "HALO_RESOURCE_SERVER", "HALO_CLIENT_ID", "HALO_CLIENT_SECRET"]
    .filter(key => !env[key]);

  if (missing.length) {
    throw new Error(`Missing Worker secret/variable: ${missing.join(", ")}`);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
