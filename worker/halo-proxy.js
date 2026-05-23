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
    include_custom_fields: env.HALO_DISPATCH_DATE_FIELD_ID || "",
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
  const customDate = customFieldValue(ticket, env.HALO_DISPATCH_DATE_FIELD_ID || "486");
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
  const params = new URLSearchParams({
    start_date: `${date}T00:00:00`,
    end_date: `${date}T23:59:59`,
    agents: agentIds.join(","),
    showall: "true",
    showappointments: "true",
    excluderecurringmaster: "true",
    count: String(pageSize(env))
  });

  const { records: rawAppointments, meta } = await haloGetAllPages(env, "/api/Appointment", params);
  debugLog(env, "loadAppointments request", { date, agentIds, haloPath: meta.firstPath, pages: meta.pages });

  const appointments = rawAppointments
    .flatMap(appointment => normalizeAppointment(appointment, date, agentIds, env))
    .filter(Boolean);
  debugLog(env, "loadAppointments response", {
    date,
    agentIds,
    pages: meta.pages,
    rawCount: rawAppointments.length,
    normalizedCount: appointments.length,
    normalizedSample: appointments.slice(0, 5)
  });

  return {
    ok: true,
    data: { appointments },
    meta: {
      haloPath: meta.firstPath,
      rawCount: rawAppointments.length,
      normalizedCount: appointments.length,
      pages: meta.pages
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
    includeallopen: "true",
    includecompleted: "false",
    includeclosed: "false",
    includestatus: "true",
    includetickettype: "true",
    count: String(pageSize(env))
  });
  const { records: rawTickets, meta } = await haloGetAllPages(env, "/api/Tickets", params);
  debugLog(env, "loadDateOnlyTasks request", { date, agentIds, haloPath: meta.firstPath, pages: meta.pages });
  const normalizedTasks = rawTickets
    .map(ticket => normalizeDateOnlyTicket(ticket, dateFieldId))
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
  const [preferencesTable, filtersTable] = await Promise.all([
    loadCustomTable(env, customTableId(env, "HALO_USER_PREF_TABLE_ID", DEFAULT_USER_PREF_TABLE_ID)),
    loadCustomTable(env, customTableId(env, "HALO_SAVED_FILTER_TABLE_ID", DEFAULT_SAVED_FILTER_TABLE_ID))
  ]);

  const preferences = agentId ? normalizeUserPreferenceRows(preferencesTable.rows, agentId, env) : null;
  const savedFilters = normalizeSavedFilterRows(filtersTable.rows, env);

  return {
    ok: true,
    data: {
      userPreferences: preferences,
      savedFilters,
      meta: {
        userPreferenceRows: preferencesTable.rows.length,
        savedFilterRows: filtersTable.rows.length,
        userPreferenceTableId: preferencesTable.id,
        savedFilterTableId: filtersTable.id
      }
    }
  };
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
    [fields.prefVisibleTickets[0]]: JSON.stringify(preferences.visibleFields || []),
    [fields.updatedAt[0]]: now,
    ...(!existing ? { [fields.createdAt[0]]: now } : {})
  };

  const result = await saveCustomTableRow(env, tableId, row, existing, table.fields);
  const verifiedTable = await loadCustomTable(env, tableId);
  const verifiedFields = storageFields(env, verifiedTable.fields);
  const saved = verifiedTable.rows.find(entry => String(readRowValue(entry, verifiedFields.prefAgent)) === agentId);
  if (!saved) {
    return {
      ok: false,
      error: "Halo accepted the custom table save, but the preference row was not found afterward. Confirm the User Preferences table column names.",
      meta: result.meta
    };
  }
  return result;
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
  const row = {
    [fields.filterName[0]]: name,
    [fields.filterTitle[0]]: filter.title || name,
    [fields.filterColor[0]]: filter.color || "",
    [fields.filterConditions[0]]: JSON.stringify(filter.conditions || []),
    [fields.filterActive[0]]: true,
    [fields.filterUpdatedBy[0]]: String(payload.agentId || ""),
    [fields.updatedAt[0]]: now,
    ...(!existing ? {
      [fields.filterCreatedBy[0]]: String(payload.agentId || ""),
      [fields.filterCreatedAt[0]]: now
    } : {}),
    [fields.filterJson[0]]: JSON.stringify(filter),
    [fields.filterDeleted[0]]: false
  };

  const result = await saveCustomTableRow(env, tableId, row, existing, table.fields);
  const verifiedTable = await loadCustomTable(env, tableId);
  const verifiedFields = storageFields(env, verifiedTable.fields);
  const saved = verifiedTable.rows.find(entry => String(readRowValue(entry, verifiedFields.filterName)).toLowerCase() === name.toLowerCase());
  if (!saved) {
    return {
      ok: false,
      error: "Halo accepted the custom table save, but the saved filter row was not found afterward. Confirm the Saved Filters table column names.",
      meta: result.meta
    };
  }
  return result;
}

async function handleDispatchSavedFilterDelete(payload, env) {
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("Filter name is required.");

  const tableId = customTableId(env, "HALO_SAVED_FILTER_TABLE_ID", DEFAULT_SAVED_FILTER_TABLE_ID);
  const table = await loadCustomTable(env, tableId);
  const fields = storageFields(env, table.fields);
  const existing = table.rows.find(row => String(readRowValue(row, fields.filterName)).toLowerCase() === name.toLowerCase());
  if (!existing) return { ok: true, mode: "not-found", message: "Saved filter was not present in Halo storage." };

  const row = {
    [fields.filterName[0]]: name,
    [fields.filterActive[0]]: false,
    [fields.filterDeleted[0]]: true,
    [fields.updatedAt[0]]: new Date().toISOString()
  };

  const result = await saveCustomTableRow(env, tableId, row, existing, table.fields);
  const verifiedTable = await loadCustomTable(env, tableId);
  const verifiedFields = storageFields(env, verifiedTable.fields);
  const saved = verifiedTable.rows.find(entry => String(readRowValue(entry, verifiedFields.filterName)).toLowerCase() === name.toLowerCase());
  const active = saved ? readRowValue(saved, verifiedFields.filterActive) : "";
  const deleted = saved ? readRowValue(saved, verifiedFields.filterDeleted) : "";
  if (saved && active !== false && String(active).toLowerCase() !== "false" && deleted !== true && String(deleted).toLowerCase() !== "true") {
    return {
      ok: false,
      error: "Halo accepted the custom table save, but the filter was not marked deleted afterward. Confirm the Saved Filters table column names.",
      meta: result.meta
    };
  }
  return result;
}

function normalizeDateOnlyTicket(ticket, dateFieldId) {
  const ticketId = ticket.id ?? ticket.faultid ?? ticket.fault_id;
  const techId = ticket.agent_id ?? ticket.agentid ?? ticket.assigned_agent_id;
  const date = String(customFieldValue(ticket, dateFieldId) || "").slice(0, 10);
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

function customFieldValue(ticket, fieldId) {
  const fields = Array.isArray(ticket.customfields) ? ticket.customfields : [];
  const wanted = String(fieldId).toLowerCase();
  const match = fields.find(field => {
    const candidates = [
      field.id,
      field.customfield_id,
      field.name,
      field.label,
      field.display_name
    ].map(value => String(value || "").toLowerCase());
    return candidates.includes(wanted) || (wanted === "486" && field.name === "CFTaskWithoutTimeDate");
  });
  return match?.value ?? match?.display ?? match?.text ?? "";
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
  const response = await haloRequestWithFallback(env, [
    `/api/CustomTable/${encodeURIComponent(tableId)}?includedetails=true`,
    `/api/CustomTables/${encodeURIComponent(tableId)}?includedetails=true`
  ], { method: "GET" });
  const table = response.data || {};
  return {
    id: Number(table.id || table.customextratableid || tableId),
    rows: Array.isArray(table.rows) ? table.rows : [],
    fields: Array.isArray(table.fields) ? table.fields : [],
    schema: Array.isArray(table.schema) ? table.schema : [],
    raw: table
  };
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
      visibleFields: parseStorageJson(readRowValue(row, fields.prefVisibleTickets), [])
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
    const conditions = parseStorageJson(readRowValue(row, fields.filterConditions), fallbackFilter.conditions || []);
    filters[name] = {
      ...fallbackFilter,
      name: fallbackFilter.name || name,
      title: fallbackFilter.title || readRowValue(row, fields.filterTitle) || name,
      color: fallbackFilter.color || readRowValue(row, fields.filterColor) || "#1976a3",
      conditions
    };
    return filters;
  }, {});
}

function storageFields(env, schema = []) {
  return {
    prefAgent: fieldAliases(env.HALO_PREF_AGENT_FIELD, ["CFDispatchAgentID", "agent_id", "agentId", "Agent ID", "Agent"], schema),
    prefTheme: fieldAliases(env.HALO_PREF_THEME_FIELD, ["CFDispatchTheme", "theme", "Dispatch Theme"], schema),
    prefOrientation: fieldAliases(env.HALO_PREF_ORIENTATION_FIELD, ["CFDispatchOrientation", "orientation", "Calendar Orientation"], schema),
    prefSelectedTeams: fieldAliases(env.HALO_PREF_SELECTED_TEAMS_FIELD, ["CFDispatchSelectedTeams", "selected_team_ids_json", "Selected Teams"], schema),
    prefSelectedAgents: fieldAliases(env.HALO_PREF_SELECTED_AGENTS_FIELD, ["CFDispatchSelectedAgents", "selected_agent_ids_json", "Selected Agents"], schema),
    prefPanelPinned: fieldAliases(env.HALO_PREF_PANEL_PINNED_FIELD, ["CFDispatchPanelPinned", "ticket_panel_pinned", "Ticket Panel Pinned?"], schema),
    prefPanelWidth: fieldAliases(env.HALO_PREF_PANEL_WIDTH_FIELD, ["CFDispatchPanelWidth", "ticket_panel_width", "Dispatch Ticket Panel Width"], schema),
    prefCalendarStart: fieldAliases(env.HALO_PREF_CALENDAR_START_FIELD, ["CFDispatchCalendarStartTime", "calendar_start_time", "Calendar Start Time"], schema),
    prefCalendarEnd: fieldAliases(env.HALO_PREF_CALENDAR_END_FIELD, ["CFDispatchCalendarEndTime", "calendar_end_time", "Calendar End Time"], schema),
    prefTechThemes: fieldAliases(env.HALO_PREF_TECH_THEMES_FIELD, ["CFDispatchTechThemes", "tech_themes_json", "Tech Themes"], schema),
    prefVisibleTickets: fieldAliases(env.HALO_PREF_VISIBLE_TICKETS_FIELD, ["CFDispatchVisibleTickets", "visible_ticket_fields_json", "Visible Tickets"], schema),
    filterName: fieldAliases(env.HALO_FILTER_NAME_FIELD, ["CFDispatchFilterName", "filter_name", "name", "Filter Name"], schema),
    filterTitle: fieldAliases(env.HALO_FILTER_TITLE_FIELD, ["CFDispatchFilterTitle", "list_title", "title", "Filter Title"], schema),
    filterColor: fieldAliases(env.HALO_FILTER_COLOR_FIELD, ["CFDispatchFilterColor", "color", "theme_color", "Filter Color"], schema),
    filterConditions: fieldAliases(env.HALO_FILTER_CONDITIONS_FIELD, ["CFDispatchFilterConditions", "conditions_json", "filter_conditions", "Filter Conditions"], schema),
    filterJson: fieldAliases(env.HALO_FILTER_JSON_FIELD, ["filter_json", "filter", "json"], schema),
    filterDeleted: fieldAliases(env.HALO_FILTER_DELETED_FIELD, ["deleted", "is_deleted", "Deleted"], schema),
    filterCreatedBy: fieldAliases(env.HALO_FILTER_CREATED_BY_FIELD, ["CFDispatchFilterCreatedBy", "created_by_agent_id", "Created By"], schema),
    filterUpdatedBy: fieldAliases(env.HALO_FILTER_UPDATED_BY_FIELD, ["CFDispatchFilterUpdatedBy", "updated_by_agent_id", "Updated By"], schema),
    filterActive: fieldAliases(env.HALO_FILTER_ACTIVE_FIELD, ["CFDispatchFilterActive", "is_active", "active", "Is Active"], schema),
    filterCreatedAt: fieldAliases(env.HALO_FILTER_CREATED_AT_FIELD, ["CFDispatchFilterCreatedAt", "created_at", "Created At"], schema),
    createdAt: fieldAliases(env.HALO_STORAGE_CREATED_AT_FIELD, ["CFDispatchCreatedAt", "created_at", "Created At"], schema),
    updatedAt: fieldAliases(env.HALO_STORAGE_UPDATED_AT_FIELD, ["CFDispatchUpdatedAt", "CFDispatchFilerUpdatedAt", "updated_at", "Updated At"], schema)
  };
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
