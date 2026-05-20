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

  if (action === "loadTechnicians") {
    return handleTechnicianLoad(payload, env);
  }

  if (action === "loadAppointments") {
    return handleAppointmentLoad(payload, env);
  }

  if (action === "loadDateOnlyTasks") {
    return handleDateOnlyTaskLoad(payload, env);
  }

  if (action === "moveAppointmentToDateOnly") {
    return handleMoveAppointmentToDateOnly(payload, env);
  }

  if (action === "createAppointmentFromDateOnly") {
    return handleCreateAppointmentFromDateOnly(payload, env);
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
        body: [appointmentUpdatePayload(payload, env)]
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

async function handleMoveAppointmentToDateOnly(payload, env) {
  if (payload.appointmentId) {
    await haloRequest(env, `/api/Appointment/${encodeURIComponent(payload.appointmentId)}?ignoreexchangedelete=true`, {
      method: "DELETE"
    });
  }

  return haloRequest(env, "/api/Tickets", {
    method: "POST",
    body: [ticketAssignmentPayload(payload, env)]
  });
}

async function handleCreateAppointmentFromDateOnly(payload, env) {
  await haloRequest(env, "/api/Tickets", {
    method: "POST",
    body: [ticketAssignmentPayload({ ...payload, dateFieldValue: "" }, env)]
  });

  return haloRequest(env, "/api/Appointment", {
    method: "POST",
    body: [appointmentPayload(payload, env, { allDay: Boolean(payload.allday) })]
  });
}

async function handleAppointmentLoad(payload, env) {
  const date = payload.date;
  if (!date) {
    throw new Error("Appointment load requires a date.");
  }

  const configuredTechnicianIds = parseListEnv(env.HALO_TECHNICIAN_IDS || "");
  const agentIds = (payload.technicianIds?.length ? payload.technicianIds : configuredTechnicianIds).map(String);
  const params = new URLSearchParams({
    start_date: `${date}T00:00:00`,
    end_date: `${date}T23:59:59`,
    agents: agentIds.join(","),
    showall: "true",
    showappointments: "true",
    excluderecurringmaster: "true",
    page_size: "500"
  });

  const haloPath = `/api/Appointment?${params.toString()}`;
  console.log("loadAppointments request", JSON.stringify({ date, agentIds, haloPath }));

  const response = await haloRequest(env, haloPath, { method: "GET" });
  const rawAppointments = unwrapList(response.data);
  const appointments = rawAppointments
    .flatMap(appointment => normalizeAppointment(appointment, date, agentIds, env))
    .filter(Boolean);
  console.log("loadAppointments response", JSON.stringify({
    date,
    agentIds,
    rawCount: rawAppointments.length,
    normalizedCount: appointments.length,
    sample: rawAppointments.slice(0, 3).map(appointment => ({
      id: appointment.id || appointment.appointment_id,
      ticket_id: appointment.ticket_id,
      agent_id: appointment.agent_id,
      agents: Array.isArray(appointment.agents) ? appointment.agents.slice(0, 3) : undefined,
      start_date: appointment.start_date,
      end_date: appointment.end_date,
      allday: appointment.allday,
      status: appointment.status || appointment.appointment_status || appointment.complete_status,
      subject: appointment.subject
    })),
    normalizedSample: appointments.slice(0, 5)
  }));

  return {
    ok: true,
    data: { appointments },
    meta: {
      haloPath,
      rawCount: rawAppointments.length,
      normalizedCount: appointments.length
    }
  };
}

async function handleDateOnlyTaskLoad(payload, env) {
  const date = payload.date;
  const dateFieldId = env.HALO_DISPATCH_DATE_FIELD_ID;
  const agentIds = (payload.technicianIds || []).map(String).filter(Boolean);
  if (!date || !dateFieldId || !agentIds.length) {
    return { ok: true, data: { tasks: [] }, meta: { rawCount: 0, normalizedCount: 0 } };
  }

  const params = new URLSearchParams({
    include_custom_fields: String(dateFieldId),
    agent: agentIds.join(","),
    includecompleted: "true",
    count: "500"
  });
  const haloPath = `/api/Tickets?${params.toString()}`;
  console.log("loadDateOnlyTasks request", JSON.stringify({ date, agentIds, haloPath }));
  const response = await haloRequest(env, haloPath, { method: "GET" });
  const rawTickets = unwrapList(response.data);
  const tasks = rawTickets
    .map(ticket => normalizeDateOnlyTicket(ticket, date, dateFieldId))
    .filter(Boolean)
    .filter(task => agentIds.includes(String(task.techId)));

  return {
    ok: true,
    data: { tasks },
    meta: {
      haloPath,
      rawCount: rawTickets.length,
      normalizedCount: tasks.length
    }
  };
}

function normalizeDateOnlyTicket(ticket, date, dateFieldId) {
  const ticketId = ticket.id ?? ticket.faultid ?? ticket.fault_id;
  const techId = ticket.agent_id ?? ticket.agentid ?? ticket.assigned_agent_id;
  const customDate = customFieldValue(ticket, dateFieldId);
  if (!ticketId || !techId || String(customDate || "").slice(0, 10) !== date) return null;

  return {
    ticketId: Number(ticketId),
    haloTicketId: Number(ticketId),
    techId: String(techId),
    kind: "noTime",
    date,
    label: stripHtml(ticket.summary || ticket.subject || ticket.title || `Ticket #${ticketId}`),
    completed: isCompletedTicket(ticket),
    source: "haloDateOnly"
  };
}

function customFieldValue(ticket, fieldId) {
  const fields = Array.isArray(ticket.customfields) ? ticket.customfields : [];
  const match = fields.find(field => String(field.id ?? field.customfield_id ?? field.name) === String(fieldId) || field.name === "CFTaskWithoutTimeDate");
  return match?.value ?? match?.display ?? match?.text ?? "";
}

function isCompletedTicket(ticket) {
  const values = [
    ticket.status,
    ticket.status_name,
    ticket.workflow_name,
    ticket.date_closed,
    ticket.closed_at
  ].map(value => String(value || "").toLowerCase());
  return values.some(value => value.includes("complete") || value.includes("closed") || value === "done");
}

function normalizeAppointment(appointment, date, allowedAgentIds, env) {
  const ticketId = appointment.ticket_id ?? appointment.faultid ?? appointment.fault_id ?? appointment.apfaultid;
  const displayId = ticketId ?? appointment.id ?? appointment.appointment_id;
  if (!displayId) return [];

  const agentIds = appointmentAgentIds(appointment).filter(agentId => allowedAgentIds.includes(agentId));
  if (!agentIds.length) return [];

  const startDate = appointment.start_date || appointment.startdate || appointment.start_date_only;
  const endDate = appointment.end_date || appointment.enddate || appointment.end_date_only;
  const startTime = timePart(startDate, env) || "00:00";
  const duration = appointment.allday ? 1440 : durationMinutes(startDate, endDate);
  const kind = appointment.allday ? "allDay" : "timed";
  const title = appointment.subject || appointment.note || appointment.appointment_type_name || `Appointment #${displayId}`;
  const completed = isCompletedAppointment(appointment);

  return agentIds.map(agentId => ({
    appointmentId: String(appointment.id || appointment.appointment_id || ""),
    ticketId: Number(displayId),
    haloTicketId: ticketId ? Number(ticketId) : null,
    techId: agentId,
    kind,
    time: kind === "timed" ? startTime : undefined,
    duration,
    date: datePart(startDate, env) || date,
    label: stripHtml(title),
    completed,
    source: "haloAppointment"
  }));
}

function isCompletedAppointment(appointment) {
  const values = [
    appointment.status,
    appointment.appointment_status,
    appointment.complete_status,
    appointment.agent_status,
    appointment.complete_date
  ].map(value => String(value || "").toLowerCase());
  return values.some(value => value.includes("complete") || value === "closed" || value === "done");
}

function appointmentAgentIds(appointment) {
  const agents = Array.isArray(appointment.agents) ? appointment.agents : [];
  const fromAgents = agents
    .map(agent => agent.id ?? agent.agent_id ?? agent.agentid ?? agent.agentId)
    .filter(value => value !== undefined && value !== null);
  const primary = [
    appointment.agent_id,
    appointment.agentid,
    appointment.agentId,
    appointment.scheduled_for_id
  ].filter(value => value !== undefined && value !== null);
  return Array.from(new Set([...primary, ...fromAgents].map(String)));
}

async function handleTechnicianLoad(payload, env) {
  const configuredTechnicianIds = parseListEnv("");
  const configuredTeamIds = parseListEnv("");
  const technicianIds = new Set((payload.technicianIds?.length ? payload.technicianIds : configuredTechnicianIds).map(String));
  const teamIds = new Set((payload.teamIds?.length ? payload.teamIds : configuredTeamIds).map(String));
  const response = await haloRequest(env, "/api/Agent", { method: "GET" });
  const agents = unwrapList(response.data);
  const teamMap = new Map();

  const technicians = agents
    .filter(agent => !technicianIds.size || technicianIds.has(String(agent.id)))
    .map(agent => {
      const memberships = Array.isArray(agent.teams) ? agent.teams : [];
      const matchingTeams = memberships.filter(team => {
        const teamId = String(team.team_id ?? team.id ?? "");
        return (!teamIds.size || teamIds.has(teamId)) && isTrue(team.in_section);
      });
      if (!matchingTeams.length) return null;

      const primaryTeam = matchingTeams[0];
      matchingTeams.forEach(team => {
        const teamId = String(team.team_id ?? team.id ?? "");
        teamMap.set(teamId, {
          id: teamId,
          name: team.name || team.team || team.team_name || (String(agent.team_id) === teamId ? agent.team : "") || `Team ${teamId}`
        });
      });

      const primaryTeamId = String(primaryTeam.team_id ?? primaryTeam.id ?? "");
      return {
        id: String(agent.id),
        name: agent.name || agent.display_name || agent.email || `Technician ${agent.id}`,
        teamId: primaryTeamId,
        team: teamMap.get(primaryTeamId)?.name || agent.team || `Team ${primaryTeamId}`,
        teamIds: matchingTeams.map(team => String(team.team_id ?? team.id ?? "")).filter(Boolean)
      };
    })
    .filter(Boolean);

  return {
    ok: true,
    data: {
      technicians,
      teams: Array.from(teamMap.values()).sort((a, b) => Number(a.id) - Number(b.id))
    }
  };
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

function appointmentUpdatePayload(payload, env) {
  const startTime = payload.startTime || "00:00";
  const duration = Number(payload.durationMinutes || 30);
  const allDay = Boolean(payload.allday);

  const body = compactObject({
    id: Number(payload.appointmentId),
    agent_id: haloAgentId(payload.technicianId, env),
    start_date: allDay ? undefined : dispatchLocalToUtcDateTime(payload.date, startTime, env),
    end_date: allDay ? undefined : dispatchLocalToUtcDateTime(payload.date, addMinutes(startTime, duration), env),
    allday: allDay,
    _force: true
  });
  console.log("updateAppointment payload", JSON.stringify(body));
  return body;
}

function appointmentPayload(payload, env, options = {}) {
  const startTime = payload.startTime || "00:00";
  const duration = Number(payload.durationMinutes || 30);
  const startDate = options.allDay ? `${payload.date}T00:00:00` : dispatchLocalToUtcDateTime(payload.date, startTime, env);
  const endDate = options.allDay ? `${payload.date}T23:59:59` : dispatchLocalToUtcDateTime(payload.date, addMinutes(startTime, duration), env);

  return compactObject({
    id: options.appointmentId ? Number(options.appointmentId) : undefined,
    ticket_id: payload.ticketId ? Number(payload.ticketId) : undefined,
    agent_id: haloAgentId(payload.technicianId, env),
    start_date: startDate,
    end_date: endDate,
    allday: Boolean(options.allDay),
    note: payload.notes || undefined,
    status: payload.status || undefined,
    appointment_type_id: env.HALO_APPOINTMENT_TYPE_ID ? Number(env.HALO_APPOINTMENT_TYPE_ID) : undefined,
    reassign_ticket: payload.ticketId ? payload.assignTicket !== false : undefined
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
        value: payload.dateFieldValue ?? payload.date
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

function dispatchLocalToUtcDateTime(date, time, env) {
  if (!date || !time) {
    throw new Error("Appointments require both date and startTime.");
  }

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const timeZone = env.HALO_DISPLAY_TIME_ZONE || "America/Chicago";
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let index = 0; index < 3; index += 1) {
    const offset = timeZoneOffsetMs(new Date(utcMs), timeZone);
    utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offset;
  }

  return new Date(utcMs).toISOString().slice(0, 19);
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const localAsUtc = Date.UTC(
    Number(byType.year),
    Number(byType.month) - 1,
    Number(byType.day),
    Number(byType.hour),
    Number(byType.minute),
    Number(byType.second)
  );
  return localAsUtc - date.getTime();
}

function addMinutes(time, minutes) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour * 60) + minute + minutes;
  const nextHour = Math.floor(total / 60) % 24;
  const nextMinute = total % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

function durationMinutes(startDate, endDate) {
  const start = Date.parse(normalizeDateTime(startDate));
  const end = Date.parse(normalizeDateTime(endDate));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 30;
  }
  return Math.max(15, Math.round((end - start) / 60000));
}

function datePart(value, env) {
  const local = localDateTimeParts(value, env);
  return local ? local.date : String(value || "").slice(0, 10);
}

function timePart(value, env) {
  const local = localDateTimeParts(value, env);
  if (local) return local.time;
  const match = String(value || "").match(/[T\s](\d{1,2}:\d{2})/);
  return match ? match[1] : "";
}

function localDateTimeParts(value, env) {
  if (!value) return null;
  const date = new Date(normalizeDateTime(value));
  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: env.HALO_DISPLAY_TIME_ZONE || "America/Chicago",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${byType.year}-${byType.month}-${byType.day}`,
    time: `${byType.hour}:${byType.minute}`
  };
}

function normalizeDateTime(value) {
  const normalized = String(value || "").replace(" ", "T");
  if (!normalized || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return normalized;
  return `${normalized}Z`;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("TECHNICIAN_MAP_JSON is not valid JSON.");
  }
}

function parseListEnv(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function isTrue(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.agents)) return data.agents;
  if (Array.isArray(data?.users)) return data.users;
  if (Array.isArray(data?.record)) return data.record;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.data)) return data.data;
  return [];
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
