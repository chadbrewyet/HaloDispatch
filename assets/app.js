const technicians = [
    ];

    const teams = [
    ];

    const reports = [
      { id: "api-open", name: "Open Tickets", reportId: "api-tickets" }
    ];

    const tickets = [];
    const ticketTypes = [];
    const knownTicketIds = new Set();
    const attentionTicketIds = new Set();

    const state = {
      selectedTeams: [],
      selectedTechs: [],
      selectedTicketTypes: [],
      orientation: "horizontal",
      reportLists: ["api-open"],
      visibleFields: ["client", "sla", "estimate"],
      workingHours: [7, 17],
      calendarStartTime: "07:00",
      calendarEndTime: "17:00",
      show24Hours: false,
      colorBy: "priority",
      theme: "light",
      listViews: {},
      collapsedLists: {},
      listFilters: {},
      savedFilters: {},
      selectedListFilterFields: ["assignedTo", "team", "status", "type", "serviceZone"],
      openFilterMenu: null,
      openFilterFields: {},
      filterValueScroll: {},
      copyFilterMenuOpen: false,
      activeFilterListKey: null,
      draftFilter: null,
      activeTechEditId: null,
      techThemes: {},
      collapsedTechGroups: {},
      sectionSizes: {},
      ticketPanelPinned: false,
      ticketPanelOpen: false,
      ticketPanelWidth: 360,
      apiBaseUrl: "https://gagepsa.halopsa.com/ticket?id=",
      apiProxyUrl: "",
      appointmentRefreshMinutes: 5,
      appointmentRefreshTimer: null,
      currentTimeTimer: null,
      shouldCenterNow: true,
      calendarScroll: {},
      pendingAppointment: null,
      activeTicketId: null,
      boardItems: []
    };

    const fieldOptions = [
      { key: "client", label: "Client" },
      { key: "site", label: "Site" },
      { key: "sla", label: "SLA" },
      { key: "estimate", label: "Estimate" },
      { key: "contact", label: "Contact" },
      { key: "type", label: "Type" }
    ];

    const listFilterFieldOptions = [
      { key: "assignedTo", label: "Tech Assigned" },
      { key: "team", label: "Team" },
      { key: "status", label: "Status" },
      { key: "type", label: "Ticket Type" },
      { key: "serviceZone", label: "Service Zone" },
      { key: "priority", label: "Priority" },
      { key: "client", label: "Client" },
      { key: "site", label: "Site" },
      { key: "contact", label: "Contact" }
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
      renderTicketTypeSelect();
      renderListFilterFieldPicker();
      renderDeleteFilterSelect();
      renderFieldChecks();
      renderReportLists();
      renderBoard();
      applySavedSectionSizes();
      observeResizableSections();
      wireSectionResizers();
      bindEvents();
      resetAppointmentRefreshTimer();
      resetCurrentTimeTimer();
      toast("Ready", "Dispatch board loaded. HaloPSA actions run in mock mode until a Worker API URL is saved.");
      loadHaloTechnicians();
      loadHaloTicketTypes();
      loadHaloTickets({ quiet: true });
    }

    function bindEvents() {
      $("addListBtn").addEventListener("click", addReportList);
      $("ticketPanelTab").addEventListener("click", () => setTicketPanelOpen(true));
      $("ticketPanelTab").addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setTicketPanelOpen(true);
      });
      $("ticketPanelHeader").addEventListener("click", event => {
        if (event.target.closest(".panel-actions, button")) return;
        state.ticketPanelPinned = false;
        setTicketPanelOpen(false);
        saveLocalSettings();
      });
      $("pinTicketPanelBtn").addEventListener("click", toggleTicketPanelPin);
      $("ticketPanelResizer").addEventListener("pointerdown", startTicketPanelResize);
      $("prevDay").addEventListener("click", () => shiftDate(-1));
      $("nextDay").addEventListener("click", () => shiftDate(1));
      $("todayBtn").addEventListener("click", () => {
        $("boardDate").value = new Date().toISOString().slice(0, 10);
        state.shouldCenterNow = true;
        renderAll();
        loadHaloAppointments();
      });
      $("boardDate").addEventListener("change", () => {
        state.shouldCenterNow = true;
        renderAll();
        loadHaloAppointments();
      });
      $("show24HoursCheck").addEventListener("change", () => {
        state.show24Hours = $("show24HoursCheck").checked;
        updateWorkingHours();
        state.shouldCenterNow = true;
        saveLocalSettings();
        renderBoard();
      });
      $("calendarStartTime").addEventListener("change", updateCalendarBounds);
      $("calendarEndTime").addEventListener("change", updateCalendarBounds);
      $("colorBySelect").addEventListener("change", () => {
        state.colorBy = $("colorBySelect").value;
        saveLocalSettings();
        renderAll();
      });
      $("themeToggleBtn").addEventListener("click", () => {
        state.theme = state.theme === "dark" ? "light" : "dark";
        applyTheme();
        saveLocalSettings();
      });
      $("orientationToggleBtn").addEventListener("click", () => {
        setOrientation(state.orientation === "horizontal" ? "vertical" : "horizontal");
      });
      $("settingsBtn").addEventListener("click", () => $("configDrawer").classList.add("open"));
      $("closeSettingsBtn").addEventListener("click", () => $("configDrawer").classList.remove("open"));
      wireSettingsAccordion();
      $("saveApiBtn").addEventListener("click", saveApiSettings);
      $("testWorkerBtn").addEventListener("click", testWorkerConnection);
      $("appointmentRefreshSelect").addEventListener("change", () => {
        state.appointmentRefreshMinutes = Number($("appointmentRefreshSelect").value);
        saveLocalSettings();
        resetAppointmentRefreshTimer();
      });
      $("refreshBtn").addEventListener("click", refreshReports);
      $("deleteSavedFilterBtn").addEventListener("click", deleteSelectedSavedFilter);
      $("closeModalBtn").addEventListener("click", closeAppointmentModal);
      $("cancelAppointmentBtn").addEventListener("click", closeAppointmentModal);
      $("saveAppointmentBtn").addEventListener("click", saveAppointment);
      $("zoneModalClose").addEventListener("click", closeZoneModal);
      $("closeFilterModalBtn").addEventListener("click", closeFilterModal);
      $("filterModalCancelBtn").addEventListener("click", closeFilterModal);
      $("filterModalApplyBtn").addEventListener("click", applyFilterModal);
      $("filterModalSaveBtn").addEventListener("click", saveFilterFromModal);
      $("filterModalCopyBtn").addEventListener("click", toggleCopyFilterMenu);
      $("copyFilterMenu").addEventListener("click", event => {
        const button = event.target.closest("[data-copy-filter]");
        if (button) copySavedFilterToDraft(button.dataset.copyFilter);
      });
      $("filterModalListTitle").addEventListener("input", () => {
        if (state.draftFilter) state.draftFilter.title = $("filterModalListTitle").value;
      });
      $("filterModalColor").addEventListener("input", () => {
        if (state.draftFilter) state.draftFilter.color = $("filterModalColor").value;
      });
      $("closeTechThemeModalBtn").addEventListener("click", closeTechThemeModal);
      $("cancelTechThemeBtn").addEventListener("click", closeTechThemeModal);
      $("saveTechThemeBtn").addEventListener("click", saveTechTheme);
      document.addEventListener("click", event => {
        if (!event.target.closest(".ticket-popover")) closeTicketPopover();
        closeFloatingSurfaces(event);
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
        if (saved.show24Hours !== undefined) {
          state.show24Hours = Boolean(saved.show24Hours);
          $("show24HoursCheck").checked = state.show24Hours;
        }
        if (isValidTime(saved.calendarStartTime)) state.calendarStartTime = saved.calendarStartTime;
        if (isValidTime(saved.calendarEndTime)) state.calendarEndTime = saved.calendarEndTime;
        $("calendarStartTime").value = state.calendarStartTime;
        $("calendarEndTime").value = state.calendarEndTime;
        updateWorkingHours();
        if (saved.theme) {
          state.theme = saved.theme;
        }
        if (Array.isArray(saved.reportLists) && saved.reportLists.length) state.reportLists = saved.reportLists;
        if (saved.orientation === "vertical" || saved.orientation === "horizontal") state.orientation = saved.orientation;
        if (saved.listViews) state.listViews = { ...state.listViews, ...saved.listViews };
        if (saved.collapsedLists) state.collapsedLists = saved.collapsedLists;
        if (saved.listFilters) state.listFilters = saved.listFilters;
        if (saved.savedFilters) state.savedFilters = saved.savedFilters;
        if (saved.selectedListFilterFields) state.selectedListFilterFields = saved.selectedListFilterFields;
        if (saved.techThemes) state.techThemes = saved.techThemes;
        if (saved.openFilterFields) state.openFilterFields = saved.openFilterFields;
        if (saved.collapsedTechGroups) state.collapsedTechGroups = saved.collapsedTechGroups;
        if (saved.sectionSizes) state.sectionSizes = saved.sectionSizes;
        if (saved.ticketPanelPinned !== undefined) state.ticketPanelPinned = Boolean(saved.ticketPanelPinned);
        if (saved.ticketPanelWidth) state.ticketPanelWidth = Number(saved.ticketPanelWidth);
        state.ticketPanelOpen = state.ticketPanelPinned;
        if (saved.appointmentRefreshMinutes !== undefined) {
          state.appointmentRefreshMinutes = Number(saved.appointmentRefreshMinutes);
        }
        if (Array.isArray(saved.selectedTicketTypes)) state.selectedTicketTypes = saved.selectedTicketTypes.map(String);
        if (saved.selectionDefaultsVersion >= 1 && Array.isArray(saved.selectedTeams)) state.selectedTeams = saved.selectedTeams.map(String);
        if (saved.selectionDefaultsVersion >= 1 && Array.isArray(saved.selectedTechs)) state.selectedTechs = saved.selectedTechs.map(String);
        $("appointmentRefreshSelect").value = String(state.appointmentRefreshMinutes);
        if (saved.apiBaseUrl) state.apiBaseUrl = saved.apiBaseUrl;
        $("apiBaseUrl").value = state.apiBaseUrl;
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
        show24Hours: state.show24Hours,
        calendarStartTime: state.calendarStartTime,
        calendarEndTime: state.calendarEndTime,
        theme: state.theme,
        orientation: state.orientation,
        reportLists: state.reportLists,
        listViews: state.listViews,
        collapsedLists: state.collapsedLists,
        listFilters: state.listFilters,
        savedFilters: state.savedFilters,
        selectedListFilterFields: state.selectedListFilterFields,
        techThemes: state.techThemes,
        openFilterFields: state.openFilterFields,
        collapsedTechGroups: state.collapsedTechGroups,
        sectionSizes: state.sectionSizes,
        ticketPanelPinned: state.ticketPanelPinned,
        ticketPanelWidth: state.ticketPanelWidth,
        apiBaseUrl: state.apiBaseUrl,
        apiProxyUrl: state.apiProxyUrl,
        appointmentRefreshMinutes: state.appointmentRefreshMinutes,
        selectedTeams: state.selectedTeams,
        selectedTechs: state.selectedTechs,
        selectedTicketTypes: state.selectedTicketTypes,
        selectionDefaultsVersion: 1
      }));
    }

    function applyTheme() {
      document.body.dataset.theme = state.theme;
      updateHeaderToggles();
      applyTicketPanelState();
    }

    function wireSettingsAccordion() {
      document.querySelectorAll(".drawer-body > .accordion-section").forEach(section => {
        section.addEventListener("toggle", () => {
          if (!section.open) return;
          document.querySelectorAll(".drawer-body > .accordion-section").forEach(other => {
            if (other !== section) other.open = false;
          });
        });
      });
    }

    function updateCalendarBounds() {
      const nextStart = $("calendarStartTime").value;
      const nextEnd = $("calendarEndTime").value;
      if (!isValidTime(nextStart) || !isValidTime(nextEnd) || timeToMinutes(nextEnd) <= timeToMinutes(nextStart)) {
        $("calendarStartTime").value = state.calendarStartTime;
        $("calendarEndTime").value = state.calendarEndTime;
        toast("Calendar time not changed", "The end time must be later than the start time.");
        return;
      }
      state.calendarStartTime = nextStart;
      state.calendarEndTime = nextEnd;
      updateWorkingHours();
      state.shouldCenterNow = true;
      saveLocalSettings();
      renderBoard();
    }

    function updateWorkingHours() {
      if (state.show24Hours) {
        state.workingHours = [0, 24];
        return;
      }
      state.workingHours = [timeToMinutes(state.calendarStartTime) / 60, timeToMinutes(state.calendarEndTime) / 60];
    }

    function calendarStartMinutes() {
      return state.show24Hours ? 0 : timeToMinutes(state.calendarStartTime);
    }

    function calendarEndMinutes() {
      return state.show24Hours ? 1440 : timeToMinutes(state.calendarEndTime);
    }

    function isValidTime(value) {
      if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return false;
      const [hour, minute] = String(value).split(":").map(Number);
      return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    }

    function timeToMinutes(value) {
      const [hour = 0, minute = 0] = String(value || "00:00").split(":").map(Number);
      return Math.min(1440, Math.max(0, (hour * 60) + minute));
    }

    function minutesToTime(minutes) {
      const normalized = Math.min(1439, Math.max(0, minutes));
      const hour = Math.floor(normalized / 60);
      const minute = normalized % 60;
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }

    function closeFloatingSurfaces(event) {
      const target = event.target;
      const path = event.composedPath ? event.composedPath() : [];
      const clickedInTicketPanel = path.some(node => node?.classList?.contains("left-panel")) || Boolean(target.closest(".left-panel"));
      const clickedInTicketFilter = path.some(node => node?.classList?.contains("ticket-filter-menu")) || Boolean(target.closest(".ticket-filter-menu"));
      if ($("appointmentModal").classList.contains("open") && target === $("appointmentModal")) {
        closeAppointmentModal();
      }
      if ($("filterModal").classList.contains("open") && target === $("filterModal")) {
        closeFilterModal();
      }
      if ($("techThemeModal").classList.contains("open") && target === $("techThemeModal")) {
        closeTechThemeModal();
      }
      if ($("configDrawer").classList.contains("open") && !target.closest("#configDrawer") && !target.closest("#settingsBtn")) {
        $("configDrawer").classList.remove("open");
      }
      if (state.openFilterMenu && !clickedInTicketFilter && !target.closest("[data-filter-toggle]")) {
        state.openFilterMenu = null;
        renderReportLists();
      }
      if (state.ticketPanelOpen && !state.ticketPanelPinned && !clickedInTicketPanel && !target.closest("#ticketPanelTab")) {
        setTicketPanelOpen(false);
      }
      if ($("zoneModal").classList.contains("open") && !target.closest("#zoneModal") && !target.closest("[data-expand-zone]")) {
        closeZoneModal();
      }
      document.querySelectorAll(".multi-dropdown[open]").forEach(dropdown => {
        if (!dropdown.contains(target)) dropdown.open = false;
      });
    }

    function applyTicketPanelState() {
      document.body.classList.toggle("ticket-panel-open", state.ticketPanelOpen);
      document.body.classList.toggle("ticket-panel-pinned", state.ticketPanelPinned);
      document.documentElement.style.setProperty("--ticket-panel-width", `${state.ticketPanelWidth}px`);
      $("pinTicketPanelBtn").innerHTML = pinIconSvg();
      $("pinTicketPanelBtn").classList.toggle("active", state.ticketPanelPinned);
      $("pinTicketPanelBtn").title = state.ticketPanelPinned ? "Unpin ticket panel" : "Pin ticket panel";
      $("pinTicketPanelBtn").setAttribute("aria-label", state.ticketPanelPinned ? "Unpin ticket panel" : "Pin ticket panel");
    }

    function pinIconSvg() {
      return `
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M8 3h8v2l-1 1v5l3 3v2h-5v5l-1 1-1-1v-5H6v-2l3-3V6L8 5V3Zm3 4v4.8L8.8 14h6.4L13 11.8V7h-2Z" fill="currentColor"/>
        </svg>
      `;
    }

    function funnelIconSvg() {
      return `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" fill="currentColor"/></svg>`;
    }

    function squareIconSvg() {
      return `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M5 5h14v14H5V5Zm2 2v10h10V7H7Z" fill="currentColor"/></svg>`;
    }

    function listIconSvg() {
      return `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M5 6h3v3H5V6Zm5 1h9v1.8h-9V7ZM5 11h3v3H5v-3Zm5 1h9v1.8h-9V12ZM5 16h3v3H5v-3Zm5 1h9v1.8h-9V17Z" fill="currentColor"/></svg>`;
    }

    function saveIconSvg() {
      return `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M5 4h12l2 2v14H5V4Zm2 2v5h9V6H7Zm2 9v3h6v-3H9Z" fill="currentColor"/></svg>`;
    }

    function pencilIconSvg() {
      return `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M17.7 3.3 20.7 6.3 8.9 18.1 4.5 19.5 5.9 15.1 17.7 3.3Zm-1.4 4.4-8.6 8.6-.4 1.4 1.4-.4 8.6-8.6-1-1Z" fill="currentColor"/></svg>`;
    }

    function sunIconSvg() {
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0-5 1.2 3h-2.4L12 2Zm0 17 1.2 3h-2.4l1.2-3ZM4.2 3.8l3 1.3-1.7 1.7-1.3-3Zm14.3 13.4 1.3 3-3-1.3 1.7-1.7ZM2 12l3-1.2v2.4L2 12Zm17 0 3-1.2v2.4L19 12ZM5.5 17.2l1.7 1.7-3 1.3 1.3-3ZM18.5 6.8l-1.7-1.7 3-1.3-1.3 3Z" fill="currentColor"/></svg>`;
    }

    function moonIconSvg() {
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20.5 15.4A8.2 8.2 0 0 1 8.6 3.5a8.8 8.8 0 1 0 11.9 11.9Z" fill="currentColor"/></svg>`;
    }

    function orientationIconSvg(orientation) {
      if (orientation === "vertical") {
        return `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M5 3h5v18H5V3Zm9 0h5v18h-5V3Z" fill="currentColor"/></svg>`;
      }
      return `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M3 5h18v5H3V5Zm0 9h18v5H3v-5Z" fill="currentColor"/></svg>`;
    }

    function updateHeaderToggles() {
      const themeButton = $("themeToggleBtn");
      if (themeButton) {
        themeButton.innerHTML = state.theme === "dark" ? moonIconSvg() : sunIconSvg();
        themeButton.title = state.theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
        themeButton.setAttribute("aria-label", themeButton.title);
        themeButton.classList.toggle("active", state.theme === "dark");
      }
      const orientationButton = $("orientationToggleBtn");
      if (orientationButton) {
        orientationButton.innerHTML = orientationIconSvg(state.orientation);
        orientationButton.title = state.orientation === "horizontal" ? "Switch to vertical view" : "Switch to horizontal view";
        orientationButton.setAttribute("aria-label", orientationButton.title);
        orientationButton.classList.toggle("active", state.orientation === "vertical");
      }
    }

    function setTicketPanelOpen(open) {
      state.ticketPanelOpen = open || state.ticketPanelPinned;
      applyTicketPanelState();
    }

    function toggleTicketPanelPin() {
      state.ticketPanelPinned = !state.ticketPanelPinned;
      state.ticketPanelOpen = state.ticketPanelPinned || state.ticketPanelOpen;
      saveLocalSettings();
      applyTicketPanelState();
    }

    function startTicketPanelResize(event) {
      if (!state.ticketPanelPinned) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = state.ticketPanelWidth;
      const handle = $("ticketPanelResizer");
      handle.classList.add("active");
      const onMove = moveEvent => {
        state.ticketPanelWidth = Math.max(280, Math.min(620, startWidth + (moveEvent.clientX - startX)));
        applyTicketPanelState();
      };
      const onUp = () => {
        handle.classList.remove("active");
        saveLocalSettings();
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    }

    function renderTeamSelect() {
      const picker = $("settingsTeamPicker");
      const allSelected = teams.length > 0 && teams.every(team => state.selectedTeams.includes(team.id));
      picker.innerHTML = `
        <label class="agent-option select-all">
          <input type="checkbox" value="__all" ${allSelected ? "checked" : ""}>
          <span>Select All</span>
        </label>
        ${teams.map(team => `
        <label class="agent-option">
          <input type="checkbox" value="${team.id}" ${state.selectedTeams.includes(team.id) ? "checked" : ""}>
          <span>${escapeHtml(team.name)}</span>
        </label>
      `).join("") || `<div class="empty">Load Halo agents to show teams.</div>`}
      `;
      $("settingsTeamSummary").textContent = summaryText(state.selectedTeams.length, teams.length, "team", "teams");
      picker.querySelectorAll("input").forEach(input => {
        input.addEventListener("change", () => selectTeams(input));
      });
    }

    function renderTechPicker() {
      const picker = $("settingsAgentPicker");
      const filtered = filteredTechnicians();
      const filteredIds = filtered.map(tech => tech.id);
      const allSelected = filteredIds.length > 0 && filteredIds.every(id => state.selectedTechs.includes(id));
      $("settingsAgentSummary").textContent = summaryText(state.selectedTechs.filter(id => filteredIds.includes(id)).length, filteredIds.length, "agent", "agents");
      picker.innerHTML = `
        <label class="agent-option select-all">
          <input type="checkbox" value="__all" ${allSelected ? "checked" : ""}>
          Select All
        </label>
        ${filtered.map(tech => `
          <label class="agent-option">
            <input type="checkbox" value="${tech.id}" ${state.selectedTechs.includes(tech.id) ? "checked" : ""}>
            <span>${escapeHtml(tech.name)}</span>
          </label>
        `).join("") || `<div class="empty">Select a team to show matching agents.</div>`}
      `;
      picker.querySelectorAll("input").forEach(input => {
        input.addEventListener("change", () => {
          if (input.value === "__all") {
            state.selectedTechs = input.checked ? filteredIds : [];
          } else {
            state.selectedTechs = Array.from(picker.querySelectorAll("input:checked"))
              .map(item => item.value)
              .filter(value => value !== "__all");
          }
          saveLocalSettings();
          renderTechPicker();
          renderBoard();
          loadHaloAppointments();
        });
      });
    }

    function renderTicketTypeSelect() {
      const picker = $("ticketTypePicker");
      const selected = new Set(state.selectedTicketTypes.map(String));
      $("ticketTypeSummary").textContent = state.selectedTicketTypes.length
        ? summaryText(state.selectedTicketTypes.length, ticketTypes.length, "type", "types")
        : "All open ticket types";
      picker.innerHTML = ticketTypes.map(type => `
        <label class="agent-option">
          <input type="checkbox" value="${type.id}" ${selected.has(String(type.id)) ? "checked" : ""}>
          <span>${escapeHtml(type.name)}</span>
        </label>
      `).join("") || `<div class="empty">Ticket types will load from Halo.</div>`;
      picker.querySelectorAll("input").forEach(input => {
        input.addEventListener("change", () => {
          state.selectedTicketTypes = Array.from(picker.querySelectorAll("input:checked")).map(item => item.value);
          saveLocalSettings();
          renderTicketTypeSelect();
          loadHaloTickets();
        });
      });
    }

    function renderListFilterFieldPicker() {
      const picker = $("listFilterFieldPicker");
      if (!picker) return;
      $("listFilterFieldSummary").textContent = summaryText(state.selectedListFilterFields.length, listFilterFieldOptions.length, "field", "fields");
      picker.innerHTML = listFilterFieldOptions.map(field => `
        <label class="agent-option">
          <input type="checkbox" value="${field.key}" ${state.selectedListFilterFields.includes(field.key) ? "checked" : ""}>
          <span>${escapeHtml(field.label)}</span>
        </label>
      `).join("");
      picker.querySelectorAll("input").forEach(input => {
        input.addEventListener("change", () => {
          state.selectedListFilterFields = Array.from(picker.querySelectorAll("input:checked")).map(item => item.value);
          saveLocalSettings();
          renderListFilterFieldPicker();
          renderReportLists();
        });
      });
    }

    function renderDeleteFilterSelect() {
      const select = $("deleteFilterSelect");
      if (!select) return;
      const names = Object.keys(state.savedFilters).sort((a, b) => a.localeCompare(b));
      select.innerHTML = `<option value="">Select saved filter</option>${names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
    }

    function deleteSelectedSavedFilter() {
      const name = $("deleteFilterSelect").value;
      if (!name || !state.savedFilters[name]) return;
      delete state.savedFilters[name];
      Object.values(state.listFilters).forEach(filter => {
        if (filter.name === name) filter.name = "";
      });
      saveLocalSettings();
      renderDeleteFilterSelect();
      renderReportLists();
      toast("Filter deleted", `${name} was removed from saved ticket filters.`);
    }

    function filteredTechnicians() {
      if (!state.selectedTeams.length) return [];
      const selectedTeams = new Set(state.selectedTeams.map(String));
      return technicians.filter(tech => {
        const teamIds = Array.isArray(tech.teamIds) && tech.teamIds.length ? tech.teamIds : [tech.teamId];
        return teamIds.some(teamId => selectedTeams.has(String(teamId)));
      });
    }

    function summaryText(selectedCount, totalCount, singular, plural) {
      if (!totalCount) return `No ${plural}`;
      if (selectedCount === totalCount) return `All ${plural}`;
      if (!selectedCount) return `No ${plural} selected`;
      return `${selectedCount} ${selectedCount === 1 ? singular : plural} selected`;
    }

    function renderFieldChecks() {
      $("fieldSummary").textContent = summaryText(state.visibleFields.length, fieldOptions.length, "field", "fields");
      $("fieldChecks").innerHTML = fieldOptions.map(option => `
        <label class="agent-option">
          <input type="checkbox" value="${option.key}" ${state.visibleFields.includes(option.key) ? "checked" : ""}>
          <span>${option.label}</span>
        </label>
      `).join("");
      $("fieldChecks").querySelectorAll("input").forEach(input => {
        input.addEventListener("change", () => {
          state.visibleFields = Array.from($("fieldChecks").querySelectorAll("input:checked")).map(item => item.value);
          saveLocalSettings();
          renderFieldChecks();
          renderReportLists();
        });
      });
    }

    function renderReportLists() {
      if (!reports.length) {
        $("reportLists").innerHTML = `<div class="empty">No ticket lists configured yet.</div>`;
        updateTicketPanelBadges([]);
        return;
      }
      const counts = state.reportLists.map((reportId, index) => filteredTicketsForList(reportId, index).length);
      ensureTicketListAccordion();
      const expandedCount = state.reportLists.filter((reportId, index) => !state.collapsedLists[sectionKey(index)]).length;
      $("reportLists").className = `report-lists expanded-count-${Math.min(expandedCount, 3)}`;
      $("reportLists").innerHTML = state.reportLists.map((reportId, index) => renderReportList(reportId, index)).join("");
      updateTicketPanelBadges(counts);
      $("reportLists").querySelectorAll("[data-remove-list]").forEach(button => {
        button.addEventListener("click", () => {
          state.reportLists.splice(Number(button.dataset.index), 1);
          resetReportListHeights();
          saveLocalSettings();
          renderReportLists();
        });
      });
      $("reportLists").querySelectorAll("[data-list-view]").forEach(button => {
        button.addEventListener("click", () => {
          state.listViews[sectionKey(Number(button.dataset.index))] = button.dataset.view;
          saveLocalSettings();
          renderReportLists();
        });
      });
      $("reportLists").querySelectorAll("[data-list-view-toggle]").forEach(button => {
        button.addEventListener("click", event => {
          event.stopPropagation();
          const key = sectionKey(Number(button.dataset.index));
          state.listViews[key] = (state.listViews[key] || "card") === "card" ? "list" : "card";
          saveLocalSettings();
          renderReportLists();
        });
      });
      $("reportLists").querySelectorAll("[data-filter-toggle]").forEach(button => {
        button.addEventListener("click", event => {
          event.stopPropagation();
          const key = button.dataset.filterToggle;
          openFilterModal(key);
        });
      });
      $("reportLists").querySelectorAll("[data-filter-name]").forEach(input => {
        input.addEventListener("change", () => setListFilterName(input.dataset.filterName, input.value.trim()));
      });
      $("reportLists").querySelectorAll("[data-save-filter]").forEach(button => {
        button.addEventListener("click", () => saveNamedFilter(button.dataset.saveFilter));
      });
      $("reportLists").querySelectorAll("[data-saved-filter-select]").forEach(select => {
        select.addEventListener("change", () => applySavedFilterToList(select.dataset.savedFilterSelect, select.value));
      });
      $("reportLists").querySelectorAll("[data-filter-field]").forEach(input => {
        input.addEventListener("change", () => updateListFilterValue(input.dataset.filterList, input.dataset.filterField));
      });
      $("reportLists").querySelectorAll("[data-filter-mode]").forEach(select => {
        select.addEventListener("change", () => updateListFilterMode(select.dataset.filterList, select.dataset.filterMode, select.value));
      });
      $("reportLists").querySelectorAll("[data-filter-bulk]").forEach(button => {
        button.addEventListener("click", () => updateListFilterBulk(button.dataset.filterList, button.dataset.filterBulk, button.dataset.bulkAction));
      });
      $("reportLists").querySelectorAll("[data-filter-details]").forEach(details => {
        details.addEventListener("toggle", () => {
          state.openFilterFields[details.dataset.filterDetails] = details.open;
          saveLocalSettings();
        });
      });
      $("reportLists").querySelectorAll("[data-list-header]").forEach(header => {
        header.addEventListener("click", event => {
          if (event.target.closest(".report-actions, button, input, select, details, a")) return;
          const key = header.dataset.listHeader;
          setExpandedTicketList(key, Boolean(state.collapsedLists[key]));
          saveLocalSettings();
          renderReportLists();
        });
      });
      makeTicketsDraggable();
    }

    function updateTicketPanelBadges(counts) {
      const safeCounts = counts.length ? counts : [0];
      $("ticketPanelBadges").innerHTML = safeCounts.slice(0, 3).map((count, index) => `
        <span class="${count > 0 ? "has-count" : ""}" ${listThemeStyle(state.listFilters[sectionKey(index)]?.color)} title="List ${index + 1}: ${count} tickets">${count}</span>
      `).join("");
    }

    function ensureTicketListAccordion() {
      const openKeys = state.reportLists
        .map((reportId, index) => sectionKey(index))
        .filter(key => !state.collapsedLists[key]);
      openKeys.slice(1).forEach(key => {
        state.collapsedLists[key] = true;
      });
    }

    function setExpandedTicketList(key, expand) {
      state.reportLists.forEach((reportId, index) => {
        state.collapsedLists[sectionKey(index)] = true;
      });
      if (expand) state.collapsedLists[key] = false;
    }

    function renderReportList(reportId, index) {
      const report = reports.find(item => item.id === reportId) || reports[0];
      const listTickets = filteredTicketsForList(reportId, index);
      const key = sectionKey(index);
      const view = state.listViews[key] || "card";
      const collapsed = Boolean(state.collapsedLists[key]);
      const listFilter = ensureListFilter(key);
      const title = listFilter.title || listFilter.name || report.name;
      const themeStyle = listThemeStyle(listFilter.color);
      const hasAttention = listTickets.some(ticket => attentionTicketIds.has(Number(ticket.id)));
      return `
        <section class="report-list ${collapsed ? "collapsed" : ""} ${hasAttention ? "has-new-ticket" : ""}" ${themeStyle}>
          <header data-list-header="${key}" title="${collapsed ? "Expand list" : "Collapse list"}">
            <div class="report-name">${escapeHtml(title)} <span class="count-badge" title="${listTickets.length} open tickets">${listTickets.length}</span></div>
            <div class="report-actions">
              <button class="icon" data-list-view-toggle data-index="${index}" title="${view === "card" ? "Switch to list view" : "Switch to card view"}">${view === "card" ? squareIconSvg() : listIconSvg()}</button>
              <button class="icon" data-filter-toggle="${key}" title="Edit ticket list">${pencilIconSvg()}</button>
              <button class="icon danger-icon" data-remove-list data-index="${index}" title="Remove list">x</button>
            </div>
            <div class="report-meta">
              ${state.openFilterMenu === key ? renderTicketFilterMenu(key) : ""}
            </div>
          </header>
          <div class="ticket-stack ${view === "list" ? "list-view" : "card-view"}">
            ${listTickets.length ? listTickets.map(ticket => renderTicketCard(ticket, view, !collapsed)).join("") : `<div class="empty">No tickets in this list.</div>`}
          </div>
        </section>
      `;
    }

    function filteredTicketsForList(reportId, index) {
      const report = reports.find(item => item.id === reportId) || reports[0];
      const key = sectionKey(index);
      const filter = ensureListFilter(key);
      return tickets.filter(ticket => {
        if (ticket.report !== report.id || !shouldShowTicketCard(ticket)) return false;
        const activeConditions = filterConditions(filter).filter(condition => condition.values?.length);
        if (!activeConditions.length) return true;
        return activeConditions.reduce((matches, condition, index) => {
          const hasValue = ticketFilterValues(ticket, condition.field).some(value => condition.values.includes(String(value)));
          const conditionMatches = condition.mode === "exclude" ? !hasValue : hasValue;
          if (index === 0) return conditionMatches;
          return condition.joiner === "or" ? matches || conditionMatches : matches && conditionMatches;
        }, true);
      });
    }

    function ensureListFilter(key) {
      if (!state.listFilters[key]) state.listFilters[key] = { name: "", values: {}, modes: {} };
      if (!state.listFilters[key].values) state.listFilters[key].values = {};
      if (!state.listFilters[key].modes) state.listFilters[key].modes = {};
      if (!Array.isArray(state.listFilters[key].conditions)) {
        state.listFilters[key].conditions = conditionsFromLegacyFilter(state.listFilters[key]);
      }
      return state.listFilters[key];
    }

    function filterConditions(filter) {
      if (Array.isArray(filter.conditions)) return filter.conditions;
      return conditionsFromLegacyFilter(filter);
    }

    function conditionsFromLegacyFilter(filter) {
      return Object.entries(filter.values || {}).map(([field, values]) => ({
        field,
        joiner: "and",
        mode: filter.modes?.[field] || "include",
        values: values || []
      }));
    }

    function defaultCondition() {
      return { joiner: "and", mode: "include", field: state.selectedListFilterFields[0] || "assignedTo", values: [] };
    }

    function listThemeStyle(color = "#1976a3") {
      return `style="${listThemeVars(color)}"`;
    }

    function listThemeVars(color = "#1976a3") {
      const hsl = hexToHsl(color);
      return `--list-hue:${hsl.h};--list-sat:${hsl.s}%;--list-light:${hsl.l}%;`;
    }

    function hexToHsl(hex) {
      const normalized = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#1976a3";
      const r = parseInt(normalized.slice(1, 3), 16) / 255;
      const g = parseInt(normalized.slice(3, 5), 16) / 255;
      const b = parseInt(normalized.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h = 0;
      let s = 0;
      const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d) + (g < b ? 6 : 0);
        else if (max === g) h = ((b - r) / d) + 2;
        else h = ((r - g) / d) + 4;
        h /= 6;
      }
      return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    }

    function renderTicketFilterMenu(key) {
      const filter = ensureListFilter(key);
      const names = Object.keys(state.savedFilters).sort((a, b) => a.localeCompare(b));
      return `
        <div class="ticket-filter-menu">
          <div class="filter-name-row">
            <input data-filter-name="${key}" list="saved-filter-names-${key}" placeholder="Filter name" value="${escapeHtml(filter.name || "")}">
            <datalist id="saved-filter-names-${key}">${names.map(name => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist>
            <button class="icon" data-save-filter="${key}" title="Save filter">${saveIconSvg()}</button>
          </div>
          <select data-saved-filter-select="${key}">
            <option value="">Apply saved filter</option>
            ${names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
          </select>
          ${state.selectedListFilterFields.map(field => renderFilterFieldPicker(key, field)).join("")}
        </div>
      `;
    }

    function openFilterModal(key) {
      const filter = ensureListFilter(key);
      state.activeFilterListKey = key;
      state.copyFilterMenuOpen = false;
      state.draftFilter = {
        name: filter.name || "",
        title: filter.title || filter.name || "",
        color: filter.color || "#1976a3",
        conditions: structuredClone(filterConditions(filter))
      };
      if (!state.draftFilter.conditions.length) state.draftFilter.conditions.push(defaultCondition());
      renderFilterModal();
      $("filterModal").classList.add("open");
    }

    function closeFilterModal() {
      $("filterModal").classList.remove("open");
      state.activeFilterListKey = null;
      state.draftFilter = null;
    }

    function renderFilterModal() {
      if (!state.draftFilter) return;
      $("filterModalName").value = state.draftFilter.name || "";
      $("filterModalListTitle").value = state.draftFilter.title || "";
      $("filterModalColor").value = state.draftFilter.color || "#1976a3";
      renderCopyFilterMenu();
      $("filterConditionList").innerHTML = state.draftFilter.conditions.map((condition, index) => renderFilterConditionRow(condition, index)).join("");
      wireFilterModalRows();
      restoreFilterValueScroll();
    }

    function renderFilterConditionRow(condition, index) {
      const values = uniqueTicketValues(condition.field);
      const selected = condition.values || [];
      const fieldOptions = listFilterFieldOptions.map(field => `<option value="${field.key}" ${field.key === condition.field ? "selected" : ""}>${escapeHtml(field.label)}</option>`).join("");
      return `
        <div class="filter-condition-row" data-condition-index="${index}">
          ${index > 0 ? `
            <select data-condition-joiner="${index}" title="How this condition combines with the previous condition">
              <option value="and" ${(condition.joiner || "and") === "and" ? "selected" : ""}>And</option>
              <option value="or" ${condition.joiner === "or" ? "selected" : ""}>Or</option>
            </select>
          ` : `<div class="condition-joiner-spacer"></div>`}
          <button class="filter-mode-toggle ${condition.mode === "exclude" ? "exclude" : ""}" data-condition-mode="${index}" type="button">${condition.mode === "exclude" ? "Exclude" : "Include"}</button>
          <select data-condition-field="${index}">${fieldOptions}</select>
          <details class="multi-dropdown condition-value-picker" data-condition-details="${index}" ${state.openFilterFields[`modal:${index}`] ? "open" : ""}>
            <summary>${selected.length ? `${selected.length} selected` : "Select values"}</summary>
            <div class="agent-picker">
              <div class="filter-bulk-row">
                <button type="button" data-condition-bulk="${index}" data-bulk-action="select">Select All</button>
                <button type="button" data-condition-bulk="${index}" data-bulk-action="clear">Clear All</button>
              </div>
              ${values.map(value => `
                <label class="agent-option">
                  <input type="checkbox" data-condition-value="${index}" value="${escapeHtml(value)}" ${selected.includes(value) ? "checked" : ""}>
                  <span>${escapeHtml(filterValueLabel(condition.field, value))}</span>
                </label>
              `).join("") || `<div class="empty">No values yet.</div>`}
            </div>
          </details>
          <button class="icon" data-add-condition="${index}" type="button" title="Add condition">+</button>
          ${index > 0 ? `<button class="icon danger-icon" data-delete-condition="${index}" type="button" title="Remove condition">x</button>` : ""}
        </div>
      `;
    }

    function wireFilterModalRows() {
      $("filterConditionList").querySelectorAll("[data-condition-joiner]").forEach(select => {
        select.addEventListener("change", () => {
          state.draftFilter.conditions[Number(select.dataset.conditionJoiner)].joiner = select.value;
          renderFilterModal();
        });
      });
      $("filterConditionList").querySelectorAll("[data-condition-mode]").forEach(button => {
        button.addEventListener("click", () => {
          const condition = state.draftFilter.conditions[Number(button.dataset.conditionMode)];
          condition.mode = condition.mode === "exclude" ? "include" : "exclude";
          renderFilterModal();
        });
      });
      $("filterConditionList").querySelectorAll("[data-condition-field]").forEach(select => {
        select.addEventListener("change", () => {
          const condition = state.draftFilter.conditions[Number(select.dataset.conditionField)];
          condition.field = select.value;
          condition.values = [];
          renderFilterModal();
        });
      });
      $("filterConditionList").querySelectorAll("[data-condition-value]").forEach(input => {
        input.addEventListener("change", () => {
          const index = Number(input.dataset.conditionValue);
          rememberFilterValueScroll(index);
          state.draftFilter.conditions[index].values = Array.from(document.querySelectorAll(`[data-condition-value="${index}"]:checked`)).map(item => item.value);
          state.openFilterFields[`modal:${index}`] = true;
          renderFilterModal();
        });
      });
      $("filterConditionList").querySelectorAll("[data-condition-bulk]").forEach(button => {
        button.addEventListener("click", () => {
          const index = Number(button.dataset.conditionBulk);
          rememberFilterValueScroll(index);
          const condition = state.draftFilter.conditions[index];
          condition.values = button.dataset.bulkAction === "select" ? uniqueTicketValues(condition.field) : [];
          state.openFilterFields[`modal:${index}`] = true;
          renderFilterModal();
        });
      });
      $("filterConditionList").querySelectorAll("[data-add-condition]").forEach(button => {
        button.addEventListener("click", () => {
          state.draftFilter.conditions.splice(Number(button.dataset.addCondition) + 1, 0, defaultCondition());
          renderFilterModal();
        });
      });
      $("filterConditionList").querySelectorAll("[data-delete-condition]").forEach(button => {
        button.addEventListener("click", () => {
          state.draftFilter.conditions.splice(Number(button.dataset.deleteCondition), 1);
          renderFilterModal();
        });
      });
      $("filterConditionList").querySelectorAll("[data-condition-details]").forEach(details => {
        details.addEventListener("toggle", () => {
          state.openFilterFields[`modal:${details.dataset.conditionDetails}`] = details.open;
          if (!details.open) delete state.filterValueScroll[`modal:${details.dataset.conditionDetails}`];
        });
      });
    }

    function rememberFilterValueScroll(index) {
      const picker = document.querySelector(`[data-condition-details="${index}"] .agent-picker`);
      if (picker) state.filterValueScroll[`modal:${index}`] = picker.scrollTop;
    }

    function restoreFilterValueScroll() {
      requestAnimationFrame(() => {
        Object.entries(state.filterValueScroll).forEach(([key, top]) => {
          const index = key.replace("modal:", "");
          const picker = document.querySelector(`[data-condition-details="${index}"] .agent-picker`);
          if (picker) picker.scrollTop = top;
        });
      });
    }

    function renderCopyFilterMenu() {
      const names = Object.keys(state.savedFilters).sort((a, b) => a.localeCompare(b));
      $("copyFilterMenu").classList.toggle("open", state.copyFilterMenuOpen);
      $("copyFilterMenu").innerHTML = names.length
        ? names.map(name => `<button type="button" data-copy-filter="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")
        : `<div class="empty">No saved filters yet.</div>`;
    }

    function toggleCopyFilterMenu() {
      state.copyFilterMenuOpen = !state.copyFilterMenuOpen;
      renderCopyFilterMenu();
    }

    function copySavedFilterToDraft(name) {
      const filter = state.savedFilters[name];
      if (!filter || !state.draftFilter) return;
      state.draftFilter = {
        name: state.draftFilter.name,
        title: state.draftFilter.title || filter.title || name,
        color: filter.color || state.draftFilter.color || "#1976a3",
        conditions: structuredClone(filterConditions(filter))
      };
      if (!state.draftFilter.conditions.length) state.draftFilter.conditions.push(defaultCondition());
      state.copyFilterMenuOpen = false;
      renderFilterModal();
    }

    function applyFilterModal() {
      if (!state.activeFilterListKey || !state.draftFilter) return;
      state.draftFilter.name = $("filterModalName").value.trim();
      state.draftFilter.title = $("filterModalListTitle").value.trim();
      state.draftFilter.color = $("filterModalColor").value;
      state.listFilters[state.activeFilterListKey] = normalizeFilterShape(state.draftFilter);
      saveLocalSettings();
      closeFilterModal();
      renderReportLists();
    }

    function saveFilterFromModal() {
      if (!state.draftFilter) return;
      state.draftFilter.name = $("filterModalName").value.trim();
      state.draftFilter.title = $("filterModalListTitle").value.trim();
      state.draftFilter.color = $("filterModalColor").value;
      const name = state.draftFilter.name;
      if (!name) {
        toast("Filter name needed", "Type a filter name before saving it.");
        return;
      }
      if (state.savedFilters[name] && !confirm(`Overwrite saved filter "${name}"? Choose Cancel, type a new name, and save again to save as new.`)) {
        return;
      }
      state.savedFilters[name] = normalizeFilterShape(state.draftFilter);
      renderDeleteFilterSelect();
      saveLocalSettings();
      toast("Filter saved", `${name} is available for ticket lists.`);
    }

    function normalizeFilterShape(filter) {
      const normalized = {
        name: filter.name || "",
        title: filter.title || filter.name || "",
        color: filter.color || "#1976a3",
        conditions: structuredClone(filter.conditions || []),
        values: {},
        modes: {}
      };
      normalized.conditions.forEach(condition => {
        if (!condition.field) return;
        condition.joiner = condition.joiner || "and";
        condition.mode = condition.mode || "include";
        normalized.values[condition.field] = condition.values || [];
        normalized.modes[condition.field] = condition.mode;
      });
      return normalized;
    }

    function renderFilterFieldPicker(key, field) {
      const option = listFilterFieldOptions.find(item => item.key === field) || { key: field, label: field };
      const filter = ensureListFilter(key);
      const selected = filter.values[field] || [];
      const mode = filter.modes[field] || "include";
      const values = uniqueTicketValues(field);
      const detailsKey = `${key}:${field}`;
      return `
        <details class="multi-dropdown filter-field-dropdown" data-filter-details="${detailsKey}" ${state.openFilterFields[detailsKey] ? "open" : ""}>
          <summary>${escapeHtml(option.label)} ${mode === "exclude" ? "excludes" : "includes"}${selected.length ? ` (${selected.length})` : ""}</summary>
          <div class="agent-picker">
            <div class="filter-mode-row">
              <select data-filter-list="${key}" data-filter-mode="${field}" title="Include or exclude selected values">
                <option value="include" ${mode === "include" ? "selected" : ""}>Include selected</option>
                <option value="exclude" ${mode === "exclude" ? "selected" : ""}>Exclude selected</option>
              </select>
            </div>
            <div class="filter-bulk-row">
              <button type="button" data-filter-list="${key}" data-filter-bulk="${field}" data-bulk-action="select">Select All</button>
              <button type="button" data-filter-list="${key}" data-filter-bulk="${field}" data-bulk-action="clear">Clear All</button>
            </div>
            ${values.map(value => `
              <label class="agent-option">
                <input type="checkbox" data-filter-list="${key}" data-filter-field="${field}" value="${escapeHtml(value)}" ${selected.includes(value) ? "checked" : ""}>
                <span>${escapeHtml(filterValueLabel(field, value))}</span>
              </label>
            `).join("") || `<div class="empty">No values yet.</div>`}
          </div>
        </details>
      `;
    }

    function uniqueTicketValues(field) {
      const values = tickets.flatMap(ticket => ticketFilterValues(ticket, field).map(value => String(value || "").trim()).filter(Boolean));
      if (field === "type") {
        values.push(...ticketTypes.map(type => type.name).filter(Boolean));
      }
      if (field === "assignedTo") {
        values.push("1", ...technicians.map(tech => String(tech.id)));
      }
      if (field === "team") {
        values.push(
          ...teams.map(team => String(team.id)),
          ...technicians.flatMap(tech => (Array.isArray(tech.teamIds) ? tech.teamIds : [tech.teamId]).map(String).filter(Boolean))
        );
      }
      return Array.from(new Set(values)).sort((a, b) => filterValueLabel(field, a).localeCompare(filterValueLabel(field, b)));
    }

    function ticketFilterValue(ticket, field) {
      return ticketFilterValues(ticket, field)[0] || "";
    }

    function ticketFilterValues(ticket, field) {
      if (field === "assignedTo") return [ticket.assignedTo || ""];
      if (field === "team") {
        const tech = technicians.find(item => String(item.id) === String(ticket.assignedTo));
        const teamIds = ticket.teamIds?.length ? ticket.teamIds : (tech?.teamIds?.length ? tech.teamIds : [ticket.teamId || tech?.teamId || ""]);
        return Array.from(new Set([
          ticket.teamId,
          ticket.team,
          ...teamIds
        ].map(value => String(value || "").trim()).filter(Boolean)));
      }
      return [ticket[field] || ""];
    }

    function filterValueLabel(field, value) {
      if (field === "assignedTo") {
        if (String(value) === "1") return "Unassigned";
        return technicians.find(tech => String(tech.id) === String(value))?.name || (value ? `Agent ${value}` : "Unassigned");
      }
      if (field === "team") {
        const team = teams.find(item => String(item.id) === String(value));
        if (team?.name) return team.name;
        const tech = technicians.find(item => {
          const teamIds = Array.isArray(item.teamIds) ? item.teamIds : [item.teamId];
          return teamIds.map(String).includes(String(value));
        });
        return tech?.team || (value ? String(value) : "No Team");
      }
      return value;
    }

    function setListFilterName(key, name) {
      ensureListFilter(key).name = name;
      saveLocalSettings();
      renderReportLists();
    }

    function updateListFilterValue(key, field) {
      const selected = Array.from(document.querySelectorAll(`[data-filter-list="${key}"][data-filter-field="${field}"]:checked`)).map(input => input.value);
      ensureListFilter(key).values[field] = selected;
      state.openFilterFields[`${key}:${field}`] = true;
      saveLocalSettings();
      renderReportLists();
    }

    function updateListFilterMode(key, field, mode) {
      ensureListFilter(key).modes[field] = mode;
      state.openFilterFields[`${key}:${field}`] = true;
      saveLocalSettings();
      renderReportLists();
    }

    function updateListFilterBulk(key, field, action) {
      ensureListFilter(key).values[field] = action === "select" ? uniqueTicketValues(field) : [];
      state.openFilterFields[`${key}:${field}`] = true;
      saveLocalSettings();
      renderReportLists();
    }

    function saveNamedFilter(key) {
      const filter = ensureListFilter(key);
      const input = document.querySelector(`[data-filter-name="${key}"]`);
      if (input) filter.name = input.value.trim();
      const name = (filter.name || "").trim();
      if (!name) {
        toast("Filter name needed", "Type a filter name before saving it.");
        return;
      }
      state.savedFilters[name] = normalizeFilterShape(filter);
      saveLocalSettings();
      renderDeleteFilterSelect();
      renderReportLists();
      toast("Filter saved", `${name} is available for other ticket lists.`);
    }

    function applySavedFilterToList(key, name) {
      if (!name || !state.savedFilters[name]) return;
      state.listFilters[key] = {
        name,
        values: structuredClone(state.savedFilters[name].values || {}),
        modes: structuredClone(state.savedFilters[name].modes || {}),
        conditions: structuredClone(filterConditions(state.savedFilters[name]))
      };
      saveLocalSettings();
      renderReportLists();
    }

    function renderTicketCard(ticket, view = "card", listExpanded = true) {
      const visible = state.visibleFields.map(field => {
        if (!ticket[field]) return "";
        return `<div class="ticket-line"><span>${labelFor(field)}</span><strong>${escapeHtml(ticket[field])}</strong></div>`;
      }).join("");
      const attentionClass = listExpanded && attentionTicketIds.has(Number(ticket.id)) ? "new-ticket-attention" : "";
      return `
        <article class="ticket-card ${ticketColorClass(ticket)} ${view === "list" ? "list-mode" : ""} ${attentionClass}" draggable="true" data-ticket-id="${ticket.id}" data-drag-source="ticket">
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
      captureCalendarScroll();
      const board = $("dispatchBoard");
      board.parentElement.className = `board-wrap ${state.orientation}`;
      board.className = `board ${state.orientation}`;
      const selectedTechs = state.selectedTechs.map(id => technicians.find(tech => tech.id === id)).filter(Boolean);
      board.innerHTML = selectedTechs.map(renderTechColumn).join("");
      restoreCalendarScroll();
      wireTechReordering();
      wireTechEditButtons();
      wireDropZones();
      wireZoneExpanders();
      wireTechGroupToggles();
      makeTicketsDraggable();
    }

    function renderTechColumn(tech) {
      const visibleItems = state.boardItems.filter(item => String(item.techId) === String(tech.id) && isSelectedDate(item.date));
      const pastNoTime = state.boardItems.filter(item => String(item.techId) === String(tech.id) && item.kind === "pastNoTime" && String(item.date || "") < selectedDate());
      const allDay = visibleItems.filter(item => item.kind === "allDay");
      const noTime = visibleItems.filter(item => item.kind === "noTime");
      const timed = visibleItems.filter(item => item.kind === "timed");
      const scheduleKey = techGroupKey(tech.id, "schedule");
      const noTimeKey = techGroupKey(tech.id, "noTime");
      const pastKey = techGroupKey(tech.id, "pastNoTime");
      const scheduleCollapsed = Boolean(state.collapsedTechGroups[scheduleKey]);
      const noTimeCollapsed = Boolean(state.collapsedTechGroups[noTimeKey]);
      const pastCollapsed = state.collapsedTechGroups[pastKey] !== false;
      const techStyle = `style="--tech-color:${escapeHtml(techThemeColor(tech.id))};"`;
      const workload = techWorkloadSummary(timed);
      if (state.orientation === "vertical") {
        return `
          <section class="tech-column ${scheduleCollapsed ? "schedule-collapsed" : ""} ${noTimeCollapsed ? "notime-collapsed" : ""}" data-tech-id="${tech.id}" ${techStyle}>
            <header class="tech-header" draggable="true" data-tech-handle="${tech.id}">
              <span></span>
              <div class="tech-title">
                <div class="tech-name">${escapeHtml(tech.name)}</div>
                <span class="tech-load-badge" title="Scheduled time vs available time">${escapeHtml(workload)}</span>
              </div>
              <button class="icon tech-edit-btn" data-edit-tech="${tech.id}" type="button" title="Edit technician theme">${pencilIconSvg()}</button>
            </header>
            <div class="vertical-task-stack">
              ${renderTechGroupToggle(tech.id, "schedule", scheduleCollapsed, "Calendar")}
              ${scheduleCollapsed ? "" : renderTaskZone("allDay", tech.id, tech.name, "All-Day Tasks", allDay, "Drop ticket here for all-day task")}
              ${renderTechGroupToggle(tech.id, "noTime", noTimeCollapsed, "Today's Tasks", noTime.length)}
              ${noTimeCollapsed ? "" : renderTaskZone("noTime", tech.id, tech.name, "Today's Tasks", noTime, "Drop ticket here to assign date only")}
              ${pastNoTime.length ? renderTechGroupToggle(tech.id, "pastNoTime", pastCollapsed, "Past Tasks", pastNoTime.length, "alert") : ""}
              ${pastNoTime.length && !pastCollapsed ? renderPastTaskZone(tech.id, tech.name, pastNoTime) : ""}
            </div>
            ${scheduleCollapsed ? `<div class="calendar-collapsed-note">Calendar hidden</div>` : `
              <div class="calendar" data-calendar-tech-id="${tech.id}">
                <div class="time-axis">${renderTimeLabels()}</div>
                <div class="slot-grid">${renderTimeSlots(tech.id, timed)}</div>
              </div>
            `}
          </section>
        `;
      }
      return `
        <section class="tech-column ${scheduleCollapsed ? "schedule-collapsed" : ""} ${noTimeCollapsed ? "notime-collapsed" : ""}" data-tech-id="${tech.id}" ${techStyle}>
          <header class="tech-header" draggable="true" data-tech-handle="${tech.id}">
            <span></span>
            <div class="tech-title">
              <div class="tech-name">${escapeHtml(tech.name)}</div>
              <span class="tech-load-badge" title="Scheduled time vs available time">${escapeHtml(workload)}</span>
            </div>
            <button class="icon tech-edit-btn" data-edit-tech="${tech.id}" type="button" title="Edit technician theme">${pencilIconSvg()}</button>
          </header>
          ${renderTechGroupToggle(tech.id, "schedule", scheduleCollapsed, "Calendar")}
          ${scheduleCollapsed ? "" : `
            ${renderTaskZone("allDay", tech.id, tech.name, "All-Day Tasks", allDay, "Drop ticket here for all-day task")}
            <div class="calendar" data-calendar-tech-id="${tech.id}">
              <div class="time-axis">${renderTimeLabels()}</div>
              <div class="slot-grid">${renderTimeSlots(tech.id, timed)}</div>
            </div>
          `}
          ${renderTechGroupToggle(tech.id, "noTime", noTimeCollapsed, "Today's Tasks", noTime.length)}
          ${noTimeCollapsed ? "" : renderTaskZone("noTime", tech.id, tech.name, "Today's Tasks", noTime, "Drop ticket here to assign date only")}
          ${pastNoTime.length ? renderTechGroupToggle(tech.id, "pastNoTime", pastCollapsed, "Past Tasks", pastNoTime.length, "alert") : ""}
          ${pastNoTime.length && !pastCollapsed ? renderPastTaskZone(tech.id, tech.name, pastNoTime) : ""}
        </section>
      `;
    }

    function renderTechGroupToggle(techId, group, collapsed, label, count = null, badgeTone = "") {
      return `
        <button class="tech-group-toggle" data-tech-group-toggle="${group}" data-tech-id="${techId}" type="button">
          <span>${escapeHtml(label)} ${count !== null ? `<span class="section-count-badge ${badgeTone}">${count}</span>` : ""}</span><span>${collapsed ? "^" : "v"}</span>
        </button>
      `;
    }

    function techGroupKey(techId, group) {
      return `${techId}:${group}`;
    }

    function wireTechGroupToggles() {
      document.querySelectorAll("[data-tech-group-toggle]").forEach(button => {
        button.addEventListener("click", () => {
          const key = techGroupKey(button.dataset.techId, button.dataset.techGroupToggle);
          state.collapsedTechGroups[key] = !state.collapsedTechGroups[key];
          saveLocalSettings();
          renderBoard();
        });
      });
    }

    function wireTechEditButtons() {
      document.querySelectorAll("[data-edit-tech]").forEach(button => {
        button.addEventListener("pointerdown", event => event.stopPropagation());
        button.addEventListener("click", event => {
          event.stopPropagation();
          openTechThemeModal(button.dataset.editTech);
        });
      });
    }

    function openTechThemeModal(techId) {
      const tech = technicians.find(item => String(item.id) === String(techId));
      if (!tech) return;
      state.activeTechEditId = String(techId);
      $("techThemeModalTitle").textContent = `Edit ${tech.name}`;
      $("techThemeColor").value = techThemeColor(techId);
      $("techThemeModal").classList.add("open");
    }

    function closeTechThemeModal() {
      $("techThemeModal").classList.remove("open");
      state.activeTechEditId = null;
    }

    function saveTechTheme() {
      if (!state.activeTechEditId) return;
      state.techThemes[state.activeTechEditId] = $("techThemeColor").value;
      saveLocalSettings();
      closeTechThemeModal();
      renderBoard();
    }

    function techThemeColor(techId) {
      const color = state.techThemes[String(techId)];
      return /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#273946";
    }

    function techWorkloadSummary(timedItems) {
      const assignedMinutes = timedItems.reduce((total, item) => total + Number(item.duration || 30), 0);
      const availableMinutes = Math.max(30, calendarEndMinutes() - calendarStartMinutes());
      const percent = Math.round((assignedMinutes / availableMinutes) * 100);
      return `${formatDurationShort(assignedMinutes)} / ${formatDurationShort(availableMinutes)} ${percent}%`;
    }

    function formatDurationShort(minutes) {
      const value = Number(minutes || 0);
      if (value < 60) return `${value}m`;
      const hours = value / 60;
      return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
    }

    function renderTaskZone(kind, techId, techName, label, items, emptyText) {
      const showInlineLabel = kind !== "noTime";
      return `
        <div class="drop-zone" data-drop-kind="${kind}" data-tech-id="${techId}">
          <div class="expanded-title">${escapeHtml(label)} - ${escapeHtml(techName)}</div>
          <div class="zone-topline">
            ${showInlineLabel ? `<div class="zone-label">${label}</div>` : `<div></div>`}
            <button class="expand-zone" data-expand-zone type="button" title="Expand section">^</button>
          </div>
          <div class="zone-items">${items.length ? items.map(renderSmallEvent).join("") : `<div class="empty">${emptyText}</div>`}</div>
        </div>
      `;
    }

    function renderPastTaskZone(techId, techName, items) {
      return `
        <div class="drop-zone past-task-zone" data-past-task-zone="${techId}">
          <div class="expanded-title">Past Tasks - ${escapeHtml(techName)}</div>
          <div class="zone-topline">
            <div class="zone-label">Past Tasks</div>
            <button class="expand-zone" data-expand-zone type="button" title="Expand section">^</button>
          </div>
          <div class="zone-items">${items.map(renderSmallEvent).join("")}</div>
        </div>
      `;
    }

    function renderTimeLabels() {
      const labels = [];
      for (let minutes = calendarStartMinutes(); minutes < calendarEndMinutes(); minutes += 60) {
        const time = minutesToTime(minutes);
        if (state.orientation === "vertical") {
          labels.push(`<div class="time-label">${formatTime(time)}</div>`);
          labels.push(`<div class="time-label">${formatTime(minutesToTime(minutes + 30))}</div>`);
        } else {
          labels.push(`<div class="time-label">${formatTime(time)}</div>`);
        }
      }
      return labels.join("");
    }

    function captureCalendarScroll() {
      document.querySelectorAll(".calendar[data-calendar-tech-id]").forEach(calendar => {
        state.calendarScroll[calendarScrollKey(calendar.dataset.calendarTechId)] = {
          top: calendar.scrollTop,
          left: calendar.scrollLeft
        };
      });
    }

    function restoreCalendarScroll() {
      requestAnimationFrame(() => {
        document.querySelectorAll(".calendar[data-calendar-tech-id]").forEach(calendar => {
          const saved = state.calendarScroll[calendarScrollKey(calendar.dataset.calendarTechId)];
          if (state.shouldCenterNow && isTodaySelected()) {
            centerCalendarOnCurrentTime(calendar);
            return;
          }
          if (!saved) return;
          calendar.scrollTop = saved.top;
          calendar.scrollLeft = saved.left;
        });
        state.shouldCenterNow = false;
      });
    }

    function calendarScrollKey(techId) {
      return `${state.orientation}:${techId}`;
    }

    function renderTimeSlots(techId, timed) {
      const slots = [];
      const nowMarker = renderCurrentTimeMarker();
      for (let minutes = calendarStartMinutes(); minutes < calendarEndMinutes(); minutes += 30) {
        const time = minutesToTime(minutes);
        const slotItems = timed
          .filter(item => slotForTime(item.time) === time)
          .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
        slots.push(`
          <div class="time-slot ${slotItems.length > 1 ? "has-overlap" : ""}" data-drop-kind="timed" data-tech-id="${techId}" data-time="${time}">
            ${slotItems.map((item, index) => renderAppointment(item, index, slotItems.length, state.orientation)).join("")}
          </div>
        `);
      }
      return `${nowMarker}${slots.join("")}`;
    }

    function renderCurrentTimeMarker() {
      const position = currentTimePosition();
      if (position === null) return "";
      return `
        <div class="current-time-marker ${state.orientation}" style="--now-position:${position}%">
        </div>
      `;
    }

    function currentTimePosition() {
      if (!isTodaySelected()) return null;
      const now = new Date();
      const minutes = (now.getHours() * 60) + now.getMinutes();
      const start = calendarStartMinutes();
      const end = calendarEndMinutes();
      if (minutes < start || minutes > end) return null;
      return ((minutes - start) / (end - start)) * 100;
    }

    function currentTimeString() {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    }

    function centerCalendarOnCurrentTime(calendar) {
      const position = currentTimePosition();
      if (position === null) return;
      const grid = calendar.querySelector(".slot-grid");
      if (!grid) return;
      if (state.orientation === "vertical") {
        const targetLeft = (grid.scrollWidth * (position / 100)) - (calendar.clientWidth / 2);
        calendar.scrollLeft = Math.max(0, targetLeft);
        return;
      }
      const targetTop = (grid.scrollHeight * (position / 100)) - (calendar.clientHeight / 2);
      calendar.scrollTop = Math.max(0, targetTop);
    }

    function renderSmallEvent(item) {
      const ticket = tickets.find(entry => entry.id === item.ticketId);
      return `<div class="small-event ${appointmentClass(item, ticket)}" draggable="true" data-ticket-id="${item.ticketId}" data-appointment-id="${item.appointmentId || ""}" data-drag-source="scheduled" data-kind="${item.kind}">#${item.ticketId} ${escapeHtml(item.label || ticket?.title || "Task")}</div>`;
    }

    function renderAppointment(item, index = 0, count = 1, orientation = state.orientation) {
      const ticket = tickets.find(entry => entry.id === item.ticketId);
      const durationSlots = Math.max(1, Math.ceil((item.duration || 30) / 30));
      return `
        <div class="appointment ${count > 1 ? "overlap-card" : ""} ${appointmentClass(item, ticket)}" draggable="true" data-ticket-id="${item.ticketId}" data-appointment-id="${item.appointmentId || ""}" data-drag-source="scheduled" data-kind="timed" style="--overlap-count:${count};--overlap-index:${index};--duration-slots:${durationSlots};" title="${escapeHtml(item.label || ticket?.title || "Appointment")}">
          <strong>#${item.ticketId} ${escapeHtml(item.label || ticket?.title || "Appointment")}</strong>
          <span>${escapeHtml(formatTime(item.time))} - ${item.duration || 30}m</span>
        </div>
      `;
    }

    function sectionKey(index) {
      return `report-${index}`;
    }

    function applySavedSectionSizes() {
      Object.entries(state.sectionSizes).forEach(([key, height]) => {
        if (key === "pool") return;
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
          if (key === "pool") continue;
          const height = Math.round(entry.contentRect.height);
          if (height < 80) continue;
          state.sectionSizes[key] = height;
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
      if (key === "pool") return;
      const section = document.querySelector(`[data-resize-key="${key}"]`);
      if (!section) return;
      const startHeight = section.offsetHeight;
      handle.classList.add("active");

      function onMove(event) {
        const delta = event.clientY - startY;
        const min = 42;
        const max = Math.round(window.innerHeight * 0.7);
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
      if (key === "pool") return;
      state.sectionSizes[key] = height;
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
          clearTicketAttention(Number(card.dataset.ticketId), { render: false });
          card.classList.add("dragging");
          event.dataTransfer.setData("text/plain", card.dataset.ticketId);
          event.dataTransfer.setData("source", card.dataset.dragSource || "ticket");
        });
        card.addEventListener("click", () => {
          clearTicketAttention(Number(card.dataset.ticketId), { render: false });
          card.classList.remove("new-ticket-attention");
        });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        card.addEventListener("contextmenu", event => {
          event.preventDefault();
          event.stopPropagation();
          clearTicketAttention(Number(card.dataset.ticketId), { render: false });
          card.classList.remove("new-ticket-attention");
          showTicketPopover(Number(card.dataset.ticketId), event.clientX, event.clientY);
        });
        card.addEventListener("dblclick", event => {
          event.preventDefault();
          event.stopPropagation();
          clearTicketAttention(Number(card.dataset.ticketId), { render: false });
          card.classList.remove("new-ticket-attention");
          openTicketExternal(Number(card.dataset.ticketId));
        });
      });
    }

    function clearTicketAttention(ticketId, options = {}) {
      if (!attentionTicketIds.delete(Number(ticketId))) return;
      if (options.render === false) return;
      renderReportLists();
    }

    function handleTicketDrop(ticketId, techId, kind, time, source = "ticket") {
      const ticket = tickets.find(item => item.id === ticketId);
      if (!ticket) return;
      const tech = technicians.find(item => item.id === techId);
      if (kind === "timed") {
        if (source === "scheduled") {
          const scheduledItem = state.boardItems.find(entry => entry.ticketId === ticketId);
          if (scheduledItem?.kind === "noTime") {
            moveNoTimeToAppointment(ticketId, techId, time, "timed");
            return;
          }
          moveScheduledItem(ticketId, techId, time);
          return;
        }
        state.pendingAppointment = { ticketId, techId, time };
        openAppointmentModal(ticket, tech, time);
        return;
      }

      if (source === "scheduled") {
        const scheduledItem = state.boardItems.find(entry => entry.ticketId === ticketId);
        if (kind === "noTime" && !scheduledItem?.haloTicketId) {
          toast("Ticket required", "Calendar appointments without a ticket cannot be moved to the no-time section.");
          return;
        }
        if (kind === "noTime") {
          moveScheduledToNoTime(ticketId, techId);
          return;
        }
        if (scheduledItem?.kind === "noTime") {
          moveNoTimeToAppointment(ticketId, techId, null, kind);
          return;
        }
        moveScheduledItem(ticketId, techId, null, kind);
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

    async function moveScheduledToNoTime(ticketId, techId) {
      const item = state.boardItems.find(entry => entry.ticketId === ticketId);
      const ticket = tickets.find(entry => entry.id === ticketId);
      const tech = technicians.find(entry => entry.id === techId);
      if (!item || !ticket || !tech) return;
      const haloTicketId = item.haloTicketId || ticket.haloTicketId;
      if (!haloTicketId) {
        toast("Ticket required", "Calendar appointments without a ticket cannot be moved to the no-time section.");
        return;
      }

      removeBoardItem(ticketId);
      ticket.assignedTo = techId;
      ticket.dateField = selectedDate();
      state.boardItems.push({
        ticketId,
        haloTicketId,
        appointmentId: null,
        techId,
        kind: "noTime",
        label: item.label || ticket.title,
        date: selectedDate(),
        source: "haloDateOnly"
      });
      renderAll();

      const action = item.appointmentId ? "moveAppointmentToDateOnly" : "assignTicketDateOnly";
      const result = await callHalo(action, {
        appointmentId: item.appointmentId || null,
        ticketId: haloTicketId,
        technicianId: techId,
        dateFieldValue: selectedDate()
      });
      toast("Date-only task updated", `#${haloTicketId} assigned to ${tech.name} for ${selectedDate()}.`);
      if (result?.ok) {
        setTimeout(() => loadHaloAppointments({ quiet: true }), 800);
      }
    }

    async function moveNoTimeToAppointment(ticketId, techId, time, targetKind) {
      const item = state.boardItems.find(entry => entry.ticketId === ticketId);
      const ticket = tickets.find(entry => entry.id === ticketId);
      const tech = technicians.find(entry => entry.id === techId);
      if (!item || !ticket || !tech) return;
      const haloTicketId = item.haloTicketId || ticket.haloTicketId || ticket.id;
      const duration = targetKind === "timed" ? 30 : 1440;
      removeBoardItem(ticketId);
      ticket.assignedTo = techId;
      ticket.dateField = "";
      state.boardItems.push({
        ticketId,
        haloTicketId,
        techId,
        kind: targetKind,
        time: targetKind === "timed" ? time : undefined,
        duration,
        label: item.label || ticket.title,
        date: selectedDate(),
        source: "haloAppointment"
      });
      renderAll();

      const result = await callHalo("createAppointmentFromDateOnly", {
        ticketId: haloTicketId,
        technicianId: techId,
        date: selectedDate(),
        startTime: time,
        durationMinutes: targetKind === "timed" ? duration : 30,
        allday: targetKind === "allDay",
        dateFieldValue: "",
        assignTicket: true
      });
      const targetLabel = targetKind === "allDay" ? "all-day" : formatTime(time);
      toast("Appointment created", `#${haloTicketId} moved to ${targetLabel} for ${tech.name}.`);
      if (result?.ok) {
        setTimeout(() => loadHaloAppointments({ quiet: true }), 800);
      }
    }

    async function moveScheduledItem(ticketId, techId, time, targetKind = "timed") {
      const item = state.boardItems.find(entry => entry.ticketId === ticketId);
      const ticket = tickets.find(entry => entry.id === ticketId);
      const tech = technicians.find(entry => entry.id === techId);
      if (!item || !ticket || !tech) return;
      const haloTicketId = item.haloTicketId || ticket.haloTicketId || null;
      const previous = { techId: item.techId, time: item.time, kind: item.kind };
      const nextDuration = targetKind === "timed" && previous.kind === "allDay" ? 30 : item.duration || 30;
      item.techId = techId;
      item.kind = targetKind;
      item.time = targetKind === "timed" ? time : undefined;
      item.duration = nextDuration;
      item.date = selectedDate();
      ticket.assignedTo = techId;
      ticket.dateField = selectedDate();
      const result = await callHalo("updateAppointment", {
        ticketId: haloTicketId,
        previousTechnicianId: previous.techId,
        technicianId: techId,
        previousStartTime: previous.time || null,
        startTime: time,
        durationMinutes: nextDuration,
        appointmentId: item.appointmentId || null,
        date: $("boardDate").value,
        allday: targetKind === "allDay",
        assignTicket: previous.techId !== techId
      });
      const techChanged = previous.techId !== techId ? ` and assigned to ${tech.name}` : "";
      const targetLabel = targetKind === "allDay" ? "all-day" : formatTime(time);
      toast("Appointment updated", `#${ticketId} moved to ${targetLabel}${techChanged}.`);
      renderAll();
      if (result?.ok) {
        setTimeout(() => loadHaloAppointments({ quiet: true }), 800);
      }
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
      popover.style.setProperty("--ticket-popover-left", `${Math.max(16, left)}px`);
      popover.style.setProperty("--ticket-popover-top", `${Math.max(16, y)}px`);
      popover.innerHTML = `
        <strong>#${ticket.id} ${escapeHtml(ticket.title)}</strong>
        <span><b>Client:</b> ${escapeHtml(ticket.client)} - ${escapeHtml(ticket.site)}</span>
        <span><b>Contact:</b> ${escapeHtml(ticket.contact)}</span>
        <span><b>Type:</b> ${escapeHtml(ticket.type || "-")}</span>
        <span><b>Estimate:</b> ${escapeHtml(ticket.estimate || "-")}</span>
        <span><b>No-Time Date:</b> ${escapeHtml(ticket.dateField || "Not set")}</span>
        <span>${escapeHtml(ticket.details)}</span>
        <div class="ticket-popover-actions">
          <button type="button" id="popoverOpenTicket">Open Ticket</button>
        </div>
      `;
      popover.classList.add("open");
      const rect = popover.getBoundingClientRect();
      const adjustedTop = Math.min(Math.max(16, y), window.innerHeight - rect.height - 16);
      popover.style.setProperty("--ticket-popover-top", `${Math.max(16, adjustedTop)}px`);
      $("popoverOpenTicket").addEventListener("click", event => {
        event.stopPropagation();
        openTicketExternal(ticketId);
      });
    }

    function closeTicketPopover() {
      $("ticketPopover").classList.remove("open");
    }

    function openTicketExternal(ticketId = state.activeTicketId) {
      const ticket = tickets.find(item => item.id === ticketId);
      if (!ticket) return;
      closeTicketPopover();
      state.activeTicketId = ticketId;
      const url = ticketUrl(ticket);
      if (url.startsWith("http")) {
        window.open(url, "_blank", "noopener");
      } else {
        toast("Ticket URL pending", "The full HaloPSA URL can be added after testing.");
      }
    }

    function ticketUrl(ticket) {
      if (!state.apiBaseUrl) return `HaloPSA ticket URL pending for #${ticket.id}`;
      if (state.apiBaseUrl.includes("?id=") || state.apiBaseUrl.endsWith("=")) {
        return `${state.apiBaseUrl}${ticket.id}`;
      }
      return `${state.apiBaseUrl.replace(/\/$/, "")}/ticket?id=${ticket.id}`;
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
      if (!reports.length) {
        toast("No ticket views configured", "Ticket views will become configurable in the next filter pass.");
        return;
      }
      if (state.reportLists.length >= 5) {
        toast("List limit reached", "You can show up to 5 ticket lists.");
        return;
      }
      const next = reports.find(report => !state.reportLists.includes(report.id)) || reports[0];
      state.reportLists.push(next.id);
      setExpandedTicketList(sectionKey(state.reportLists.length - 1), true);
      resetReportListHeights();
      saveLocalSettings();
      renderReportLists();
    }

    function resetReportListHeights() {
      Object.keys(state.sectionSizes).forEach(key => {
        if (key.startsWith("report-")) delete state.sectionSizes[key];
      });
      saveLocalSettings();
    }

    function selectTeams(changedInput) {
      if (changedInput?.value === "__all") {
        state.selectedTeams = changedInput.checked ? teams.map(team => team.id) : [];
      } else {
        state.selectedTeams = Array.from($("settingsTeamPicker").querySelectorAll("input:checked"))
          .map(input => input.value)
          .filter(value => value !== "__all");
      }
      const filteredIds = new Set(filteredTechnicians().map(tech => tech.id));
      state.selectedTechs = state.selectedTechs.filter(id => filteredIds.has(id));
      if (state.selectedTeams.length && !state.selectedTechs.length) {
        state.selectedTechs = Array.from(filteredIds);
      }
      saveLocalSettings();
      renderTeamSelect();
      renderTechPicker();
      renderBoard();
      loadHaloAppointments();
    }

    function setOrientation(orientation) {
      state.orientation = orientation;
      state.shouldCenterNow = true;
      updateHeaderToggles();
      saveLocalSettings();
      renderBoard();
    }

    function shiftDate(days) {
      const date = new Date(`${$("boardDate").value}T00:00:00`);
      date.setDate(date.getDate() + days);
      $("boardDate").value = date.toISOString().slice(0, 10);
      state.shouldCenterNow = true;
      renderAll();
      loadHaloAppointments();
    }

    function saveApiSettings() {
      state.apiBaseUrl = $("apiBaseUrl").value.trim();
      state.apiProxyUrl = $("apiProxyUrl").value.trim();
      $("apiState").textContent = state.apiProxyUrl ? "HaloPSA Worker connected" : "HaloPSA mock mode";
      saveLocalSettings();
      resetAppointmentRefreshTimer();
      toast("Connection settings saved", state.apiProxyUrl || "Mock mode remains active until the Worker URL is added.");
      loadHaloTechnicians();
      loadHaloTicketTypes();
      loadHaloTickets();
    }

    async function loadHaloTechnicians() {
      if (!state.apiProxyUrl) return;
      const workerReady = await testWorkerConnection({ quiet: true });
      if (!workerReady) return;
      const result = await callHalo("loadTechnicians", {}, { quiet: true });
      let data = result?.data;
      if (!data?.technicians?.length) {
        data = await loadHaloTechniciansFromAgentEndpoint();
      }
      if (!data?.technicians?.length) {
        toast("Halo names not loaded", "No agents matched the selected teams and in_section rule.");
        return;
      }
      syncHaloTechnicians(data);
      renderTeamSelect();
      renderTechPicker();
      renderBoard();
      toast("Halo names loaded", `${data.technicians.length} agents are available for dispatch.`);
      loadHaloAppointments();
    }

    async function loadHaloTicketTypes() {
      if (!state.apiProxyUrl) return;
      const result = await callHalo("loadTicketTypes", {}, { quiet: true });
      if (!result?.ok) return;
      syncHaloTicketTypes(result.data?.ticketTypes || []);
      renderTicketTypeSelect();
    }

    function syncHaloTicketTypes(types) {
      ticketTypes.splice(0, ticketTypes.length, ...types.map(type => ({
        id: String(type.id),
        name: type.name || `Type ${type.id}`
      })));
      const validIds = new Set(ticketTypes.map(type => type.id));
      state.selectedTicketTypes = state.selectedTicketTypes.filter(id => validIds.has(String(id)));
      saveLocalSettings();
    }

    async function loadHaloTickets(options = {}) {
      if (!state.apiProxyUrl) {
        if (!options.quiet) toast("Worker URL missing", "Add the Cloudflare Worker URL in Settings first.");
        return;
      }
      const result = await callHalo("loadTickets", {
        ticketTypeIds: state.selectedTicketTypes
      }, { quiet: true });
      console.log("HaloPSA ticket load result", result?.meta || result);
      if (!result?.ok) return;
      syncHaloTickets(result.data?.tickets || []);
      renderReportLists();
      if (!options.quiet) {
        toast("Tickets loaded", `${result.data?.tickets?.length || 0} open tickets matched the current type filter.`);
      }
    }

    function syncHaloTickets(loadedTickets) {
      const hadKnownTickets = knownTicketIds.size > 0 || tickets.some(ticket => ticket.source === "haloTicket");
      for (let index = tickets.length - 1; index >= 0; index -= 1) {
        if (tickets[index].source === "haloTicket") tickets.splice(index, 1);
      }
      loadedTickets.forEach(ticket => {
        const normalized = normalizeHaloTicket(ticket);
        if (!normalized) return;
        if (hadKnownTickets && !knownTicketIds.has(Number(normalized.id))) {
          attentionTicketIds.add(Number(normalized.id));
        }
        knownTicketIds.add(Number(normalized.id));
        const existing = tickets.find(item => item.id === normalized.id);
        if (existing) {
          Object.assign(existing, normalized, {
            dateField: existing.dateField || normalized.dateField,
            assignedTo: existing.assignedTo || normalized.assignedTo,
            completed: existing.completed || normalized.completed
          });
          return;
        }
        tickets.push(normalized);
      });
    }

    function normalizeHaloTicket(ticket) {
      const id = Number(ticket.id || ticket.ticketId || ticket.haloTicketId);
      if (!id) return null;
      const assignedTech = technicians.find(tech => String(tech.id) === String(ticket.assignedTo));
      const apiTeamId = ticket.teamId || ticket.team_id || ticket.teamid || "";
      const apiTeamName = ticket.team || ticket.teamName || ticket.team_name || "";
      const fallbackTeamIds = [
        apiTeamId,
        ...(assignedTech?.teamIds || []),
        assignedTech?.teamId || ""
      ].map(String).filter(Boolean);
      return {
        id,
        client: ticket.client || "",
        title: ticket.title || `Ticket #${id}`,
        priority: ticket.priority || "",
        status: ticket.status || "",
        type: ticket.type || "",
        team: apiTeamName || assignedTech?.team || "",
        teamId: apiTeamId || assignedTech?.teamId || "",
        teamIds: Array.isArray(ticket.teamIds) ? ticket.teamIds.map(String) : Array.from(new Set(fallbackTeamIds)),
        serviceZone: ticket.serviceZone || "",
        report: "api-open",
        site: ticket.site || "",
        sla: ticket.sla || "",
        estimate: ticket.estimate || "",
        contact: ticket.contact || "",
        details: ticket.details || "",
        dateField: ticket.dateField || "",
        assignedTo: ticket.assignedTo || "",
        haloTicketId: ticket.haloTicketId || id,
        completed: Boolean(ticket.completed),
        source: "haloTicket"
      };
    }

    async function loadHaloAppointments(options = {}) {
      if (!state.apiProxyUrl || !state.selectedTechs.length) return;
      const result = await callHalo("loadAppointments", {
        date: selectedDate(),
        technicianIds: state.selectedTechs
      }, { quiet: true });
      console.log("HaloPSA appointment load result", result?.meta || result);
      if (!result?.ok) return;
      syncHaloAppointments(result.data?.appointments || []);
      loadHaloDateOnlyTasks({ quiet: true });
      renderBoard();
      console.log("HaloPSA board appointment sync", appointmentVisibilitySummary(result.data?.appointments || []));
      if (!options.quiet && result.data?.appointments?.length) {
        toast("Halo appointments loaded", `${result.data.appointments.length} calendar items matched this view.`);
      }
    }

    function resetAppointmentRefreshTimer() {
      if (state.appointmentRefreshTimer) {
        clearInterval(state.appointmentRefreshTimer);
        state.appointmentRefreshTimer = null;
      }
      if (!state.appointmentRefreshMinutes || state.appointmentRefreshMinutes < 1) return;

      state.appointmentRefreshTimer = setInterval(() => {
        loadHaloAppointments({ quiet: true });
      }, state.appointmentRefreshMinutes * 60000);
    }

    function resetCurrentTimeTimer() {
      if (state.currentTimeTimer) {
        clearInterval(state.currentTimeTimer);
      }
      state.currentTimeTimer = setInterval(() => {
        if (isTodaySelected()) renderBoard();
      }, 60000);
    }

    async function loadHaloDateOnlyTasks(options = {}) {
      if (!state.apiProxyUrl || !state.selectedTechs.length) return;
      const result = await callHalo("loadDateOnlyTasks", {
        date: selectedDate(),
        technicianIds: state.selectedTechs
      }, { quiet: true });
      console.log("HaloPSA date-only task load result", result?.meta || result);
      if (!result?.ok) return;
      syncHaloDateOnlyTasks(result.data?.tasks || [], result.data?.pastTasks || []);
      renderBoard();
      const taskCount = (result.data?.tasks?.length || 0) + (result.data?.pastTasks?.length || 0);
      if (!options.quiet && taskCount) {
        toast("Date-only tasks loaded", `${taskCount} without-time tickets matched this view.`);
      }
    }

    function syncHaloAppointments(appointments) {
      const visibleTechs = new Set(state.selectedTechs);
      state.boardItems = state.boardItems.filter(item => {
        const sameDate = isSelectedDate(item.date);
        const sameTech = visibleTechs.has(String(item.techId));
        return item.source !== "haloAppointment" || !sameDate || !sameTech;
      });

      appointments.forEach(appointment => {
        hydrateTicketFromAppointment(appointment);
        state.boardItems.push(appointment);
      });
    }

    function syncHaloDateOnlyTasks(tasks, pastTasks = []) {
      const visibleTechs = new Set(state.selectedTechs);
      state.boardItems = state.boardItems.filter(item => {
        const dateValue = String(item.date || "").slice(0, 10);
        const relevantDateOnlyDate = isSelectedDate(dateValue) || dateValue < selectedDate();
        const sameTech = visibleTechs.has(String(item.techId));
        const dateOnlyKind = item.kind === "noTime" || item.kind === "pastNoTime";
        return (item.source !== "haloDateOnly" && !dateOnlyKind) || !relevantDateOnlyDate || !sameTech;
      });

      const seen = new Set();
      const currentTasks = tasks.map(task => ({ ...task, kind: "noTime" }));
      const olderTasks = pastTasks.map(task => ({ ...task, kind: "pastNoTime" }));
      [...currentTasks, ...olderTasks].filter(task => !task.completed).forEach(task => {
        const key = `${task.ticketId}:${task.techId}:${task.date}`;
        if (seen.has(key)) return;
        seen.add(key);
        hydrateTicketFromDateOnlyTask(task);
        state.boardItems.push(task);
      });
    }

    function appointmentVisibilitySummary(appointments) {
      const visibleTechs = new Set(state.selectedTechs.map(String));
      const visibleAppointments = appointments.filter(item => visibleTechs.has(String(item.techId)) && isSelectedDate(item.date));
      return {
        received: appointments.length,
        visible: visibleAppointments.length,
        selectedDate: selectedDate(),
        selectedTechs: Array.from(visibleTechs),
        sample: appointments.slice(0, 5)
      };
    }

    function hydrateTicketFromAppointment(appointment) {
      if (tickets.some(ticket => ticket.id === appointment.ticketId)) return;
      tickets.push({
        id: appointment.ticketId,
        client: "",
        title: appointment.label || "Scheduled appointment",
        priority: "",
        type: "Appointment",
        report: "",
        site: "",
        sla: "",
        estimate: appointment.duration ? `${appointment.duration}m` : "",
        contact: "",
        details: appointment.label || "",
        dateField: appointment.date,
        assignedTo: appointment.techId,
        haloTicketId: appointment.haloTicketId || null,
        completed: appointment.completed
      });
    }

    function hydrateTicketFromDateOnlyTask(task) {
      const existing = tickets.find(ticket => ticket.id === task.ticketId);
      if (existing) {
        existing.dateField = task.date;
        existing.assignedTo = task.techId;
        existing.haloTicketId = task.haloTicketId || existing.haloTicketId;
        existing.completed = task.completed;
        return;
      }
      tickets.push({
        id: task.ticketId,
        client: "",
        title: task.label || "Date-only ticket",
        priority: "",
        type: "Date-only",
        report: "",
        site: "",
        sla: "",
        estimate: "",
        contact: "",
        details: task.label || "",
        dateField: task.date,
        assignedTo: task.techId,
        haloTicketId: task.haloTicketId || task.ticketId,
        completed: task.completed
      });
    }

    async function loadHaloTechniciansFromAgentEndpoint() {
      try {
        const result = await fetchWorkerJson("/api/halo/Agent");
        return normalizeHaloAgents(result.data || result);
      } catch (error) {
        console.error(error);
        toast("Halo technician load failed", friendlyFetchError(error));
        return null;
      }
    }

    function normalizeHaloAgents(data) {
      const agents = unwrapList(data);
      const teamMap = new Map();

      const matchedTechnicians = agents
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
            return String(team.team_id ?? team.id ?? "") && isTrue(team.in_section);
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
        technicians: matchedTechnicians,
        teams: Array.from(teamMap.values()).sort((a, b) => Number(a.id) - Number(b.id))
      };
    }

    function syncHaloTechnicians(data) {
      technicians.splice(0, technicians.length, ...data.technicians.map(tech => ({
        id: String(tech.id),
        name: tech.name || `Technician ${tech.id}`,
        teamId: String(tech.teamId || ""),
        team: tech.team || `Team ${tech.teamId || ""}`,
        teamIds: Array.isArray(tech.teamIds) && tech.teamIds.length ? tech.teamIds.map(String) : [String(tech.teamId || "")]
      })));

      teams.splice(0, teams.length, ...data.teams.map(team => ({
        id: String(team.id),
        name: team.name || `Team ${team.id}`
      })));

      const availableTeamIds = new Set(teams.map(team => team.id));
      state.selectedTeams = state.selectedTeams.filter(id => availableTeamIds.has(id));

      const filteredIds = new Set(filteredTechnicians().map(tech => tech.id));
      state.selectedTechs = state.selectedTechs.filter(id => filteredIds.has(id));
      if (state.selectedTeams.length && !state.selectedTechs.length) {
        state.selectedTechs = Array.from(filteredIds);
      }
      saveLocalSettings();
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

    function isTrue(value) {
      return value === true || String(value).toLowerCase() === "true";
    }

    function refreshReports() {
      loadHaloTickets();
    }

    async function testWorkerConnection(options = {}) {
      if (!state.apiProxyUrl) {
        if (!options.quiet) toast("Worker URL missing", "Add the Cloudflare Worker URL in Settings first.");
        return false;
      }

      try {
        const result = await fetchWorkerJson("/api/health");
        const ok = result?.ok === true && result?.service === "halo-dispatch-api";
        if (!ok) {
          throw new Error("The URL responded, but it does not look like the Halo Dispatch Worker.");
        }
        $("apiState").textContent = "HaloPSA Worker connected";
        if (!options.quiet) toast("Worker connected", "Cloudflare Worker health check passed.");
        return true;
      } catch (error) {
        $("apiState").textContent = "Worker connection failed";
        if (!options.quiet) toast("Worker connection failed", friendlyFetchError(error));
        return false;
      }
    }

    async function callHalo(action, payload, options = {}) {
      const request = {
        action,
        proxyUrl: state.apiProxyUrl || "(mock)",
        payload,
        timestamp: new Date().toISOString()
      };
      console.log("HaloPSA action", request);
      if (!state.apiProxyUrl) return request;

      try {
        return await fetchWorkerJson("/api/halo/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request)
        });
      } catch (error) {
        console.error(error);
        if (!options.quiet) toast("HaloPSA API error", friendlyFetchError(error));
        return { ok: false, error: error.message, request };
      }
    }

    async function fetchWorkerJson(path, options = {}) {
      const response = await fetch(`${workerBaseUrl()}${path}`, options);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || result.message || `HaloPSA proxy returned ${response.status}`);
      }
      return result;
    }

    function workerBaseUrl() {
      const url = state.apiProxyUrl.trim().replace(/\/$/, "");
      if (!/^https?:\/\//i.test(url)) {
        throw new Error("Worker URL must start with https://");
      }
      return url;
    }

    function friendlyFetchError(error) {
      if (error.message === "Failed to fetch") {
        return "Unable to reach the Worker URL. Confirm the saved Worker API URL is the workers.dev URL, not the GitHub Pages URL, and that the Worker is deployed.";
      }
      return error.message;
    }

    function renderAll() {
      closeZoneModal();
      closeTicketPopover();
      renderReportLists();
      renderBoard();
    }

    function removeBoardItem(ticketId) {
      const index = state.boardItems.findIndex(item => item.ticketId === ticketId);
      if (index >= 0) state.boardItems.splice(index, 1);
    }

    function isTicketScheduled(ticketId) {
      return state.boardItems.some(item => item.ticketId === ticketId);
    }

    function shouldShowTicketCard(ticket) {
      if (ticket.dateField && !isSelectedDate(ticket.dateField)) return false;
      return !isTicketScheduled(ticket.id);
    }

    function isSelectedDate(value) {
      return String(value || "").slice(0, 10) === selectedDate();
    }

    function slotForTime(time) {
      const [hour, minute] = String(time || "00:00").split(":").map(Number);
      const slotMinute = minute >= 30 ? 30 : 0;
      return `${String(hour || 0).padStart(2, "0")}:${String(slotMinute).padStart(2, "0")}`;
    }

    function selectedDate() {
      return $("boardDate").value;
    }

    function isTodaySelected() {
      return selectedDate() === new Date().toISOString().slice(0, 10);
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
      if (ticket.completed) return "color-completed";
      if (state.colorBy === "priority") return `color-${ticket.priority.toLowerCase()}`;
      if (state.colorBy === "type") return `color-type-${ticket.type.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
      return `color-sla-${slaBucket(ticket.sla)}`;
    }

    function appointmentClass(item, ticket) {
      if (item.completed || ticket?.completed) return "color-completed";
      if (!item.haloTicketId) return "color-ticketless";
      return ticketColorClass(ticket);
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
