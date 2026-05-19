const technicians = [
      { id: "davis", name: "2 Davis", team: "Field Service" },
      { id: "mlee", name: "M. Lee", team: "Field Service" },
      { id: "aperez", name: "A. Perez", team: "Projects" },
      { id: "jkim", name: "J. Kim", team: "Remote Support" }
    ];

    const teams = ["All Teams", "Field Service", "Projects", "Remote Support"];

    const reports = [
      { id: "r-dispatch", name: "Dispatch Queue", reportId: "Halo Report 1042" },
      { id: "r-emergency", name: "Escalations", reportId: "Halo Report 1088" },
      { id: "r-onsite", name: "Ready for Onsite", reportId: "Halo Report 1120" }
    ];

    const tickets = [
      { id: 23891, client: "Northwind Dental", title: "Front desk workstation cannot print", priority: "P2", type: "Break/Fix", report: "r-dispatch", site: "Plano", sla: "Due 10:30 AM", estimate: "45m", contact: "Megan H.", details: "Printer queue is stuck after Windows update. Client has two front desk users blocked.", dateField: "", assignedTo: "" },
      { id: 23896, client: "Lakeside Clinic", title: "Exam room Wi-Fi drops intermittently", priority: "P1", type: "Break/Fix", report: "r-emergency", site: "Dallas", sla: "Due 9:45 AM", estimate: "1h", contact: "Dr. Samuels", details: "Access point logs show repeated client disconnects near rooms 3 and 4.", dateField: "", assignedTo: "" },
      { id: 23901, client: "Harbor Logistics", title: "Warehouse scanner replacement", priority: "P3", type: "Maintenance", report: "r-onsite", site: "Irving", sla: "Due Friday", estimate: "30m", contact: "Luis R.", details: "Replacement scanner is ready. Needs pairing, test scan, and asset tag update.", dateField: "", assignedTo: "" },
      { id: 23907, client: "BrightPath CPA", title: "New hire laptop deployment", priority: "P2", type: "Project", report: "r-dispatch", site: "Fort Worth", sla: "Due 2:00 PM", estimate: "1.5h", contact: "Nina K.", details: "Laptop is imaged. Need desk setup, MFA enrollment, and printer mapping.", dateField: "", assignedTo: "" },
      { id: 23908, client: "Austin & Grey Law", title: "Conference room camera issue", priority: "P2", type: "Break/Fix", report: "r-dispatch", site: "Dallas", sla: "Due 3:30 PM", estimate: "30m", contact: "Dana A.", details: "Camera detected in device manager but Teams does not list it.", dateField: "", assignedTo: "" },
      { id: 23912, client: "Metro Fabrication", title: "Firewall firmware maintenance", priority: "P3", type: "Maintenance", report: "r-onsite", site: "Arlington", sla: "Due Today", estimate: "1h", contact: "Tom B.", details: "Approved maintenance window is after lunch. Confirm backups before update.", dateField: "", assignedTo: "" },
      { id: 23916, client: "Cedar Ridge School", title: "Projector audio not passing HDMI", priority: "P3", type: "Break/Fix", report: "r-dispatch", site: "Richardson", sla: "Due Tomorrow", estimate: "30m", contact: "Ellen P.", details: "Teacher reports video works but audio plays through laptop speakers.", dateField: "", assignedTo: "" },
      { id: 23919, client: "Summit Realty", title: "Boardroom display mount inspection", priority: "P2", type: "Project", report: "r-onsite", site: "Frisco", sla: "Due 4:00 PM", estimate: "1h", contact: "Rachel C.", details: "Inspect wall backing and confirm parts for Friday install.", dateField: "", assignedTo: "" }
    ];

    const state = {
      selectedTechs: ["davis", "mlee"],
      team: "Field Service",
      orientation: "horizontal",
      reportLists: ["r-dispatch", "r-emergency"],
      visibleFields: ["client", "sla", "estimate"],
      workingHours: [8, 17],
      colorBy: "priority",
      theme: "light",
      listViews: { pool: "card" },
      sectionSizes: {},
      apiBaseUrl: "",
      apiProxyUrl: "",
      pendingAppointment: null,
      activeTicketId: null,
      boardItems: [
        { ticketId: 23912, techId: "mlee", kind: "allDay", label: "Firmware maintenance", date: "" },
        { ticketId: 23907, techId: "davis", kind: "timed", time: "09:00", duration: 60, date: "" },
        { ticketId: 23919, techId: "mlee", kind: "timed", time: "15:00", duration: 60, date: "" },
        { ticketId: 23901, techId: "davis", kind: "noTime", label: "Scanner replacement", date: "" }
      ]
    };

    const fieldOptions = [
      { key: "client", label: "Client" },
      { key: "site", label: "Site" },
      { key: "sla", label: "SLA" },
      { key: "estimate", label: "Estimate" },
      { key: "contact", label: "Contact" },
      { key: "type", label: "Type" }
    ];

    const $ = (id) => document.getElementById(id);

    function init() {
      const today = new Date();
      $("boardDate").value = today.toISOString().slice(0, 10);
      state.boardItems.forEach(item => {
        if (!item.date) item.date = $("boardDate").value;
        const ticket = tickets.find(entry => entry.id === item.ticketId);
        if (ticket && !ticket.dateField) ticket.dateField = item.date;
      });
      loadLocalSettings();
      applyTheme();
      renderTeamSelect();
      renderTechPicker();
      renderFieldChecks();
      renderReportLists();
      renderBoard();
      renderPool();
      applySavedSectionSizes();
      observeResizableSections();
      wireSectionResizers();
      bindEvents();
      toast("Ready", "Dispatch board loaded. HaloPSA actions run in mock mode until a Worker API URL is saved.");
    }

    function bindEvents() {
      $("addListBtn").addEventListener("click", addReportList);
      $("prevDay").addEventListener("click", () => shiftDate(-1));
      $("nextDay").addEventListener("click", () => shiftDate(1));
      $("todayBtn").addEventListener("click", () => {
        $("boardDate").value = new Date().toISOString().slice(0, 10);
        renderAll();
      });
      $("boardDate").addEventListener("change", renderAll);
      $("teamSelect").addEventListener("change", selectTeam);
      $("hoursSelect").addEventListener("change", () => {
        state.workingHours = $("hoursSelect").value.split(",").map(Number);
        renderBoard();
      });
      $("colorBySelect").addEventListener("change", () => {
        state.colorBy = $("colorBySelect").value;
        saveLocalSettings();
        renderAll();
      });
      $("themeSelect").addEventListener("change", () => {
        state.theme = $("themeSelect").value;
        applyTheme();
        saveLocalSettings();
      });
      $("poolViewSelect").addEventListener("change", () => {
        state.listViews.pool = $("poolViewSelect").value;
        saveLocalSettings();
        renderPool();
      });
      $("horizontalBtn").addEventListener("click", () => setOrientation("horizontal"));
      $("verticalBtn").addEventListener("click", () => setOrientation("vertical"));
      $("settingsBtn").addEventListener("click", () => $("configDrawer").classList.add("open"));
      $("closeSettingsBtn").addEventListener("click", () => $("configDrawer").classList.remove("open"));
      $("saveApiBtn").addEventListener("click", saveApiSettings);
      $("refreshBtn").addEventListener("click", refreshReports);
      $("poolSearch").addEventListener("input", renderPool);
      $("poolPriority").addEventListener("change", renderPool);
      $("poolType").addEventListener("change", renderPool);
      $("clearFiltersBtn").addEventListener("click", () => {
        $("poolSearch").value = "";
        $("poolPriority").value = "";
        $("poolType").value = "";
        renderPool();
      });
      $("closeModalBtn").addEventListener("click", closeAppointmentModal);
      $("cancelAppointmentBtn").addEventListener("click", closeAppointmentModal);
      $("saveAppointmentBtn").addEventListener("click", saveAppointment);
      $("zoneModalClose").addEventListener("click", closeZoneModal);
      $("closeTicketModalBtn").addEventListener("click", closeTicketModal);
      $("ticketModalDoneBtn").addEventListener("click", closeTicketModal);
      $("ticketExternalBtn").addEventListener("click", openTicketExternal);
      document.addEventListener("click", event => {
        if (!event.target.closest(".ticket-popover")) closeTicketPopover();
      });
    }

    function loadLocalSettings() {
      try {
        const saved = JSON.parse(localStorage.getItem("dispatchBoardSettings") || "{}");
        if (saved.visibleFields) state.visibleFields = saved.visibleFields;
        if (saved.colorBy) {
          state.colorBy = saved.colorBy;
          $("colorBySelect").value = saved.colorBy;
        }
        if (saved.theme) {
          state.theme = saved.theme;
          $("themeSelect").value = saved.theme;
        }
        if (saved.listViews) state.listViews = { ...state.listViews, ...saved.listViews };
        if (saved.sectionSizes) state.sectionSizes = saved.sectionSizes;
        if (saved.apiBaseUrl) {
          state.apiBaseUrl = saved.apiBaseUrl;
          $("apiBaseUrl").value = saved.apiBaseUrl;
        }
        if (saved.apiProxyUrl) {
          state.apiProxyUrl = saved.apiProxyUrl;
          $("apiProxyUrl").value = saved.apiProxyUrl;
          $("apiState").textContent = "HaloPSA Worker connected";
        }
      } catch (error) {
        console.warn(error);
      }
    }

    function saveLocalSettings() {
      localStorage.setItem("dispatchBoardSettings", JSON.stringify({
        visibleFields: state.visibleFields,
        colorBy: state.colorBy,
        theme: state.theme,
        listViews: state.listViews,
        sectionSizes: state.sectionSizes,
        apiBaseUrl: state.apiBaseUrl,
        apiProxyUrl: state.apiProxyUrl
      }));
    }

    function applyTheme() {
      document.body.dataset.theme = state.theme;
    }

    function renderTeamSelect() {
      $("teamSelect").innerHTML = teams.map(team => `<option>${team}</option>`).join("");
      $("teamSelect").value = state.team;
    }

    function renderTechPicker() {
      const picker = $("techPicker");
      picker.innerHTML = technicians.map(tech => `
        <label class="chip">
          <input type="checkbox" value="${tech.id}" ${state.selectedTechs.includes(tech.id) ? "checked" : ""}>
          ${escapeHtml(tech.name)}
        </label>
      `).join("");
      picker.querySelectorAll("input").forEach(input => {
        input.addEventListener("change", () => {
          const selected = Array.from(picker.querySelectorAll("input:checked")).map(item => item.value);
          state.selectedTechs = selected.length ? selected : [input.value];
          renderTechPicker();
          renderBoard();
        });
      });
    }

    function renderFieldChecks() {
      $("fieldChecks").innerHTML = fieldOptions.map(option => `
        <label>
          <input type="checkbox" value="${option.key}" ${state.visibleFields.includes(option.key) ? "checked" : ""}>
          ${option.label}
        </label>
      `).join("");
      $("fieldChecks").querySelectorAll("input").forEach(input => {
        input.addEventListener("change", () => {
          state.visibleFields = Array.from($("fieldChecks").querySelectorAll("input:checked")).map(item => item.value);
          saveLocalSettings();
          renderReportLists();
          renderPool();
        });
      });
    }

    function renderReportLists() {
      $("reportLists").innerHTML = state.reportLists.map((reportId, index) => renderReportList(reportId, index)).join("");
      $("reportLists").querySelectorAll("[data-report-select]").forEach(select => {
        select.addEventListener("change", () => {
          state.reportLists[Number(select.dataset.index)] = select.value;
          renderReportLists();
        });
      });
      $("reportLists").querySelectorAll("[data-remove-list]").forEach(button => {
        button.addEventListener("click", () => {
          state.reportLists.splice(Number(button.dataset.index), 1);
          renderReportLists();
        });
      });
      $("reportLists").querySelectorAll("[data-list-view]").forEach(select => {
        select.addEventListener("change", () => {
          state.listViews[sectionKey(Number(select.dataset.index))] = select.value;
          saveLocalSettings();
          renderReportLists();
        });
      });
      observeResizableSections();
      wireSectionResizers();
      makeTicketsDraggable();
    }

    function renderReportList(reportId, index) {
      const report = reports.find(item => item.id === reportId) || reports[0];
      const listTickets = tickets.filter(ticket => ticket.report === report.id && shouldShowTicketCard(ticket));
      const options = reports.map(item => `<option value="${item.id}" ${item.id === report.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
      const key = sectionKey(index);
      const view = state.listViews[key] || "card";
      const sizeStyle = state.sectionSizes[key] ? `style="height:${state.sectionSizes[key]}px"` : "";
      return `
        <section class="report-list" data-resize-key="${key}" ${sizeStyle}>
          <header>
            <div class="report-name">${escapeHtml(report.name)}</div>
            <button class="icon" data-remove-list data-index="${index}" title="Remove list">-</button>
            <div class="report-meta">
              <select data-report-select data-index="${index}">${options}</select>
              <select data-list-view data-index="${index}" title="List display">
                <option value="card" ${view === "card" ? "selected" : ""}>Cards</option>
                <option value="list" ${view === "list" ? "selected" : ""}>List</option>
              </select>
              <span class="api-pill" title="${escapeHtml(report.reportId)}">${listTickets.length} open</span>
            </div>
          </header>
          <div class="ticket-stack ${view === "list" ? "list-view" : "card-view"}">
            ${listTickets.length ? listTickets.map(ticket => renderTicketCard(ticket, view)).join("") : `<div class="empty">No tickets in this report.</div>`}
          </div>
        </section>
        ${index < state.reportLists.length - 1 ? `<div class="section-resizer" data-resizer-for="${key}" title="Drag to resize this ticket list"></div>` : ""}
      `;
    }

    function renderTicketCard(ticket, view = "card") {
      const visible = state.visibleFields.map(field => {
        if (!ticket[field]) return "";
        return `<div class="ticket-line"><span>${labelFor(field)}</span><strong>${escapeHtml(ticket[field])}</strong></div>`;
      }).join("");
      return `
        <article class="ticket-card ${ticketColorClass(ticket)} ${view === "list" ? "list-mode" : ""}" draggable="true" data-ticket-id="${ticket.id}" data-drag-source="ticket">
          <div class="ticket-top">
            <span class="ticket-id">#${ticket.id}</span>
            <span class="priority ${ticket.priority.toLowerCase()}">${ticket.priority}</span>
          </div>
          <div class="ticket-title">${escapeHtml(ticket.title)}</div>
          ${visible}
        </article>
      `;
    }

    function renderBoard() {
      const board = $("dispatchBoard");
      board.parentElement.className = `board-wrap ${state.orientation}`;
      board.className = `board ${state.orientation}`;
      const selectedTechs = state.selectedTechs.map(id => technicians.find(tech => tech.id === id)).filter(Boolean);
      board.innerHTML = selectedTechs.map(renderTechColumn).join("");
      wireTechReordering();
      wireDropZones();
      wireZoneExpanders();
      makeTicketsDraggable();
    }

    function renderTechColumn(tech) {
      const visibleItems = state.boardItems.filter(item => item.techId === tech.id && item.date === selectedDate());
      const allDay = visibleItems.filter(item => item.kind === "allDay");
      const noTime = visibleItems.filter(item => item.kind === "noTime");
      const timed = visibleItems.filter(item => item.kind === "timed");
      const load = allDay.length + noTime.length + timed.length;
      if (state.orientation === "vertical") {
        return `
          <section class="tech-column" data-tech-id="${tech.id}">
            <header class="tech-header" draggable="true" data-tech-handle="${tech.id}">
              <div class="tech-name">TECH: ${escapeHtml(tech.name)}</div>
              <div class="tech-load">${load} assigned</div>
            </header>
            <div class="vertical-task-stack">
              ${renderTaskZone("allDay", tech.id, tech.name, "All-Day Tasks", allDay, "Drop ticket here for all-day task")}
              ${renderTaskZone("noTime", tech.id, tech.name, "Tasks Without Time", noTime, "Drop ticket here to assign date only")}
            </div>
            <div class="calendar">
              <div class="time-axis">${renderTimeLabels()}</div>
              <div class="slot-grid">${renderTimeSlots(tech.id, timed)}</div>
            </div>
          </section>
        `;
      }
      return `
        <section class="tech-column" data-tech-id="${tech.id}">
          <header class="tech-header" draggable="true" data-tech-handle="${tech.id}">
            <div class="tech-name">TECH: ${escapeHtml(tech.name)}</div>
            <div class="tech-load">${load} assigned</div>
          </header>
          ${renderTaskZone("allDay", tech.id, tech.name, "All-Day Tasks", allDay, "Drop ticket here for all-day task")}
          <div class="calendar">
            <div class="time-axis">${renderTimeLabels()}</div>
            <div class="slot-grid">${renderTimeSlots(tech.id, timed)}</div>
          </div>
          ${renderTaskZone("noTime", tech.id, tech.name, "Tasks Without Time", noTime, "Drop ticket here to assign date only")}
        </section>
      `;
    }

    function renderTaskZone(kind, techId, techName, label, items, emptyText) {
      return `
        <div class="drop-zone" data-drop-kind="${kind}" data-tech-id="${techId}">
          <div class="expanded-title">${escapeHtml(label)} - ${escapeHtml(techName)}</div>
          <div class="zone-topline">
            <div class="zone-label">${label}</div>
            <button class="expand-zone" data-expand-zone type="button" title="Expand section">^</button>
          </div>
          <div class="zone-items">${items.length ? items.map(renderSmallEvent).join("") : `<div class="empty">${emptyText}</div>`}</div>
        </div>
      `;
    }

    function renderTimeLabels() {
      const labels = [];
      for (let hour = state.workingHours[0]; hour < state.workingHours[1]; hour++) {
        if (state.orientation === "vertical") {
          labels.push(`<div class="time-label">${formatTime(`${String(hour).padStart(2, "0")}:00`)}</div>`);
          labels.push(`<div class="time-label">${formatTime(`${String(hour).padStart(2, "0")}:30`)}</div>`);
        } else {
          labels.push(`<div class="time-label">${formatHour(hour)}</div>`);
        }
      }
      return labels.join("");
    }

    function renderTimeSlots(techId, timed) {
      const slots = [];
      for (let hour = state.workingHours[0]; hour < state.workingHours[1]; hour++) {
        for (const minute of [0, 30]) {
          const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
          const slotItems = timed.filter(item => item.time === time);
          slots.push(`
            <div class="time-slot" data-drop-kind="timed" data-tech-id="${techId}" data-time="${time}">
              ${slotItems.map(renderAppointment).join("")}
            </div>
          `);
        }
      }
      return slots.join("");
    }

    function renderSmallEvent(item) {
      const ticket = tickets.find(entry => entry.id === item.ticketId);
      return `<div class="small-event ${ticketColorClass(ticket)}" draggable="true" data-ticket-id="${item.ticketId}" data-drag-source="scheduled" data-kind="${item.kind}">#${item.ticketId} ${escapeHtml(item.label || ticket?.title || "Task")}</div>`;
    }

    function renderAppointment(item) {
      const ticket = tickets.find(entry => entry.id === item.ticketId);
      return `
        <div class="appointment ${ticketColorClass(ticket)}" draggable="true" data-ticket-id="${item.ticketId}" data-drag-source="scheduled" data-kind="timed">
          <strong>#${item.ticketId} ${escapeHtml(ticket?.title || "Appointment")}</strong>
          <span>${escapeHtml(formatTime(item.time))} - ${item.duration || 30}m</span>
        </div>
      `;
    }

    function renderPool() {
      const search = $("poolSearch").value.trim().toLowerCase();
      const priority = $("poolPriority").value;
      const type = $("poolType").value;
      const view = state.listViews.pool || "card";
      $("poolViewSelect").value = view;
      const filtered = tickets.filter(ticket => {
        const text = `${ticket.id} ${ticket.client} ${ticket.title} ${ticket.site} ${ticket.contact}`.toLowerCase();
        return (!search || text.includes(search)) && (!priority || ticket.priority === priority) && (!type || ticket.type === type) && shouldShowTicketCard(ticket);
      });
      $("poolList").className = `pool-list ${view === "list" ? "list-view" : "card-view"}`;
      $("poolList").innerHTML = filtered.length ? filtered.map(ticket => renderTicketCard(ticket, view)).join("") : `<div class="empty">No tickets match the current filters.</div>`;
      applySavedSectionSizes();
      observeResizableSections();
      wireSectionResizers();
      makeTicketsDraggable();
    }

    function sectionKey(index) {
      return `report-${index}`;
    }

    function applySavedSectionSizes() {
      Object.entries(state.sectionSizes).forEach(([key, height]) => {
        setSectionHeight(key, height);
      });
    }

    function observeResizableSections() {
      if (!window.ResizeObserver) return;
      if (state.resizeObserver) state.resizeObserver.disconnect();
      state.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const key = entry.target.dataset.resizeKey;
          if (!key) continue;
          const height = Math.round(entry.contentRect.height);
          if (height < 80) continue;
          state.sectionSizes[key] = height;
          if (key === "pool") {
            document.documentElement.style.setProperty("--bottom-height", `${height}px`);
          }
        }
        clearTimeout(state.resizeSaveTimer);
        state.resizeSaveTimer = setTimeout(saveLocalSettings, 250);
      });
      document.querySelectorAll("[data-resize-key]").forEach(section => state.resizeObserver.observe(section));
    }

    function wireSectionResizers() {
      document.querySelectorAll("[data-resizer-for]").forEach(handle => {
        handle.addEventListener("pointerdown", event => {
          event.preventDefault();
          startSectionResize(handle, event.clientY);
        });
      });
    }

    function startSectionResize(handle, startY) {
      const key = handle.dataset.resizerFor;
      const section = document.querySelector(`[data-resize-key="${key}"]`);
      if (!section) return;
      const startHeight = key === "pool" ? section.getBoundingClientRect().height : section.offsetHeight;
      const resizingPool = key === "pool";
      handle.classList.add("active");

      function onMove(event) {
        const delta = resizingPool ? startY - event.clientY : event.clientY - startY;
        const min = resizingPool ? 120 : 172;
        const max = resizingPool ? Math.round(window.innerHeight * 0.45) : Math.round(window.innerHeight * 0.7);
        const nextHeight = Math.max(min, Math.min(max, Math.round(startHeight + delta)));
        setSectionHeight(key, nextHeight);
      }

      function onUp() {
        handle.classList.remove("active");
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        saveLocalSettings();
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    }

    function setSectionHeight(key, height) {
      state.sectionSizes[key] = height;
      if (key === "pool") {
        document.documentElement.style.setProperty("--bottom-height", `${height}px`);
      }
      document.querySelectorAll(`[data-resize-key="${key}"]`).forEach(section => {
        section.style.height = `${height}px`;
      });
    }

    function wireDropZones() {
      document.querySelectorAll("[data-drop-kind]").forEach(zone => {
        zone.addEventListener("dragover", event => {
          if (event.dataTransfer.types.includes("tech-id")) return;
          event.preventDefault();
          zone.classList.add("over");
        });
        zone.addEventListener("dragleave", () => zone.classList.remove("over"));
        zone.addEventListener("drop", event => {
          event.preventDefault();
          zone.classList.remove("over");
          const ticketId = Number(event.dataTransfer.getData("text/plain"));
          const source = event.dataTransfer.getData("source") || "ticket";
          handleTicketDrop(ticketId, zone.dataset.techId, zone.dataset.dropKind, zone.dataset.time, source);
        });
      });
    }

    function wireTechReordering() {
      document.querySelectorAll("[data-tech-handle]").forEach(handle => {
        handle.addEventListener("dragstart", event => {
          event.stopPropagation();
          event.dataTransfer.setData("tech-id", handle.dataset.techHandle);
        });
      });
      document.querySelectorAll(".tech-column").forEach(column => {
        column.addEventListener("dragover", event => {
          if (!event.dataTransfer.types.includes("tech-id")) return;
          event.preventDefault();
          column.classList.add("tech-over");
        });
        column.addEventListener("dragleave", () => column.classList.remove("tech-over"));
        column.addEventListener("drop", event => {
          const draggedTechId = event.dataTransfer.getData("tech-id");
          if (!draggedTechId) return;
          event.preventDefault();
          column.classList.remove("tech-over");
          reorderTechnicians(draggedTechId, column.dataset.techId);
        });
      });
    }

    function reorderTechnicians(draggedTechId, targetTechId) {
      if (!draggedTechId || draggedTechId === targetTechId) return;
      const order = state.selectedTechs.filter(id => id !== draggedTechId);
      const targetIndex = order.indexOf(targetTechId);
      order.splice(targetIndex < 0 ? order.length : targetIndex, 0, draggedTechId);
      state.selectedTechs = order;
      renderTechPicker();
      renderBoard();
      toast("Technician order updated", "The main dispatch view has been reordered.");
    }

    function wireZoneExpanders() {
      document.querySelectorAll("[data-expand-zone]").forEach(button => {
        button.addEventListener("click", event => {
          event.stopPropagation();
          const zone = button.closest(".drop-zone");
          if (button.textContent === "x") {
            closeZoneModal();
          } else {
            openZoneModal(zone, button);
          }
        });
      });
    }

    function openZoneModal(zone, button) {
      closeZoneModal();
      const rect = zone.getBoundingClientRect();
      const width = Math.min(580, window.innerWidth - 60);
      const preferRight = rect.right + 10 + width <= window.innerWidth - 20;
      const left = preferRight ? rect.right + 10 : Math.max(20, rect.left);
      const top = Math.min(Math.max(20, rect.top), window.innerHeight - 120);
      $("zoneModal").style.setProperty("--expanded-left", `${left}px`);
      $("zoneModal").style.setProperty("--expanded-top", `${top}px`);
      $("zoneModalTitle").textContent = zone.querySelector(".expanded-title").textContent;
      $("zoneModalBody").innerHTML = zone.querySelector(".zone-items").innerHTML;
      $("zoneModal").classList.add("open");
      button.textContent = "x";
      button.title = "Collapse section";
      button.dataset.activeExpand = "true";
      makeTicketsDraggable();
    }

    function closeZoneModal() {
      $("zoneModal").classList.remove("open");
      $("zoneModalBody").innerHTML = "";
      document.querySelectorAll("[data-active-expand]").forEach(button => {
        button.textContent = "^";
        button.title = "Expand section";
        delete button.dataset.activeExpand;
      });
    }

    function makeTicketsDraggable() {
      document.querySelectorAll(".ticket-card, .appointment, .small-event").forEach(card => {
        card.addEventListener("dragstart", event => {
          card.classList.add("dragging");
          event.dataTransfer.setData("text/plain", card.dataset.ticketId);
          event.dataTransfer.setData("source", card.dataset.dragSource || "ticket");
        });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        card.addEventListener("contextmenu", event => {
          event.preventDefault();
          event.stopPropagation();
          showTicketPopover(Number(card.dataset.ticketId), event.clientX, event.clientY);
        });
        card.addEventListener("dblclick", event => {
          event.preventDefault();
          event.stopPropagation();
          openTicketModal(Number(card.dataset.ticketId));
        });
      });
    }

    function handleTicketDrop(ticketId, techId, kind, time, source = "ticket") {
      const ticket = tickets.find(item => item.id === ticketId);
      if (!ticket) return;
      const tech = technicians.find(item => item.id === techId);
      if (kind === "timed") {
        if (source === "scheduled") {
          moveScheduledItem(ticketId, techId, time);
          return;
        }
        state.pendingAppointment = { ticketId, techId, time };
        openAppointmentModal(ticket, tech, time);
        return;
      }

      removeBoardItem(ticketId);
      ticket.assignedTo = techId;
      if (kind === "allDay") {
        ticket.dateField = selectedDate();
        state.boardItems.push({ ticketId, techId, kind: "allDay", label: ticket.title, date: selectedDate() });
        callHalo(source === "scheduled" ? "moveToAllDayTask" : "createAllDayTask", { ticketId, technicianId: techId, date: $("boardDate").value, assignTicket: true });
        toast(source === "scheduled" ? "Task moved" : "All-day task queued", `#${ticketId} assigned to ${tech.name}.`);
      }
      if (kind === "noTime") {
        ticket.dateField = selectedDate();
        state.boardItems.push({ ticketId, techId, kind: "noTime", label: ticket.title, date: selectedDate() });
        callHalo(source === "scheduled" ? "moveToDateOnlyTask" : "assignTicketDateOnly", { ticketId, technicianId: techId, dateFieldValue: $("boardDate").value });
        toast(source === "scheduled" ? "Task moved" : "Date-only task queued", `#${ticketId} assigned to ${tech.name} for ${$("boardDate").value}.`);
      }
      renderAll();
    }

    function moveScheduledItem(ticketId, techId, time) {
      const item = state.boardItems.find(entry => entry.ticketId === ticketId);
      const ticket = tickets.find(entry => entry.id === ticketId);
      const tech = technicians.find(entry => entry.id === techId);
      if (!item || !ticket || !tech) return;
      const previous = { techId: item.techId, time: item.time, kind: item.kind };
      item.techId = techId;
      item.kind = "timed";
      item.time = time;
      item.duration = item.duration || 30;
      item.date = selectedDate();
      ticket.assignedTo = techId;
      ticket.dateField = selectedDate();
      callHalo("updateAppointment", {
        ticketId,
        previousTechnicianId: previous.techId,
        technicianId: techId,
        previousStartTime: previous.time || null,
        startTime: time,
        date: $("boardDate").value,
        assignTicket: previous.techId !== techId
      });
      const techChanged = previous.techId !== techId ? ` and assigned to ${tech.name}` : "";
      toast("Appointment updated", `#${ticketId} moved to ${formatTime(time)}${techChanged}.`);
      renderAll();
    }

    function openAppointmentModal(ticket, tech, time) {
      $("modalTicket").value = `#${ticket.id} ${ticket.title}`;
      $("modalTech").value = tech.name;
      $("modalStart").value = time;
      $("modalDuration").value = "30";
      $("modalStatus").value = "Scheduled";
      $("modalLocation").value = ticket.site;
      $("modalNotes").value = `${ticket.client} - ${ticket.details}`;
      $("appointmentModal").classList.add("open");
    }

    function closeAppointmentModal() {
      $("appointmentModal").classList.remove("open");
      state.pendingAppointment = null;
    }

    function showTicketPopover(ticketId, x, y) {
      const ticket = tickets.find(item => item.id === ticketId);
      if (!ticket) return;
      state.activeTicketId = ticketId;
      const popover = $("ticketPopover");
      const left = Math.min(x, window.innerWidth - 340);
      const top = Math.min(y, window.innerHeight - 230);
      popover.style.setProperty("--ticket-popover-left", `${Math.max(16, left)}px`);
      popover.style.setProperty("--ticket-popover-top", `${Math.max(16, top)}px`);
      popover.innerHTML = `
        <strong>#${ticket.id} ${escapeHtml(ticket.title)}</strong>
        <span><b>Client:</b> ${escapeHtml(ticket.client)} - ${escapeHtml(ticket.site)}</span>
        <span><b>Contact:</b> ${escapeHtml(ticket.contact)}</span>
        <span><b>Type:</b> ${escapeHtml(ticket.type)} | <b>Priority:</b> ${escapeHtml(ticket.priority)}</span>
        <span><b>SLA:</b> ${escapeHtml(ticket.sla)} | <b>Estimate:</b> ${escapeHtml(ticket.estimate)}</span>
        <span><b>Date:</b> ${escapeHtml(ticket.dateField || "Unscheduled")}</span>
        <span>${escapeHtml(ticket.details)}</span>
        <div class="ticket-popover-actions">
          <button type="button" id="popoverOpenTicket">Open Ticket</button>
        </div>
      `;
      popover.classList.add("open");
      $("popoverOpenTicket").addEventListener("click", event => {
        event.stopPropagation();
        openTicketModal(ticketId);
      });
    }

    function closeTicketPopover() {
      $("ticketPopover").classList.remove("open");
    }

    function openTicketModal(ticketId) {
      const ticket = tickets.find(item => item.id === ticketId);
      if (!ticket) return;
      closeTicketPopover();
      state.activeTicketId = ticketId;
      const assignedTech = technicians.find(tech => tech.id === ticket.assignedTo)?.name || "Unassigned";
      $("ticketModalTitle").textContent = `Ticket #${ticket.id}`;
      $("ticketModalBody").innerHTML = `
        <div class="ticket-summary">
          <h3>${escapeHtml(ticket.title)}</h3>
          <p style="margin:0;color:var(--muted);line-height:1.45;">${escapeHtml(ticket.details)}</p>
          <div class="detail-grid">
            ${detailBox("Client", ticket.client)}
            ${detailBox("Site", ticket.site)}
            ${detailBox("Contact", ticket.contact)}
            ${detailBox("Priority", ticket.priority)}
            ${detailBox("SLA", ticket.sla)}
            ${detailBox("Estimate", ticket.estimate)}
            ${detailBox("Type", ticket.type)}
            ${detailBox("Assigned Tech", assignedTech)}
            ${detailBox("Board Date", ticket.dateField || "Unscheduled")}
            ${detailBox("Report", reports.find(report => report.id === ticket.report)?.name || ticket.report)}
          </div>
        </div>
        <aside class="settings-card" style="align-content:start;">
          <h3>HaloPSA Link</h3>
          <p style="margin:0;color:var(--muted);font-size:13px;line-height:1.45;">This will use the full ticket URL once provided after testing.</p>
          <div class="empty" style="text-align:left;">${escapeHtml(ticketUrl(ticket))}</div>
          <button type="button" onclick="openTicketExternal()">Open HaloPSA URL</button>
        </aside>
      `;
      $("ticketModal").classList.add("open");
    }

    function closeTicketModal() {
      $("ticketModal").classList.remove("open");
    }

    function openTicketExternal() {
      const ticket = tickets.find(item => item.id === state.activeTicketId);
      if (!ticket) return;
      const url = ticketUrl(ticket);
      if (url.startsWith("http")) {
        window.open(url, "_blank", "noopener");
      } else {
        toast("Ticket URL pending", "The full HaloPSA URL can be added after testing.");
      }
    }

    function ticketUrl(ticket) {
      return state.apiBaseUrl ? `${state.apiBaseUrl.replace(/\/$/, "")}/tickets?id=${ticket.id}` : `HaloPSA ticket URL pending for #${ticket.id}`;
    }

    function detailBox(label, value) {
      return `<div class="detail-box"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`;
    }

    function saveAppointment() {
      if (!state.pendingAppointment) return;
      const { ticketId, techId } = state.pendingAppointment;
      const ticket = tickets.find(item => item.id === ticketId);
      const tech = technicians.find(item => item.id === techId);
      const time = $("modalStart").value;
      const duration = Number($("modalDuration").value);
      removeBoardItem(ticketId);
      ticket.assignedTo = techId;
      ticket.dateField = selectedDate();
      state.boardItems.push({ ticketId, techId, kind: "timed", time, duration, date: selectedDate() });
      callHalo("createAppointment", {
        ticketId,
        technicianId: techId,
        date: $("boardDate").value,
        startTime: time,
        durationMinutes: duration,
        status: $("modalStatus").value,
        location: $("modalLocation").value,
        notes: $("modalNotes").value,
        assignTicket: true
      });
      toast("Appointment queued", `#${ticketId} scheduled for ${tech.name} at ${formatTime(time)}.`);
      closeAppointmentModal();
      renderAll();
    }

    function addReportList() {
      if (state.reportLists.length >= 3) {
        toast("List limit reached", "You can show up to 3 report-backed ticket lists.");
        return;
      }
      const next = reports.find(report => !state.reportLists.includes(report.id)) || reports[0];
      state.reportLists.push(next.id);
      renderReportLists();
    }

    function selectTeam() {
      state.team = $("teamSelect").value;
      if (state.team === "All Teams") {
        state.selectedTechs = technicians.map(tech => tech.id);
      } else {
        state.selectedTechs = technicians.filter(tech => tech.team === state.team).map(tech => tech.id);
      }
      renderTechPicker();
      renderBoard();
    }

    function setOrientation(orientation) {
      state.orientation = orientation;
      $("horizontalBtn").classList.toggle("active", orientation === "horizontal");
      $("verticalBtn").classList.toggle("active", orientation === "vertical");
      renderBoard();
    }

    function shiftDate(days) {
      const date = new Date(`${$("boardDate").value}T00:00:00`);
      date.setDate(date.getDate() + days);
      $("boardDate").value = date.toISOString().slice(0, 10);
      renderAll();
    }

    function saveApiSettings() {
      state.apiBaseUrl = $("apiBaseUrl").value.trim();
      state.apiProxyUrl = $("apiProxyUrl").value.trim();
      $("apiState").textContent = state.apiProxyUrl ? "HaloPSA Worker connected" : "HaloPSA mock mode";
      saveLocalSettings();
      toast("Connection settings saved", state.apiProxyUrl || "Mock mode remains active until the Worker URL is added.");
    }

    function refreshReports() {
      callHalo("refreshReports", {
        reports: state.reportLists.map(id => reports.find(report => report.id === id)?.reportId),
        date: $("boardDate").value
      });
      toast("Report refresh requested", "This is where HaloPSA report results will repopulate the ticket lists.");
    }

    async function callHalo(action, payload) {
      const request = {
        action,
        proxyUrl: state.apiProxyUrl || "(mock)",
        payload,
        timestamp: new Date().toISOString()
      };
      console.log("HaloPSA action", request);
      if (!state.apiProxyUrl) return request;

      try {
        const response = await fetch(`${state.apiProxyUrl.replace(/\/$/, "")}/api/halo/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || `HaloPSA proxy returned ${response.status}`);
        }
        return result;
      } catch (error) {
        console.error(error);
        toast("HaloPSA API error", error.message);
        return { ok: false, error: error.message, request };
      }
    }

    function renderAll() {
      closeZoneModal();
      closeTicketPopover();
      renderReportLists();
      renderBoard();
      renderPool();
    }

    function removeBoardItem(ticketId) {
      const index = state.boardItems.findIndex(item => item.ticketId === ticketId);
      if (index >= 0) state.boardItems.splice(index, 1);
    }

    function isTicketScheduled(ticketId) {
      return state.boardItems.some(item => item.ticketId === ticketId);
    }

    function shouldShowTicketCard(ticket) {
      if (ticket.dateField && ticket.dateField !== selectedDate()) return false;
      return !isTicketScheduled(ticket.id);
    }

    function selectedDate() {
      return $("boardDate").value;
    }

    function toast(title, message) {
      const item = document.createElement("div");
      item.className = "toast";
      item.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
      $("toastLog").prepend(item);
      setTimeout(() => item.remove(), 5200);
    }

    function labelFor(key) {
      return fieldOptions.find(item => item.key === key)?.label || key;
    }

    function ticketColorClass(ticket) {
      if (!ticket) return "";
      if (state.colorBy === "priority") return `color-${ticket.priority.toLowerCase()}`;
      if (state.colorBy === "type") return `color-type-${ticket.type.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
      return `color-sla-${slaBucket(ticket.sla)}`;
    }

    function slaBucket(sla) {
      const value = String(sla || "").toLowerCase();
      if (value.includes("9:") || value.includes("10:") || value.includes("today")) return "urgent";
      if (value.includes("2:") || value.includes("3:") || value.includes("4:")) return "soon";
      return "later";
    }

    function formatHour(hour) {
      const suffix = hour >= 12 ? "PM" : "AM";
      const display = hour % 12 || 12;
      return `${display}:00 ${suffix}`;
    }

    function formatTime(time) {
      const [hourRaw, minute] = time.split(":").map(Number);
      const suffix = hourRaw >= 12 ? "PM" : "AM";
      const hour = hourRaw % 12 || 12;
      return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char]));
    }

    init();
