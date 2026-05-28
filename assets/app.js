/*
 * Halo Dispatch Board frontend.
 *
 * The browser owns presentation state, drag/drop state, and user preferences.
 * Halo writes and credentialed reads go through the Cloudflare Worker; do not
 * add Halo secrets or direct OAuth flows to this file.
 */
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
    const debugEnabled = new URLSearchParams(window.location.search).get("debug") === "true"
      || localStorage.getItem("dispatchBoardDebug") === "true";
    const DEFAULT_WORKER_API_URL = "https://halo-dispatch-api.chadbrewyet.workers.dev";

    const state = {
      selectedTeams: [],
      selectedTechs: [],
      selectedTicketTypes: [],
      orientation: "horizontal",
      reportLists: ["api-open"],
      visibleFields: ["ticketNumber", "summary"],
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
      currentAgentId: "",
      activeTechEditId: null,
      techThemes: {},
      collapsedTechGroups: {},
      noTimeTaskOrder: {},
      sectionSizes: {},
      ticketPanelPinned: false,
      ticketPanelOpen: false,
      ticketPanelWidth: 360,
      apiBaseUrl: "https://gagepsa.halopsa.com/ticket?id=",
      apiProxyUrl: DEFAULT_WORKER_API_URL,
      mockMode: false,
      appointmentRefreshMinutes: 5,
      appointmentRefreshTimer: null,
      ticketRefreshMinutes: 2,
      ticketRefreshTimer: null,
      currentTimeTimer: null,
      appointmentCache: {},
      appointmentCacheTtlMs: 120000,
      appointmentPrefetchDays: 2,
      prefetchingAppointments: false,
      calendarLoadingDates: {},
      haloStorageLoaded: false,
      haloStorageSaveTimer: null,
      loadingHaloStorage: false,
      shouldCenterNow: true,
      calendarScroll: {},
      pendingAppointment: null,
      activeTicketId: null,
      boardItems: []
    };

    const fieldOptions = [
      { key: "ticketNumber", label: "Ticket #" },
      { key: "summary", label: "Summary" },
      { key: "client", label: "Client" },
      { key: "site", label: "Site" },
      { key: "contact", label: "Contact" },
      { key: "type", label: "Ticket Type" },
      { key: "sla", label: "SLO Time Remaining" },
      { key: "priority", label: "Priority" }
    ];

    const listFilterFieldOptions = [
      { key: "assignedTo", label: "Tech Assigned", type: "category" },
      { key: "team", label: "Team", type: "category" },
      { key: "status", label: "Status", type: "category" },
      { key: "type", label: "Ticket Type", type: "category" },
      { key: "serviceZone", label: "Service Zone", type: "category" },
      { key: "priority", label: "Priority", type: "category" },
      { key: "client", label: "Client", type: "category" },
      { key: "site", label: "Site", type: "category" },
      { key: "contact", label: "Contact", type: "category" },
      { key: "dateOpened", label: "Date Opened", type: "date" },
      { key: "dateField", label: "No-Time Task Date", type: "date" },
      { key: "estimate", label: "Estimate", type: "number" }
    ];

    const $ = (id) => document.getElementById(id);

    async function init() {
      document.body.classList.add("booting");
      $("boardDate").value = todayDateKey();
      state.boardItems.forEach(item => {
        if (!item.date) item.date = $("boardDate").value;
        const ticket = tickets.find(entry => entry.id === item.ticketId);
        if (ticket && !ticket.dateField) ticket.dateField = item.date;
      });
      loadLocalSettings();
      applyIframeParams();
      applyConnectionState();
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
      resetTicketRefreshTimer();
      resetCurrentTimeTimer();
      try {
        await loadInitialHaloState();
        toast("Ready", state.mockMode ? "Dispatch board loaded in mock mode." : "Dispatch board connected to HaloPSA.");
      } finally {
        setLoadingMessage("Opening board...");
        renderAll();
        document.body.classList.remove("booting");
      }
    }

    async function loadInitialHaloState() {
      setLoadingMessage(state.mockMode ? "Starting mock mode..." : "Loading saved preferences...");
      await loadHaloStorage({ quiet: true, skipReload: true });
      setLoadingMessage("Loading Halo agents...");
      await loadHaloTechnicians({ quiet: true, skipAppointments: true });
      setLoadingMessage("Loading ticket types...");
      await loadHaloTicketTypes();
      setLoadingMessage("Loading service tickets...");
      await loadHaloTickets({ quiet: true });
      setLoadingMessage("Loading calendars...");
      await loadHaloAppointments({ quiet: true });
    }

    function setLoadingMessage(message) {
      const element = $("loadingMessage");
      if (element) element.textContent = message;
    }

    function bindEvents() {
      $("addListBtn").addEventListener("pointerdown", event => event.stopPropagation());
      $("addListBtn").addEventListener("click", event => {
        event.stopPropagation();
        addReportList();
      });
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
      $("pinTicketPanelBtn").addEventListener("pointerdown", event => event.stopPropagation());
      $("pinTicketPanelBtn").addEventListener("click", event => {
        event.stopPropagation();
        toggleTicketPanelPin();
      });
      $("ticketPanelResizer").addEventListener("pointerdown", startTicketPanelResize);
      $("prevDay").addEventListener("click", () => shiftDate(-1));
      $("nextDay").addEventListener("click", () => shiftDate(1));
      $("todayBtn").addEventListener("click", () => {
        $("boardDate").value = todayDateKey();
        state.shouldCenterNow = true;
        renderAll();
        loadHaloAppointments({ showLoading: true });
      });
      $("boardDate").addEventListener("change", () => {
        state.shouldCenterNow = true;
        renderAll();
        loadHaloAppointments({ showLoading: true });
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
      $("mockModeCheck").addEventListener("change", () => {
        state.mockMode = $("mockModeCheck").checked;
        applyConnectionState();
        saveApiSettings();
      });
      $("appointmentRefreshSelect").addEventListener("change", () => {
        state.appointmentRefreshMinutes = Number($("appointmentRefreshSelect").value);
        saveLocalSettings();
        resetAppointmentRefreshTimer();
      });
      $("ticketRefreshSelect").addEventListener("change", () => {
        state.ticketRefreshMinutes = Number($("ticketRefreshSelect").value);
        saveLocalSettings();
        resetTicketRefreshTimer();
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
      $("filterIncludeAssignedCheck").addEventListener("change", () => {
        if (state.draftFilter) state.draftFilter.includeAssigned = $("filterIncludeAssignedCheck").checked;
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
        if (saved.visibleFields) state.visibleFields = normalizeVisibleFields(saved.visibleFields);
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
        if (Array.isArray(saved.ticketLists) && saved.ticketLists.length) {
          applyTicketListPayload(saved.ticketLists);
        } else if (Array.isArray(saved.reportLists) && saved.reportLists.length) {
          state.reportLists = saved.reportLists;
        }
        if (saved.orientation === "vertical" || saved.orientation === "horizontal") state.orientation = saved.orientation;
        if (!Array.isArray(saved.ticketLists) || !saved.ticketLists.length) {
          if (saved.listViews) state.listViews = { ...state.listViews, ...saved.listViews };
          if (saved.collapsedLists) state.collapsedLists = saved.collapsedLists;
          if (saved.listFilters) state.listFilters = saved.listFilters;
        }
        normalizeTicketListState();
        if (saved.savedFilters) state.savedFilters = saved.savedFilters;
        if (saved.selectedListFilterFields) state.selectedListFilterFields = saved.selectedListFilterFields;
        if (saved.techThemes) state.techThemes = saved.techThemes;
        if (saved.openFilterFields) state.openFilterFields = saved.openFilterFields;
        if (saved.collapsedTechGroups) state.collapsedTechGroups = saved.collapsedTechGroups;
        if (saved.noTimeTaskOrder) state.noTimeTaskOrder = saved.noTimeTaskOrder;
        normalizeNoTimeTaskOrder();
        if (saved.sectionSizes) state.sectionSizes = saved.sectionSizes;
        if (saved.ticketPanelPinned !== undefined) state.ticketPanelPinned = Boolean(saved.ticketPanelPinned);
        if (saved.ticketPanelWidth) state.ticketPanelWidth = Number(saved.ticketPanelWidth);
        state.ticketPanelOpen = state.ticketPanelPinned;
        if (saved.appointmentRefreshMinutes !== undefined) {
          state.appointmentRefreshMinutes = Number(saved.appointmentRefreshMinutes);
        }
        if (saved.ticketRefreshMinutes !== undefined) {
          state.ticketRefreshMinutes = Number(saved.ticketRefreshMinutes);
        }
        if (Array.isArray(saved.selectedTicketTypes)) state.selectedTicketTypes = saved.selectedTicketTypes.map(String);
        if (saved.selectionDefaultsVersion >= 1 && Array.isArray(saved.selectedTeams)) state.selectedTeams = saved.selectedTeams.map(String);
        if (saved.selectionDefaultsVersion >= 1 && Array.isArray(saved.selectedTechs)) state.selectedTechs = saved.selectedTechs.map(String);
        $("appointmentRefreshSelect").value = String(state.appointmentRefreshMinutes);
        $("ticketRefreshSelect").value = String(state.ticketRefreshMinutes);
        if (saved.apiBaseUrl) state.apiBaseUrl = saved.apiBaseUrl;
        $("apiBaseUrl").value = state.apiBaseUrl;
        if (saved.apiProxyUrl !== undefined) state.apiProxyUrl = saved.apiProxyUrl || DEFAULT_WORKER_API_URL;
        if (saved.mockMode !== undefined) state.mockMode = Boolean(saved.mockMode);
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
        ticketLists: ticketListPayload(),
        reportLists: state.reportLists,
        listViews: state.listViews,
        collapsedLists: state.collapsedLists,
        listFilters: state.listFilters,
        savedFilters: state.savedFilters,
        selectedListFilterFields: state.selectedListFilterFields,
        techThemes: state.techThemes,
        openFilterFields: state.openFilterFields,
        collapsedTechGroups: state.collapsedTechGroups,
        noTimeTaskOrder: state.noTimeTaskOrder,
        sectionSizes: state.sectionSizes,
        ticketPanelPinned: state.ticketPanelPinned,
        ticketPanelWidth: state.ticketPanelWidth,
        apiBaseUrl: state.apiBaseUrl,
        apiProxyUrl: state.apiProxyUrl,
        mockMode: state.mockMode,
        appointmentRefreshMinutes: state.appointmentRefreshMinutes,
        ticketRefreshMinutes: state.ticketRefreshMinutes,
        selectedTeams: state.selectedTeams,
        selectedTechs: state.selectedTechs,
        selectedTicketTypes: state.selectedTicketTypes,
        selectionDefaultsVersion: 1
      }));
      scheduleHaloPreferenceSave();
    }

    function dispatchPreferencePayload() {
      state.visibleFields = normalizeVisibleFields(state.visibleFields);
      return {
        visibleFields: state.visibleFields,
        colorBy: state.colorBy,
        show24Hours: state.show24Hours,
        calendarStartTime: state.calendarStartTime,
        calendarEndTime: state.calendarEndTime,
        theme: state.theme,
        orientation: state.orientation,
        ticketLists: ticketListPayload(),
        reportLists: state.reportLists,
        listViews: state.listViews,
        collapsedLists: state.collapsedLists,
        listFilters: state.listFilters,
        selectedListFilterFields: state.selectedListFilterFields,
        techThemes: state.techThemes,
        collapsedTechGroups: state.collapsedTechGroups,
        noTimeTaskOrder: state.noTimeTaskOrder,
        sectionSizes: state.sectionSizes,
        ticketPanelPinned: state.ticketPanelPinned,
        ticketPanelWidth: state.ticketPanelWidth,
        appointmentRefreshMinutes: state.appointmentRefreshMinutes,
        ticketRefreshMinutes: state.ticketRefreshMinutes,
        selectedTeams: state.selectedTeams,
        selectedTechs: state.selectedTechs,
        selectedTicketTypes: state.selectedTicketTypes,
        selectionDefaultsVersion: 1
      };
    }

    function ticketListPayload() {
      normalizeTicketListState();
      return state.reportLists.slice(0, 5).map((reportId, index) => {
        const key = sectionKey(index);
        return {
          reportId,
          collapsed: Boolean(state.collapsedLists[key]),
          filter: normalizeFilterShape(ensureListFilter(key))
        };
      });
    }

    function applyTicketListPayload(ticketLists = []) {
      const lists = ticketLists.slice(0, 5);
      state.reportLists = lists.map(list => list.reportId || "api-open");
      state.listViews = {};
      state.collapsedLists = {};
      state.listFilters = {};
      lists.forEach((list, index) => {
        const key = sectionKey(index);
        state.collapsedLists[key] = Boolean(list.collapsed);
        state.listFilters[key] = normalizeFilterShape(list.filter || {});
      });
      normalizeTicketListState();
    }

    function normalizeTicketListState() {
      if (!Array.isArray(state.reportLists)) state.reportLists = [];
      const filterIndexes = Object.keys(state.listFilters || {})
        .map(key => Number((key.match(/^report-(\d+)$/) || [])[1]))
        .filter(index => Number.isInteger(index) && index >= 0);
      const requiredLength = Math.min(5, Math.max(state.reportLists.length, filterIndexes.length ? Math.max(...filterIndexes) + 1 : 0));
      while (state.reportLists.length < requiredLength) state.reportLists.push("api-open");
      state.reportLists = state.reportLists.slice(0, 5);
      state.reportLists.forEach((reportId, index) => {
        const key = sectionKey(index);
        if (!state.listFilters[key]) state.listFilters[key] = normalizeFilterShape({});
      });
    }

    function applyDispatchPreferencePayload(preferences = {}) {
      const keepConnection = {
        apiBaseUrl: state.apiBaseUrl,
        apiProxyUrl: state.apiProxyUrl,
        mockMode: state.mockMode,
        currentAgentId: state.currentAgentId
      };
      Object.assign(state, preferences, keepConnection);
      state.visibleFields = normalizeVisibleFields(preferences.visibleFields);
      normalizeNoTimeTaskOrder();
      if (Array.isArray(preferences.ticketLists) && preferences.ticketLists.length) {
        applyTicketListPayload(preferences.ticketLists);
      } else {
        if (Array.isArray(preferences.reportLists)) state.reportLists = preferences.reportLists.slice(0, 5);
        if (preferences.listFilters && typeof preferences.listFilters === "object") state.listFilters = preferences.listFilters;
        if (preferences.collapsedLists && typeof preferences.collapsedLists === "object") state.collapsedLists = preferences.collapsedLists;
        normalizeTicketListState();
      }
      if (technicians.length) ensureSelectedTechnicians();
      $("colorBySelect").value = state.colorBy;
      $("show24HoursCheck").checked = state.show24Hours;
      $("calendarStartTime").value = state.calendarStartTime;
      $("calendarEndTime").value = state.calendarEndTime;
      $("appointmentRefreshSelect").value = String(state.appointmentRefreshMinutes);
      $("ticketRefreshSelect").value = String(state.ticketRefreshMinutes);
      updateWorkingHours();
      applyTheme();
      renderTeamSelect();
      renderTechPicker();
      renderTicketTypeSelect();
      renderListFilterFieldPicker();
      renderDeleteFilterSelect();
      renderFieldChecks();
      renderReportLists();
      renderBoard();
      resetAppointmentRefreshTimer();
      resetTicketRefreshTimer();
    }

    function normalizeNoTimeTaskOrder() {
      if (!state.noTimeTaskOrder || typeof state.noTimeTaskOrder !== "object" || Array.isArray(state.noTimeTaskOrder)) {
        state.noTimeTaskOrder = {};
      }
    }

    function hydrateListFiltersFromSavedFilters() {
      Object.entries(state.listFilters || {}).forEach(([key, filter]) => {
        const saved = state.savedFilters?.[filter?.name];
        if (!saved) return;
        const currentConditions = filterConditions(filter);
        if (currentConditions.length) return;
        state.listFilters[key] = normalizeFilterShape({
          ...saved,
          name: saved.name || filter.name,
          title: saved.title || filter.title || saved.name || filter.name
        });
      });
    }

    function currentStorageAgentId() {
      return String(state.currentAgentId || "").trim();
    }

    function effectiveWorkerUrl() {
      return state.mockMode ? "" : (state.apiProxyUrl || DEFAULT_WORKER_API_URL);
    }

    function applyConnectionState() {
      if (!state.apiProxyUrl) state.apiProxyUrl = DEFAULT_WORKER_API_URL;
      $("apiProxyUrl").value = state.apiProxyUrl;
      $("mockModeCheck").checked = state.mockMode;
      $("apiState").textContent = state.mockMode ? "HaloPSA mock mode" : "HaloPSA Worker connected";
      $("apiProxyUrl").disabled = state.mockMode;
      $("testWorkerBtn").disabled = state.mockMode;
    }

    function ensureSelectedTechnicians() {
      const technicianIds = new Set(technicians.map(tech => tech.id));
      state.selectedTechs = state.selectedTechs.map(String).filter(id => technicianIds.has(id));
      if (state.selectedTechs.length) return;

      const viewerTech = technicians.find(tech => String(tech.id) === currentStorageAgentId());
      if (viewerTech) {
        const viewerTeamIds = (Array.isArray(viewerTech.teamIds) && viewerTech.teamIds.length ? viewerTech.teamIds : [viewerTech.teamId]).map(String).filter(Boolean);
        if (!state.selectedTeams.length) state.selectedTeams = viewerTeamIds;
        state.selectedTechs = [viewerTech.id];
        return;
      }

      const filteredIds = filteredTechnicians().map(tech => tech.id);
      if (state.selectedTeams.length && filteredIds.length) state.selectedTechs = filteredIds;
      if (!state.selectedTechs.length && technicians.length) state.selectedTechs = technicians.map(tech => tech.id);
    }

    function scheduleHaloPreferenceSave() {
      if (!state.haloStorageLoaded || state.loadingHaloStorage || !effectiveWorkerUrl() || !currentStorageAgentId()) return;
      clearTimeout(state.haloStorageSaveTimer);
      state.haloStorageSaveTimer = setTimeout(() => {
        saveHaloUserPreferences({ quiet: true });
      }, 1200);
    }

    function applyIframeParams() {
      const params = new URLSearchParams(window.location.search);
      const viewerAgentIds = splitParamList(params.get("viewer_agent_id") || params.get("current_agent_id") || params.get("dispatch_agent_id"));

      if (viewerAgentIds.length) state.currentAgentId = viewerAgentIds[0];
    }

    function splitParamList(value) {
      return String(value || "")
        .split(",")
        .map(entry => entry.trim())
        .filter(Boolean);
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
      deleteHaloSavedFilter(name);
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
      state.visibleFields = normalizeVisibleFields(state.visibleFields);
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

    function normalizeVisibleFields(fields) {
      const allowed = new Set(fieldOptions.map(option => option.key));
      const source = Array.isArray(fields) ? fields : ["ticketNumber", "summary"];
      const mapped = source
        .map(field => field === "title" ? "summary" : field)
        .filter(field => allowed.has(field));
      const normalized = Array.from(new Set(mapped));
      if (!normalized.length) return ["ticketNumber", "summary"];
      if (source.includes("estimate")) {
        return Array.from(new Set(["ticketNumber", "summary", ...normalized]));
      }
      return normalized;
    }

    function renderReportLists() {
      if (!reports.length) {
        $("reportLists").innerHTML = `<div class="empty">No ticket lists configured yet.</div>`;
        updateTicketPanelBadges([]);
        return;
      }
      if (!state.reportLists.length) {
        $("reportLists").className = "report-lists expanded-count-0";
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
        button.addEventListener("click", event => {
          event.stopPropagation();
          removeTicketList(Number(button.dataset.index));
        });
      });
      wireTicketListReordering();
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

    function removeTicketList(index) {
      const lists = ticketListPayload();
      lists.splice(index, 1);
      applyTicketListPayload(lists);
      resetReportListHeights();
      saveLocalSettings();
      saveHaloUserPreferences({ quiet: true });
      renderReportLists();
    }

    function wireTicketListReordering() {
      $("reportLists").querySelectorAll("[data-list-drag-index]").forEach(header => {
        header.addEventListener("dragstart", event => {
          if (event.target.closest(".report-actions, button, input, select, details, a")) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData("ticket-list-index", header.dataset.listDragIndex);
          event.dataTransfer.effectAllowed = "move";
        });
      });
      $("reportLists").querySelectorAll("[data-report-list-index]").forEach(list => {
        list.addEventListener("dragover", event => {
          if (!event.dataTransfer.types.includes("ticket-list-index")) return;
          event.preventDefault();
          list.classList.add("list-over");
        });
        list.addEventListener("dragleave", () => list.classList.remove("list-over"));
        list.addEventListener("drop", event => {
          const fromIndex = Number(event.dataTransfer.getData("ticket-list-index"));
          const toIndex = Number(list.dataset.reportListIndex);
          if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
          event.preventDefault();
          list.classList.remove("list-over");
          reorderTicketLists(fromIndex, toIndex);
        });
      });
    }

    function reorderTicketLists(fromIndex, toIndex) {
      if (fromIndex === toIndex) return;
      const lists = ticketListPayload();
      const [moved] = lists.splice(fromIndex, 1);
      if (!moved) return;
      lists.splice(toIndex, 0, moved);
      applyTicketListPayload(lists);
      saveLocalSettings();
      saveHaloUserPreferences({ quiet: true });
      renderReportLists();
    }

    function renderReportList(reportId, index) {
      const report = reports.find(item => item.id === reportId) || reports[0];
      const listTickets = filteredTicketsForList(reportId, index);
      const key = sectionKey(index);
      const collapsed = Boolean(state.collapsedLists[key]);
      const listFilter = ensureListFilter(key);
      const title = listFilter.title || listFilter.name || report.name;
      const themeStyle = listThemeStyle(listFilter.color);
      const hasAttention = listTickets.some(ticket => attentionTicketIds.has(Number(ticket.id)));
      return `
        <section class="report-list ${collapsed ? "collapsed" : ""} ${hasAttention ? "has-new-ticket" : ""}" data-report-list-index="${index}" ${themeStyle}>
          <header data-list-header="${key}" data-list-drag-index="${index}" draggable="true" title="${collapsed ? "Expand list" : "Collapse list"}">
            <div class="report-name">${escapeHtml(title)} <span class="count-badge" title="${listTickets.length} open tickets">${listTickets.length}</span></div>
            <div class="report-actions">
              <button class="icon" data-filter-toggle="${key}" title="Edit ticket list">${pencilIconSvg()}</button>
              <button class="icon danger-icon" data-remove-list data-index="${index}" title="Remove list">x</button>
            </div>
            <div class="report-meta">
              ${state.openFilterMenu === key ? renderTicketFilterMenu(key) : ""}
            </div>
          </header>
          <div class="ticket-stack card-view">
            ${listTickets.length ? listTickets.map(ticket => renderTicketCard(ticket, !collapsed)).join("") : `<div class="empty">No tickets in this list.</div>`}
          </div>
        </section>
      `;
    }

    function filteredTicketsForList(reportId, index) {
      const report = reports.find(item => item.id === reportId) || reports[0];
      const key = sectionKey(index);
      const filter = ensureListFilter(key);
      const activeConditions = filterConditions(filter).filter(conditionActive);
      return tickets.filter(ticket => {
        if (ticket.report !== report.id) return false;
        if (!filter.includeAssigned && !shouldShowTicketCard(ticket)) return false;
        if (!activeConditions.length) return true;
        return activeConditions.reduce((matches, condition, index) => {
          const conditionMatches = ticketMatchesCondition(ticket, condition);
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
        operator: defaultOperatorForField(field),
        values: values || []
      }));
    }

    function defaultCondition() {
      const field = availableFilterFieldOptions()[0]?.key || "assignedTo";
      return { joiner: "and", mode: "include", field, operator: defaultOperatorForField(field), values: [], value: "", valueEnd: "" };
    }

    function filterFieldConfig(field) {
      return listFilterFieldOptions.find(item => item.key === field) || { key: field, label: field, type: "category" };
    }

    function availableFilterFieldOptions(currentField = "") {
      const selected = state.selectedListFilterFields.length ? state.selectedListFilterFields : listFilterFieldOptions.map(field => field.key);
      const allowed = new Set(selected);
      if (currentField) allowed.add(currentField);
      return listFilterFieldOptions.filter(field => allowed.has(field.key));
    }

    function visibleFilterPickerFields(filter) {
      const fields = new Set(state.selectedListFilterFields);
      filterConditions(filter).forEach(condition => {
        if (condition.field) fields.add(condition.field);
      });
      Object.keys(filter.values || {}).forEach(field => fields.add(field));
      return Array.from(fields);
    }

    function filterFieldType(field) {
      return filterFieldConfig(field).type || "category";
    }

    function defaultOperatorForField(field) {
      const type = filterFieldType(field);
      if (type === "date") return "on";
      if (type === "number") return "eq";
      return "any";
    }

    function conditionActive(condition) {
      const type = filterFieldType(condition.field);
      if (type === "category") return Array.isArray(condition.values) && condition.values.length > 0;
      if (["empty", "notEmpty"].includes(condition.operator)) return true;
      if (type === "date" && relativeDateOperators().includes(condition.operator)) {
        if (condition.operator === "lastDays" || condition.operator === "nextDays") return Number(condition.value || 7) > 0;
        return true;
      }
      if (condition.operator === "between") return Boolean(condition.value && condition.valueEnd);
      return condition.value !== undefined && condition.value !== null && String(condition.value).trim() !== "";
    }

    function ticketMatchesCondition(ticket, condition) {
      const type = filterFieldType(condition.field);
      let matches = false;
      if (type === "date") {
        matches = dateConditionMatches(ticketFilterValue(ticket, condition.field), condition);
      } else if (type === "number") {
        matches = numberConditionMatches(ticketFilterValue(ticket, condition.field), condition);
      } else {
        const selected = (condition.values || []).map(String);
        const hasValue = ticketFilterValues(ticket, condition.field).some(value => selected.includes(String(value)));
        matches = condition.operator === "none" ? !hasValue : hasValue;
      }
      return condition.mode === "exclude" ? !matches : matches;
    }

    function dateConditionMatches(rawValue, condition) {
      const dateValue = normalizeDateValue(rawValue);
      if (condition.operator === "empty") return !dateValue;
      if (condition.operator === "notEmpty") return Boolean(dateValue);
      if (!dateValue) return false;
      const relativeRange = relativeDateRange(condition);
      if (relativeRange) return dateValue >= relativeRange.start && dateValue <= relativeRange.end;
      const compareValue = normalizeDateValue(condition.value);
      const compareEnd = normalizeDateValue(condition.valueEnd);
      if (!compareValue) return false;
      if (condition.operator === "before") return dateValue < compareValue;
      if (condition.operator === "after") return dateValue > compareValue;
      if (condition.operator === "onOrBefore") return dateValue <= compareValue;
      if (condition.operator === "onOrAfter") return dateValue >= compareValue;
      if (condition.operator === "between") return Boolean(compareEnd) && dateValue >= compareValue && dateValue <= compareEnd;
      return dateValue === compareValue;
    }

    function relativeDateOperators() {
      return ["today", "yesterday", "tomorrow", "thisWeek", "thisMonth", "lastDays", "nextDays"];
    }

    function relativeDateRange(condition) {
      if (!relativeDateOperators().includes(condition.operator)) return null;
      const today = startOfLocalDay(new Date());
      if (condition.operator === "today") return singleDateRange(today);
      if (condition.operator === "yesterday") return singleDateRange(addDays(today, -1));
      if (condition.operator === "tomorrow") return singleDateRange(addDays(today, 1));
      if (condition.operator === "thisWeek") {
        const start = addDays(today, -today.getDay());
        return { start: localDateKey(start), end: localDateKey(addDays(start, 6)) };
      }
      if (condition.operator === "thisMonth") {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return { start: localDateKey(start), end: localDateKey(end) };
      }
      const dayCount = Math.max(1, Math.min(365, Number(condition.value || 7)));
      if (condition.operator === "lastDays") return { start: localDateKey(addDays(today, -(dayCount - 1))), end: localDateKey(today) };
      if (condition.operator === "nextDays") return { start: localDateKey(today), end: localDateKey(addDays(today, dayCount - 1)) };
      return null;
    }

    function singleDateRange(date) {
      const key = localDateKey(date);
      return { start: key, end: key };
    }

    function startOfLocalDay(date) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function addDays(date, days) {
      const copy = new Date(date);
      copy.setDate(copy.getDate() + days);
      return copy;
    }

    function localDateKey(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    function numberConditionMatches(rawValue, condition) {
      const numberValue = Number(rawValue);
      const compareValue = Number(condition.value);
      const compareEnd = Number(condition.valueEnd);
      if (condition.operator === "empty") return rawValue === "" || rawValue === undefined || rawValue === null;
      if (condition.operator === "notEmpty") return !(rawValue === "" || rawValue === undefined || rawValue === null);
      if (!Number.isFinite(numberValue) || !Number.isFinite(compareValue)) return false;
      if (condition.operator === "lt") return numberValue < compareValue;
      if (condition.operator === "gt") return numberValue > compareValue;
      if (condition.operator === "lte") return numberValue <= compareValue;
      if (condition.operator === "gte") return numberValue >= compareValue;
      if (condition.operator === "between") return Number.isFinite(compareEnd) && numberValue >= compareValue && numberValue <= compareEnd;
      return numberValue === compareValue;
    }

    function normalizeDateValue(value) {
      if (!value) return "";
      const text = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
      const date = new Date(text);
      return Number.isFinite(date.getTime()) ? localDateKey(date) : "";
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
          ${visibleFilterPickerFields(filter).map(field => renderFilterFieldPicker(key, field)).join("")}
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
        includeAssigned: Boolean(filter.includeAssigned),
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
      $("filterIncludeAssignedCheck").checked = Boolean(state.draftFilter.includeAssigned);
      renderCopyFilterMenu();
      $("filterConditionList").innerHTML = state.draftFilter.conditions.map((condition, index) => renderFilterConditionRow(condition, index)).join("");
      wireFilterModalRows();
      restoreFilterValueScroll();
    }

    function renderFilterConditionRow(condition, index) {
      const fieldType = filterFieldType(condition.field);
      const fieldOptions = availableFilterFieldOptions(condition.field).map(field => `<option value="${field.key}" ${field.key === condition.field ? "selected" : ""}>${escapeHtml(field.label)}</option>`).join("");
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
          ${renderConditionOperator(condition, index, fieldType)}
          ${renderConditionValueControl(condition, index, fieldType)}
          <button class="icon" data-add-condition="${index}" type="button" title="Add condition">+</button>
          ${index > 0 ? `<button class="icon danger-icon" data-delete-condition="${index}" type="button" title="Remove condition">x</button>` : ""}
        </div>
      `;
    }

    function renderConditionOperator(condition, index, fieldType) {
      const options = conditionOperatorOptions(fieldType);
      const value = condition.operator || defaultOperatorForField(condition.field);
      return `
        <select data-condition-operator="${index}" title="Filter operator">
          ${options.map(option => `<option value="${option.value}" ${option.value === value ? "selected" : ""}>${option.label}</option>`).join("")}
        </select>
      `;
    }

    function conditionOperatorOptions(fieldType) {
      if (fieldType === "date") {
        return [
          { value: "on", label: "On" },
          { value: "before", label: "Before" },
          { value: "after", label: "After" },
          { value: "onOrBefore", label: "On/before" },
          { value: "onOrAfter", label: "On/after" },
          { value: "between", label: "Between" },
          { value: "today", label: "Today" },
          { value: "yesterday", label: "Yesterday" },
          { value: "tomorrow", label: "Tomorrow" },
          { value: "thisWeek", label: "This week" },
          { value: "thisMonth", label: "This month" },
          { value: "lastDays", label: "Last days" },
          { value: "nextDays", label: "Next days" },
          { value: "empty", label: "Blank" },
          { value: "notEmpty", label: "Not blank" }
        ];
      }
      if (fieldType === "number") {
        return [
          { value: "eq", label: "=" },
          { value: "lt", label: "<" },
          { value: "gt", label: ">" },
          { value: "lte", label: "<=" },
          { value: "gte", label: ">=" },
          { value: "between", label: "Between" },
          { value: "empty", label: "Blank" },
          { value: "notEmpty", label: "Not blank" }
        ];
      }
      return [
        { value: "any", label: "Matches" },
        { value: "none", label: "Doesn't match" }
      ];
    }

    function renderConditionValueControl(condition, index, fieldType) {
      if (fieldType === "date" || fieldType === "number") {
        if (fieldType === "date" && relativeDateOperators().includes(condition.operator)) {
          if (condition.operator === "lastDays" || condition.operator === "nextDays") {
            return `
              <div class="condition-range-inputs single">
                <input type="number" min="1" max="365" data-condition-scalar="${index}" value="${escapeHtml(condition.value || "7")}" aria-label="Number of days">
              </div>
            `;
          }
          return `<div class="condition-static-value">Relative date</div>`;
        }
        const inputType = fieldType === "date" ? "date" : "number";
        const disabled = ["empty", "notEmpty"].includes(condition.operator) ? "disabled" : "";
        return `
          <div class="condition-range-inputs">
            <input type="${inputType}" data-condition-scalar="${index}" value="${escapeHtml(condition.value || "")}" ${disabled}>
            ${condition.operator === "between" ? `<input type="${inputType}" data-condition-scalar-end="${index}" value="${escapeHtml(condition.valueEnd || "")}">` : ""}
          </div>
        `;
      }
      const values = uniqueTicketValues(condition.field);
      const selected = condition.values || [];
      return `
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
          condition.operator = defaultOperatorForField(condition.field);
          condition.values = [];
          condition.value = "";
          condition.valueEnd = "";
          renderFilterModal();
        });
      });
      $("filterConditionList").querySelectorAll("[data-condition-operator]").forEach(select => {
        select.addEventListener("change", () => {
          const condition = state.draftFilter.conditions[Number(select.dataset.conditionOperator)];
          condition.operator = select.value;
          if (["empty", "notEmpty"].includes(condition.operator)) {
            condition.value = "";
            condition.valueEnd = "";
          } else if (condition.operator === "lastDays" || condition.operator === "nextDays") {
            condition.value = condition.value || "7";
            condition.valueEnd = "";
          } else if (relativeDateOperators().includes(condition.operator)) {
            condition.value = "";
            condition.valueEnd = "";
          }
          renderFilterModal();
        });
      });
      $("filterConditionList").querySelectorAll("[data-condition-scalar]").forEach(input => {
        input.addEventListener("input", () => {
          state.draftFilter.conditions[Number(input.dataset.conditionScalar)].value = input.value;
        });
      });
      $("filterConditionList").querySelectorAll("[data-condition-scalar-end]").forEach(input => {
        input.addEventListener("input", () => {
          state.draftFilter.conditions[Number(input.dataset.conditionScalarEnd)].valueEnd = input.value;
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
        name,
        title: filter.title || filter.name || name,
        color: filter.color || state.draftFilter.color || "#1976a3",
        includeAssigned: Boolean(filter.includeAssigned),
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
      state.draftFilter.includeAssigned = $("filterIncludeAssignedCheck").checked;
      state.listFilters[state.activeFilterListKey] = normalizeFilterShape(state.draftFilter);
      saveLocalSettings();
      saveHaloUserPreferences({ quiet: true });
      closeFilterModal();
      renderReportLists();
    }

    function saveFilterFromModal() {
      if (!state.draftFilter) return;
      state.draftFilter.name = $("filterModalName").value.trim();
      state.draftFilter.title = $("filterModalListTitle").value.trim();
      state.draftFilter.color = $("filterModalColor").value;
      state.draftFilter.includeAssigned = $("filterIncludeAssignedCheck").checked;
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
      saveHaloSavedFilter(name, state.savedFilters[name]);
      toast("Filter saved", `${name} is available for ticket lists.`);
    }

    function normalizeFilterShape(filter) {
      const normalized = {
        name: filter.name || "",
        title: filter.title || filter.name || "",
        color: filter.color || "#1976a3",
        includeAssigned: Boolean(filter.includeAssigned),
        conditions: structuredClone(filter.conditions || []),
        values: {},
        modes: {}
      };
      normalized.conditions.forEach(condition => {
        if (!condition.field) return;
        condition.joiner = condition.joiner || "and";
        condition.mode = condition.mode || "include";
        condition.operator = condition.operator || defaultOperatorForField(condition.field);
        condition.values = condition.values || [];
        condition.value = condition.value || "";
        condition.valueEnd = condition.valueEnd || "";
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
      saveHaloSavedFilter(name, state.savedFilters[name]);
      renderDeleteFilterSelect();
      renderReportLists();
      toast("Filter saved", `${name} is available for other ticket lists.`);
    }

    function applySavedFilterToList(key, name) {
      if (!name || !state.savedFilters[name]) return;
      const saved = state.savedFilters[name];
      state.listFilters[key] = normalizeFilterShape({
        ...saved,
        name,
        title: saved.title || saved.name || name,
        conditions: structuredClone(filterConditions(saved))
      });
      saveLocalSettings();
      saveHaloUserPreferences({ quiet: true });
      renderReportLists();
    }

    function renderTicketCard(ticket, listExpanded = true) {
      const visible = new Set(state.visibleFields);
      const attentionClass = listExpanded && attentionTicketIds.has(Number(ticket.id)) ? "new-ticket-attention" : "";
      const topFields = [
        visible.has("sla") ? renderTicketStatusCell("SLO Time Left", ticket.sla || "None", "sla") : "",
        visible.has("priority") ? renderTicketStatusCell("Priority", ticket.priority || "None", "priority-status") : ""
      ].filter(Boolean).join("");
      const rows = [
        renderTicketCardRow([
          visible.has("ticketNumber") ? renderTicketValue("Ticket #", `#${ticket.id}`, "ticket-number") : "",
          visible.has("summary") ? renderTicketValue("Summary", ticket.title, "summary") : ""
        ], "primary-row"),
        renderTicketCardRow([
          visible.has("client") ? renderTicketValue("Client", ticket.client) : "",
          visible.has("site") ? renderTicketValue("Site", ticket.site) : ""
        ], "client-row"),
        renderTicketCardRow([
          visible.has("contact") ? renderTicketValue("Contact", ticket.contact) : "",
          visible.has("type") ? renderTicketValue("Ticket Type", ticket.type) : ""
        ], "meta-row")
      ].filter(Boolean).join("");
      return `
        <article class="ticket-card ${attentionClass}" draggable="true" data-ticket-id="${ticket.id}" data-drag-source="ticket" ${ticketStatusStyle(ticket)}>
          ${topFields ? `<div class="ticket-status-row">${topFields}</div>` : ""}
          ${rows || `<div class="ticket-card-empty">No visible fields selected.</div>`}
        </article>
      `;
    }

    function renderTicketCardRow(cells, className = "") {
      const visibleCells = cells.filter(Boolean);
      if (!visibleCells.length) return "";
      return `<div class="ticket-card-row ${className} cols-${visibleCells.length}">${visibleCells.join("")}</div>`;
    }

    function renderTicketValue(label, value, tone = "") {
      if (!value) return "";
      return `
        <div class="ticket-value ${tone}">
          <strong>${escapeHtml(value)}</strong>
        </div>
      `;
    }

    function renderTicketStatusCell(label, value, kind) {
      return `
        <div class="ticket-status-cell ${kind}">
          <strong>${escapeHtml(value)}</strong>
        </div>
      `;
    }

    function renderBoard() {
      captureCalendarScroll();
      const board = $("dispatchBoard");
      const layout = boardLayoutOrientation();
      board.parentElement.className = `board-wrap ${layout} ${isCalendarLoading() ? "is-loading" : ""}`;
      board.className = `board ${layout}`;
      const selectedTechs = state.selectedTechs.map(id => technicians.find(tech => tech.id === id)).filter(Boolean);
      board.innerHTML = selectedTechs.map(renderTechColumn).join("");
      restoreCalendarScroll();
      wireTechReordering();
      wireTechEditButtons();
      wireDropZones();
      wireZoneExpanders();
      wireTechGroupToggles();
      makeTicketsDraggable();
      wireNoTimeTaskReordering();
      wireAppointmentResizers();
    }

    function renderTechColumn(tech) {
      const visibleItems = state.boardItems.filter(item => String(item.techId) === String(tech.id) && isSelectedDate(item.date));
      const pastNoTime = state.boardItems.filter(item => String(item.techId) === String(tech.id) && item.kind === "pastNoTime" && String(item.date || "") < selectedDate());
      const allDay = visibleItems.filter(item => item.kind === "allDay");
      const noTime = sortNoTimeItems(visibleItems.filter(item => item.kind === "noTime"), tech.id, "noTime");
      const timed = visibleItems.filter(item => item.kind === "timed");
      const orderedPastNoTime = sortNoTimeItems(pastNoTime, tech.id, "pastNoTime");
      const allDayBlocked = allDay.some(item => item.availabilityBlock);
      const scheduleKey = techGroupKey(tech.id, "schedule");
      const noTimeKey = techGroupKey(tech.id, "noTime");
      const pastKey = techGroupKey(tech.id, "pastNoTime");
      const scheduleCollapsed = Boolean(state.collapsedTechGroups[scheduleKey]);
      const noTimeCollapsed = Boolean(state.collapsedTechGroups[noTimeKey]);
      const pastCollapsed = state.collapsedTechGroups[pastKey] !== false;
      const techStyle = `style="--tech-color:${escapeHtml(techThemeColor(tech.id))};"`;
      const workload = techWorkloadSummary(tech, timed, allDay);
      if (boardLayoutOrientation() === "vertical") {
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
              ${orderedPastNoTime.length ? renderTechGroupToggle(tech.id, "pastNoTime", pastCollapsed, "Past Tasks", orderedPastNoTime.length, "alert") : ""}
              ${orderedPastNoTime.length && !pastCollapsed ? renderPastTaskZone(tech.id, tech.name, orderedPastNoTime) : ""}
            </div>
            ${scheduleCollapsed ? `<div class="calendar-collapsed-note">Calendar hidden</div>` : `
              <div class="calendar" data-calendar-tech-id="${tech.id}">
                <div class="time-axis">${renderTimeLabels()}</div>
                <div class="slot-grid">${renderTimeSlots(tech.id, timed, allDayBlocked)}</div>
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
              <div class="slot-grid">${renderTimeSlots(tech.id, timed, allDayBlocked)}</div>
            </div>
          `}
          ${renderTechGroupToggle(tech.id, "noTime", noTimeCollapsed, "Today's Tasks", noTime.length)}
          ${noTimeCollapsed ? "" : renderTaskZone("noTime", tech.id, tech.name, "Today's Tasks", noTime, "Drop ticket here to assign date only")}
          ${orderedPastNoTime.length ? renderTechGroupToggle(tech.id, "pastNoTime", pastCollapsed, "Past Tasks", orderedPastNoTime.length, "alert") : ""}
          ${orderedPastNoTime.length && !pastCollapsed ? renderPastTaskZone(tech.id, tech.name, orderedPastNoTime) : ""}
        </section>
      `;
    }

    function isCalendarLoading(date = selectedDate()) {
      return Boolean(state.calendarLoadingDates[date]);
    }

    function setCalendarLoading(date, loading) {
      if (loading) {
        state.calendarLoadingDates[date] = true;
      } else {
        delete state.calendarLoadingDates[date];
      }
      if (date === selectedDate()) renderBoard();
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

    function techWorkloadSummary(tech, timedItems, allDayItems = []) {
      const assignedMinutes = timedItems.reduce((total, item) => total + Number(item.duration || 30), 0);
      const availableMinutes = techAvailableMinutes(tech, allDayItems);
      if (availableMinutes <= 0) return `${formatDurationShort(assignedMinutes)} / 0m off`;
      const percent = Math.round((assignedMinutes / availableMinutes) * 100);
      return `${formatDurationShort(assignedMinutes)} / ${formatDurationShort(availableMinutes)} ${percent}%`;
    }

    function techAvailableMinutes(tech, allDayItems = []) {
      if (allDayItems.some(item => item.availabilityBlock)) return 0;
      const workdayMinutes = workdayMinutesForDate(tech?.workday, selectedDate());
      if (workdayMinutes !== null) return workdayMinutes;
      return Math.max(30, calendarEndMinutes() - calendarStartMinutes());
    }

    function workdayMinutesForDate(workday, dateValue) {
      if (!workday?.weekly) return null;
      const date = new Date(`${dateValue}T00:00:00`);
      if (!Number.isFinite(date.getTime())) return null;
      const dayKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const day = workday.weekly[dayKeys[date.getDay()]];
      if (!day) return null;
      if (day.enabled === false) return 0;
      const start = timeToMinutes(day.start || "");
      const end = timeToMinutes(day.end || "");
      return end > start ? end - start : 0;
    }

    function formatDurationShort(minutes) {
      const value = Number(minutes || 0);
      if (value < 60) return `${value}m`;
      const hours = value / 60;
      return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
    }

    function renderTaskZone(kind, techId, techName, label, items, emptyText) {
      const showInlineLabel = kind !== "noTime";
      const orderAttrs = kind === "noTime" ? `data-no-time-order-zone data-order-kind="noTime" data-tech-id="${techId}"` : "";
      return `
        <div class="drop-zone" data-drop-kind="${kind}" data-tech-id="${techId}">
          <div class="expanded-title">${escapeHtml(label)} - ${escapeHtml(techName)}</div>
          <div class="zone-topline">
            ${showInlineLabel ? `<div class="zone-label">${label}</div>` : `<div></div>`}
            <button class="expand-zone" data-expand-zone type="button" title="Expand section">^</button>
          </div>
          <div class="zone-items" ${orderAttrs}>${items.length ? items.map(renderSmallEvent).join("") : `<div class="empty">${emptyText}</div>`}</div>
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
          <div class="zone-items" data-no-time-order-zone data-order-kind="pastNoTime" data-tech-id="${techId}">${items.map(renderSmallEvent).join("")}</div>
        </div>
      `;
    }

    function renderTimeLabels() {
      const labels = [];
      for (let minutes = calendarStartMinutes(); minutes < calendarEndMinutes(); minutes += 60) {
        const time = minutesToTime(minutes);
        if (boardLayoutOrientation() === "vertical") {
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

    function renderTimeSlots(techId, timed, allDayBlocked = false) {
      const layout = boardLayoutOrientation();
      const slots = [];
      const nowMarker = renderCurrentTimeMarker();
      for (let minutes = calendarStartMinutes(); minutes < calendarEndMinutes(); minutes += 30) {
        const time = minutesToTime(minutes);
        const slotItems = timed
          .filter(item => slotForTime(item.time) === time)
          .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
        const blocked = allDayBlocked || timed.some(item => item.availabilityBlock && appointmentOverlapsSlot(item, minutes));
        slots.push(`
          <div class="time-slot ${slotItems.length > 1 ? "has-overlap" : ""} ${blocked ? "availability-blocked" : ""}" data-drop-kind="timed" data-tech-id="${techId}" data-time="${time}">
            ${slotItems.map((item, index) => renderAppointment(item, index, slotItems.length, layout)).join("")}
          </div>
        `);
      }
      return `${nowMarker}${slots.join("")}`;
    }

    function appointmentOverlapsSlot(item, slotStart) {
      const itemStart = timeToMinutes(item.time || "00:00");
      const itemEnd = itemStart + Number(item.duration || 30);
      const slotEnd = slotStart + 30;
      return itemStart < slotEnd && itemEnd > slotStart;
    }

    function renderCurrentTimeMarker() {
      const position = currentTimePosition();
      if (position === null) return "";
      return `
        <div class="current-time-marker ${boardLayoutOrientation()}" style="--now-position:${position}%">
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
      if (boardLayoutOrientation() === "vertical") {
        const targetLeft = (grid.scrollWidth * (position / 100)) - (calendar.clientWidth / 2);
        calendar.scrollLeft = Math.max(0, targetLeft);
        return;
      }
      const targetTop = (grid.scrollHeight * (position / 100)) - (calendar.clientHeight / 2);
      calendar.scrollTop = Math.max(0, targetTop);
    }

    function renderSmallEvent(item) {
      const ticket = tickets.find(entry => entry.id === item.ticketId);
      const draggable = item.availabilityBlock ? "false" : "true";
      const prefix = item.haloTicketId ? `#${item.ticketId} ` : "";
      return `<div class="small-event ${appointmentClass(item, ticket)}" draggable="${draggable}" data-ticket-id="${item.ticketId}" data-tech-id="${item.techId}" data-date="${item.date || ""}" data-appointment-id="${item.appointmentId || ""}" data-drag-source="scheduled" data-kind="${item.kind}">${prefix}${escapeHtml(item.label || ticket?.title || "Task")}</div>`;
    }

    function sortNoTimeItems(items, techId, kind) {
      const order = state.noTimeTaskOrder[noTimeOrderKey(techId, kind)] || [];
      if (!order.length) return items;
      const rank = new Map(order.map((ticketId, index) => [String(ticketId), index]));
      return [...items].sort((a, b) => {
        const aRank = rank.has(String(a.ticketId)) ? rank.get(String(a.ticketId)) : Number.MAX_SAFE_INTEGER;
        const bRank = rank.has(String(b.ticketId)) ? rank.get(String(b.ticketId)) : Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
        return items.indexOf(a) - items.indexOf(b);
      });
    }

    function noTimeOrderKey(techId, kind) {
      return `${kind}:${techId}:${kind === "pastNoTime" ? `past:${selectedDate()}` : selectedDate()}`;
    }

    function appendNoTimeOrder(ticketId, techId, kind) {
      const key = noTimeOrderKey(techId, kind);
      const order = (state.noTimeTaskOrder[key] || []).filter(id => String(id) !== String(ticketId));
      order.push(String(ticketId));
      state.noTimeTaskOrder[key] = order;
    }

    function renderAppointment(item, index = 0, count = 1, orientation = boardLayoutOrientation()) {
      const ticket = tickets.find(entry => entry.id === item.ticketId);
      const durationSlots = Math.max(1, Math.ceil((item.duration || 30) / 30));
      const draggable = item.availabilityBlock ? "false" : "true";
      const resizeHandle = !item.availabilityBlock && item.appointmentId ? `<span class="appointment-resize-handle" data-resize-appointment="${item.appointmentId}" title="Resize appointment"></span>` : "";
      return `
        <div class="appointment ${count > 1 ? "overlap-card" : ""} ${appointmentClass(item, ticket)}" draggable="${draggable}" data-ticket-id="${item.ticketId}" data-appointment-id="${item.appointmentId || ""}" data-drag-source="scheduled" data-kind="timed" style="--overlap-count:${count};--overlap-index:${index};--duration-slots:${durationSlots};" title="${escapeHtml(item.label || ticket?.title || "Appointment")}">
          <strong>${calendarCardTitle(item, ticket)}</strong>
          <span>${escapeHtml(formatTime(item.time))} - ${item.duration || 30}m</span>
          ${resizeHandle}
        </div>
      `;
    }

    function calendarCardTitle(item, ticket) {
      if (!ticket || item.availabilityBlock || !item.haloTicketId) return escapeHtml(item.label || ticket?.title || "Appointment");
      const ticketNumber = item.haloTicketId || ticket.haloTicketId || ticket.id;
      return [
        `<span>#${escapeHtml(ticketNumber)}</span>`,
        ticket.client ? `<span>${escapeHtml(ticket.client)}</span>` : "",
        `<span>${escapeHtml(ticket.title || item.label || "Ticket")}</span>`
      ].filter(Boolean).join(" ");
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
          if (event.target.closest("[data-no-time-order-zone]")) return;
          if (event.dataTransfer.types.includes("tech-id")) return;
          event.preventDefault();
          zone.classList.add("over");
        });
        zone.addEventListener("dragleave", () => zone.classList.remove("over"));
        zone.addEventListener("drop", event => {
          if (event.target.closest("[data-no-time-order-zone]")) return;
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
      document.querySelectorAll(".ticket-card, .appointment[draggable='true'], .small-event[draggable='true']").forEach(card => {
        card.addEventListener("dragstart", event => {
          clearTicketAttention(Number(card.dataset.ticketId), { render: false });
          card.classList.add("dragging");
          event.dataTransfer.setData("text/plain", card.dataset.ticketId);
          event.dataTransfer.setData("source", card.dataset.dragSource || "ticket");
          event.dataTransfer.setData("item-kind", card.dataset.kind || "");
          event.dataTransfer.setData("item-tech-id", card.dataset.techId || "");
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

    function wireNoTimeTaskReordering() {
      document.querySelectorAll("[data-no-time-order-zone]").forEach(zone => {
        zone.addEventListener("dragover", event => {
          if (!isNoTimeReorderDrag(event) || !canReorderNoTimeInZone(event, zone)) return;
          event.preventDefault();
          event.stopPropagation();
          zone.classList.add("order-over");
        });
        zone.addEventListener("dragleave", event => {
          if (!zone.contains(event.relatedTarget)) zone.classList.remove("order-over");
        });
        zone.addEventListener("drop", event => {
          if (!isNoTimeReorderDrag(event) || !canReorderNoTimeInZone(event, zone)) return;
          event.preventDefault();
          event.stopPropagation();
          zone.classList.remove("order-over");
          const ticketId = Number(event.dataTransfer.getData("text/plain"));
          reorderNoTimeTask(ticketId, zone, event);
        });
      });
    }

    function isNoTimeReorderDrag(event) {
      const kind = event.dataTransfer.getData("item-kind");
      return event.dataTransfer.getData("source") === "scheduled" && (kind === "noTime" || kind === "pastNoTime");
    }

    function canReorderNoTimeInZone(event, zone) {
      const ticketId = Number(event.dataTransfer.getData("text/plain"));
      const dragged = state.boardItems.find(item => Number(item.ticketId) === ticketId);
      return Boolean(dragged && String(dragged.kind) === String(zone.dataset.orderKind) && String(dragged.techId) === String(zone.dataset.techId));
    }

    function reorderNoTimeTask(ticketId, zone, event) {
      const dragged = state.boardItems.find(item => Number(item.ticketId) === Number(ticketId));
      if (!dragged) return;
      const targetKind = zone.dataset.orderKind;
      const targetTechId = zone.dataset.techId;
      if (String(dragged.kind) !== String(targetKind) || String(dragged.techId) !== String(targetTechId)) return;
      const targetCard = event.target.closest(".small-event");
      const targetTicketId = targetCard ? Number(targetCard.dataset.ticketId) : null;
      const orderKey = noTimeOrderKey(targetTechId, targetKind);
      const currentIds = sortNoTimeItems(
        state.boardItems.filter(item => String(item.techId) === String(targetTechId) && item.kind === targetKind && (targetKind === "pastNoTime" ? String(item.date || "") < selectedDate() : isSelectedDate(item.date))),
        targetTechId,
        targetKind
      ).map(item => Number(item.ticketId));
      const nextOrder = currentIds.filter(id => id !== ticketId);
      if (targetTicketId && targetTicketId !== ticketId) {
        const targetIndex = nextOrder.indexOf(targetTicketId);
        const rect = targetCard.getBoundingClientRect();
        const insertAfter = event.clientY > rect.top + (rect.height / 2);
        nextOrder.splice(targetIndex + (insertAfter ? 1 : 0), 0, ticketId);
      } else {
        nextOrder.push(ticketId);
      }
      state.noTimeTaskOrder[orderKey] = nextOrder.map(String);
      saveLocalSettings();
      saveHaloUserPreferences({ quiet: true });
      renderBoard();
    }

    function wireAppointmentResizers() {
      document.querySelectorAll(".appointment-resize-handle").forEach(handle => {
        handle.addEventListener("pointerdown", startAppointmentResize);
      });
    }

    function startAppointmentResize(event) {
      event.preventDefault();
      event.stopPropagation();
      const card = event.target.closest(".appointment");
      if (!card) return;
      const item = state.boardItems.find(entry => String(entry.appointmentId || "") === String(card.dataset.appointmentId || ""));
      if (!item || item.kind !== "timed" || item.availabilityBlock) return;
      if (!item.appointmentId) {
        toast("Appointment not loaded", "The appointment needs a Halo appointment ID before it can be resized.");
        return;
      }

      const grid = card.closest(".slot-grid");
      const firstSlot = grid?.querySelector(".time-slot");
      const layout = boardLayoutOrientation();
      const slotSize = layout === "vertical"
        ? (firstSlot?.getBoundingClientRect().width || 160)
        : (firstSlot?.getBoundingClientRect().height || 40);
      const startPointer = layout === "vertical" ? event.clientX : event.clientY;
      const startDuration = Number(item.duration || 30);
      const snapshot = snapshotDispatchState();
      let nextDuration = startDuration;

      card.setPointerCapture?.(event.pointerId);
      card.classList.add("resizing");

      const onMove = moveEvent => {
        const pointer = layout === "vertical" ? moveEvent.clientX : moveEvent.clientY;
        const deltaSlots = Math.round((pointer - startPointer) / slotSize);
        nextDuration = clampAppointmentDuration(item, startDuration + (deltaSlots * 30));
        item.duration = nextDuration;
        card.style.setProperty("--duration-slots", Math.max(1, Math.ceil(nextDuration / 30)));
        const label = card.querySelector("span:not(.appointment-resize-handle)");
        if (label) label.textContent = `${formatTime(item.time)} - ${nextDuration}m`;
      };

      const onEnd = async endEvent => {
        card.releasePointerCapture?.(endEvent.pointerId);
        card.classList.remove("resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        if (nextDuration === startDuration) {
          item.duration = startDuration;
          renderBoard();
          return;
        }
        await resizeScheduledAppointment(item, nextDuration, snapshot);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd, { once: true });
    }

    function clampAppointmentDuration(item, duration) {
      const start = timeToMinutes(item.time || "00:00");
      const maxDuration = Math.max(30, calendarEndMinutes() - start);
      return Math.max(30, Math.min(maxDuration, duration));
    }

    function clearTicketAttention(ticketId, options = {}) {
      if (!attentionTicketIds.delete(Number(ticketId))) return;
      if (options.render === false) return;
      renderReportLists();
    }

    async function handleTicketDrop(ticketId, techId, kind, time, source = "ticket") {
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

      const snapshot = snapshotDispatchState();
      removeBoardItem(ticketId);
      ticket.assignedTo = techId;
      if (kind === "allDay") {
        ticket.dateField = selectedDate();
        state.boardItems.push({ ticketId, techId, kind: "allDay", label: ticket.title, date: selectedDate() });
        renderAll();
        await persistOptimisticChange(snapshot, callHalo(source === "scheduled" ? "moveToAllDayTask" : "createAllDayTask", { ticketId, technicianId: techId, date: $("boardDate").value, assignTicket: true }, { quiet: true }), {
          successTitle: source === "scheduled" ? "Task moved" : "All-day task queued",
          successMessage: `#${ticketId} assigned to ${tech.name}.`,
          refreshAppointments: true
        });
        return;
      }
      if (kind === "noTime") {
        ticket.dateField = selectedDate();
        state.boardItems.push({ ticketId, techId, kind: "noTime", label: ticket.title, date: selectedDate() });
        appendNoTimeOrder(ticketId, techId, "noTime");
        renderAll();
        await persistOptimisticChange(snapshot, callHalo(source === "scheduled" ? "moveToDateOnlyTask" : "assignTicketDateOnly", { ticketId, technicianId: techId, dateFieldValue: $("boardDate").value }, { quiet: true }), {
          successTitle: source === "scheduled" ? "Task moved" : "Date-only task queued",
          successMessage: `#${ticketId} assigned to ${tech.name} for ${$("boardDate").value}.`,
          refreshAppointments: true,
          refreshTickets: true
        });
        return;
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

      const snapshot = snapshotDispatchState();
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
      appendNoTimeOrder(ticketId, techId, "noTime");
      renderAll();

      const action = item.appointmentId ? "moveAppointmentToDateOnly" : "assignTicketDateOnly";
      await persistOptimisticChange(snapshot, callHalo(action, {
        appointmentId: item.appointmentId || null,
        ticketId: haloTicketId,
        technicianId: techId,
        dateFieldValue: selectedDate()
      }, { quiet: true }), {
        successTitle: "Date-only task updated",
        successMessage: `#${haloTicketId} assigned to ${tech.name} for ${selectedDate()}.`,
        refreshAppointments: true,
        refreshTickets: true
      });
    }

    async function moveNoTimeToAppointment(ticketId, techId, time, targetKind) {
      const item = state.boardItems.find(entry => entry.ticketId === ticketId);
      const ticket = tickets.find(entry => entry.id === ticketId);
      const tech = technicians.find(entry => entry.id === techId);
      if (!item || !ticket || !tech) return;
      const haloTicketId = item.haloTicketId || ticket.haloTicketId || ticket.id;
      const duration = targetKind === "timed" ? 30 : 1440;
      const snapshot = snapshotDispatchState();
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

      const targetLabel = targetKind === "allDay" ? "all-day" : formatTime(time);
      await persistOptimisticChange(snapshot, callHalo("createAppointmentFromDateOnly", {
        ticketId: haloTicketId,
        technicianId: techId,
        date: selectedDate(),
        startTime: time,
        durationMinutes: targetKind === "timed" ? duration : 30,
        allday: targetKind === "allDay",
        dateFieldValue: "",
        assignTicket: true
      }, { quiet: true }), {
        successTitle: "Appointment created",
        successMessage: `#${haloTicketId} moved to ${targetLabel} for ${tech.name}.`,
        refreshAppointments: true,
        refreshTickets: true
      });
    }

    async function moveScheduledItem(ticketId, techId, time, targetKind = "timed") {
      const item = state.boardItems.find(entry => entry.ticketId === ticketId);
      const ticket = tickets.find(entry => entry.id === ticketId);
      const tech = technicians.find(entry => entry.id === techId);
      if (!item || !ticket || !tech) return;
      const snapshot = snapshotDispatchState();
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
      const targetLabel = targetKind === "allDay" ? "all-day" : formatTime(time);
      const techChanged = previous.techId !== techId ? ` and assigned to ${tech.name}` : "";
      await persistOptimisticChange(snapshot, callHalo("updateAppointment", {
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
      }, { quiet: true }), {
        successTitle: "Appointment updated",
        successMessage: `#${ticketId} moved to ${targetLabel}${techChanged}.`,
        refreshAppointments: true
      });
      renderAll();
    }

    async function resizeScheduledAppointment(item, nextDuration, snapshot) {
      const ticket = tickets.find(entry => entry.id === item.ticketId);
      item.duration = nextDuration;
      await persistOptimisticChange(snapshot, callHalo("updateAppointment", {
        ticketId: item.haloTicketId || ticket?.haloTicketId || null,
        previousTechnicianId: item.techId,
        technicianId: item.techId,
        previousStartTime: item.time || null,
        startTime: item.time,
        durationMinutes: nextDuration,
        appointmentId: item.appointmentId || null,
        date: item.date || selectedDate(),
        allday: false,
        assignTicket: false
      }, { quiet: true }), {
        successTitle: "Appointment resized",
        successMessage: `${item.label || ticket?.title || "Appointment"} is now ${formatDurationShort(nextDuration)}.`,
        refreshAppointments: true
      });
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
      popover.style.setProperty("--ticket-popover-left", `${Math.max(16, left)}px`);
      popover.style.setProperty("--ticket-popover-top", `${Math.max(16, y)}px`);
      popover.innerHTML = `
        <strong>#${ticket.id}</strong>
        <span><b>Summary:</b> ${escapeHtml(ticket.title || "-")}</span>
        <span><b>Client:</b> ${escapeHtml(ticket.client)} - ${escapeHtml(ticket.site)}</span>
        <span><b>Contact:</b> ${escapeHtml(ticket.contact)}</span>
        <span><b>Type:</b> ${escapeHtml(ticket.type || "-")}</span>
        <span><b>Date:</b> ${escapeHtml(ticket.nextAppointmentDate || "Not set")}</span>
        ${ticket.lastAction ? `<span><b>Last Action:</b> ${escapeHtml(ticket.lastAction)}</span>` : ""}
        ${ticket.details ? `<span><b>Details:</b> ${escapeHtml(ticket.details)}</span>` : ""}
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

    async function saveAppointment() {
      if (!state.pendingAppointment) return;
      const { ticketId, techId } = state.pendingAppointment;
      const ticket = tickets.find(item => item.id === ticketId);
      const tech = technicians.find(item => item.id === techId);
      const time = $("modalStart").value;
      const duration = Number($("modalDuration").value);
      const snapshot = snapshotDispatchState();
      removeBoardItem(ticketId);
      ticket.assignedTo = techId;
      ticket.dateField = selectedDate();
      state.boardItems.push({ ticketId, techId, kind: "timed", time, duration, date: selectedDate() });
      renderAll();
      const result = await persistOptimisticChange(snapshot, callHalo("createAppointment", {
        ticketId,
        technicianId: techId,
        date: $("boardDate").value,
        startTime: time,
        durationMinutes: duration,
        status: $("modalStatus").value,
        location: $("modalLocation").value,
        notes: $("modalNotes").value,
        assignTicket: true
      }, { quiet: true }), {
        successTitle: "Appointment queued",
        successMessage: `#${ticketId} scheduled for ${tech.name} at ${formatTime(time)}.`,
        refreshAppointments: true,
        refreshTickets: true
      });
      if (result?.ok !== false) closeAppointmentModal();
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
      saveHaloUserPreferences({ quiet: true });
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
      const technicianIds = new Set(technicians.map(tech => tech.id));
      state.selectedTechs = state.selectedTechs.filter(id => technicianIds.has(id));
      if (state.selectedTeams.length) {
        const filteredIds = new Set(filteredTechnicians().map(tech => tech.id));
        state.selectedTechs = state.selectedTechs.filter(id => filteredIds.has(id));
        if (!state.selectedTechs.length) state.selectedTechs = Array.from(filteredIds);
      }
      ensureSelectedTechnicians();
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

    function boardLayoutOrientation() {
      return state.orientation === "horizontal" ? "vertical" : "horizontal";
    }

    function shiftDate(days) {
      const date = new Date(`${$("boardDate").value}T00:00:00`);
      date.setDate(date.getDate() + days);
      $("boardDate").value = localDateKey(date);
      state.shouldCenterNow = true;
      renderAll();
      loadHaloAppointments({ showLoading: true });
    }

    function saveApiSettings() {
      state.apiBaseUrl = $("apiBaseUrl").value.trim();
      state.apiProxyUrl = $("apiProxyUrl").value.trim() || DEFAULT_WORKER_API_URL;
      state.mockMode = $("mockModeCheck").checked;
      applyConnectionState();
      saveLocalSettings();
      resetAppointmentRefreshTimer();
      resetTicketRefreshTimer();
      toast("Connection settings saved", state.mockMode ? "Mock mode is active." : state.apiProxyUrl);
      loadHaloStorage({ quiet: true });
      loadHaloTechnicians();
      loadHaloTicketTypes();
      loadHaloTickets();
    }

    async function loadHaloStorage(options = {}) {
      if (!effectiveWorkerUrl()) return;
      const result = await callHalo("loadDispatchStorage", {
        agentId: currentStorageAgentId()
      }, { quiet: true });
      if (!result?.ok) return;

      state.loadingHaloStorage = true;
      try {
        const savedFilters = result.data?.savedFilters || {};
        state.savedFilters = savedFilters;
        const preferences = result.data?.userPreferences?.preferences;
        if (preferences && Object.keys(preferences).length) {
          applyDispatchPreferencePayload(preferences);
          state.savedFilters = savedFilters;
          hydrateListFiltersFromSavedFilters();
          renderDeleteFilterSelect();
          renderReportLists();
          if (!options.skipReload) {
            loadHaloTickets({ quiet: true });
            loadHaloAppointments({ quiet: true });
          }
        } else {
          hydrateListFiltersFromSavedFilters();
          renderDeleteFilterSelect();
          renderReportLists();
        }
        state.haloStorageLoaded = true;
        if (!options.quiet) toast("Halo storage loaded", "User preferences and shared filters were loaded from Halo.");
      } finally {
        state.loadingHaloStorage = false;
      }
    }

    async function saveHaloUserPreferences(options = {}) {
      if (!effectiveWorkerUrl()) return;
      if (!currentStorageAgentId()) {
        if (!options.quiet) toast("Preferences not synced", "Pass viewer_agent_id in the iframe URL before saving user preferences.");
        return;
      }
      const result = await callHalo("saveDispatchUserPreferences", {
        agentId: currentStorageAgentId(),
        preferences: dispatchPreferencePayload()
      }, { quiet: true });
      if (result?.ok === false) toast("Preference sync failed", result.error || "The preferences remain saved locally.");
      if (result?.ok && !options.quiet) toast("Preferences saved", "Your dispatch board preferences were saved to Halo.");
    }

    async function saveHaloSavedFilter(name, filter) {
      if (!effectiveWorkerUrl() || !name) return;
      const result = await callHalo("saveDispatchSavedFilter", {
        agentId: currentStorageAgentId(),
        name,
        filter
      }, { quiet: true });
      if (result?.ok === false) toast("Filter sync failed", result.error || "The saved filter remains available locally.");
    }

    async function deleteHaloSavedFilter(name) {
      if (!effectiveWorkerUrl() || !name) return;
      const result = await callHalo("deleteDispatchSavedFilter", {
        agentId: currentStorageAgentId(),
        name
      }, { quiet: true });
      if (result?.ok === false) toast("Filter sync failed", result.error || "The filter was removed locally but not in Halo.");
    }

    async function loadHaloTechnicians(options = {}) {
      if (!effectiveWorkerUrl()) return;
      const workerReady = await testWorkerConnection({ quiet: true });
      if (!workerReady) return;
      const result = await callHalo("loadTechnicians", {}, { quiet: true });
      const data = result?.data;
      if (!data?.technicians?.length) {
        if (!options.quiet) toast("Halo names not loaded", "No agents matched the selected teams and in_section rule.");
        return;
      }
      syncHaloTechnicians(data);
      renderTeamSelect();
      renderTechPicker();
      renderBoard();
      if (!options.quiet) toast("Halo names loaded", `${data.technicians.length} agents are available for dispatch.`);
      if (!options.skipAppointments) loadHaloAppointments();
    }

    async function loadHaloTicketTypes() {
      if (!effectiveWorkerUrl()) return;
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
      if (!effectiveWorkerUrl()) {
        if (!options.quiet) toast("Mock mode active", "Disable mock mode in Settings to load Halo tickets.");
        return;
      }
      const result = await callHalo("loadTickets", {
        ticketTypeIds: state.selectedTicketTypes
      }, { quiet: true });
      debugLog("HaloPSA ticket load result", result?.meta || result);
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
          Object.assign(existing, normalized);
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
        nextAppointmentDate: ticket.nextAppointmentDate || "",
        lastAction: ticket.lastAction || "",
        dateOpened: ticket.dateOpened || "",
        assignedTo: ticket.assignedTo || "",
        haloTicketId: ticket.haloTicketId || id,
        completed: Boolean(ticket.completed),
        source: "haloTicket"
      };
    }

    async function loadHaloAppointments(options = {}) {
      if (!effectiveWorkerUrl() || !state.selectedTechs.length) return;
      const date = options.date || selectedDate();
      const cached = appointmentCacheEntry(date);
      if (cached && !options.force) {
        if (options.apply !== false) {
          syncHaloAppointments(cached.appointments, date);
          if (date === selectedDate()) {
            loadHaloDateOnlyTasks({ quiet: true });
            renderBoard();
          }
        }
        if (!options.skipPrefetch) prefetchAdjacentAppointments(date);
        return;
      }
      const shouldShowCalendarLoading = options.showLoading === true && options.apply !== false && date === selectedDate();
      if (shouldShowCalendarLoading) setCalendarLoading(date, true);
      try {
        const result = await callHalo("loadAppointments", {
          date,
          technicianIds: state.selectedTechs
        }, { quiet: true });
        debugLog("HaloPSA appointment load result", result?.meta || result);
        if (!result?.ok) return;
        const appointments = result.data?.appointments || [];
        setAppointmentCacheEntry(date, appointments);
        if (options.apply !== false) {
          syncHaloAppointments(appointments, date);
          if (date === selectedDate()) {
            loadHaloDateOnlyTasks({ quiet: true });
            renderBoard();
          }
        }
        if (!options.skipPrefetch) prefetchAdjacentAppointments(date);
        debugLog("HaloPSA board appointment sync", appointmentVisibilitySummary(result.data?.appointments || []));
        if (!options.quiet && result.data?.appointments?.length) {
          toast("Halo appointments loaded", `${result.data.appointments.length} calendar items matched this view.`);
        }
      } finally {
        if (shouldShowCalendarLoading) setCalendarLoading(date, false);
      }
    }

    function appointmentCacheKey(date = selectedDate()) {
      return `${date}|${state.selectedTechs.map(String).sort().join(",")}`;
    }

    function appointmentCacheEntry(date = selectedDate()) {
      const entry = state.appointmentCache[appointmentCacheKey(date)];
      if (!entry) return null;
      if (Date.now() - entry.loadedAt > state.appointmentCacheTtlMs) return null;
      return entry;
    }

    function setAppointmentCacheEntry(date, appointments) {
      state.appointmentCache[appointmentCacheKey(date)] = {
        loadedAt: Date.now(),
        appointments: structuredClone(appointments || [])
      };
      pruneAppointmentCache();
    }

    function pruneAppointmentCache() {
      const keys = Object.keys(state.appointmentCache);
      if (keys.length <= 30) return;
      keys
        .sort((a, b) => (state.appointmentCache[a]?.loadedAt || 0) - (state.appointmentCache[b]?.loadedAt || 0))
        .slice(0, keys.length - 30)
        .forEach(key => delete state.appointmentCache[key]);
    }

    function prefetchAdjacentAppointments(date = selectedDate()) {
      if (!effectiveWorkerUrl() || !state.selectedTechs.length || state.prefetchingAppointments) return;
      state.prefetchingAppointments = true;
      const base = new Date(`${date}T00:00:00`);
      const dates = [];
      for (let offset = 1; offset <= state.appointmentPrefetchDays; offset += 1) {
        dates.push(localDateKey(addDays(base, -offset)), localDateKey(addDays(base, offset)));
      }
      setTimeout(() => {
        Promise.all(dates
          .filter(day => !appointmentCacheEntry(day))
          .map(day => loadHaloAppointments({ date: day, quiet: true, apply: false, skipPrefetch: true })))
          .finally(() => {
            state.prefetchingAppointments = false;
          });
      }, 100);
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

    function resetTicketRefreshTimer() {
      if (state.ticketRefreshTimer) {
        clearInterval(state.ticketRefreshTimer);
        state.ticketRefreshTimer = null;
      }
      if (!state.ticketRefreshMinutes || state.ticketRefreshMinutes < 1) return;

      state.ticketRefreshTimer = setInterval(() => {
        loadHaloTickets({ quiet: true });
      }, state.ticketRefreshMinutes * 60000);
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
      if (!effectiveWorkerUrl() || !state.selectedTechs.length) return;
      const result = await callHalo("loadDateOnlyTasks", {
        date: selectedDate(),
        technicianIds: state.selectedTechs
      }, { quiet: true });
      debugLog("HaloPSA date-only task load result", result?.meta || result);
      if (!result?.ok) return;
      syncHaloDateOnlyTasks(result.data?.tasks || [], result.data?.pastTasks || []);
      renderBoard();
      const taskCount = (result.data?.tasks?.length || 0) + (result.data?.pastTasks?.length || 0);
      if (!options.quiet && taskCount) {
        toast("Date-only tasks loaded", `${taskCount} without-time tickets matched this view.`);
      }
    }

    function syncHaloAppointments(appointments, date = selectedDate()) {
      const visibleTechs = new Set(state.selectedTechs);
      state.boardItems = state.boardItems.filter(item => {
        const sameDate = String(item.date || "") === date;
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
        nextAppointmentDate: appointment.date,
        lastAction: "",
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
        nextAppointmentDate: "",
        lastAction: "",
        assignedTo: task.techId,
        haloTicketId: task.haloTicketId || task.ticketId,
        completed: task.completed
      });
    }

    function syncHaloTechnicians(data) {
      technicians.splice(0, technicians.length, ...data.technicians.map(tech => ({
        id: String(tech.id),
        name: tech.name || `Technician ${tech.id}`,
        teamId: String(tech.teamId || ""),
        team: tech.team || `Team ${tech.teamId || ""}`,
        teamIds: Array.isArray(tech.teamIds) && tech.teamIds.length ? tech.teamIds.map(String) : [String(tech.teamId || "")],
        workdayId: String(tech.workdayId || ""),
        workday: tech.workday || null
      })));

      teams.splice(0, teams.length, ...data.teams.map(team => ({
        id: String(team.id),
        name: team.name || `Team ${team.id}`
      })));

      const availableTeamIds = new Set(teams.map(team => team.id));
      state.selectedTeams = state.selectedTeams.filter(id => availableTeamIds.has(id));

      const technicianIds = new Set(technicians.map(tech => tech.id));
      state.selectedTechs = state.selectedTechs.filter(id => technicianIds.has(id));
      if (state.selectedTeams.length) {
        const filteredIds = new Set(filteredTechnicians().map(tech => tech.id));
        state.selectedTechs = state.selectedTechs.filter(id => filteredIds.has(id));
        if (!state.selectedTechs.length) state.selectedTechs = Array.from(filteredIds);
      }
      ensureSelectedTechnicians();
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

    function refreshReports() {
      loadHaloTickets();
    }

    async function testWorkerConnection(options = {}) {
      if (!effectiveWorkerUrl()) {
        $("apiState").textContent = "HaloPSA mock mode";
        if (!options.quiet) toast("Mock mode active", "Disable mock mode in Settings to connect to HaloPSA.");
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
      const enrichedPayload = {
        ...(payload || {}),
        context: {
          ...(payload?.context || {}),
          viewerAgentId: currentStorageAgentId() || undefined
        }
      };
      const request = {
        action,
        proxyUrl: effectiveWorkerUrl() || "(mock)",
        payload: enrichedPayload,
        timestamp: new Date().toISOString()
      };
      debugLog("HaloPSA action", request);
      if (!effectiveWorkerUrl()) return request;

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
      const url = effectiveWorkerUrl().trim().replace(/\/$/, "");
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

    function debugLog(message, data) {
      if (debugEnabled) console.log(message, data);
    }

    function snapshotDispatchState() {
      return {
        boardItems: structuredClone(state.boardItems),
        tickets: structuredClone(tickets)
      };
    }

    function restoreDispatchState(snapshot) {
      state.boardItems.splice(0, state.boardItems.length, ...snapshot.boardItems);
      tickets.splice(0, tickets.length, ...snapshot.tickets);
      renderAll();
    }

    async function persistOptimisticChange(snapshot, haloPromise, options = {}) {
      const result = await haloPromise;
      if (effectiveWorkerUrl() && result?.ok === false) {
        restoreDispatchState(snapshot);
        toast("Halo update failed", result.error || "The board was restored because Halo rejected the update.");
        return result;
      }
      if (options.successTitle) toast(options.successTitle, options.successMessage || "");
      if (result?.ok) {
        if (options.refreshAppointments) setTimeout(() => loadHaloAppointments({ quiet: true, force: true }), 800);
        if (options.refreshTickets) setTimeout(() => loadHaloTickets({ quiet: true }), 800);
      }
      return result;
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
      return selectedDate() === todayDateKey();
    }

    function todayDateKey() {
      return localDateKey(new Date());
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

    function ticketStatusStyle(ticket) {
      const priorityColor = statusColorForPriority(ticket?.priority);
      const slaColor = statusColorForSla(ticket?.sla);
      return `style="--ticket-priority-color:${priorityColor};--ticket-sla-color:${slaColor};"`;
    }

    function statusColorForPriority(priority) {
      const value = String(priority || "").toLowerCase();
      if (value.includes("1") || value.includes("critical") || value.includes("high")) return "#bd4d3f";
      if (value.includes("2") || value.includes("medium")) return "#c47a10";
      return "#0d9276";
    }

    function statusColorForSla(sla) {
      const bucket = slaBucket(sla);
      if (bucket === "urgent") return "#a93226";
      if (bucket === "soon") return "#bc6c25";
      return "#33815f";
    }

    function appointmentClass(item, ticket) {
      if (item.completed || ticket?.completed) return "color-completed";
      if (item.availabilityBlock) return "color-availability-block";
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
