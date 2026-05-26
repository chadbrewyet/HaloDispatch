/*
 * Cloudflare Worker facade for HaloPSA.
 *
 * Keep this file as the only place that knows Halo credentials. The frontend
 * calls the small action surface below; this Worker normalizes Halo payloads
 * into the dashboard model and maps dashboard writes back to Halo endpoints.
 */
const tokenCache = {
  accessToken: "",
  expiresAt: 0
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

const excludedTicketTypeNames = new Set([
  "lead",
  "sales/opportunity",
  "sales/opportunity - nonactive",
  "quick quote"
]);

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_USER_PREF_TABLE_ID = 1013;
const DEFAULT_SAVED_FILTER_TABLE_ID = 1014;
const DEFAULT_USER_PREF_REPORT_ID = "7ff3826a-f693-43dd-a7dc-333acf2d0a63";
const DEFAULT_SAVED_FILTER_REPORT_ID = "267cb7b5-35de-48e6-baf8-936feaf90949";
const WORKER_BUILD = "2026-05-24-field-mapping";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "halo-dispatch-api", build: WORKER_BUILD });
      }

      if (url.pathname === "/api/halo/action" && request.method === "POST") {
        const body = await request.json();
        return json(await handleDashboardAction(body, env));
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

  if (action === "loadTicketTypes") {
    return handleTicketTypeLoad(payload, env);
  }

  if (action === "loadTickets") {
    return handleTicketLoad(payload, env);
  }

  if (action === "loadAppointments") {
    return handleAppointmentLoad(payload, env);
  }

  if (action === "loadDateOnlyTasks") {
    return handleDateOnlyTaskLoad(payload, env);
  }

  if (action === "loadDispatchStorage") {
    return handleDispatchStorageLoad(payload, env);
  }

  if (action === "saveDispatchUserPreferences") {
    return handleDispatchUserPreferenceSave(payload, env);
  }

  if (action === "saveDispatchSavedFilter") {
    return handleDispatchSavedFilterSave(payload, env);
  }

  if (action === "deleteDispatchSavedFilter") {
    return handleDispatchSavedFilterDelete(payload, env);
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

async function handleTicketTypeLoad(payload, env) {
  const params = new URLSearchParams({
    count: String(pageSize(env))
  });
  const { records: rawTypes, meta } = await haloGetAllPages(env, "/api/TicketType", params);
  const ticketTypes = rawTypes
    .map(normalizeTicketType)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    data: { ticketTypes },
    meta: {
      haloPath: meta.firstPath,
      rawCount: rawTypes.length,
      normalizedCount: ticketTypes.length,
      pages: meta.pages,
      excludedTypes: []
    }
  };
}

async function handleTicketLoad(payload, env) {
  const ticketTypeIds = (payload.ticketTypeIds || []).map(String).filter(Boolean);
  const params = new URLSearchParams({
    includeallopen: "true",
    includeclosed: "0",
    includecompleted: "false",
    includetickettype: "true",
    includestatus: "true",
    include_custom_fields: dispatchDateFieldId(env),
    include_customfields: dispatchDateFieldId(env),
    count: String(pageSize(env)),
    order: "dateoccured",
    orderdesc: "true"
  });
  if (ticketTypeIds.length) {
    params.set("requesttype", ticketTypeIds.join(","));
  }

  const { records: rawTickets, meta } = await haloGetAllPages(env, "/api/Tickets", params);
  debugLog(env, "loadTickets request", { ticketTypeIds, haloPath: meta.firstPath, pages: meta.pages });
  const tickets = rawTickets
    .map(ticket => normalizeTicket(ticket, env))
    .filter(Boolean)
    .filter(ticket => !ticket.completed)
    .filter(ticket => !excludedTicketTypeNames.has(ticket.type.toLowerCase()))
    .filter(ticket => !ticketTypeIds.length || ticketTypeIds.includes(String(ticket.typeId)));

  return {
    ok: true,
    data: { tickets },
    meta: {
      haloPath: meta.firstPath,
      rawCount: rawTickets.length,
      normalizedCount: tickets.length,
      pages: meta.pages,
      selectedTicketTypes: ticketTypeIds,
      excludedTypes: Array.from(excludedTicketTypeNames)
    }
  };
}

function normalizeTicketType(type) {
  const id = type.id ?? type.requesttype_id ?? type.rtid;
  const name = stripHtml(type.name || type.requesttype_name || type.requesttype || type.tickettype || type.description || "");
  if (!id || !name) return null;
  return { id: String(id), name };
}

function normalizeTicket(ticket, env) {
  const id = ticket.id ?? ticket.faultid ?? ticket.fault_id;
  if (!id) return null;
  const typeId = ticket.requesttype_id ?? ticket.tickettype_id ?? ticket.type_id ?? ticket.requesttypeid;
  const typeName = stripHtml(ticket.requesttype_name || ticket.requesttype || ticket.request_type || ticket.tickettype_name || ticket.tickettype || ticket.ticket_type || ticket.type || "");
  const rawTeam = ticket.team;
  const rawTeamId = typeof rawTeam === "number" || (typeof rawTeam === "string" && /^\d+$/.test(rawTeam)) ? rawTeam : undefined;
  const teamId = ticket.team_id ?? ticket.teamid ?? ticket.teamId ?? ticket.team?.id ?? rawTeamId;
  const teamName = ticket.team_name
    || ticket.teamname
    || ticket.teamName
    || ticket.team?.name
    || (typeof rawTeam === "string" && !/^\d+$/.test(rawTeam) ? rawTeam : "");
  const customDate = customDatePart(customFieldValue(ticket, dispatchDateFieldId(env), dispatchDateFieldName(env)));
  const serviceZone = customFieldValue(ticket, "Service Zone");
  return {
    id: Number(id),
    haloTicketId: Number(id),
    client: stripHtml(ticket.client_name || ticket.client || ticket.username || ticket.customer || ""),
    title: stripHtml(ticket.summary || ticket.subject || ticket.title || `Ticket #${id}`),
    priority: stripHtml(ticket.priority || ticket.priority_name || ticket.seriousness || ""),
    status: stripHtml(ticket.status_name || ticket.statusname || ticket.status?.name || ticket.status || ""),
    type: typeName,
    typeId: typeId ? String(typeId) : "",
    team: stripHtml(teamName || ""),
    teamId: teamId ? String(teamId) : "",
    site: stripHtml(ticket.site_name || ticket.sitename || ticket.site || ""),
    sla: stripHtml(ticket.sla || ticket.sla_name || ticket.slastate || ""),
    estimate: ticket.estimatedays || ticket.estimate || "",
    contact: stripHtml(ticket.user_name || ticket.contact_name || ticket.contact || ""),
    serviceZone: stripHtml(serviceZone || ticket.service_zone || ticket.servicezone || ""),
    details: stripHtml(ticket.details || ticket.detail || ticket.lastnote || ticket.last_note || ""),
    dateField: customDate,
    dateOpened: datePart(ticket.dateoccurred || ticket.dateoccured || ticket.date_occurred || ticket.dateopened || ticket.date_opened || ticket.datecreated || ticket.date_created, env) || "",
    assignedTo: ticket.agent_id ? String(ticket.agent_id) : "",
    completed: isCompletedTicket(ticket)
  };
}

async function handleAppointmentLoad(payload, env) {
  const date = payload.date;
  if (!date) {
    throw new Error("Appointment load requires a date.");
  }

  const configuredTechnicianIds = parseListEnv(env.HALO_TECHNICIAN_IDS || "");
  const agentIds = (payload.technicianIds?.length ? payload.technicianIds : configuredTechnicianIds).map(String);
  const appointmentLoad = await loadAppointmentsWithFallbacks(env, date, agentIds);
  const holidayLoad = await loadHolidaysForAgents(env, date, agentIds);
  const { records: rawAppointments, meta } = appointmentLoad;
  const { records: rawHolidays, meta: holidayMeta } = holidayLoad;
  debugLog(env, "loadAppointments request", { date, agentIds, haloPath: meta.firstPath, pages: meta.pages, variant: meta.variant });

  const appointments = [
    ...rawAppointments.flatMap(appointment => normalizeAppointment(appointment, date, agentIds, env)),
    ...rawHolidays.flatMap(holiday => normalizeHoliday(holiday, date, agentIds, env))
  ].filter(Boolean);
  debugLog(env, "loadAppointments response", {
    date,
    agentIds,
    pages: meta.pages,
    rawCount: rawAppointments.length,
    rawHolidayCount: rawHolidays.length,
    normalizedCount: appointments.length,
    normalizedSample: appointments.slice(0, 5)
  });

  return {
    ok: true,
    data: { appointments },
    meta: {
      haloPath: meta.firstPath,
      rawCount: rawAppointments.length,
      rawHolidayCount: rawHolidays.length,
      normalizedCount: appointments.length,
      pages: meta.pages,
      variant: meta.variant,
      variants: meta.variants,
      holidayPath: holidayMeta.firstPath,
      holidayPages: holidayMeta.pages,
      holidayQueries: holidayMeta.queries,
      rawSample: payload.debug ? rawAppointments.slice(0, 10).map(summarizeRawAppointment) : undefined,
      rawHolidaySample: payload.debug ? rawHolidays.slice(0, 10).map(summarizeRawHoliday) : undefined
    }
  };
}

async function loadAppointmentsWithFallbacks(env, date, agentIds) {
  const variants = appointmentQueryVariants(date, agentIds);
  const merged = [];
  const seen = new Set();
  const summaries = [];

  for (const variant of variants) {
    const result = await haloGetAllPages(env, "/api/Appointment", variant.params);
    result.meta.variant = variant.name;
    summaries.push({ variant: variant.name, count: result.records.length, firstPath: result.meta.firstPath, pages: result.meta.pages });
    result.records.forEach(record => {
      const key = appointmentRecordKey(record);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(record);
    });
  }

  return {
    records: merged,
    meta: {
      firstPath: summaries.find(summary => summary.firstPath)?.firstPath || "",
      pages: summaries.reduce((total, summary) => total + (summary.pages || 0), 0),
      variant: "merged",
      variants: summaries
    }
  };
}

function appointmentRecordKey(record) {
  return String(record?.id ?? record?.appointment_id ?? record?.apptid ?? record?.guid ?? JSON.stringify(record));
}

function appointmentQueryVariants(date, agentIds) {
  const common = {
    agents: agentIds.join(","),
    showall: "true",
    showappointments: "true",
    excluderecurringmaster: "true",
    count: String(DEFAULT_PAGE_SIZE)
  };
  return [
    {
      name: "datetime",
      params: new URLSearchParams({
        ...common,
        start_date: `${date}T00:00:00`,
        end_date: `${date}T23:59:59`
      })
    },
    {
      name: "datetime-appointments-only",
      params: new URLSearchParams({
        ...common,
        appointmentsonly: "true",
        start_date: `${date}T00:00:00`,
        end_date: `${date}T23:59:59`
      })
    },
    {
      name: "datetime-tasks-only",
      params: new URLSearchParams({
        ...common,
        tasksonly: "true",
        start_date: `${date}T00:00:00`,
        end_date: `${date}T23:59:59`
      })
    },
    {
      name: "date-only",
      params: new URLSearchParams({
        ...common,
        start_date: date,
        end_date: date
      })
    },
    {
      name: "datetime-no-agent-filter",
      params: new URLSearchParams({
        ...common,
        agents: "",
        start_date: `${date}T00:00:00`,
        end_date: `${date}T23:59:59`
      })
    }
  ];
}

async function loadHolidaysForAgents(env, date, agentIds) {
  const merged = [];
  const seen = new Set();
  const queries = [];
  const queryAgentIds = Array.from(new Set(["", ...agentIds.map(String)]));

  for (const agentId of queryAgentIds) {
    for (const variant of holidayQueryVariants(date, agentId)) {
      const result = await haloGetAllPages(env, "/api/Holiday", variant.params);
      queries.push({ agentId: agentId || "all", variant: variant.name, count: result.records.length, firstPath: result.meta.firstPath, pages: result.meta.pages });
      result.records
        .filter(record => holidayOverlapsDate(record, date, env))
        .forEach(record => {
          const key = holidayRecordKey(record, agentId);
          if (seen.has(key)) return;
          seen.add(key);
          merged.push(record);
        });
    }
  }

  const workdayResult = await haloGetAllPages(env, "/api/Workday", new URLSearchParams({
    showholidays: "true",
    count: String(DEFAULT_PAGE_SIZE)
  }));
  queries.push({ agentId: "workdays", count: workdayResult.records.length, firstPath: workdayResult.meta.firstPath, pages: workdayResult.meta.pages });
  workdayResult.records
    .flatMap(workday => {
      const holidays = Array.isArray(workday.holidays) ? workday.holidays : [];
      return holidays.map(holiday => ({
        ...holiday,
        workday_id: holiday.workday_id ?? workday.id,
        workday_name: workday.name
      }));
    })
    .filter(holiday => holidayOverlapsDate(holiday, date, env))
    .forEach(record => {
      const key = holidayRecordKey(record, "workdays");
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(record);
    });

  return {
    records: merged,
    meta: {
      firstPath: queries.find(query => query.firstPath)?.firstPath || "",
      pages: queries.reduce((total, query) => total + (query.pages || 0), 0),
      queries
    }
  };
}

function holidayQueryVariants(date, agentId) {
  const common = {
    inclusive_start: "true",
    inclusive_end: "true",
    include_apid: "true",
    count: String(DEFAULT_PAGE_SIZE)
  };
  const variants = [
    {
      name: "datetime-approved",
      params: new URLSearchParams({
        ...common,
        approved_only: "true",
        start_date: `${date}T00:00:00`,
        end_date: `${date}T23:59:59`
      })
    },
    {
      name: "date-approved",
      params: new URLSearchParams({
        ...common,
        approved_only: "true",
        start_date: date,
        end_date: date
      })
    },
    {
      name: "datetime-all-status",
      params: new URLSearchParams({
        ...common,
        start_date: `${date}T00:00:00`,
        end_date: `${date}T23:59:59`
      })
    },
    {
      name: "date-all-status",
      params: new URLSearchParams({
        ...common,
        start_date: date,
        end_date: date
      })
    }
  ];
  if (agentId) variants.forEach(variant => variant.params.set("agent_id", agentId));
  return variants;
}

function holidayRecordKey(record, queriedAgentId = "") {
  const agentId = record?.agent_id ?? record?.agentid ?? queriedAgentId ?? "";
  if (!agentId || String(agentId) === "0" || String(agentId) === "workdays") {
    const name = String(record?.name || record?.holiday_type_name || "").toLowerCase();
    const start = customDatePart(record?.date_datetime || record?.date || record?.date_only || "");
    const end = customDatePart(record?.end_date || record?.end_date_only || start);
    if (name && start) return `global:${name}:${start}:${end}`;
  }
  const id = record?.holid ?? record?.id ?? record?.guid ?? JSON.stringify(record);
  return `${id}:${agentId}`;
}

function holidayOverlapsDate(holiday, date, env) {
  const startDate = holiday.date_datetime || holiday.date || holiday.date_only || "";
  if (!startDate) return false;
  const endDate = holiday.end_date || holiday.end_date_only || startDate;
  const literalDates = isTrue(holiday.allday) || Boolean(holiday.date_only || holiday.end_date_only);
  const start = literalDates ? customDatePart(startDate) : datePart(startDate, env);
  const end = literalDates ? customDatePart(endDate) : (datePart(endDate, env) || start);
  return Boolean(start && end && start <= date && date <= end);
}

async function handleDateOnlyTaskLoad(payload, env) {
  const date = payload.date;
  const dateFieldId = dispatchDateFieldId(env);
  const agentIds = (payload.technicianIds || []).map(String).filter(Boolean);
  if (!date || !dateFieldId || !agentIds.length) {
    return { ok: true, data: { tasks: [] }, meta: { rawCount: 0, normalizedCount: 0 } };
  }

  const params = new URLSearchParams({
    include_custom_fields: String(dateFieldId),
    include_customfields: String(dateFieldId),
    agent: agentIds.join(","),
    agent_id: agentIds.join(","),
    includeallopen: "true",
    includecompleted: "false",
    includeclosed: "false",
    includestatus: "true",
    includetickettype: "true",
    count: String(pageSize(env))
  });
  let { records: rawTickets, meta } = await haloGetAllPages(env, "/api/Tickets", params);
  if (!rawTickets.length) {
    const broadParams = new URLSearchParams(params);
    broadParams.delete("agent");
    broadParams.delete("agent_id");
    const broadResult = await haloGetAllPages(env, "/api/Tickets", broadParams);
    rawTickets = broadResult.records;
    meta = { ...broadResult.meta, variant: "no-agent-filter" };
  } else {
    meta.variant = "agent-filter";
  }
  debugLog(env, "loadDateOnlyTasks request", { date, agentIds, haloPath: meta.firstPath, pages: meta.pages });
  const normalizedTasks = rawTickets
    .map(ticket => normalizeDateOnlyTicket(ticket, dateFieldId, env))
    .filter(Boolean)
    .filter(task => !task.completed)
    .filter(task => agentIds.includes(String(task.techId)));
  const tasks = normalizedTasks.filter(task => task.date === date);
  const pastTasks = normalizedTasks.filter(task => task.date && task.date < date);

  return {
    ok: true,
    data: { tasks, pastTasks },
    meta: {
      haloPath: meta.firstPath,
      rawCount: rawTickets.length,
      normalizedCount: tasks.length,
      pastCount: pastTasks.length,
      pages: meta.pages
    }
  };
}

async function handleDispatchStorageLoad(payload, env) {
  const agentId = String(payload.agentId || "").trim();
  const [preferencesReport, filtersReport, preferencesTable, filtersTable] = await Promise.all([
    loadStorageReport(env, "HALO_USER_PREF_REPORT_ID", DEFAULT_USER_PREF_REPORT_ID),
    loadStorageReport(env, "HALO_SAVED_FILTER_REPORT_ID", DEFAULT_SAVED_FILTER_REPORT_ID),
    loadCustomTable(env, customTableId(env, "HALO_USER_PREF_TABLE_ID", DEFAULT_USER_PREF_TABLE_ID)),
    loadCustomTable(env, customTableId(env, "HALO_SAVED_FILTER_TABLE_ID", DEFAULT_SAVED_FILTER_TABLE_ID))
  ]);

  const preferenceRows = preferencesReport.rows.length ? preferencesReport.rows : preferencesTable.rows;
  const filterRows = filtersReport.rows.length ? filtersReport.rows : filtersTable.rows;
  const preferences = agentId ? normalizeUserPreferenceRows(preferenceRows, agentId, env) : null;
  const savedFilters = normalizeSavedFilterRows(filterRows, env);

  return {
    ok: true,
    data: {
      userPreferences: preferences,
      savedFilters,
      meta: {
        userPreferenceRows: preferenceRows.length,
        savedFilterRows: filterRows.length,
        userPreferenceReportId: storageReportId(env, "HALO_USER_PREF_REPORT_ID", DEFAULT_USER_PREF_REPORT_ID),
        savedFilterReportId: storageReportId(env, "HALO_SAVED_FILTER_REPORT_ID", DEFAULT_SAVED_FILTER_REPORT_ID),
        userPreferenceReportMeta: preferencesReport.meta,
        savedFilterReportMeta: filtersReport.meta,
        userPreferenceTableId: preferencesTable.id,
        savedFilterTableId: filtersTable.id,
        userPreferenceReadSummary: preferencesTable.readSummary,
        savedFilterReadSummary: filtersTable.readSummary
      }
    }
  };
}

async function loadStorageReport(env, key, fallbackId) {
  const reportId = storageReportId(env, key, fallbackId);
  if (!reportId) return { rows: [], meta: { skipped: true } };
  const reportToken = cleanBearerToken(env.HALO_REPORT_BEARER_TOKEN);
  try {
    const response = await haloRequest(env, `/api/ReportData/${encodeURIComponent(reportId)}`, {
      method: "GET",
      bearerToken: reportToken
    });
    const rows = normalizeReportRows(response.data);
    return {
      rows,
      meta: {
        reportId,
        authMode: reportToken ? "published-token" : "oauth",
        authConfigured: Boolean(reportToken),
        rawType: Array.isArray(response.data) ? "array" : typeof response.data,
        rowCount: rows.length,
        rowKeys: reportRowKeys(rows),
        keys: response.data && typeof response.data === "object" && !Array.isArray(response.data) ? Object.keys(response.data).slice(0, 20) : []
      }
    };
  } catch (error) {
    if (reportToken) {
      try {
        const response = await haloRequest(env, `/api/ReportData/${encodeURIComponent(reportId)}`, { method: "GET" });
        const rows = normalizeReportRows(response.data);
        return {
          rows,
          meta: {
            reportId,
            authMode: "oauth-after-published-token-failed",
            authConfigured: true,
            publishedTokenError: error.message,
            rawType: Array.isArray(response.data) ? "array" : typeof response.data,
            rowCount: rows.length,
            rowKeys: reportRowKeys(rows),
            keys: response.data && typeof response.data === "object" && !Array.isArray(response.data) ? Object.keys(response.data).slice(0, 20) : []
          }
        };
      } catch (fallbackError) {
        return {
          rows: [],
          meta: {
            reportId,
            authMode: "published-token-then-oauth",
            authConfigured: true,
            publishedTokenError: error.message,
            error: fallbackError.message
          }
        };
      }
    }
    return {
      rows: [],
      meta: {
        reportId,
        authMode: "oauth",
        authConfigured: false,
        error: error.message
      }
    };
  }
}

function cleanBearerToken(value) {
  return String(value || "").trim().replace(/^Bearer\s+/i, "").trim();
}

function reportRowKeys(rows) {
  const first = rows.find(row => row && typeof row === "object");
  return first ? Object.keys(first).slice(0, 40) : [];
}

function storageReportId(env, key, fallbackId) {
  const value = String(env[key] || fallbackId || "").trim();
  return value || "";
}

function normalizeReportRows(data) {
  if (Array.isArray(data)) return data.map(normalizeReportRow);
  const candidateArrays = [
    data?.reportdata,
    data?.reportData,
    data?.rows,
    data?.data,
    data?.record,
    data?.records,
    data?.results,
    data?.result
  ];
  const rows = candidateArrays.find(Array.isArray) || [];
  return rows.map(normalizeReportRow);
}

function normalizeReportRow(row) {
  if (!row || typeof row !== "object") return row;
  if (Array.isArray(row.cells)) {
    return row.cells.reduce((record, cell) => {
      const key = cell.name || cell.column || cell.column_name || cell.label || cell.header || cell.field;
      if (key) record[key] = cell.value ?? cell.display ?? cell.text ?? "";
      return record;
    }, {});
  }
  if (Array.isArray(row.columns)) {
    return row.columns.reduce((record, cell) => {
      const key = cell.name || cell.column || cell.column_name || cell.label || cell.header || cell.field;
      if (key) record[key] = cell.value ?? cell.display ?? cell.text ?? "";
      return record;
    }, {});
  }
  return row;
}

async function handleDispatchUserPreferenceSave(payload, env) {
  const agentId = String(payload.agentId || "").trim();
  if (!agentId) throw new Error("agentId is required to save user preferences.");

  const tableId = customTableId(env, "HALO_USER_PREF_TABLE_ID", DEFAULT_USER_PREF_TABLE_ID);
  const table = await loadCustomTable(env, tableId);
  const fields = storageFields(env, table.fields);
  const existing = table.rows.find(row => String(readRowValue(row, fields.prefAgent)) === agentId);
  const preferences = payload.preferences || {};
  const now = new Date().toISOString();
  const row = {
    [fields.prefAgent[0]]: agentId,
    [fields.prefTheme[0]]: preferences.theme || "",
    [fields.prefOrientation[0]]: preferences.orientation || "",
    [fields.prefSelectedTeams[0]]: JSON.stringify(preferences.selectedTeams || []),
    [fields.prefSelectedAgents[0]]: JSON.stringify(preferences.selectedTechs || []),
    [fields.prefPanelPinned[0]]: Boolean(preferences.ticketPanelPinned),
    [fields.prefPanelWidth[0]]: String(preferences.ticketPanelWidth || ""),
    [fields.prefCalendarStart[0]]: preferences.calendarStartTime || "",
    [fields.prefCalendarEnd[0]]: preferences.calendarEndTime || "",
    [fields.prefTechThemes[0]]: JSON.stringify(preferences.techThemes || {}),
    [fields.prefVisibleTickets[0]]: JSON.stringify(preferences),
    [fields.updatedAt[0]]: now,
    ...(!existing ? { [fields.createdAt[0]]: now } : {})
  };

  return saveCustomTableRow(env, tableId, row, existing, table.fields);
}

async function handleDispatchSavedFilterSave(payload, env) {
  const name = String(payload.name || payload.filter?.name || "").trim();
  if (!name) throw new Error("Filter name is required.");

  const tableId = customTableId(env, "HALO_SAVED_FILTER_TABLE_ID", DEFAULT_SAVED_FILTER_TABLE_ID);
  const table = await loadCustomTable(env, tableId);
  const fields = storageFields(env, table.fields);
  const existing = table.rows.find(row => String(readRowValue(row, fields.filterName)).toLowerCase() === name.toLowerCase());
  const filter = payload.filter || {};
  const now = new Date().toISOString();
  const filterPayload = {
    ...filter,
    includeAssigned: Boolean(filter.includeAssigned)
  };
  const row = {
    [fields.filterName[0]]: name,
    [fields.filterTitle[0]]: filterPayload.title || name,
    [fields.filterColor[0]]: filterPayload.color || "",
    [fields.filterConditions[0]]: JSON.stringify({
      includeAssigned: Boolean(filterPayload.includeAssigned),
      conditions: filterPayload.conditions || []
    }),
    [fields.filterActive[0]]: true,
    [fields.filterUpdatedBy[0]]: String(payload.agentId || ""),
    [fields.updatedAt[0]]: now,
    ...(!existing ? {
      [fields.filterCreatedBy[0]]: String(payload.agentId || ""),
      [fields.filterCreatedAt[0]]: now
    } : {}),
    [fields.filterJson[0]]: JSON.stringify(filterPayload),
    [fields.filterDeleted[0]]: false
  };

  return saveCustomTableRow(env, tableId, row, existing, table.fields);
}

async function handleDispatchSavedFilterDelete(payload, env) {
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("Filter name is required.");

  const tableId = customTableId(env, "HALO_SAVED_FILTER_TABLE_ID", DEFAULT_SAVED_FILTER_TABLE_ID);
  const table = await loadCustomTable(env, tableId);
  const fields = storageFields(env, table.fields);
  const existing = table.rows.find(row => String(readRowValue(row, fields.filterName)).toLowerCase() === name.toLowerCase());

  const row = {
    [fields.filterName[0]]: name,
    [fields.filterActive[0]]: false,
    [fields.filterDeleted[0]]: true,
    [fields.updatedAt[0]]: new Date().toISOString()
  };

  return saveCustomTableRow(env, tableId, row, existing, table.fields);
}

function normalizeDateOnlyTicket(ticket, dateFieldId, env) {
  const ticketId = ticket.id ?? ticket.faultid ?? ticket.fault_id;
  const techId = ticket.agent_id ?? ticket.agentid ?? ticket.assigned_agent_id ?? ticket.assigned_agentid ?? ticket.owner_agent_id;
  const date = customDatePart(customFieldValue(ticket, dateFieldId, "CFTaskWithoutTimeDate"));
  if (!ticketId || !techId || !date) return null;

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

function customFieldValue(ticket, fieldId, fieldName = "") {
  const directValue = directCustomFieldValue(ticket, fieldId, fieldName);
  if (directValue !== undefined && directValue !== null && directValue !== "") return directValue;

  const fields = Array.isArray(ticket.customfields) ? ticket.customfields : [];
  const wanted = String(fieldId).toLowerCase();
  const wantedName = String(fieldName || "").toLowerCase();
  const match = fields.find(field => {
    const candidates = [
      field.id,
      field.customfield_id,
      field.customfieldid,
      field.field_id,
      field.name,
      field.label,
      field.display_name,
      field.customfield_name,
      field.customfieldname,
      field.field_name,
      field.input_name,
      field.variable_name
    ].map(value => String(value || "").toLowerCase());
    return candidates.includes(wanted)
      || (wantedName && candidates.includes(wantedName))
      || candidates.includes("cftaskwithouttimedate")
      || candidates.includes("486")
      || candidates.includes("$cf00486");
  });
  return customFieldEntryValue(match);
}

function directCustomFieldValue(ticket, fieldId, fieldName = "") {
  const keys = [
    fieldName,
    String(fieldName || "").toLowerCase(),
    String(fieldName || "").toUpperCase(),
    fieldId,
    `CF${fieldId}`,
    `cf${fieldId}`,
    `$CF${String(fieldId).padStart(5, "0")}`,
    `customfield_${fieldId}`,
    "CFTaskWithoutTimeDate",
    "cftaskwithouttimedate",
    "$CF00486"
  ].filter(Boolean);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(ticket, key)) return ticket[key];
  }
  return undefined;
}

function customFieldEntryValue(field) {
  const value = field?.value ?? field?.display ?? field?.text ?? field?.display_value ?? field?.value_display ?? "";
  if (Array.isArray(value)) return value.map(item => customFieldEntryValue(item)).find(Boolean) || "";
  if (value && typeof value === "object") {
    return value.value ?? value.display ?? value.text ?? value.name ?? value.label ?? "";
  }
  return value;
}

function isCompletedTicket(ticket) {
  const flagValues = [
    ticket.closed,
    ticket.is_closed,
    ticket.isclosed,
    ticket.completed,
    ticket.is_completed,
    ticket.iscomplete,
    ticket.complete
  ];
  if (flagValues.some(value => value === true || String(value || "").toLowerCase() === "true" || String(value) === "1")) {
    return true;
  }

  const values = [
    ticket.status,
    ticket.status?.name,
    ticket.status?.text,
    ticket.status?.label,
    ticket.status_name,
    ticket.statusname,
    ticket.workflow_name,
    ticket.date_closed,
    ticket.closed_at,
    ticket.dateclosed,
    ticket.date_completed,
    ticket.datecompleted,
    ticket.completed_at
  ].map(value => String(value || "").toLowerCase());
  return values.some(value => value.includes("complete") || value.includes("closed") || value === "done" || value === "resolved");
}

function normalizeAppointment(appointment, date, allowedAgentIds, env) {
  const ticketId = appointment.ticket_id ?? appointment.faultid ?? appointment.fault_id ?? appointment.apfaultid;
  const appointmentId = appointment.id ?? appointment.appointment_id ?? appointment.apptid ?? appointment.appointmentid ?? appointment.event_id ?? appointment.eventid;
  const displayId = ticketId ?? appointmentId;
  if (!displayId) return [];

  let agentIds = appointmentAgentIds(appointment).filter(agentId => allowedAgentIds.includes(agentId));
  const title = appointment.subject
    || appointment.title
    || appointment.summary
    || appointment.note
    || appointment.appointment_type_name
    || appointment.appointmenttype_name
    || appointment.appointmenttypename
    || appointment.type_name
    || appointment.typename
    || `Appointment #${displayId}`;
  const availabilityBlock = isAvailabilityBlock(appointment, title);
  if (!agentIds.length && availabilityBlock && allowedAgentIds.length) agentIds = allowedAgentIds;
  if (!agentIds.length && allowedAgentIds.length === 1) agentIds = allowedAgentIds;
  if (!agentIds.length) return [];

  const startDate = appointmentDateValue(appointment, "start") || date;
  const endDate = appointmentDateValue(appointment, "end") || startDate;
  const allDay = isTrue(appointment.allday ?? appointment.all_day ?? appointment.isallday ?? appointment.is_all_day);
  const startTime = timePart(startDate, env) || "00:00";
  const duration = allDay ? 1440 : durationMinutes(startDate, endDate);
  const kind = allDay ? "allDay" : "timed";
  const completed = isCompletedAppointment(appointment);
  const displayDate = appointmentDisplayDate(startDate, endDate, date, env);

  return agentIds.map(agentId => ({
    appointmentId: String(appointmentId || ""),
    ticketId: Number(displayId),
    haloTicketId: ticketId ? Number(ticketId) : null,
    techId: agentId,
    kind,
    time: kind === "timed" ? startTime : undefined,
    duration,
    date: displayDate,
    label: stripHtml(title),
    completed,
    availabilityBlock,
    source: "haloAppointment"
  }));
}

function normalizeHoliday(holiday, date, allowedAgentIds, env) {
  const sourceId = holiday.holid ?? holiday.id ?? holiday.guid;
  if (!sourceId) return [];

  let agentIds = splitAgentIds(holiday.agent_id ?? holiday.agentid).filter(agentId => allowedAgentIds.includes(agentId));
  if (!agentIds.length && allowedAgentIds.length) agentIds = allowedAgentIds;
  if (!agentIds.length) return [];

  const startDate = holiday.date_datetime || holiday.date || holiday.date_only || date;
  const endDate = holiday.end_date || holiday.end_date_only || startDate;
  const allDay = isTrue(holiday.allday) || Boolean(holiday.date_only || holiday.end_date_only);
  const startTime = timePart(startDate, env) || "00:00";
  const duration = allDay ? 1440 : durationMinutes(startDate, endDate);
  const kind = allDay ? "allDay" : "timed";
  const label = holiday.name || holiday.holiday_type_name || holiday.workday_name || holiday.agent_name || "Holiday / PTO";
  const displayDate = holidayDisplayDate(holiday, date, env);

  return agentIds.map(agentId => ({
    appointmentId: `holiday:${sourceId}:${agentId}`,
    ticketId: syntheticHolidayId(sourceId, agentId),
    haloTicketId: null,
    techId: agentId,
    kind,
    time: kind === "timed" ? startTime : undefined,
    duration,
    date: displayDate,
    label: stripHtml(label),
    completed: false,
    availabilityBlock: true,
    source: "haloHoliday"
  }));
}

function appointmentDisplayDate(startDate, endDate, selectedDate, env) {
  const start = datePart(startDate, env);
  const end = datePart(endDate, env) || start;
  if (start && end && start <= selectedDate && selectedDate <= end) return selectedDate;
  return start || selectedDate;
}

function holidayDisplayDate(holiday, selectedDate, env) {
  const startDate = holiday.date_datetime || holiday.date || holiday.date_only || selectedDate;
  const endDate = holiday.end_date || holiday.end_date_only || startDate;
  const literalDates = isTrue(holiday.allday) || Boolean(holiday.date_only || holiday.end_date_only);
  const start = literalDates ? customDatePart(startDate) : datePart(startDate, env);
  const end = literalDates ? customDatePart(endDate) : (datePart(endDate, env) || start);
  if (start && end && start <= selectedDate && selectedDate <= end) return selectedDate;
  return start || selectedDate;
}

function syntheticHolidayId(sourceId, agentId) {
  const input = `holiday:${sourceId}:${agentId}`;
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return -Math.abs(hash || 1);
}

function summarizeRawAppointment(appointment) {
  return {
    id: appointment.id,
    appointment_id: appointment.appointment_id,
    apptid: appointment.apptid,
    faultid: appointment.faultid,
    ticket_id: appointment.ticket_id,
    subject: appointment.subject,
    title: appointment.title,
    note: stripHtml(appointment.note || "").slice(0, 120),
    appointment_type_name: appointment.appointment_type_name,
    appointmenttype_name: appointment.appointmenttype_name,
    type_name: appointment.type_name,
    type: appointment.type,
    status: appointment.status,
    agent_id: appointment.agent_id,
    agentid: appointment.agentid,
    agent_ids: appointment.agent_ids,
    agents: Array.isArray(appointment.agents) ? appointment.agents.slice(0, 5) : undefined,
    start: appointmentDateValue(appointment, "start"),
    end: appointmentDateValue(appointment, "end"),
    allday: appointment.allday ?? appointment.all_day ?? appointment.isallday ?? appointment.is_all_day
  };
}

function summarizeRawHoliday(holiday) {
  return {
    id: holiday.id,
    holid: holiday.holid,
    name: holiday.name,
    workday_name: holiday.workday_name,
    workday_id: holiday.workday_id,
    agent_id: holiday.agent_id,
    agent_name: holiday.agent_name,
    date: holiday.date,
    date_only: holiday.date_only,
    date_datetime: holiday.date_datetime,
    end_date: holiday.end_date,
    end_date_only: holiday.end_date_only,
    allday: holiday.allday,
    duration: holiday.duration,
    holiday_type: holiday.holiday_type,
    approval_status: holiday.approval_status
  };
}

function isAvailabilityBlock(appointment, title = "") {
  const values = [
    title,
    appointment.appointment_type_name,
    appointment.appointmenttype_name,
    appointment.appointmenttypename,
    appointment.type_name,
    appointment.typename,
    appointment.type,
    appointment.status,
    appointment.note,
    appointment.subject,
    appointment.title,
    appointment.summary
  ].map(value => String(value || "").toLowerCase());
  return values.some(value => {
    return value.includes("holiday")
      || value.includes("pto")
      || value.includes("paid time off")
      || value.includes("vacation")
      || value.includes("out of office")
      || value.includes("out-of-office")
      || value.includes("sick");
  });
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
    .flatMap(agent => splitAgentIds(agent.id ?? agent.agent_id ?? agent.agentid ?? agent.agentId ?? agent.resource_id ?? agent.resourceid ?? agent.userid ?? agent.user_id))
    .filter(value => value !== undefined && value !== null);
  const resources = Array.isArray(appointment.resources) ? appointment.resources : [];
  const fromResources = resources
    .flatMap(resource => splitAgentIds(resource.id ?? resource.agent_id ?? resource.agentid ?? resource.resource_id ?? resource.resourceid ?? resource.userid ?? resource.user_id))
    .filter(value => value !== undefined && value !== null);
  const primary = [
    appointment.agent_id,
    appointment.agentid,
    appointment.agentId,
    appointment.userid,
    appointment.user_id,
    appointment.userId,
    appointment.assigned_agent_id,
    appointment.assigned_agentid,
    appointment.scheduled_for_id,
    appointment.scheduledforid,
    appointment.resource_id,
    appointment.resourceid,
    appointment.owner_agent_id,
    appointment.owneragentid,
    appointment.agent_ids,
    appointment.agentids
  ].flatMap(splitAgentIds).filter(value => value !== undefined && value !== null);
  return Array.from(new Set([...primary, ...fromAgents, ...fromResources].map(String)));
}

function splitAgentIds(value) {
  if (Array.isArray(value)) return value.flatMap(splitAgentIds);
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(",").map(entry => entry.trim()).filter(Boolean);
}

function appointmentDateValue(appointment, part) {
  const prefix = part === "end" ? "end" : "start";
  return appointment[`${prefix}_date`]
    || appointment[`${prefix}date`]
    || appointment[`${prefix}_datetime`]
    || appointment[`${prefix}datetime`]
    || appointment[`${prefix}_time`]
    || appointment[`${prefix}time`]
    || appointment[`${prefix}_date_only`]
    || appointment[`${prefix}dateonly`]
    || (prefix === "start" ? appointment.date : "")
    || (prefix === "start" ? appointment.appointment_date : "");
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
      memberships.forEach(team => {
        const teamId = String(team.team_id ?? team.id ?? "");
        if (!teamId) return;
        teamMap.set(teamId, {
          id: teamId,
          name: team.name || team.team || team.team_name || (String(agent.team_id) === teamId ? agent.team : "") || `Team ${teamId}`
        });
      });
      const matchingTeams = memberships.filter(team => {
        const teamId = String(team.team_id ?? team.id ?? "");
        return (!teamIds.size || teamIds.has(teamId)) && isTrue(team.in_section);
      });
      if (!matchingTeams.length) return null;

      const primaryTeam = matchingTeams[0];
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
  debugLog(env, "updateAppointment payload", body);
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
  const dateFieldId = dispatchDateFieldId(env);
  if (!dateFieldId) {
    throw new Error("Missing Worker variable: HALO_DISPATCH_DATE_FIELD_ID");
  }

  return {
    id: Number(payload.ticketId),
    agent_id: haloAgentId(payload.technicianId, env),
    customfields: [
      {
        id: Number(dateFieldId),
        name: dispatchDateFieldName(env),
        value: payload.dateFieldValue ?? payload.date
      }
    ]
  };
}

function dispatchDateFieldId(env) {
  return String(env.HALO_DISPATCH_DATE_FIELD_ID || "486");
}

function dispatchDateFieldName(env) {
  return env.HALO_DISPATCH_DATE_FIELD_NAME || "CFTaskWithoutTimeDate";
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
  const text = String(value || "").trim();
  const reportDataMatch = text.match(/ReportData\/([^/?#]+)/i);
  if (reportDataMatch) return reportDataMatch[1];
  return text;
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

function customDatePart(value) {
  return String(value || "").trim().slice(0, 10);
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
  const text = String(value).toLowerCase();
  return value === true || text === "true" || text === "1" || text === "yes";
}

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.agents)) return data.agents;
  if (Array.isArray(data?.appointments)) return data.appointments;
  if (Array.isArray(data?.ticketTypes)) return data.ticketTypes;
  if (Array.isArray(data?.requesttypes)) return data.requesttypes;
  if (Array.isArray(data?.requestTypes)) return data.requestTypes;
  if (Array.isArray(data?.tickets)) return data.tickets;
  if (Array.isArray(data?.faults)) return data.faults;
  if (Array.isArray(data?.users)) return data.users;
  if (Array.isArray(data?.record)) return data.record;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function haloGetAllPages(env, path, params = new URLSearchParams(), options = {}) {
  const size = pageSize(env, options.pageSize);
  const maxPages = maxPageCount(env, options.maxPages);
  const records = [];
  let firstPath = "";
  let pages = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("pageinate", "true");
    pageParams.set("page_no", String(page));
    pageParams.set("page_size", String(size));
    pageParams.set("count", String(size));

    const haloPath = `${path}?${pageParams.toString()}`;
    if (!firstPath) firstPath = haloPath;
    const response = await haloRequest(env, haloPath, { method: "GET" });
    const pageRecords = unwrapList(response.data);
    records.push(...pageRecords);
    pages = page;

    if (pageRecords.length < size) break;
  }

  return { records, meta: { firstPath, pages, pageSize: size, maxPages } };
}

function pageSize(env, requested) {
  const value = Number(requested || env.HALO_PAGE_SIZE || DEFAULT_PAGE_SIZE);
  return Math.min(DEFAULT_PAGE_SIZE, Math.max(1, Number.isFinite(value) ? value : DEFAULT_PAGE_SIZE));
}

function maxPageCount(env, requested) {
  const value = Number(requested || env.HALO_MAX_PAGES || DEFAULT_MAX_PAGES);
  return Math.max(1, Number.isFinite(value) ? value : DEFAULT_MAX_PAGES);
}

async function loadCustomTable(env, tableId) {
  const detailPaths = customTableReadPaths(tableId);
  const response = await haloRequestWithFallback(env, detailPaths, { method: "GET" });
  const table = response.data || {};
  const rows = customTableRows(table);
  const fields = Array.isArray(table.fields) ? table.fields : [];
  const extra = await loadCustomTableRows(env, tableId, fields);
  const extraRows = extra.rows;
  extraRows.forEach(row => mergeCustomTableRow(rows, row));
  if (!rows.length) {
    const queryResult = await loadCustomTableRowsByQuery(env, tableId, table.db_name);
    queryResult.rows.forEach(row => mergeCustomTableRow(rows, row));
    extra.summary.push(queryResult.summary);
  }
  return {
    id: Number(table.id || table.customextratableid || tableId),
    rows,
    fields,
    schema: Array.isArray(table.schema) ? table.schema : [],
    raw: table,
    readSummary: [
      summarizeCustomTableResponse(detailPaths[0], table),
      ...extra.summary
    ]
  };
}

async function loadCustomTableRowsByQuery(env, tableId, dbName) {
  if (!isDispatchStorageTableId(tableId) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(String(dbName || ""))) {
    return { rows: [], summary: { path: "CustomQuery", skipped: true, tableId, dbName } };
  }
  const query = {
    name: `Dispatch Board ${tableId}`,
    sql_script: `select * from ${dbName}`,
    run: true,
    top_max: 500
  };
  try {
    const response = await haloRequest(env, "/api/CustomQuery", {
      method: "POST",
      body: query
    });
    const rows = customQueryRows(response.data);
    return {
      rows,
      summary: summarizeCustomQueryResponse(tableId, dbName, response.data, rows.length)
    };
  } catch (error) {
    debugLog(env, "custom table query fallback failed", { tableId, dbName, error: error.message });
    return { rows: [], summary: { path: "CustomQuery", tableId, dbName, error: error.message } };
  }
}

function summarizeCustomQueryResponse(tableId, dbName, data, rowCount) {
  const results = Array.isArray(data) ? data : unwrapList(data);
  const first = results[0] || data || {};
  return {
    path: "CustomQuery",
    tableId,
    dbName,
    rowCount,
    responseType: Array.isArray(data) ? "array" : typeof data,
    resultCount: results.length,
    keys: first && typeof first === "object" ? Object.keys(first).slice(0, 20) : [],
    success: first?.run_result?.success ?? first?.success,
    error: first?.run_result?.error ?? first?.error ?? ""
  };
}

function isDispatchStorageTableId(tableId) {
  const value = Number(tableId);
  return value === DEFAULT_USER_PREF_TABLE_ID || value === DEFAULT_SAVED_FILTER_TABLE_ID;
}

function customQueryRows(data) {
  const results = Array.isArray(data) ? data : unwrapList(data);
  return results.flatMap(item => {
    const sqlResult = item.run_result?.sql_result ?? item.sql_result ?? item.result ?? item.data;
    if (Array.isArray(sqlResult)) return sqlResult;
    if (Array.isArray(sqlResult?.rows)) return sqlResult.rows;
    if (Array.isArray(sqlResult?.data)) return sqlResult.data;
    if (typeof sqlResult === "string") return parseStorageJson(sqlResult, []);
    return [];
  });
}

function customTableReadPaths(tableId) {
  const encoded = encodeURIComponent(tableId);
  return [
    `/api/CustomTable/${encoded}?includedetails=true&includevalues=true&includerows=true&includedata=true&loaddata=true&load_data=true`,
    `/api/CustomTable/${encoded}?includedetails=true`,
    `/api/CustomTables/${encoded}?includedetails=true&includevalues=true&includerows=true&includedata=true&loaddata=true&load_data=true`,
    `/api/CustomTables/${encoded}?includedetails=true`
  ];
}

async function loadCustomTableRows(env, tableId, fields = []) {
  const primaryFieldIds = fields.map(field => field.id).filter(Boolean).slice(0, 1);
  const paths = [
    `/api/CustomTable?usage=${encodeURIComponent(tableId)}&includedetails=true&includevalues=true&includerows=true&includedata=true&loaddata=true&load_data=true`,
    `/api/CustomTable?customonly=true&usage=${encodeURIComponent(tableId)}&includedetails=true&includevalues=true&includerows=true&includedata=true&loaddata=true&load_data=true`,
    `/api/CustomTables?usage=${encodeURIComponent(tableId)}&includedetails=true&includevalues=true&includerows=true&includedata=true&loaddata=true&load_data=true`,
    ...primaryFieldIds.flatMap(fieldId => [
      `/api/CustomTable/${encodeURIComponent(fieldId)}?includedetails=true&includevalues=true&includerows=true&includedata=true&loaddata=true&load_data=true`,
      `/api/CustomTable?usage=${encodeURIComponent(fieldId)}&includedetails=true&includevalues=true&includerows=true&includedata=true&loaddata=true&load_data=true`
    ])
  ];
  const rows = [];
  const summary = [];
  for (const path of paths) {
    try {
      const response = await haloRequest(env, path, { method: "GET" });
      summary.push(summarizeCustomTableResponse(path, response.data));
      customTableRows(response.data || {}).forEach(row => mergeCustomTableRow(rows, row));
      unwrapList(response.data).forEach(entry => {
        if (String(entry.id || entry.customextratableid || entry.usage || "") === String(tableId)) {
          customTableRows(entry).forEach(row => mergeCustomTableRow(rows, row));
        } else if (Array.isArray(entry.customfields)) {
          mergeCustomTableRow(rows, entry);
        }
      });
    } catch (error) {
      summary.push({ path, error: error.message });
      debugLog(env, "custom table row variant failed", { tableId, path, error: error.message });
    }
  }
  return { rows, summary };
}

function summarizeCustomTableResponse(path, data) {
  const keys = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [];
  const arrayKeys = keys
    .filter(key => Array.isArray(data[key]))
    .map(key => ({ key, count: data[key].length, sampleKeys: data[key][0] && typeof data[key][0] === "object" ? Object.keys(data[key][0]).slice(0, 12) : [] }));
  return {
    path,
    type: Array.isArray(data) ? "array" : typeof data,
    keys: keys.slice(0, 30),
    arrayKeys,
    arrayCount: Array.isArray(data) ? data.length : undefined,
    firstArrayKeys: Array.isArray(data) && data[0] && typeof data[0] === "object" ? Object.keys(data[0]).slice(0, 12) : undefined
  };
}

function customTableRows(table) {
  const rows = [
    ...(Array.isArray(table.rows) ? table.rows : []),
    ...(Array.isArray(table.data) ? table.data : []),
    ...(Array.isArray(table.values) ? table.values : []),
    ...(Array.isArray(table.value) ? table.value : []),
    ...(Array.isArray(table.records) ? table.records : [])
  ];
  const nestedRows = (Array.isArray(table.customfields) ? table.customfields : [])
    .flatMap(field => Array.isArray(field.value) ? field.value : [])
    .filter(row => Array.isArray(row?.customfields));

  nestedRows.forEach(row => mergeCustomTableRow(rows, row));
  return rows;
}

function mergeCustomTableRow(rows, row) {
  if (!row) return;
  const key = row.id || row.key || row.fkid || row.display || JSON.stringify(row.customfields || row);
  const exists = rows.some(entry => {
    const entryKey = entry.id || entry.key || entry.fkid || entry.display || JSON.stringify(entry.customfields || entry);
    return String(entryKey) === String(key);
  });
  if (!exists) rows.push(row);
}

async function saveCustomTableRow(env, tableId, row, existingRow, fields = []) {
  const customfields = rowToCustomFields(row, fields);
  const tableField = customTableEntryField(fields, customfields);
  const body = [{
    id: Number(tableId),
    _isimport: true,
    _importtype: "runbook",
    customfields: [
      {
        id: tableField.id,
        name: tableField.name,
        type: 7,
        usage: Number(tableId),
        value: [
          {
            customfields: customfields.length ? customfields : rowToFallbackCustomFields(row)
          }
        ]
      }
    ]
  }];
  const response = await haloRequestWithFallback(env, ["/api/CustomTable", "/api/CustomTables"], {
    method: "POST",
    body
  });
  return {
    ok: true,
    data: response.data,
    meta: {
      tableId: Number(tableId),
      mode: existingRow?.id ? "update" : "insert"
    }
  };
}

function customTableEntryField(fields = [], customfields = []) {
  const primary = fields.find(field => customfields.some(entry => Number(entry.id) === Number(field.id)));
  const fallback = fields.find(field => field.id) || customfields.find(field => field.id);
  if (!primary && !fallback) {
    throw new Error("Unable to identify the custom table entry field for this Halo custom table.");
  }
  return primary || fallback;
}

function rowToCustomFields(row, fields = []) {
  if (!fields.length) return [];
  return Object.entries(row).flatMap(([key, value]) => {
    const field = fields.find(entry => fieldMatches(entry, key));
    if (!field?.id) return [];
    return [{
      id: field.id,
      name: field.name,
      value
    }];
  });
}

function rowToFallbackCustomFields(row) {
  return Object.entries(row).map(([key, value]) => ({
    name: key,
    value
  }));
}

async function haloRequestWithFallback(env, paths, options = {}) {
  let lastError;
  for (const path of paths) {
    try {
      return await haloRequest(env, path, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function normalizeUserPreferenceRows(rows, agentId, env) {
  const fields = storageFields(env);
  const row = rows.find(entry => String(readRowValue(entry, fields.prefAgent)) === String(agentId));
  if (!row) return null;
  const payload = parseStorageJson(readRowValue(row, fields.prefVisibleTickets), null);
  if (payload && !Array.isArray(payload) && typeof payload === "object") {
    return {
      rowId: row.id || null,
      agentId,
      preferences: compactObject({
        ...payload,
        theme: payload.theme ?? readRowValue(row, fields.prefTheme),
        orientation: payload.orientation ?? readRowValue(row, fields.prefOrientation),
        selectedTeams: payload.selectedTeams ?? parseStorageJson(readRowValue(row, fields.prefSelectedTeams), []),
        selectedTechs: payload.selectedTechs ?? parseStorageJson(readRowValue(row, fields.prefSelectedAgents), [])
      })
    };
  }
  return {
    rowId: row.id || null,
    agentId,
    preferences: compactObject({
      theme: readRowValue(row, fields.prefTheme),
      orientation: readRowValue(row, fields.prefOrientation),
      selectedTeams: parseStorageJson(readRowValue(row, fields.prefSelectedTeams), []),
      selectedTechs: parseStorageJson(readRowValue(row, fields.prefSelectedAgents), []),
      ticketPanelPinned: parseStorageBoolean(readRowValue(row, fields.prefPanelPinned)),
      ticketPanelWidth: Number(readRowValue(row, fields.prefPanelWidth)) || undefined,
      calendarStartTime: readRowValue(row, fields.prefCalendarStart),
      calendarEndTime: readRowValue(row, fields.prefCalendarEnd),
      techThemes: parseStorageJson(readRowValue(row, fields.prefTechThemes), {}),
      visibleFields: Array.isArray(payload) ? payload : []
    })
  };
}

function normalizeSavedFilterRows(rows, env) {
  const fields = storageFields(env);
  return rows.reduce((filters, row) => {
    const active = readRowValue(row, fields.filterActive);
    if (active === false || String(active).toLowerCase() === "false") return filters;
    const deleted = readRowValue(row, fields.filterDeleted);
    if (deleted === true || String(deleted).toLowerCase() === "true") return filters;

    const name = String(readRowValue(row, fields.filterName) || "").trim();
    if (!name) return filters;

    const fallbackFilter = parseStorageJson(readRowValue(row, fields.filterJson), {});
    const conditionPayload = parseStorageJson(readRowValue(row, fields.filterConditions), fallbackFilter.conditions || []);
    const conditions = Array.isArray(conditionPayload) ? conditionPayload : (conditionPayload.conditions || fallbackFilter.conditions || []);
    filters[name] = {
      ...fallbackFilter,
      name: fallbackFilter.name || name,
      title: fallbackFilter.title || readRowValue(row, fields.filterTitle) || name,
      color: fallbackFilter.color || readRowValue(row, fields.filterColor) || "#1976a3",
      includeAssigned: fallbackFilter.includeAssigned ?? conditionPayload.includeAssigned ?? false,
      conditions
    };
    return filters;
  }, {});
}

function storageFields(env, schema = []) {
  return {
    prefAgent: fieldAliases(env.HALO_PREF_AGENT_FIELD, storageAliases("CFDispatchAgentID", 488, "agent_id", "agentId", "Agent ID", "Agent"), schema),
    prefTheme: fieldAliases(env.HALO_PREF_THEME_FIELD, storageAliases("CFDispatchTheme", 489, "theme", "Dispatch Theme"), schema),
    prefOrientation: fieldAliases(env.HALO_PREF_ORIENTATION_FIELD, storageAliases("CFDispatchOrientation", 490, "orientation", "Calendar Orientation"), schema),
    prefSelectedTeams: fieldAliases(env.HALO_PREF_SELECTED_TEAMS_FIELD, storageAliases("CFDispatchSelectedTeams", 491, "selected_team_ids_json", "Selected Teams"), schema),
    prefSelectedAgents: fieldAliases(env.HALO_PREF_SELECTED_AGENTS_FIELD, storageAliases("CFDispatchSelectedAgents", 492, "selected_agent_ids_json", "Selected Agents"), schema),
    prefPanelPinned: fieldAliases(env.HALO_PREF_PANEL_PINNED_FIELD, storageAliases("CFDispatchPanelPinned", 493, "ticket_panel_pinned", "Ticket Panel Pinned?"), schema),
    prefPanelWidth: fieldAliases(env.HALO_PREF_PANEL_WIDTH_FIELD, storageAliases("CFDispatchPanelWidth", 494, "ticket_panel_width", "Dispatch Ticket Panel Width"), schema),
    prefCalendarStart: fieldAliases(env.HALO_PREF_CALENDAR_START_FIELD, storageAliases("CFDispatchCalendarStartTime", 495, "calendar_start_time", "Calendar Start Time"), schema),
    prefCalendarEnd: fieldAliases(env.HALO_PREF_CALENDAR_END_FIELD, storageAliases("CFDispatchCalendarEndTime", 496, "calendar_end_time", "Calendar End Time"), schema),
    prefTechThemes: fieldAliases(env.HALO_PREF_TECH_THEMES_FIELD, storageAliases("CFDispatchTechThemes", 497, "tech_themes_json", "Tech Themes"), schema),
    prefVisibleTickets: fieldAliases(env.HALO_PREF_VISIBLE_TICKETS_FIELD, storageAliases("CFDispatchVisibleTickets", 498, "visible_ticket_fields_json", "Visible Tickets"), schema),
    filterName: fieldAliases(env.HALO_FILTER_NAME_FIELD, storageAliases("CFDispatchFilterName", 502, "filter_name", "name", "Filter Name"), schema),
    filterTitle: fieldAliases(env.HALO_FILTER_TITLE_FIELD, storageAliases("CFDispatchFilterTitle", 503, "list_title", "title", "Filter Title"), schema),
    filterColor: fieldAliases(env.HALO_FILTER_COLOR_FIELD, storageAliases("CFDispatchFilterColor", 504, "color", "theme_color", "Filter Color"), schema),
    filterConditions: fieldAliases(env.HALO_FILTER_CONDITIONS_FIELD, storageAliases("CFDispatchFilterConditions", 505, "conditions_json", "filter_conditions", "Filter Conditions"), schema),
    filterJson: fieldAliases(env.HALO_FILTER_JSON_FIELD, ["filter_json", "filter", "json"], schema),
    filterDeleted: fieldAliases(env.HALO_FILTER_DELETED_FIELD, ["deleted", "is_deleted", "Deleted"], schema),
    filterCreatedBy: fieldAliases(env.HALO_FILTER_CREATED_BY_FIELD, storageAliases("CFDispatchFilterCreatedBy", 506, "created_by_agent_id", "Created By"), schema),
    filterUpdatedBy: fieldAliases(env.HALO_FILTER_UPDATED_BY_FIELD, storageAliases("CFDispatchFilterUpdatedBy", 507, "updated_by_agent_id", "Updated By"), schema),
    filterActive: fieldAliases(env.HALO_FILTER_ACTIVE_FIELD, storageAliases("CFDispatchFilterActive", 508, "is_active", "active", "Is Active"), schema),
    filterCreatedAt: fieldAliases(env.HALO_FILTER_CREATED_AT_FIELD, storageAliases("CFDispatchFilterCreatedAt", 509, "created_at", "Created At"), schema),
    createdAt: fieldAliases(env.HALO_STORAGE_CREATED_AT_FIELD, storageAliases("CFDispatchCreatedAt", 499, "created_at", "Created At"), schema),
    updatedAt: fieldAliases(env.HALO_STORAGE_UPDATED_AT_FIELD, storageAliases("CFDispatchUpdatedAt", 500, "CFDispatchFilerUpdatedAt", 510, "updated_at", "Updated At"), schema)
  };
}

function storageAliases(name, id, ...aliases) {
  const padded = String(id).padStart(5, "0");
  return [name, String(id), `CF${id}`, `cf${id}`, `$CF${padded}`, `$cf${padded}`, ...aliases];
}

function fieldAliases(configured, defaults, schema = []) {
  const values = parseListEnv(configured);
  const aliases = values.length ? values : defaults;
  const schemaMatch = schema.find(field => aliases.some(alias => fieldMatches(field, alias)));
  return schemaMatch ? [schemaMatch.name, schemaMatch.label, schemaMatch.labellong, ...aliases].filter(Boolean) : aliases;
}

function fieldMatches(field, alias) {
  const needle = normalizeFieldName(alias);
  return [field.name, field.label, field.labellong, field.summary, field.id, field.guid]
    .map(normalizeFieldName)
    .some(value => value === needle);
}

function readRowValue(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null) return row[name];
    const match = Object.keys(row).find(key => key.toLowerCase() === String(name).toLowerCase());
    if (match && row[match] !== undefined && row[match] !== null) return row[match];
  }

  const customfields = Array.isArray(row.customfields) ? row.customfields : [];
  for (const name of names) {
    const match = customfields.find(field => {
      return fieldMatches(field, name);
    });
    if (match) return match.value ?? match.display ?? "";
  }

  return "";
}

function parseStorageJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function parseStorageBoolean(value) {
  if (value === true || value === false) return value;
  if (value === "" || value === undefined || value === null) return undefined;
  return ["true", "1", "yes"].includes(String(value).toLowerCase());
}

function normalizeFieldName(value) {
  return String(value || "").trim().toLowerCase();
}

function customTableId(env, key, fallback) {
  const value = Number(env[key] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

async function haloRequest(env, path, options = {}) {
  const accessToken = options.bearerToken || await getAccessToken(env);
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

function debugLog(env, message, data = {}) {
  if (!isTrue(env.HALO_DEBUG_LOGS)) return;
  console.log(message, JSON.stringify(data));
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
