(() => {
  // shared/api.js
  async function apiFetch(path, { json, as, headers, ...init } = {}) {
    var _a, _b;
    if (json !== void 0) {
      init.body = JSON.stringify(json);
      (_a = init.method) != null ? _a : init.method = "POST";
      headers = { ...headers, "Content-Type": "application/json" };
    }
    const res = await fetch(path, { credentials: "same-origin", ...init, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const err = new Error((_b = body == null ? void 0 : body.error) != null ? _b : `Request failed (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    if (as === "blob") return res.blob();
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // shared/auth.js
  var CACHE_KEY = "auth:session";
  var current;
  var loading = null;
  var listeners = /* @__PURE__ */ new Set();
  function readCached() {
    var _a;
    try {
      return (_a = JSON.parse(localStorage.getItem(CACHE_KEY))) != null ? _a : null;
    } catch {
      return null;
    }
  }
  function writeCached(session) {
    try {
      if (session) localStorage.setItem(CACHE_KEY, JSON.stringify(session));
      else localStorage.removeItem(CACHE_KEY);
    } catch {
    }
  }
  function same(a, b) {
    var _a, _b;
    return ((_a = a == null ? void 0 : a.user.id) != null ? _a : null) === ((_b = b == null ? void 0 : b.user.id) != null ? _b : null);
  }
  function set(session) {
    const changed = current !== void 0 && !same(current, session);
    current = session;
    writeCached(session);
    if (changed) listeners.forEach((fn) => fn(session));
  }
  async function load() {
    try {
      const { user } = await apiFetch("/api/auth/session");
      set(user ? { user } : null);
    } catch {
      current = readCached();
      window.addEventListener("online", () => load(), { once: true });
    }
    return current;
  }
  function getSession() {
    if (current !== void 0) return Promise.resolve(current);
    return loading != null ? loading : loading = load();
  }
  function onSessionChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === CACHE_KEY && current !== void 0) set(readCached());
    });
  }
  function useSession() {
    const { useState: useState10, useEffect: useEffect6 } = React;
    const [session, setSession] = useState10(current);
    useEffect6(() => {
      let cancelled = false;
      getSession().then((s) => {
        if (!cancelled) setSession(s);
      });
      const off = onSessionChange(setSession);
      return () => {
        cancelled = true;
        off();
      };
    }, []);
    return session;
  }
  function signIn(next = location.pathname + location.search + location.hash) {
    location.assign(`/auth/login?next=${encodeURIComponent(next)}`);
  }
  async function signOut() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (error) {
      return { error };
    }
    set(null);
    return { error: null };
  }

  // shared/events.js
  var RETRY_MS = 3e4;
  var subs = /* @__PURE__ */ new Set();
  var source = null;
  var openTopics = "";
  var queued = false;
  var forced = false;
  var retryTimer = null;
  function wantedTopics() {
    return [...new Set([...subs].map((s) => s.topic))].sort().join(",");
  }
  function dispatch(change) {
    const topic = change.resync ? null : change.table === "app_data" ? "data" : "mo";
    for (const s of [...subs]) if (!topic || s.topic === topic) s.fn(change);
  }
  function open(topics) {
    clearTimeout(retryTimer);
    source == null ? void 0 : source.close();
    source = null;
    openTopics = topics;
    if (!topics) return;
    const es = new EventSource(`/api/events?topics=${topics}`);
    source = es;
    let opened = false;
    es.onopen = () => {
      if (opened) dispatch({ resync: true });
      opened = true;
    };
    es.onmessage = (e) => {
      let change;
      try {
        change = JSON.parse(e.data);
      } catch {
        return;
      }
      dispatch(change);
    };
    es.addEventListener("resync", () => dispatch({ resync: true }));
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED || source !== es) return;
      source = null;
      openTopics = "";
      retryTimer = setTimeout(() => {
        if (opened) dispatch({ resync: true });
        update();
      }, RETRY_MS);
    };
  }
  function update(force = false) {
    forced || (forced = force);
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const topics = wantedTopics();
      if (forced || topics !== openTopics || topics && !source) open(topics);
      forced = false;
    });
  }
  function subscribe(topic, fn) {
    const sub = { topic, fn };
    subs.add(sub);
    update();
    return () => {
      subs.delete(sub);
      update();
    };
  }
  onSessionChange(() => {
    if (source) update(true);
  });

  // marsova-opravila/api.js
  var ADMIN_TOKEN_KEY = "marsova_admin_token";
  var ADMIN_EXPIRES_KEY = "marsova_admin_token_expires";
  function getAdminSession() {
    try {
      const token = localStorage.getItem(ADMIN_TOKEN_KEY);
      const expiresAt = localStorage.getItem(ADMIN_EXPIRES_KEY);
      if (!token || !expiresAt) return null;
      if (new Date(expiresAt).getTime() <= Date.now()) return null;
      return { token, expiresAt };
    } catch {
      return null;
    }
  }
  function setAdminSession(token, expiresAt) {
    try {
      localStorage.setItem(ADMIN_TOKEN_KEY, token);
      localStorage.setItem(ADMIN_EXPIRES_KEY, expiresAt);
    } catch {
    }
  }
  function clearAdminSession() {
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem(ADMIN_EXPIRES_KEY);
    } catch {
    }
  }
  var ApiError = class extends Error {
    constructor(code, offline) {
      super(code);
      this.code = code;
      this.offline = offline;
    }
  };
  function isOffline() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }
  async function call(path, args) {
    try {
      return await apiFetch(path, args === void 0 ? {} : { json: args });
    } catch (err) {
      throw new ApiError(err.message || "unknown_error", isOffline());
    }
  }
  var table = (name) => call(`/api/mo/${name}`);
  var rpc = (name, args = {}) => call(`/api/mo/rpc/${name}`, args);
  var fetchCategories = () => table("mo_categories");
  var fetchChores = () => table("mo_chores");
  var fetchRewards = () => table("mo_rewards");
  var fetchRewardRequests = () => table("mo_reward_requests");
  var fetchActivityLog = () => table("mo_activity_log");
  var fetchPointsSummary = () => rpc("mo_points_summary");
  var fetchSettings = () => table("mo_settings");
  var completeChore = (choreId) => rpc("mo_complete_chore", { p_chore_id: choreId });
  var undoChoreCompletion = (logId) => rpc("mo_undo_chore_completion", { p_log_id: logId });
  var requestReward = (rewardId) => rpc("mo_request_reward", { p_reward_id: rewardId });
  var cancelRewardRequest = (id) => rpc("mo_cancel_reward_request", { p_id: id });
  var adminPinStatus = () => rpc("mo_admin_pin_status");
  var adminBootstrapPin = (pin) => rpc("mo_admin_bootstrap_pin", { p_pin: pin });
  var adminLogin = (pin) => rpc("mo_admin_login", { p_pin: pin });
  var adminSessionValid = (token) => rpc("mo_admin_session_valid", { p_token: token });
  var adminLogout = (token) => rpc("mo_admin_logout", { p_token: token });
  var adminCreateCategory = (token, emoji, name, color) => rpc("mo_admin_create_category", { p_token: token, p_emoji: emoji, p_name: name, p_color: color });
  var adminUpdateCategory = (token, id, emoji, name, color) => rpc("mo_admin_update_category", { p_token: token, p_id: id, p_emoji: emoji, p_name: name, p_color: color });
  var adminReorderCategories = (token, ids) => rpc("mo_admin_reorder_categories", { p_token: token, p_ids: ids });
  var adminDeleteCategory = (token, id, reassignTo) => rpc("mo_admin_delete_category", { p_token: token, p_id: id, p_reassign_to: reassignTo });
  var adminCreateChore = (token, emoji, title, description, categoryId, points) => rpc("mo_admin_create_chore", { p_token: token, p_emoji: emoji, p_title: title, p_description: description, p_category_id: categoryId, p_points: points });
  var adminUpdateChore = (token, id, emoji, title, description, categoryId, points) => rpc("mo_admin_update_chore", { p_token: token, p_id: id, p_emoji: emoji, p_title: title, p_description: description, p_category_id: categoryId, p_points: points });
  var adminSetChoreActive = (token, id, active) => rpc("mo_admin_set_chore_active", { p_token: token, p_id: id, p_active: active });
  var adminReorderChores = (token, ids) => rpc("mo_admin_reorder_chores", { p_token: token, p_ids: ids });
  var adminCreateReward = (token, emoji, title, description, cost) => rpc("mo_admin_create_reward", { p_token: token, p_emoji: emoji, p_title: title, p_description: description, p_cost: cost });
  var adminUpdateReward = (token, id, emoji, title, description, cost) => rpc("mo_admin_update_reward", { p_token: token, p_id: id, p_emoji: emoji, p_title: title, p_description: description, p_cost: cost });
  var adminSetRewardActive = (token, id, active) => rpc("mo_admin_set_reward_active", { p_token: token, p_id: id, p_active: active });
  var adminReorderRewards = (token, ids) => rpc("mo_admin_reorder_rewards", { p_token: token, p_ids: ids });
  var adminApproveRequest = (token, id, message) => rpc("mo_admin_approve_request", { p_token: token, p_id: id, p_message: message });
  var adminDeclineRequest = (token, id, message) => rpc("mo_admin_decline_request", { p_token: token, p_id: id, p_message: message });
  var adminFulfillRequest = (token, id) => rpc("mo_admin_fulfill_request", { p_token: token, p_id: id });
  var adminAdjustPoints = (token, delta) => rpc("mo_admin_adjust_points", { p_token: token, p_delta: delta });
  var adminUpdateSettings = (token, displayName) => rpc("mo_admin_update_settings", { p_token: token, p_display_name: displayName });
  var TABLES = ["mo_categories", "mo_chores", "mo_rewards", "mo_reward_requests", "mo_activity_log", "mo_settings"];
  function subscribeToChanges(onChange) {
    return subscribe("mo", (change) => {
      if (change.resync) TABLES.forEach((table2) => onChange({ table: table2 }));
      else onChange({ table: change.table });
    });
  }

  // marsova-opravila/strings.js
  var strings = {
    app: {
      name: "Marsova opravila",
      tagline: "woof woof mothafucka"
    },
    nav: {
      opravila: "Opravila",
      nagrade: "Nagrade",
      dogajanje: "Dogajanje"
    },
    header: {
      greeting: (name) => `\u017Divjo, ${name}`,
      available: "na voljo",
      points: "to\u010Dk",
      reserved: "rezervirano",
      lifetime: "skupaj zbrano",
      soundOn: "Izklopi zvok",
      soundOff: "Vklopi zvok",
      settings: "Skrbni\u0161ke nastavitve",
      offline: "Ni povezave \u2014 to\u010Dke se zdaj ne morejo shraniti.",
      marsIdle: "Mars pravi, da ga danes slaya\u0161.",
      marsHappy: "Mars je ponosen na tebe.",
      marsEmpty: "Mars is sooo sleepy"
    },
    account: {
      openAria: "Ra\u010Dun",
      title: "Ra\u010Dun",
      subtitle: "Prijava ni obvezna \u2014 aplikacija deluje enako naprej, prijavljena ali ne. Koristna je, \u010De \u017Eeli\u0161 do nje dostopati tudi kje drugje na apps.trplan.si, brez ovinka \u010Dez glavno stran.",
      signIn: "Prijava s Pocket ID",
      signOut: "Odjava",
      loggedInAs: (email) => `Prijavljena kot ${email}`,
      loading: "Nalagam \u2026"
    },
    chores: {
      allChip: "Vse",
      holdLabel: (points) => `Dr\u017Ei za +${points}`,
      holding: (pct) => `Dr\u017Ei\u2026 ${pct} %`,
      saving: "Shranjujem\u2026",
      done: "Opravljeno \u2713",
      holdAria: (title, points) => `Dr\u017Ei za dokon\u010Danje: ${title}, ${points} to\u010Dk`,
      hint: "Dr\u017Ei gumb pribli\u017Eno sekundo, dokler se ne napolni.",
      emptyTitle: "He is so stupid. He doesn't know anything",
      emptyBody: "Mars \u010Daka na prvo opravilo. Ko ga skrbnik doda, se pojavi to\u010Dno tukaj.",
      categoryEmptyTitle: "V tej kategoriji \u0161e ni opravil",
      categoryEmptyBody: "Poskusi Vse ali izberi drugo kategorijo.",
      completedToast: (title, points) => `${title} \xB7 +${points} to\u010Dk`,
      undoAction: "Razveljavi",
      retryAction: "Poskusi znova",
      offlineToast: "Brez povezave. Opravilo ni shranjeno.",
      errorToast: "Ni se shranilo. To\u010Dke ostajajo enake.",
      goneToast: "To opravilo je medtem izginilo. Mars ga i\u0161\u010De."
    },
    rewards: {
      available: "na voljo",
      reserved: "rezervirano",
      reservedNote: "v \u010Dakajo\u010Dih zahtevkih",
      yourRequestsTitle: "Tvoji zahtevki \u{1F43E}",
      cancel: "Prekli\u010Di",
      forExchange: "Za zamenjavo",
      gapLabel: (n) => `\u0161e ${n} to\u010Dk`,
      pointsUnit: "TO\u010CK",
      lockedNote: "Rezervirane to\u010Dke po\u010Dakajo, dokler skrbnik zahtevka ne potrdi ali zavrne.",
      emptyTitle: "Nagrade \u0161e \u010Dakajo",
      emptyBody: "Skrbnik jih \u0161e ni dodal. Ko jih doda, se pojavijo to\u010Dno tukaj, \u010Disto blizu tvojih to\u010Dk.",
      sheetCost: "Cena nagrade",
      sheetAvailableNow: "Zdaj na voljo",
      sheetAfter: "Po rezervaciji",
      sheetHold: "Dr\u017Ei za zahtevek",
      sheetHolding: (pct) => `Dr\u017Eim\u2026 ${pct} %`,
      sheetSaving: "Po\u0161iljam\u2026",
      sheetAria: (title) => `Dr\u017Ei za zahtevek: ${title}`,
      sheetCancelNote: "Zahtevek lahko prekli\u010De\u0161, dokler \u010Daka.",
      requestedToast: "Zahtevek poslan. Mars ga nese naprej.",
      cancelledToast: "Zahtevek preklican, to\u010Dke so spet tvoje.",
      insufficientToast: "Ni dovolj razpolo\u017Eljivih to\u010Dk.",
      offlineToast: "Brez povezave. Zahtevek ni poslan.",
      errorToast: "Zahtevek se ni poslal. To\u010Dke ostajajo enake.",
      goneToast: "Ta nagrada je medtem izginila.",
      notPendingToast: "Ta zahtevek je bil medtem \u017Ee obravnavan.",
      adminMessageLabel: "Sporo\u010Dilo od skrbnika",
      statusPending: "V \u010Dakanju",
      statusApproved: "Odobreno",
      statusDeclined: "Zavrnjeno",
      statusCancelled: "Preklicano",
      statusFulfilled: "Izpolnjeno"
    },
    log: {
      filterAll: "Vse",
      filterChores: "Opravila",
      filterRewards: "Nagrade",
      emptyTitle: "\u0160e ni\u010D se ni zgodilo",
      emptyBody: "Prvo opravilo bo prvi vpis v to zgodbo.",
      choreSub: (time) => `Opravilo \xB7 ${time}`,
      choreUndoneSub: (time) => `Razveljavljeno \xB7 ${time}`,
      choreUndoneTitle: (title) => `Razveljavljeno: ${title}`,
      adjustSub: (time) => `Skrbnik \xB7 ${time}`,
      adjustTitle: "Prilagoditev to\u010Dk",
      requestedSub: (time) => `V \u010Dakanju \xB7 ${time}`,
      cancelledSub: (time) => `Preklicano \xB7 ${time}`,
      approvedSub: (time) => `Odobreno \xB7 ${time}`,
      declinedSub: (time) => `Zavrnjeno \xB7 ${time}`,
      fulfilledSub: (time) => `Izpolnjeno \xB7 ${time}`,
      undoAria: "Razveljavi",
      undoLockedAria: "Razveljavitev ni mogo\u010Da",
      undoSheetTitle: "Razveljavim to opravilo?",
      undoSheetBody: (title, points) => `Marsu vzamem ${points} to\u010Dk za "${title}". Vpis ostane v zgodovini kot razveljavljen.`,
      undoSheetKeep: "Pusti",
      undoSheetConfirm: "Razveljavi",
      undoLockedTitle: "Tega zdaj ne morem razveljaviti",
      undoLockedBody: "Te to\u010Dke so \u017Ee rezervirane za \u010Dakajo\u010D zahtevek. Prekli\u010Di zahtevek pod Nagrade in poskusi znova.",
      undoLockedOk: "Razumem",
      undoAlreadyToast: "To je bilo medtem \u017Ee razveljavljeno."
    },
    common: {
      close: "Zapri",
      save: "Shrani",
      cancel: "Prekli\u010Di",
      add: "Dodaj",
      edit: "Uredi",
      delete: "Izbri\u0161i",
      archive: "Arhiviraj",
      unarchive: "Obnovi",
      loading: "Nalagam\u2026",
      retry: "Poskusi znova",
      genericError: "Nekaj je \u0161lo narobe. Poskusi znova.",
      offlineError: "Ni povezave. Preveri internet in poskusi znova.",
      unsavedWarning: "Sprememb nisi shranil."
    },
    footer: {
      tip: "Pridr\u017Ei gumb za dokon\u010Danje opravila in poglej, kam odletijo to\u010Dke. Nato zahtevaj nagrado pod Nagrade \u2014 Mars jo nese naprej."
    },
    // ── admin ──────────────────────────────────────────────────────────────
    adminNav: {
      pregled: "Pregled",
      opravila: "Opravila",
      kategorije: "Kategorije",
      nagrade: "Nagrade",
      zahtevki: "Zahtevki",
      dogajanje: "Dogajanje",
      nastavitve: "Nastavitve",
      lock: "Zakleni skrbni\u0161ki na\u010Din",
      backToApp: "Nazaj v aplikacijo"
    },
    adminPin: {
      titleLogin: "Skrbni\u0161ki na\u010Din",
      titleBootstrap: "Nastavi skrbni\u0161ki PIN",
      subtitleLogin: "Vnesi svoj PIN, da uredi\u0161 opravila, nagrade in zahtevke.",
      subtitleBootstrap: "To je prvi obisk skrbni\u0161kega dela. Izberi PIN, ki si ga bo\u0161 zapomnil.",
      confirmLabel: "Ponovi PIN",
      submitLogin: "Odkleni",
      submitBootstrap: "Nastavi PIN",
      show: "Poka\u017Ei",
      hide: "Skrij",
      wrongPin: "Napa\u010Den PIN. Poskusi znova.",
      tooShort: "PIN naj ima vsaj 4 \u0161tevilke.",
      mismatch: "PIN se ne ujema. Poskusi \u0161e enkrat.",
      rateLimited: "Preve\u010D napa\u010Dnih poskusov. Po\u010Dakaj nekaj minut in poskusi znova.",
      notConfigured: "PIN \u0161e ni nastavljen. Osve\u017Ei stran in poskusi znova.",
      checking: "Preverjam\u2026",
      backLink: "Nazaj brez vnosa",
      expired: "Skrbni\u0161ka seja je potekla. Vnesi PIN znova."
    },
    adminOverview: {
      title: "Pregled",
      pendingTitle: "\u010Cakajo\u010Di zahtevki",
      pendingEmpty: "Trenutno ni \u010Dakajo\u010Dih zahtevkov.",
      pendingCta: "Poglej vse",
      pointsTitle: "To\u010Dke",
      current: "trenutno",
      reserved: "rezervirano",
      available: "na voljo",
      quickActions: "Hitra dejanja",
      addChore: "Dodaj opravilo",
      addReward: "Dodaj nagrado",
      adjustPoints: "Prilagodi to\u010Dke",
      recentActivity: "Zadnje dogajanje",
      recentEmpty: "\u0160e ni dogajanja za prikaz."
    },
    adminChores: {
      title: "Opravila",
      active: "Aktivna",
      archived: "Arhivirana",
      empty: "\u0160e ni opravil. Dodaj prvo spodaj.",
      addTitle: "Novo opravilo",
      editTitle: "Uredi opravilo",
      emojiLabel: "Emoji",
      titleLabel: "Naslov",
      descriptionLabel: "Opis (neobvezno)",
      categoryLabel: "Kategorija",
      pointsLabel: "To\u010Dke",
      saveSuccess: "Opravilo shranjeno.",
      saveError: "Opravila ni bilo mogo\u010De shraniti.",
      archiveConfirm: (title) => `Arhiviraj "${title}"? Ne bo ve\u010D vidno njej, zgodovina ostane nedotaknjena.`,
      unarchiveConfirm: (title) => `Obnovi "${title}" med aktivna opravila?`,
      validationTitle: "Vnesi naslov.",
      validationPoints: "To\u010Dke naj bodo celo \u0161tevilo, ve\u010Dje od 0.",
      validationEmoji: "Izberi emoji.",
      reorderHint: "Povleci za spremembo vrstnega reda, ali uporabi pu\u0161\u010Dici.",
      moveUp: "Premakni navzgor",
      moveDown: "Premakni navzdol"
    },
    adminCategories: {
      title: "Kategorije",
      empty: "\u0160e ni kategorij. Dodaj prvo spodaj.",
      addTitle: "Nova kategorija",
      editTitle: "Uredi kategorijo",
      emojiLabel: "Emoji",
      nameLabel: "Ime",
      colorLabel: "Barva (neobvezno)",
      saveSuccess: "Kategorija shranjena.",
      saveError: "Kategorije ni bilo mogo\u010De shraniti.",
      deleteTitle: "Izbri\u0161i kategorijo?",
      inUseBody: (count) => `To kategorijo uporablja ${count} opravil. Izberi, kam naj se prestavijo, ali prekli\u010Di.`,
      reassignLabel: "Prestavi opravila v",
      deleteConfirm: "Izbri\u0161i",
      deleteEmptyBody: "Kategorija ni v uporabi. Izbri\u0161em jo lahko brez posledic.",
      validationName: "Vnesi ime kategorije."
    },
    adminRewards: {
      title: "Nagrade",
      active: "Aktivne",
      archived: "Arhivirane",
      empty: "\u0160e ni nagrad. Dodaj prvo spodaj.",
      addTitle: "Nova nagrada",
      editTitle: "Uredi nagrado",
      emojiLabel: "Emoji",
      titleLabel: "Naslov",
      descriptionLabel: "Opis (neobvezno)",
      costLabel: "Cena (to\u010Dke)",
      saveSuccess: "Nagrada shranjena.",
      saveError: "Nagrade ni bilo mogo\u010De shraniti.",
      archiveConfirm: (title) => `Arhiviraj "${title}"? Ne bo je ve\u010D mogo\u010De zahtevati, obstoje\u010Di zahtevki ostanejo.`,
      unarchiveConfirm: (title) => `Obnovi "${title}" med aktivne nagrade?`,
      validationTitle: "Vnesi naslov.",
      validationCost: "Cena naj bo celo \u0161tevilo, ve\u010Dje od 0."
    },
    adminRequests: {
      title: "Zahtevki",
      pendingBadge: (n) => `${n}`,
      empty: "Trenutno ni zahtevkov.",
      pendingSection: "V \u010Dakanju",
      historySection: "Pretekli zahtevki",
      requestedAt: (time) => `Zahtevano ob ${time}`,
      resultingBalance: (n) => `Razpolo\u017Eljivo po odlo\u010Ditvi: ${n} to\u010Dk`,
      approve: "Odobri",
      decline: "Zavrni",
      fulfill: "Ozna\u010Di kot izpolnjeno",
      messageLabel: "Sporo\u010Dilo zanjo (neobvezno)",
      messagePlaceholder: "Napi\u0161i nekaj toplega\u2026",
      approveConfirm: "Odobri ta zahtevek?",
      declineConfirm: "Zavrni ta zahtevek?",
      fulfillConfirm: "Ozna\u010Di kot izpolnjeno?",
      changedElsewhere: "Ta zahtevek je bila medtem \u017Ee obravnavan na drugi napravi.",
      archivedRewardNote: "Nagrada je medtem arhivirana, a zahtevek je \u0161e vedno veljaven."
    },
    adminSettings: {
      title: "Nastavitve",
      lockNow: "Zakleni skrbni\u0161ki na\u010Din",
      lockedNote: "Skrbni\u0161ka seja se samodejno kon\u010Da po 30 dneh na tej napravi.",
      displayNameLabel: "Njeno ime v pozdravu",
      displayNameSaved: "Ime shranjeno."
    },
    adminPointAdjust: {
      title: "Prilagodi to\u010Dke",
      amountLabel: "Znesek (+ ali \u2212)",
      preview: "Po potrditvi",
      current: "trenutno",
      available: "na voljo",
      submit: "Potrdi prilagoditev",
      negativeBlocked: "To bi razpolo\u017Eljive to\u010Dke spravilo pod ni\u010D.",
      invalidAmount: "Vnesi znesek, ki ni ni\u010D.",
      success: "To\u010Dke prilagojene."
    },
    errors: {
      insufficient_points: "Ni dovolj razpolo\u017Eljivih to\u010Dk.",
      insufficient_available: "Trenutno ni dovolj razpolo\u017Eljivih to\u010Dk za razveljavitev.",
      not_pending: "Ta zahtevek je bil medtem \u017Ee obravnavan na drugi napravi.",
      not_approved: "Ta zahtevek \u0161e ni odobren.",
      already_undone: "To je bilo medtem \u017Ee razveljavljeno.",
      reward_not_found: "Ta nagrada je medtem izginila.",
      chore_not_found: "To opravilo je medtem izginilo.",
      category_in_use: "Kategorijo uporabljajo obstoje\u010Da opravila.",
      would_go_negative: "To bi razpolo\u017Eljive to\u010Dke spravilo pod ni\u010D.",
      invalid_points: "To\u010Dke naj bodo celo \u0161tevilo, ve\u010Dje od 0.",
      invalid_cost: "Cena naj bo celo \u0161tevilo, ve\u010Dje od 0.",
      invalid_delta: "Vnesi znesek, ki ni ni\u010D.",
      unauthorized: "Skrbni\u0161ka seja je potekla. Vnesi PIN znova.",
      invalid_pin: "Napa\u010Den PIN. Poskusi znova.",
      rate_limited: "Preve\u010D napa\u010Dnih poskusov. Po\u010Dakaj nekaj minut in poskusi znova.",
      not_configured: "PIN \u0161e ni nastavljen. Osve\u017Ei stran in poskusi znova.",
      pin_too_short: "PIN naj ima vsaj 4 \u0161tevilke.",
      already_configured: "PIN je \u017Ee nastavljen.",
      not_found: "Tega ni bilo mogo\u010De najti. Morda je bilo medtem spremenjeno."
    }
  };
  function resolveError(err) {
    if (!err) return strings.common.genericError;
    if (err.offline) return strings.common.offlineError;
    return strings.errors[err.code] || strings.common.genericError;
  }

  // marsova-opravila/format.js
  function formatPoints(n) {
    return Math.round(n).toLocaleString("sl-SI");
  }
  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" });
  }
  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function formatDayLabel(iso) {
    const d = new Date(iso);
    const now = /* @__PURE__ */ new Date();
    if (isSameDay(d, now)) return "Danes";
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(d, yesterday)) return "V\u010Deraj";
    return d.toLocaleDateString("sl-SI", { day: "numeric", month: "long" });
  }
  function dayKey(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  // marsova-opravila/activity.js
  var KIND_TO_GROUP = {
    chore_completed: "opravila",
    chore_undone: "opravila",
    reward_requested: "nagrade",
    reward_cancelled: "nagrade",
    reward_approved: "nagrade",
    reward_declined: "nagrade",
    reward_fulfilled: "nagrade",
    point_adjustment: "opravila"
  };
  function describeEntry(entry, undoneRefIds, available) {
    const time = formatTime(entry.created_at);
    switch (entry.kind) {
      case "chore_completed": {
        const undone = undoneRefIds.has(entry.id);
        const canUndo = !undone && available - entry.delta >= 0;
        const lockUndo = !undone && !canUndo;
        return {
          emoji: entry.emoji,
          title: entry.title,
          sub: strings.log.choreSub(time),
          amountText: "+" + formatPoints(entry.delta),
          amountClass: "pos",
          showUndo: canUndo,
          showLockUndo: lockUndo
        };
      }
      case "chore_undone":
        return { emoji: entry.emoji, title: entry.title, sub: strings.log.choreUndoneSub(time), amountText: formatPoints(entry.delta), amountClass: "dim" };
      case "reward_requested":
        return { emoji: entry.emoji, title: entry.title, sub: strings.log.requestedSub(time), amountText: formatPoints(entry.delta), amountClass: "neg" };
      case "reward_cancelled":
        return { emoji: entry.emoji, title: entry.title, sub: strings.log.cancelledSub(time), amountText: "\u2014", amountClass: "dim" };
      case "reward_approved":
        return { emoji: entry.emoji, title: entry.title, sub: strings.log.approvedSub(time), amountText: "\u2014", amountClass: "dim", note: entry.admin_message };
      case "reward_declined":
        return { emoji: entry.emoji, title: entry.title, sub: strings.log.declinedSub(time), amountText: "\u2014", amountClass: "dim", note: entry.admin_message };
      case "reward_fulfilled":
        return { emoji: entry.emoji, title: entry.title, sub: strings.log.fulfilledSub(time), amountText: "\u2014", amountClass: "dim" };
      case "point_adjustment":
        return {
          emoji: entry.emoji,
          title: strings.log.adjustTitle,
          sub: strings.log.adjustSub(time),
          amountText: (entry.delta > 0 ? "+" : "") + formatPoints(entry.delta),
          amountClass: entry.delta >= 0 ? "pos" : "neg"
        };
      default:
        return { emoji: "\u2728", title: entry.title, sub: time, amountText: "\u2014", amountClass: "dim" };
    }
  }

  // marsova-opravila/ui.jsx
  var { useState, useEffect, useRef, useCallback, createContext, useContext } = React;
  var theme = {
    bg: "#EFE2D3",
    bgGrad: "radial-gradient(120% 80% at 50% 0%, #F7ECE0 0%, #E9DAC8 100%)",
    card: "#FFFCF7",
    cardBorder: "#EFE0D0",
    panel: "#FBF3EA",
    headerGrad: "linear-gradient(180deg,#FDF7F0 0%,#FBF1E6 100%)",
    headerBorder: "#F0E1D1",
    ink: "#3A2E28",
    inkSoft: "#5C4A40",
    muted: "#93806F",
    mutedSoft: "#A8798A",
    rose: "#B4405C",
    roseDeep: "#A03F58",
    roseSoft: "#E08FA3",
    roseBg: "linear-gradient(160deg,#FCEEF1 0%,#F8E2E7 100%)",
    roseBgFlat: "#FCEEF1",
    roseBorder: "#F2D5DC",
    chip: "#F6E9DC",
    chipBorder: "#EBD8C6",
    sand: "#F5F1E7",
    sandBorder: "#E8E2D2",
    sage: "#6F7D52",
    sageBg: "#F1F3E6",
    sageBorder: "#E2E7D0",
    warn: "#8A6A34",
    warnBg: "#F4E3C9",
    warnBorder: "#E7CFAA",
    bad: "#8E3A46",
    badBg: "#F3EBEA",
    fontScript: "Caveat, cursive",
    fontDisplay: "'Baloo 2', system-ui, sans-serif",
    fontBody: "Nunito, system-ui, sans-serif"
  };
  function useAnimatedNumber(target, reducedMotion) {
    const [shown, setShown] = useState(target);
    const rafRef = useRef(null);
    const fromRef = useRef(target);
    const prevTarget = useRef(target);
    useEffect(() => {
      if (target === prevTarget.current) return;
      fromRef.current = shown;
      prevTarget.current = target;
      if (reducedMotion) {
        setShown(target);
        return;
      }
      cancelAnimationFrame(rafRef.current);
      const from = fromRef.current;
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 520);
        const eased = 1 - Math.pow(1 - k, 3);
        setShown(Math.round(from + (target - from) * eased));
        if (k < 1) rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
      return () => cancelAnimationFrame(rafRef.current);
    }, [target, reducedMotion]);
    return shown;
  }
  function useReducedMotionPref() {
    const [rm, setRm] = useState(
      () => typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false
    );
    useEffect(() => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const onChange = () => setRm(mq.matches);
      mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
      return () => mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange);
    }, []);
    return rm;
  }
  var SoundContext = createContext(null);
  var useSound = () => useContext(SoundContext);
  function SoundProvider({ children }) {
    const [enabled, setEnabled] = useState(() => {
      try {
        const raw = localStorage.getItem("marsova_sound");
        return raw === null ? true : raw === "1";
      } catch {
        return true;
      }
    });
    const acRef = useRef(null);
    const toggle = useCallback(() => {
      setEnabled((prev) => {
        const next = !prev;
        try {
          localStorage.setItem("marsova_sound", next ? "1" : "0");
        } catch {
        }
        return next;
      });
    }, []);
    const beep = useCallback((kind) => {
      if (!enabled) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        acRef.current = acRef.current || new AC();
        const ac = acRef.current;
        const map = { ok: [523, 784], bad: [220, 165], req: [659, 988] };
        const notes = map[kind] || map.ok;
        notes.forEach((f, i) => {
          const o = ac.createOscillator(), g = ac.createGain();
          o.type = "sine";
          o.frequency.value = f;
          const t = ac.currentTime + i * 0.09;
          g.gain.setValueAtTime(1e-4, t);
          g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
          g.gain.exponentialRampToValueAtTime(1e-4, t + 0.22);
          o.connect(g);
          g.connect(ac.destination);
          o.start(t);
          o.stop(t + 0.24);
        });
      } catch {
      }
    }, [enabled]);
    const buzz = useCallback((ms) => {
      try {
        navigator.vibrate && navigator.vibrate(ms);
      } catch {
      }
    }, []);
    return /* @__PURE__ */ React.createElement(SoundContext.Provider, { value: { enabled, toggle, beep, buzz } }, children);
  }
  function HoldControl({
    durationMs = 800,
    onComplete,
    onError,
    optimistic = false,
    label,
    ariaLabel,
    disabled,
    height = 54,
    radius = 18,
    idleBg = theme.chip,
    idleBorder = theme.chipBorder,
    fillFrom = "#F3C3CE",
    fillTo = "#E8879E",
    textColor = "#5F4640"
  }) {
    const [phase, setPhase] = useState("idle");
    const [pct, setPct] = useState(0);
    const rafRef = useRef(null);
    const t0Ref = useRef(0);
    const tickRef = useRef(0);
    const sound = useSound();
    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
    const finish = useCallback(async () => {
      cancelAnimationFrame(rafRef.current);
      setPhase(optimistic ? "done" : "saving");
      if (optimistic) sound && sound.buzz(28);
      try {
        await Promise.all([
          onComplete(),
          optimistic && new Promise((resolve) => setTimeout(resolve, 1400))
        ]);
        if (!optimistic) {
          setPhase("done");
          sound && sound.buzz(28);
          await new Promise((resolve) => setTimeout(resolve, 1400));
        }
        setPhase("idle");
        setPct(0);
      } catch (err) {
        setPhase("idle");
        setPct(0);
        sound && sound.beep("bad");
        onError && onError(err);
      }
    }, [onComplete, onError, optimistic, sound]);
    const start = useCallback(() => {
      if (disabled || phase !== "idle") return;
      t0Ref.current = performance.now();
      tickRef.current = 0;
      setPhase("holding");
      const step = (now) => {
        const k = Math.min(1, (now - t0Ref.current) / durationMs);
        if (k > 0.33 && tickRef.current < 1) {
          tickRef.current = 1;
          sound && sound.buzz(8);
        }
        if (k > 0.66 && tickRef.current < 2) {
          tickRef.current = 2;
          sound && sound.buzz(8);
        }
        setPct(k);
        if (k >= 1) {
          finish();
        } else {
          rafRef.current = requestAnimationFrame(step);
        }
      };
      rafRef.current = requestAnimationFrame(step);
    }, [disabled, phase, durationMs, finish, sound]);
    const cancel = useCallback(() => {
      if (phase !== "holding") return;
      cancelAnimationFrame(rafRef.current);
      if (pct > 0.12) sound && sound.beep("bad");
      setPhase("idle");
      setPct(0);
    }, [phase, pct, sound]);
    const pctNum = phase === "holding" ? Math.round(pct * 100) : phase === "saving" || phase === "done" ? 100 : 0;
    const fillWidth = phase === "idle" ? "0%" : `${pctNum}%`;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: disabled ? -1 : 0,
        "aria-label": ariaLabel,
        "aria-disabled": disabled || void 0,
        onPointerDown: start,
        onPointerUp: cancel,
        onPointerLeave: cancel,
        onPointerCancel: cancel,
        onKeyDown: (e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            start();
          }
        },
        onKeyUp: (e) => {
          if (e.key === " " || e.key === "Enter") cancel();
        },
        style: {
          position: "relative",
          overflow: "hidden",
          height,
          borderRadius: radius,
          background: idleBg,
          border: `1.5px solid ${idleBorder}`,
          display: "grid",
          placeItems: "center",
          cursor: disabled ? "default" : "pointer",
          userSelect: "none",
          touchAction: "none",
          WebkitTapHighlightColor: "transparent",
          opacity: disabled ? 0.55 : 1,
          outlineOffset: 2
        }
      },
      /* @__PURE__ */ React.createElement("div", { style: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        background: `linear-gradient(90deg, ${fillFrom}, ${fillTo})`,
        width: fillWidth,
        transition: phase === "idle" ? "width .15s ease-out" : "none"
      } }),
      /* @__PURE__ */ React.createElement("div", { style: { position: "relative", fontWeight: 800, fontSize: 15, color: textColor } }, label(phase, pctNum))
    );
  }
  function Toast({ toast, onAction }) {
    if (!toast) return null;
    const bad = !!toast.bad;
    return /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      left: 14,
      right: 14,
      bottom: 96,
      zIndex: 40,
      animation: "msRise .28s cubic-bezier(.2,.9,.3,1.2)"
    } }, /* @__PURE__ */ React.createElement("div", { style: {
      background: bad ? theme.bad : theme.ink,
      borderRadius: 20,
      padding: "13px 15px",
      display: "flex",
      alignItems: "center",
      gap: 11,
      boxShadow: bad ? "0 12px 26px -10px rgba(142,58,70,.5)" : "0 12px 26px -10px rgba(58,46,40,.55)"
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, toast.icon), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, color: bad ? "#FDF1F2" : "#FBF3EA", fontWeight: 700, fontSize: 14, lineHeight: 1.3 } }, toast.text), toast.actionLabel && /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: onAction,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onAction();
          }
        },
        style: {
          flex: "0 0 auto",
          height: 38,
          padding: "0 14px",
          borderRadius: 12,
          background: bad ? "#A8515D" : "#5C4A40",
          display: "grid",
          placeItems: "center",
          color: "#FFF",
          fontWeight: 800,
          fontSize: 13.5,
          cursor: "pointer"
        }
      },
      toast.actionLabel
    )));
  }
  function Sheet({ open: open2, onClose, children }) {
    if (!open2) return null;
    return /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        "aria-label": "Zapri",
        onClick: onClose,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") onClose();
        },
        style: { position: "absolute", inset: 0, background: "rgba(58,46,40,.42)", animation: "msFade .2s ease-out" }
      }
    ), /* @__PURE__ */ React.createElement("div", { style: {
      position: "relative",
      background: "#FDF7F0",
      borderRadius: "32px 32px 0 0",
      padding: "10px 22px max(30px, env(safe-area-inset-bottom))",
      boxShadow: "0 -14px 40px -14px rgba(58,46,40,.4)",
      animation: "msRise .32s cubic-bezier(.2,.9,.3,1.15)",
      maxHeight: "88%",
      overflowY: "auto"
    } }, /* @__PURE__ */ React.createElement("div", { style: { width: 44, height: 5, borderRadius: 3, background: "#E6D6C4", margin: "0 auto 16px" } }), children));
  }
  function EmptyState({ image, emoji, title, body, size = 120 }) {
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "34px 30px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 } }, image ? /* @__PURE__ */ React.createElement("img", { src: image, alt: "", style: { width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "3px solid #FFFFFF", boxShadow: "0 6px 16px rgba(120,80,50,.18)" } }) : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 34 } }, emoji), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 27, lineHeight: 1, color: theme.ink } }, title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, color: theme.muted, lineHeight: 1.45, maxWidth: 250 } }, body));
  }
  function Chip({ active, onClick, children }) {
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
        style: {
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 40,
          padding: "0 15px",
          borderRadius: 14,
          whiteSpace: "nowrap",
          cursor: "pointer",
          fontWeight: active ? 800 : 700,
          fontSize: 13.5,
          background: active ? theme.ink : "#FFFCF7",
          border: active ? "none" : `1px solid ${theme.cardBorder}`,
          color: active ? "#FBF3EA" : "#6E5A4E",
          boxShadow: active ? "0 3px 0 rgba(58,46,40,.2)" : "none"
        }
      },
      children
    );
  }
  function SkeletonList({ count = 3 }) {
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 } }, Array.from({ length: count }).map((_, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: {
      height: 132,
      borderRadius: 26,
      background: i === count - 1 ? "#F5E9DC" : "linear-gradient(90deg,#F5E9DC 0%,#FBF3EA 50%,#F5E9DC 100%)",
      backgroundSize: "240px 100%",
      animation: i === count - 1 ? "none" : "msShim 1.1s linear infinite",
      opacity: i === count - 1 ? 0.6 : 1
    } })));
  }
  function ConfirmSheet({ open: open2, title, body, confirmLabel, cancelLabel = "Prekli\u010Di", onConfirm, onCancel, danger }) {
    return /* @__PURE__ */ React.createElement(Sheet, { open: open2, onClose: onCancel }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 15 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink, lineHeight: 1.1 } }, title), body && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, color: "#7C6A5C", lineHeight: 1.45 } }, body), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: onCancel,
        style: { flex: 1, height: 52, borderRadius: 17, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#7C6A5C", cursor: "pointer" }
      },
      cancelLabel
    ), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: onConfirm,
        style: { flex: 1, height: 52, borderRadius: 17, background: danger ? theme.bad : theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#FBF3EA", cursor: "pointer" }
      },
      confirmLabel
    ))));
  }
  var EMOJI_GROUPS = [
    { label: "Dom", emojis: ["\u{1F3E1}", "\u{1F9F9}", "\u{1F9FA}", "\u{1F9FD}", "\u{1F9F4}", "\u{1FAA3}", "\u{1F6CF}\uFE0F", "\u{1F6BF}", "\u{1FA9F}", "\u{1F5D1}\uFE0F", "\u{1F9FB}", "\u{1F56F}\uFE0F", "\u{1F9E6}"] },
    { label: "Kuhinja", emojis: ["\u{1F373}", "\u{1F37D}\uFE0F", "\u{1F958}", "\u{1F355}", "\u{1F957}", "\u{1F35E}", "\u{1F9C1}", "\u{1F36A}", "\u2615", "\u{1F377}", "\u{1F36B}", "\u{1F370}", "\u{1F95E}", "\u{1F37F}"] },
    { label: "Mars in \u017Eivali", emojis: ["\u{1F43E}", "\u{1F415}", "\u{1F408}", "\u{1F9B4}", "\u{1F407}", "\u{1F426}", "\u{1F420}"] },
    { label: "Zunaj", emojis: ["\u{1F33F}", "\u{1F331}", "\u{1F33B}", "\u{1F697}", "\u{1F6B2}", "\u{1F6D2}", "\u{1F4E6}", "\u267B\uFE0F", "\u2600\uFE0F", "\u{1F327}\uFE0F"] },
    { label: "Zabava in nagrade", emojis: ["\u{1F3AC}", "\u{1F3AE}", "\u{1F3A7}", "\u{1F4DA}", "\u{1F3A8}", "\u{1F3B2}", "\u{1F381}", "\u{1F6CD}\uFE0F", "\u{1F382}", "\u{1F389}"] },
    { label: "Skrb zase", emojis: ["\u{1F9D6}", "\u{1F486}", "\u{1F6C1}", "\u{1F485}", "\u{1F634}", "\u{1F9D8}", "\u{1F4AA}", "\u{1F9F4}"] },
    { label: "\u010Custva in simboli", emojis: ["\u2764\uFE0F", "\u{1F49B}", "\u{1F496}", "\u{1F497}", "\u2728", "\u2B50", "\u{1F31F}", "\u{1F44D}", "\u2705", "\u23F0", "\u{1F4C5}", "\u{1F3F7}\uFE0F"] }
  ];
  function EmojiPicker({ value, onChange, ariaLabel }) {
    const [open2, setOpen] = useState(false);
    const wrapRef = useRef(null);
    useEffect(() => {
      if (!open2) return;
      const onDocDown = (e) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
      };
      const onKey = (e) => {
        if (e.key === "Escape") setOpen(false);
      };
      document.addEventListener("mousedown", onDocDown);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("mousedown", onDocDown);
        document.removeEventListener("keydown", onKey);
      };
    }, [open2]);
    return /* @__PURE__ */ React.createElement("div", { ref: wrapRef, style: { position: "relative", display: "inline-block" } }, /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        "aria-label": ariaLabel,
        "aria-expanded": open2,
        onClick: () => setOpen((o) => !o),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        },
        style: {
          width: 52,
          height: 46,
          borderRadius: 14,
          border: `1.5px solid ${theme.cardBorder}`,
          background: "#FFFCF7",
          display: "grid",
          placeItems: "center",
          fontSize: 22,
          cursor: "pointer",
          marginTop: 4
        }
      },
      value || "\u2753"
    ), open2 && /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      zIndex: 20,
      top: "calc(100% + 6px)",
      left: 0,
      width: 288,
      maxWidth: "min(288px, 80vw)",
      background: "#FFFCF7",
      border: `1.5px solid ${theme.cardBorder}`,
      borderRadius: 18,
      boxShadow: "0 16px 32px -12px rgba(58,46,40,.35)",
      padding: 10,
      display: "flex",
      flexDirection: "column",
      gap: 8
    } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        autoFocus: true,
        value: value || "",
        placeholder: "\u{1F50D} prilepi ali natipkaj",
        onChange: (e) => onChange(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setOpen(false);
          }
        },
        style: {
          width: "100%",
          height: 38,
          borderRadius: 11,
          border: `1px solid ${theme.cardBorder}`,
          background: "#fff",
          padding: "0 12px",
          fontSize: 15,
          color: theme.ink,
          fontFamily: theme.fontBody
        }
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "mo-hs", style: { maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 } }, EMOJI_GROUPS.map((g) => /* @__PURE__ */ React.createElement("div", { key: g.label }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, fontWeight: 800, color: theme.mutedSoft, textTransform: "uppercase", letterSpacing: ".03em", margin: "2px 2px 4px" } }, g.label), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 } }, g.emojis.map((e, i) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: e + i,
        role: "button",
        tabIndex: 0,
        "aria-label": e,
        onClick: () => {
          onChange(e);
          setOpen(false);
        },
        onKeyDown: (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onChange(e);
            setOpen(false);
          }
        },
        style: {
          height: 34,
          borderRadius: 9,
          display: "grid",
          placeItems: "center",
          fontSize: 18,
          cursor: "pointer",
          background: value === e ? theme.roseBgFlat : "transparent",
          border: value === e ? `1px solid ${theme.roseBorder}` : "1px solid transparent"
        }
      },
      e
    ))))))));
  }
  var globalCss = `
  *{box-sizing:border-box}
  body{margin:0;background:${theme.bg};font-family:${theme.fontBody};-webkit-font-smoothing:antialiased}
  a{color:${theme.rose};text-decoration:none}
  a:hover{color:${theme.roseDeep}}
  .mo-hs::-webkit-scrollbar{display:none}
  .mo-hs{scrollbar-width:none}
  input, textarea, select { font-family: ${theme.fontBody}; }
  @keyframes msRise{from{transform:translateY(120%)}to{transform:translateY(0)}}
  @keyframes msFade{from{opacity:0}to{opacity:1}}
  @keyframes msPop{0%{transform:scale(.7);opacity:0}55%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}
  @keyframes msFly{0%{transform:translateY(0) scale(1);opacity:1}100%{transform:translateY(-70px) scale(.7);opacity:0}}
  @keyframes msShim{0%{background-position:-240px 0}100%{background-position:240px 0}}
  @keyframes msCelebrate{0%{transform:scale(1) rotate(0deg)}16%{transform:scale(1.05) rotate(-1.3deg)}34%{transform:scale(1.035) rotate(1.2deg)}54%{transform:scale(1.022) rotate(-.8deg)}74%{transform:scale(1.01) rotate(.45deg)}100%{transform:scale(1) rotate(0deg)}}
`;

  // marsova-opravila/Account.jsx
  var saveBtn = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };
  function AccountIcon({ onClick }) {
    const session = useSession();
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        "aria-label": strings.account.openAria,
        onClick,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
        style: { width: 38, height: 38, borderRadius: 13, background: theme.chip, border: `1px solid ${theme.chipBorder}`, display: "grid", placeItems: "center", fontSize: 14, color: "#9A8574", cursor: "pointer" }
      },
      session ? "\u{1F464}" : "\u{1F510}"
    );
  }
  function AccountSheet({ open: open2, onClose }) {
    const session = useSession();
    return /* @__PURE__ */ React.createElement(Sheet, { open: open2, onClose }, /* @__PURE__ */ React.createElement(AccountSheetContent, { session }));
  }
  function AccountSheetContent({ session }) {
    if (session === void 0) {
      return /* @__PURE__ */ React.createElement("div", { style: { padding: "20px 4px", fontSize: 13.5, color: theme.muted } }, strings.account.loading);
    }
    if (session) {
      return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink } }, strings.account.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, color: theme.inkSoft } }, strings.account.loggedInAs(session.user.email)), /* @__PURE__ */ React.createElement(
        "div",
        {
          role: "button",
          tabIndex: 0,
          onClick: () => signOut(),
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              signOut();
            }
          },
          style: { alignSelf: "flex-start", padding: "12px 20px", borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", fontWeight: 800, fontSize: 14, color: theme.bad, cursor: "pointer" }
        },
        strings.account.signOut
      ));
    }
    return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink } }, strings.account.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: theme.muted, lineHeight: 1.4 } }, strings.account.subtitle), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 6 } }, /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: () => signIn(),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            signIn();
          }
        },
        style: saveBtn
      },
      strings.account.signIn
    )));
  }

  // marsova-opravila/UserApp.jsx
  var { useState: useState2, useEffect: useEffect2, useCallback: useCallback2, useMemo, useRef: useRef2 } = React;
  var MARS_IDLE = "./marsova-opravila/mars-idle.jpg";
  var MARS_SLEEPY = "./marsova-opravila/mars-sleepy.jpg";
  var MARS_CELEBRATE = "./marsova-opravila/mars-celebrate.jpg";
  var MARS_EXCITED = "./marsova-opravila/mars-excited.jpg";
  var CHORE_HOLD_MS = 800;
  var REWARD_HOLD_MS = 650;
  function useOnlineStatus() {
    const [online, setOnline] = useState2(() => typeof navigator !== "undefined" ? navigator.onLine : true);
    useEffect2(() => {
      const on = () => setOnline(true), off = () => setOnline(false);
      window.addEventListener("online", on);
      window.addEventListener("offline", off);
      return () => {
        window.removeEventListener("online", on);
        window.removeEventListener("offline", off);
      };
    }, []);
    return online;
  }
  function UserApp({ onOpenAdmin }) {
    return /* @__PURE__ */ React.createElement(SoundProvider, null, /* @__PURE__ */ React.createElement(UserAppInner, { onOpenAdmin }));
  }
  function UserAppInner({ onOpenAdmin }) {
    const sound = useSound();
    const reducedMotion = useReducedMotionPref();
    const online = useOnlineStatus();
    const [screen, setScreen] = useState2("opravila");
    const [category, setCategory] = useState2("vse");
    const [logFilter, setLogFilter] = useState2("vse");
    const [categories, setCategories] = useState2([]);
    const [chores, setChores] = useState2([]);
    const [rewards, setRewards] = useState2([]);
    const [requests, setRequests] = useState2([]);
    const [log, setLog] = useState2([]);
    const [points, setPoints] = useState2({ current_balance: 0, reserved: 0, available: 0, lifetime: 0 });
    const [settings, setSettings] = useState2({ display_name: "\u2026" });
    const [initialLoading, setInitialLoading] = useState2(true);
    const [loadError, setLoadError] = useState2(false);
    const [hasCompletedOnce, setHasCompletedOnce] = useState2(false);
    const [toast, setToast] = useState2(null);
    const toastTimer = useRef2(null);
    const [sheet, setSheet] = useState2(null);
    const [accountOpen, setAccountOpen] = useState2(false);
    const [marsHappy, setMarsHappy] = useState2(false);
    const [fly, setFly] = useState2(null);
    const flyTimer = useRef2(null);
    const happyTimer = useRef2(null);
    const showToast = useCallback2((t) => {
      clearTimeout(toastTimer.current);
      setToast(t);
      toastTimer.current = setTimeout(() => setToast(null), t.ms || 5500);
    }, []);
    const celebrate = useCallback2((pointsGained) => {
      setMarsHappy(true);
      setFly("+" + pointsGained);
      clearTimeout(happyTimer.current);
      clearTimeout(flyTimer.current);
      happyTimer.current = setTimeout(() => setMarsHappy(false), 1400);
      flyTimer.current = setTimeout(() => setFly(null), 1e3);
      sound.buzz(28);
      sound.beep("ok");
    }, [sound]);
    useEffect2(() => () => {
      clearTimeout(toastTimer.current);
      clearTimeout(happyTimer.current);
      clearTimeout(flyTimer.current);
    }, []);
    const loadAll = useCallback2(async () => {
      try {
        const [cats, chs, rws, reqs, lg, pts, st] = await Promise.all([
          fetchCategories(),
          fetchChores(),
          fetchRewards(),
          fetchRewardRequests(),
          fetchActivityLog(),
          fetchPointsSummary(),
          fetchSettings()
        ]);
        setCategories(cats);
        setChores(chs);
        setRewards(rws);
        setRequests(reqs);
        setLog(lg);
        setPoints(pts);
        setSettings(st);
        setLoadError(false);
        if (lg.some((e) => e.kind === "chore_completed")) setHasCompletedOnce(true);
      } catch {
        setLoadError(true);
      } finally {
        setInitialLoading(false);
      }
    }, []);
    useEffect2(() => {
      loadAll();
    }, [loadAll]);
    useEffect2(() => {
      const unsubscribe = subscribeToChanges(({ table: table2 }) => {
        if (table2 === "mo_categories") fetchCategories().then(setCategories).catch(() => {
        });
        if (table2 === "mo_chores") fetchChores().then(setChores).catch(() => {
        });
        if (table2 === "mo_rewards") fetchRewards().then(setRewards).catch(() => {
        });
        if (table2 === "mo_settings") fetchSettings().then(setSettings).catch(() => {
        });
        if (table2 === "mo_reward_requests") {
          fetchRewardRequests().then(setRequests).catch(() => {
          });
          fetchPointsSummary().then(setPoints).catch(() => {
          });
        }
        if (table2 === "mo_activity_log") {
          fetchActivityLog().then(setLog).catch(() => {
          });
          fetchPointsSummary().then(setPoints).catch(() => {
          });
        }
      });
      return unsubscribe;
    }, []);
    const shownAvail = useAnimatedNumber(points.available, reducedMotion);
    const completeChore2 = useCallback2(async (chore) => {
      celebrate(chore.points);
      const row = await completeChore(chore.id);
      setLog((l) => [row, ...l]);
      setHasCompletedOnce(true);
      const pts = await fetchPointsSummary();
      setPoints(pts);
      showToast({
        icon: "\u{1F389}",
        text: strings.chores.completedToast(chore.title, chore.points),
        actionLabel: strings.chores.undoAction,
        ms: 6e3,
        action: async () => {
          try {
            const undoRow = await undoChoreCompletion(row.id);
            setLog((l) => [undoRow, ...l]);
            setPoints(await fetchPointsSummary());
            setToast(null);
            sound.beep("bad");
          } catch (err) {
            showToast({ bad: true, icon: "\u{1F648}", text: resolveError(err), ms: 4500 });
          }
        }
      });
    }, [celebrate, showToast, sound]);
    const handleChoreError = useCallback2((chore) => (err) => {
      showToast({
        bad: true,
        icon: err.offline ? "\u{1F4E1}" : "\u{1F648}",
        text: resolveError(err),
        ms: 5e3,
        actionLabel: err.offline ? void 0 : strings.chores.retryAction
      });
    }, [showToast]);
    const confirmUndo = useCallback2(async (entry) => {
      try {
        const undoRow = await undoChoreCompletion(entry.id);
        setLog((l) => [undoRow, ...l]);
        setPoints(await fetchPointsSummary());
        setSheet(null);
        sound.beep("bad");
      } catch (err) {
        setSheet(null);
        showToast({ bad: true, icon: "\u{1F648}", text: resolveError(err), ms: 5e3 });
      }
    }, [showToast, sound]);
    const openReward = useCallback2((reward) => setSheet({ type: "reward", payload: reward }), []);
    const closeSheet = useCallback2(() => setSheet(null), []);
    const confirmReward = useCallback2(async (reward) => {
      const row = await requestReward(reward.id);
      setRequests((r) => [row, ...r]);
      setPoints(await fetchPointsSummary());
      setLog(await fetchActivityLog());
      setSheet(null);
      sound.buzz(24);
      sound.beep("req");
      showToast({ icon: "\u{1F48C}", text: strings.rewards.requestedToast });
    }, [showToast, sound]);
    const cancelRequest = useCallback2(async (req) => {
      try {
        await cancelRewardRequest(req.id);
        setRequests((r) => r.filter((x) => x.id !== req.id));
        setPoints(await fetchPointsSummary());
        setLog(await fetchActivityLog());
        showToast({ icon: "\u21A9\uFE0F", text: strings.rewards.cancelledToast });
      } catch (err) {
        showToast({ bad: true, icon: "\u{1F648}", text: resolveError(err), ms: 5e3 });
      }
    }, [showToast]);
    const marsLine = initialLoading ? "" : chores.filter((c) => c.active).length === 0 ? strings.header.marsEmpty : marsHappy ? strings.header.marsHappy : strings.header.marsIdle;
    return /* @__PURE__ */ React.createElement("div", { style: { height: "100vh", maxHeight: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden", background: theme.bgGrad } }, /* @__PURE__ */ React.createElement("div", { style: {
      position: "relative",
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      maxWidth: 560,
      width: "100%",
      margin: "0 auto",
      background: theme.panel,
      boxShadow: "0 0 0 1px rgba(210,191,169,.4)"
    } }, /* @__PURE__ */ React.createElement(
      Header,
      {
        name: settings.display_name,
        marsLine,
        marsHappy,
        shownAvail,
        reserved: points.reserved,
        lifetime: points.lifetime,
        fly,
        sound,
        online,
        onOpenAdmin,
        onOpenAccount: () => setAccountOpen(true)
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "mo-hs", style: { position: "relative", flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 18 } }, loadError && !initialLoading && /* @__PURE__ */ React.createElement(ErrorBanner, { onRetry: loadAll }), screen === "opravila" && /* @__PURE__ */ React.createElement(
      Opravila,
      {
        loading: initialLoading,
        categories,
        chores,
        category,
        setCategory,
        onComplete: completeChore2,
        onError: handleChoreError,
        reducedMotion,
        hasCompletedOnce
      }
    ), screen === "nagrade" && /* @__PURE__ */ React.createElement(
      Nagrade,
      {
        loading: initialLoading,
        rewards,
        requests,
        available: points.available,
        reserved: points.reserved,
        onOpen: openReward,
        onCancel: cancelRequest
      }
    ), screen === "dogajanje" && /* @__PURE__ */ React.createElement(
      Dogajanje,
      {
        loading: initialLoading,
        log,
        filter: logFilter,
        setFilter: setLogFilter,
        available: points.available,
        onUndo: (entry) => setSheet({ type: "undo", payload: entry }),
        onWhy: () => setSheet({ type: "why" })
      }
    )), /* @__PURE__ */ React.createElement(Toast, { toast, onAction: () => toast && toast.action && toast.action() }), /* @__PURE__ */ React.createElement(Sheet, { open: sheet && sheet.type === "reward", onClose: closeSheet }, sheet && sheet.type === "reward" && /* @__PURE__ */ React.createElement(RewardSheet, { reward: sheet.payload, available: points.available, onConfirm: confirmReward, onError: (err) => {
      setSheet(null);
      showToast({ bad: true, icon: err.offline ? "\u{1F4E1}" : "\u{1F648}", text: resolveError(err), ms: 5e3 });
    } })), /* @__PURE__ */ React.createElement(Sheet, { open: sheet && sheet.type === "undo", onClose: closeSheet }, sheet && sheet.type === "undo" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 15 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 30, color: theme.ink, lineHeight: 1.1 } }, strings.log.undoSheetTitle), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, color: "#7C6A5C", lineHeight: 1.45 } }, strings.log.undoSheetBody(sheet.payload.title, sheet.payload.delta)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: closeSheet,
        style: { flex: 1, height: 52, borderRadius: 17, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#7C6A5C", cursor: "pointer" }
      },
      strings.log.undoSheetKeep
    ), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: () => confirmUndo(sheet.payload),
        style: { flex: 1, height: 52, borderRadius: 17, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#FBF3EA", cursor: "pointer" }
      },
      strings.log.undoSheetConfirm
    )))), /* @__PURE__ */ React.createElement(Sheet, { open: sheet && sheet.type === "why", onClose: closeSheet }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 30, color: theme.ink, lineHeight: 1.1 } }, strings.log.undoLockedTitle), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, color: "#7C6A5C", lineHeight: 1.45 } }, strings.log.undoLockedBody), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: closeSheet,
        style: { height: 52, borderRadius: 17, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#FBF3EA", cursor: "pointer" }
      },
      strings.log.undoLockedOk
    ))), /* @__PURE__ */ React.createElement(AccountSheet, { open: accountOpen, onClose: () => setAccountOpen(false) }), /* @__PURE__ */ React.createElement(BottomNav, { screen, setScreen })));
  }
  function ErrorBanner({ onRetry }) {
    return /* @__PURE__ */ React.createElement("div", { style: { margin: "12px 20px 0", background: theme.badBg, border: `1px solid ${theme.bad}33`, borderRadius: 16, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15 } }, "\u{1F648}"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, fontSize: 13, color: theme.bad, lineHeight: 1.4 } }, strings.common.genericError), /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: onRetry, style: { fontWeight: 800, fontSize: 13, color: theme.bad, cursor: "pointer" } }, strings.common.retry));
  }
  function Header({ name, marsLine, marsHappy, shownAvail, reserved, lifetime, fly, sound, online, onOpenAdmin, onOpenAccount }) {
    return /* @__PURE__ */ React.createElement("div", { style: { position: "relative", flex: "0 0 auto", padding: "max(20px, env(safe-area-inset-top)) 20px 18px", background: theme.headerGrad, borderBottom: `1px solid ${theme.headerBorder}` } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", width: 54, height: 54, flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement("img", { src: marsHappy ? MARS_CELEBRATE : MARS_IDLE, alt: "Mars", style: { width: 54, height: 54, borderRadius: "50%", objectFit: "cover", border: "2.5px solid #FFFFFF", boxShadow: "0 3px 10px rgba(120,80,50,.18)", display: "block" } }), marsHappy && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 0, left: 0, width: 54, height: 54, borderRadius: "50%", boxShadow: "0 0 0 4px rgba(226,140,162,.35)", animation: "msPop .5s ease-out" } })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 28, lineHeight: 1, color: theme.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, strings.header.greeting(name), " ", /* @__PURE__ */ React.createElement("span", { style: { fontSize: 19, color: theme.roseSoft } }, "\u2665")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: theme.muted, lineHeight: 1.25 } }, marsLine)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 7, flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        "aria-label": sound.enabled ? strings.header.soundOn : strings.header.soundOff,
        onClick: sound.toggle,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            sound.toggle();
          }
        },
        style: { width: 38, height: 38, borderRadius: 13, background: theme.chip, border: `1px solid ${theme.chipBorder}`, display: "grid", placeItems: "center", fontSize: 15, cursor: "pointer" }
      },
      sound.enabled ? "\u{1F50A}" : "\u{1F507}"
    ), /* @__PURE__ */ React.createElement(AccountIcon, { onClick: onOpenAccount }), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        "aria-label": strings.header.settings,
        onClick: onOpenAdmin,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenAdmin();
          }
        },
        style: { width: 38, height: 38, borderRadius: 13, background: theme.chip, border: `1px solid ${theme.chipBorder}`, display: "grid", placeItems: "center", fontSize: 14, color: "#9A8574", cursor: "pointer" }
      },
      "\u2699"
    ))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 16, position: "relative", background: theme.roseBg, border: `1px solid ${theme.roseBorder}`, borderRadius: 24, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 4px 0 rgba(196,86,110,.08)" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 600, fontSize: 20, lineHeight: 1, color: theme.mutedSoft } }, strings.header.available), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 42, lineHeight: 1, color: theme.rose } }, formatPoints(shownAvail)), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 600, fontSize: 16, color: "#C9788C" } }, strings.header.points))), /* @__PURE__ */ React.createElement("div", { style: { flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", textAlign: "right" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: theme.mutedSoft, lineHeight: 1.2 } }, strings.header.reserved, /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("strong", { style: { fontFamily: theme.fontDisplay, fontSize: 15, color: "#8E5A6C" } }, formatPoints(reserved))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#A08D80", lineHeight: 1.2 } }, strings.header.lifetime, /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("strong", { style: { fontFamily: theme.fontDisplay, fontSize: 15, color: theme.sage } }, formatPoints(lifetime)))), fly && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", right: 24, bottom: 10, fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 26, color: theme.sage, animation: "msFly 1s ease-out forwards", pointerEvents: "none" } }, fly)), !online && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12, background: theme.warnBg, border: `1px solid ${theme.warnBorder}`, borderRadius: 14, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, color: theme.warn, display: "flex", gap: 8, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 7, height: 7, borderRadius: "50%", background: "#C9903A", flex: "0 0 auto" } }), strings.header.offline));
  }
  function BottomNav({ screen, setScreen }) {
    const tabs = [
      { id: "opravila", icon: "\u{1F9F9}", name: strings.nav.opravila },
      { id: "nagrade", icon: "\u{1F381}", name: strings.nav.nagrade },
      { id: "dogajanje", icon: "\u{1F570}\uFE0F", name: strings.nav.dogajanje }
    ];
    return /* @__PURE__ */ React.createElement("div", { style: {
      position: "sticky",
      bottom: 0,
      zIndex: 30,
      flex: "0 0 auto",
      background: "#FDF7F0",
      borderTop: `1px solid ${theme.headerBorder}`,
      padding: "9px 12px max(14px, env(safe-area-inset-bottom)) 12px",
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 6
    } }, tabs.map((t) => {
      const on = screen === t.id;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: t.id,
          role: "button",
          tabIndex: 0,
          onClick: () => setScreen(t.id),
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setScreen(t.id);
            }
          },
          style: {
            height: 56,
            borderRadius: 18,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            cursor: "pointer",
            background: on ? theme.roseBgFlat : "transparent",
            border: on ? `1px solid #EFCBD4` : "1px solid transparent"
          }
        },
        /* @__PURE__ */ React.createElement("span", { style: { fontSize: 19, lineHeight: 1, opacity: on ? 1 : 0.5 } }, t.icon),
        /* @__PURE__ */ React.createElement("span", { style: { fontWeight: on ? 800 : 700, fontSize: 11.5, color: on ? theme.rose : "#9C8878" } }, t.name)
      );
    }));
  }
  function Opravila({ loading: loading2, categories, chores, category, setCategory, onComplete, onError, reducedMotion, hasCompletedOnce }) {
    const [party, setParty] = useState2(null);
    const activeChores = useMemo(() => chores.filter((c) => c.active), [chores]);
    const visible = useMemo(
      () => category === "vse" ? activeChores : activeChores.filter((c) => c.category_id === category),
      [activeChores, category]
    );
    const catById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
    if (loading2) return /* @__PURE__ */ React.createElement(SkeletonList, { count: 3 });
    if (activeChores.length === 0) {
      return /* @__PURE__ */ React.createElement(EmptyState, { image: MARS_SLEEPY, title: strings.chores.emptyTitle, body: strings.chores.emptyBody });
    }
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "mo-hs", style: { display: "flex", gap: 8, padding: "16px 20px 4px", overflowX: "auto" } }, /* @__PURE__ */ React.createElement(Chip, { active: category === "vse", onClick: () => setCategory("vse") }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15 } }, "\u2728"), strings.chores.allChip), categories.map((c) => /* @__PURE__ */ React.createElement(Chip, { key: c.id, active: category === c.id, onClick: () => setCategory(c.id) }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15 } }, c.emoji), c.name))), /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 20px", display: "flex", flexDirection: "column", gap: 12 } }, visible.map((c) => {
      const cat = catById[c.category_id];
      const isParty = party === c.id;
      return /* @__PURE__ */ React.createElement("div", { key: c.id, style: {
        position: "relative",
        background: theme.card,
        border: `1px solid ${theme.cardBorder}`,
        borderRadius: 26,
        padding: 15,
        display: "flex",
        flexDirection: "column",
        gap: 13,
        boxShadow: "0 5px 0 rgba(150,110,80,.07)",
        animation: isParty && !reducedMotion ? "msCelebrate .72s cubic-bezier(.3,1.1,.4,1)" : "none"
      } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 50, height: 50, flex: "0 0 auto", borderRadius: 17, background: "#F8EBDF", border: "1px solid #F0DECD", display: "grid", placeItems: "center", fontSize: 25 } }, c.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 700, fontSize: 18, lineHeight: 1.15, color: theme.ink, textWrap: "pretty" } }, c.title), c.description && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: theme.muted, lineHeight: 1.35, textWrap: "pretty" } }, c.description), cat && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 3, display: "flex", gap: 5, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 8px", borderRadius: 8, background: "#F3EDE2", fontSize: 11.5, fontWeight: 700, color: "#7C6A5C" } }, /* @__PURE__ */ React.createElement("span", null, cat.emoji), cat.name))), /* @__PURE__ */ React.createElement("div", { style: { flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 48, height: 44, borderRadius: 14, background: theme.sageBg, border: `1px solid ${theme.sageBorder}` } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 17, lineHeight: 1, color: "#5C6A44" } }, "+", c.points), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.5, fontWeight: 700, color: "#8A9470", letterSpacing: ".04em" } }, "TO\u010CK"))), /* @__PURE__ */ React.createElement(
        HoldControl,
        {
          durationMs: CHORE_HOLD_MS,
          ariaLabel: strings.chores.holdAria(c.title, c.points),
          optimistic: true,
          onComplete: async () => {
            setParty(c.id);
            setTimeout(() => setParty(null), 1400);
            await onComplete(c);
          },
          onError: onError(c),
          label: (phase, pct) => {
            if (phase === "holding") return strings.chores.holding(pct);
            if (phase === "saving") return strings.chores.saving;
            if (phase === "done") return strings.chores.done;
            return strings.chores.holdLabel(c.points);
          }
        }
      ));
    }), visible.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "26px 20px", textAlign: "center", border: "1.5px dashed #E6D3C0", borderRadius: 24, background: "#FDF8F2" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 25, lineHeight: 1, color: theme.ink } }, strings.chores.categoryEmptyTitle), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, color: theme.muted, marginTop: 5, lineHeight: 1.4 } }, strings.chores.categoryEmptyBody)), !hasCompletedOnce && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 2, display: "flex", gap: 9, alignItems: "flex-start", padding: "13px 15px", borderRadius: 20, background: theme.sand, border: `1px solid ${theme.sandBorder}` } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15, lineHeight: 1.2 } }, "\u{1F446}"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "#7C6A5C", lineHeight: 1.4 } }, strings.chores.hint))));
  }
  function Nagrade({ loading: loading2, rewards, requests, available, reserved, onOpen, onCancel }) {
    const activeRewards = useMemo(() => rewards.filter((r) => r.active), [rewards]);
    const pending = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
    const pendingRewardIds = useMemo(() => new Set(pending.map((r) => r.reward_id)), [pending]);
    if (loading2) return /* @__PURE__ */ React.createElement(SkeletonList, { count: 2 });
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 9 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, padding: "12px 14px", borderRadius: 18, background: theme.roseBgFlat, border: `1px solid ${theme.roseBorder}` } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 600, fontSize: 19, lineHeight: 1.1, color: theme.mutedSoft } }, strings.rewards.available), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 26, color: theme.rose, lineHeight: 1.1 } }, formatPoints(available))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, padding: "12px 14px", borderRadius: 18, background: theme.sand, border: `1px solid ${theme.sandBorder}` } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 600, fontSize: 19, lineHeight: 1.1, color: "#9A8A76" } }, strings.rewards.reserved), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 26, color: "#7C6A5C", lineHeight: 1.1 } }, formatPoints(reserved)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "#9A8A76", marginTop: 1 } }, strings.rewards.reservedNote))), pending.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9, marginTop: 2 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 23, lineHeight: 1, color: "#7C6A5C" } }, strings.rewards.yourRequestsTitle), pending.map((q) => /* @__PURE__ */ React.createElement("div", { key: q.id, style: { background: theme.card, border: "1.5px solid #EDD9BE", borderRadius: 22, padding: "13px 14px", display: "flex", gap: 11, alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 42, height: 42, flex: "0 0 auto", borderRadius: 14, background: "#F8EFE2", display: "grid", placeItems: "center", fontSize: 21 } }, q.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 700, fontSize: 16, color: theme.ink, lineHeight: 1.15 } }, q.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: theme.muted, marginTop: 1 } }, strings.rewards.statusPending, " \xB7 ", formatPoints(q.cost), " ", strings.rewards.pointsUnit.toLowerCase(), " \xB7 ", formatTime(q.requested_at))), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: () => onCancel(q),
        style: { flex: "0 0 auto", height: 38, padding: "0 13px", borderRadius: 13, background: theme.chip, border: `1px solid #E8D3C0`, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, color: "#8A6F5E", cursor: "pointer" }
      },
      strings.rewards.cancel
    )))), activeRewards.length === 0 ? /* @__PURE__ */ React.createElement(EmptyState, { image: MARS_SLEEPY, title: strings.rewards.emptyTitle, body: strings.rewards.emptyBody, size: 100 }) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 23, lineHeight: 1, color: "#7C6A5C", marginTop: 6 } }, strings.rewards.forExchange), activeRewards.map((r) => {
      const isPending = pendingRewardIds.has(r.id);
      const ok = !isPending && available >= r.cost;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: r.id,
          role: ok ? "button" : void 0,
          tabIndex: ok ? 0 : void 0,
          onClick: ok ? () => onOpen(r) : void 0,
          onKeyDown: ok ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(r);
            }
          } : void 0,
          style: {
            background: ok ? theme.card : "#FCF8F2",
            border: ok ? `1px solid ${theme.cardBorder}` : "1px dashed #E8D8C7",
            borderRadius: 24,
            padding: 14,
            display: "flex",
            gap: 12,
            alignItems: "center",
            cursor: ok ? "pointer" : "default",
            boxShadow: ok ? "0 5px 0 rgba(150,110,80,.07)" : "none"
          }
        },
        /* @__PURE__ */ React.createElement("div", { style: { width: 52, height: 52, flex: "0 0 auto", borderRadius: 18, background: ok ? theme.roseBgFlat : "#F5EDE4", border: ok ? "1px solid #F4DBE1" : "none", display: "grid", placeItems: "center", fontSize: 26, opacity: ok ? 1 : 0.62 } }, r.emoji),
        /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 700, fontSize: 17.5, color: ok ? theme.ink : "#7E6D60", lineHeight: 1.15, textWrap: "pretty" } }, r.title), isPending ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: theme.muted, marginTop: 2 } }, strings.rewards.statusPending) : ok ? r.description && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: theme.muted, lineHeight: 1.35, marginTop: 2 } }, r.description) : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "#A08D80", marginTop: 2 } }, strings.rewards.gapLabel(r.cost - available))),
        /* @__PURE__ */ React.createElement("div", { style: { flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 52, height: 46, borderRadius: 15, background: ok ? "#F6DEE4" : "#F3ECE3", border: ok ? "1px solid #EFCBD4" : "1px solid #E7DACC" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 17, lineHeight: 1, color: ok ? theme.rose : "#8A7768" } }, r.cost), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.5, fontWeight: 700, color: ok ? "#C1808F" : "#A69485" } }, strings.rewards.pointsUnit))
      );
    }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4, display: "flex", gap: 9, alignItems: "flex-start", padding: "13px 15px", borderRadius: 20, background: theme.sand, border: `1px solid ${theme.sandBorder}` } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15 } }, "\u{1F512}"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "#7C6A5C", lineHeight: 1.4 } }, strings.rewards.lockedNote))));
  }
  function RewardSheet({ reward, available, onConfirm, onError }) {
    const after = available - reward.cost;
    return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 13, alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", width: 62, height: 62, flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 62, height: 62, borderRadius: 20, background: theme.roseBgFlat, border: "1px solid #F4DBE1", display: "grid", placeItems: "center", fontSize: 31 } }, reward.emoji), /* @__PURE__ */ React.createElement("img", { src: MARS_EXCITED, alt: "", style: { position: "absolute", right: -8, bottom: -8, width: 30, height: 30, borderRadius: "50%", objectFit: "cover", border: "2px solid #FDF7F0", boxShadow: "0 2px 6px rgba(120,80,50,.22)" } })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 30, color: theme.ink, lineHeight: 1.05, textWrap: "pretty" } }, reward.title), reward.description && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: theme.muted, marginTop: 2 } }, reward.description))), /* @__PURE__ */ React.createElement("div", { style: { borderRadius: 20, background: "#F8F3EA", border: "1px solid #EDE4D6", overflow: "hidden" } }, /* @__PURE__ */ React.createElement(Row, { label: strings.rewards.sheetCost, value: "\u2212" + formatPoints(reward.cost), valueColor: theme.rose }), /* @__PURE__ */ React.createElement("div", { style: { height: 1, background: "#EDE4D6" } }), /* @__PURE__ */ React.createElement(Row, { label: strings.rewards.sheetAvailableNow, value: formatPoints(available), valueColor: theme.inkSoft }), /* @__PURE__ */ React.createElement("div", { style: { height: 1, background: "#EDE4D6" } }), /* @__PURE__ */ React.createElement(Row, { label: strings.rewards.sheetAfter, value: formatPoints(after), valueColor: theme.sage, bold: true, bg: "#F3EEE3" })), /* @__PURE__ */ React.createElement(
      HoldControl,
      {
        durationMs: REWARD_HOLD_MS,
        ariaLabel: strings.rewards.sheetAria(reward.title),
        height: 58,
        radius: 19,
        idleBg: "#F1D9DF",
        idleBorder: "#E7C3CC",
        fillFrom: "#E8879E",
        fillTo: "#D2607C",
        textColor: "#6B3A47",
        onComplete: () => onConfirm(reward),
        onError,
        label: (phase, pct) => {
          if (phase === "holding") return strings.rewards.sheetHolding(pct);
          if (phase === "saving") return strings.rewards.sheetSaving;
          if (phase === "done") return strings.chores.done;
          return strings.rewards.sheetHold;
        }
      }
    ), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", fontSize: 12, color: "#A08D80", marginTop: -6 } }, strings.rewards.sheetCancelNote));
  }
  function Row({ label, value, valueColor, bold, bg }) {
    return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", padding: "11px 15px", fontSize: 13.5, fontWeight: bold ? 800 : 400, color: bold ? theme.inkSoft : "#7C6A5C", background: bg || "transparent" } }, /* @__PURE__ */ React.createElement("span", null, label), /* @__PURE__ */ React.createElement("strong", { style: { fontFamily: theme.fontDisplay, fontSize: 16, color: valueColor } }, value));
  }
  function Dogajanje({ loading: loading2, log, filter, setFilter, available, onUndo, onWhy }) {
    const undoneRefIds = useMemo(() => new Set(log.filter((e) => e.kind === "chore_undone").map((e) => e.ref_id)), [log]);
    const filtered = useMemo(() => {
      if (filter === "vse") return log;
      return log.filter((e) => KIND_TO_GROUP[e.kind] === filter);
    }, [log, filter]);
    const groups = useMemo(() => {
      const out = [];
      let key = null;
      filtered.forEach((e) => {
        const k = dayKey(e.created_at);
        if (k !== key) {
          key = k;
          out.push({ isDay: true, label: formatDayLabel(e.created_at), key: "d" + k });
        }
        out.push({ isEntry: true, entry: e, key: e.id });
      });
      return out;
    }, [filtered]);
    if (loading2) return /* @__PURE__ */ React.createElement(SkeletonList, { count: 4 });
    const chips = [
      { id: "vse", name: strings.log.filterAll },
      { id: "opravila", name: strings.log.filterChores },
      { id: "nagrade", name: strings.log.filterRewards }
    ];
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, padding: "16px 20px 6px" } }, chips.map((f) => /* @__PURE__ */ React.createElement(Chip, { key: f.id, active: filter === f.id, onClick: () => setFilter(f.id) }, f.name))), log.length === 0 ? /* @__PURE__ */ React.createElement(EmptyState, { image: MARS_SLEEPY, title: strings.log.emptyTitle, body: strings.log.emptyBody, size: 96 }) : /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 20px", display: "flex", flexDirection: "column", gap: 8 } }, groups.map((row) => row.isDay ? /* @__PURE__ */ React.createElement("div", { key: row.key, style: { padding: "12px 2px 3px", fontFamily: theme.fontScript, fontWeight: 700, fontSize: 22, lineHeight: 1, color: "#A38F81" } }, row.label) : /* @__PURE__ */ React.createElement(LogRow, { key: row.key, entry: row.entry, undoneRefIds, available, onUndo, onWhy }))));
  }
  function LogRow({ entry, undoneRefIds, available, onUndo, onWhy }) {
    const d = describeEntry(entry, undoneRefIds, available);
    const color = d.amountClass === "pos" ? theme.sage : d.amountClass === "neg" ? theme.rose : "#B0A093";
    return /* @__PURE__ */ React.createElement("div", { style: { background: theme.card, border: `1px solid #F0E2D3`, borderRadius: 20, padding: "12px 13px", display: "flex", gap: 11, alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 40, height: 40, flex: "0 0 auto", borderRadius: 13, background: "#F8EFE5", display: "grid", placeItems: "center", fontSize: 19 } }, d.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 14.5, color: theme.ink, lineHeight: 1.2, textWrap: "pretty" } }, d.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#98857A", marginTop: 1 } }, d.sub), d.note && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: theme.mutedSoft, marginTop: 3, fontStyle: "italic" } }, "\u201C", d.note, "\u201D")), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 16, color, flex: "0 0 auto", textDecoration: d.amountClass === "dim" && entry.kind === "chore_undone" ? "line-through" : "none" } }, d.amountText), d.showUndo && /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: () => onUndo(entry),
        "aria-label": strings.log.undoAria,
        style: { flex: "0 0 auto", width: 44, height: 44, borderRadius: 14, background: theme.chip, border: "1px solid #E8D3C0", display: "grid", placeItems: "center", fontSize: 15, color: "#8A6F5E", cursor: "pointer" }
      },
      "\u21BA"
    ), d.showLockUndo && /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: onWhy,
        "aria-label": strings.log.undoLockedAria,
        style: { flex: "0 0 auto", width: 44, height: 44, borderRadius: 14, background: theme.sand, border: "1px dashed #E0D5C4", display: "grid", placeItems: "center", fontSize: 14, color: "#B5A697", cursor: "pointer" }
      },
      "\u21BA"
    ));
  }

  // marsova-opravila/AdminPin.jsx
  var { useState: useState3, useEffect: useEffect3, useCallback: useCallback3 } = React;
  var MARS_IDLE2 = "./marsova-opravila/mars-idle.jpg";
  function AdminPin({ onSuccess, onCancel }) {
    const [mode, setMode] = useState3(null);
    const [checking, setChecking] = useState3(true);
    const [pin, setPin] = useState3("");
    const [confirmPin, setConfirmPin] = useState3("");
    const [show, setShow] = useState3(false);
    const [busy, setBusy] = useState3(false);
    const [error, setError] = useState3(null);
    useEffect3(() => {
      let cancelled = false;
      adminPinStatus().then((row) => {
        if (!cancelled) setMode(row.configured ? "login" : "bootstrap");
      }).catch(() => {
        if (!cancelled) setMode("login");
      }).finally(() => {
        if (!cancelled) setChecking(false);
      });
      return () => {
        cancelled = true;
      };
    }, []);
    const submit = useCallback3(async (e) => {
      e.preventDefault();
      if (busy) return;
      setError(null);
      if (mode === "bootstrap") {
        if (pin.length < 4) return setError(strings.adminPin.tooShort);
        if (pin !== confirmPin) return setError(strings.adminPin.mismatch);
        setBusy(true);
        try {
          const row = await adminBootstrapPin(pin);
          setAdminSession(row.token, row.expires_at);
          onSuccess();
        } catch (err) {
          if (err.code === "already_configured") {
            setMode("login");
            setPin("");
            setConfirmPin("");
          } else setError(resolveError(err));
        } finally {
          setBusy(false);
        }
        return;
      }
      setBusy(true);
      try {
        const row = await adminLogin(pin);
        setAdminSession(row.token, row.expires_at);
        onSuccess();
      } catch (err) {
        setError(resolveError(err));
        setPin("");
      } finally {
        setBusy(false);
      }
    }, [mode, pin, confirmPin, busy, onSuccess]);
    const inputType = show ? "text" : "password";
    return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: theme.bgGrad, padding: "24px 20px" } }, /* @__PURE__ */ React.createElement("div", { style: { width: "100%", maxWidth: 360, background: theme.panel, borderRadius: 32, padding: "32px 26px", boxShadow: "0 24px 56px -18px rgba(90,58,40,.28)", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 } }, /* @__PURE__ */ React.createElement("img", { src: MARS_IDLE2, alt: "Mars", style: { width: 84, height: 84, borderRadius: "50%", objectFit: "cover", border: "3px solid #FFFFFF", boxShadow: "0 6px 16px rgba(120,80,50,.18)" } }), checking ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, color: theme.muted, padding: "20px 0" } }, strings.adminPin.checking) : /* @__PURE__ */ React.createElement("form", { onSubmit: submit, style: { width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 28, color: theme.ink, textAlign: "center", lineHeight: 1.1 } }, mode === "bootstrap" ? strings.adminPin.titleBootstrap : strings.adminPin.titleLogin), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, color: theme.muted, textAlign: "center", lineHeight: 1.4 } }, mode === "bootstrap" ? strings.adminPin.subtitleBootstrap : strings.adminPin.subtitleLogin), /* @__PURE__ */ React.createElement("div", { style: { width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        autoFocus: true,
        type: inputType,
        inputMode: "numeric",
        pattern: "[0-9]*",
        maxLength: 12,
        value: pin,
        onChange: (e) => setPin(e.target.value.replace(/[^0-9]/g, "")),
        "aria-label": mode === "bootstrap" ? strings.adminPin.titleBootstrap : strings.adminPin.titleLogin,
        style: inputStyle
      }
    ), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: () => setShow((s) => !s),
        style: { position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 12.5, fontWeight: 800, color: theme.mutedSoft, cursor: "pointer" }
      },
      show ? strings.adminPin.hide : strings.adminPin.show
    )), mode === "bootstrap" && /* @__PURE__ */ React.createElement(
      "input",
      {
        type: inputType,
        inputMode: "numeric",
        pattern: "[0-9]*",
        maxLength: 12,
        placeholder: strings.adminPin.confirmLabel,
        value: confirmPin,
        onChange: (e) => setConfirmPin(e.target.value.replace(/[^0-9]/g, "")),
        "aria-label": strings.adminPin.confirmLabel,
        style: inputStyle
      }
    )), error && /* @__PURE__ */ React.createElement("div", { style: { width: "100%", background: theme.badBg, border: `1px solid ${theme.bad}33`, borderRadius: 14, padding: "10px 13px", fontSize: 12.5, color: theme.bad, fontWeight: 700, textAlign: "center" } }, error), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "submit",
        disabled: busy || pin.length < 4,
        style: {
          width: "100%",
          height: 52,
          borderRadius: 17,
          border: "none",
          marginTop: 4,
          background: busy || pin.length < 4 ? "#E7C3CC" : theme.ink,
          color: "#FBF3EA",
          fontWeight: 800,
          fontSize: 15,
          cursor: busy || pin.length < 4 ? "default" : "pointer",
          fontFamily: theme.fontBody
        }
      },
      busy ? strings.adminPin.checking : mode === "bootstrap" ? strings.adminPin.submitBootstrap : strings.adminPin.submitLogin
    ), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: onCancel,
        style: { fontSize: 12.5, color: theme.mutedSoft, cursor: "pointer", marginTop: 2 }
      },
      strings.adminPin.backLink
    ))));
  }
  var inputStyle = {
    width: "100%",
    height: 52,
    borderRadius: 16,
    border: `1.5px solid ${theme.cardBorder}`,
    background: "#FFFCF7",
    padding: "0 44px 0 16px",
    fontSize: 20,
    letterSpacing: "0.15em",
    color: theme.ink,
    textAlign: "center",
    fontFamily: theme.fontDisplay,
    fontWeight: 700
  };

  // marsova-opravila/admin/Chores.jsx
  var { useState: useState4, useCallback: useCallback4, useMemo: useMemo2 } = React;
  var fieldStyle = {
    width: "100%",
    height: 46,
    borderRadius: 14,
    border: `1.5px solid ${theme.cardBorder}`,
    background: "#FFFCF7",
    padding: "0 14px",
    fontSize: 14.5,
    color: theme.ink,
    fontFamily: theme.fontBody,
    marginTop: 4
  };
  var labelStyle = { fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft };
  function emptyForm(categories) {
    return { emoji: "", title: "", description: "", category_id: categories[0] ? categories[0].id : "", points: "" };
  }
  function AdminChores({ token, callAdmin, chores, categories, onSaved, onFailed }) {
    const [editing, setEditing] = useState4(null);
    const [form, setForm] = useState4(() => emptyForm(categories));
    const [busy, setBusy] = useState4(false);
    const [error, setError] = useState4(null);
    const [archiveTarget, setArchiveTarget] = useState4(null);
    const catById = useMemo2(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
    const active = useMemo2(() => chores.filter((c) => c.active), [chores]);
    const archived = useMemo2(() => chores.filter((c) => !c.active), [chores]);
    const openNew = useCallback4(() => {
      setForm(emptyForm(categories));
      setError(null);
      setEditing("new");
    }, [categories]);
    const openEdit = useCallback4((c) => {
      setForm({ emoji: c.emoji, title: c.title, description: c.description || "", category_id: c.category_id || "", points: String(c.points) });
      setError(null);
      setEditing(c);
    }, []);
    const close = useCallback4(() => setEditing(null), []);
    const save = useCallback4(async () => {
      if (busy) return;
      if (!form.emoji.trim()) return setError(strings.adminChores.validationEmoji);
      if (!form.title.trim()) return setError(strings.adminChores.validationTitle);
      const points = parseInt(form.points, 10);
      if (!Number.isInteger(points) || points <= 0) return setError(strings.adminChores.validationPoints);
      setBusy(true);
      setError(null);
      try {
        if (editing === "new") {
          await callAdmin(adminCreateChore, form.emoji.trim(), form.title.trim(), form.description.trim(), form.category_id || null, points);
        } else {
          await callAdmin(adminUpdateChore, editing.id, form.emoji.trim(), form.title.trim(), form.description.trim(), form.category_id || null, points);
        }
        onSaved(strings.adminChores.saveSuccess);
        setEditing(null);
      } catch (err) {
        setError(resolveError(err));
      } finally {
        setBusy(false);
      }
    }, [busy, form, editing, callAdmin, onSaved]);
    const toggleActive = useCallback4(async (chore) => {
      try {
        await callAdmin(adminSetChoreActive, chore.id, !chore.active);
        onSaved(strings.adminChores.saveSuccess);
      } catch (err) {
        onFailed(resolveError(err));
      } finally {
        setArchiveTarget(null);
      }
    }, [callAdmin, onSaved, onFailed]);
    const move = useCallback4(async (list, index, dir) => {
      const next = index + dir;
      if (next < 0 || next >= list.length) return;
      const ids = list.map((c) => c.id);
      [ids[index], ids[next]] = [ids[next], ids[index]];
      try {
        await callAdmin(adminReorderChores, ids);
      } catch (err) {
        onFailed(resolveError(err));
      }
    }, [callAdmin, onFailed]);
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 } }, /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: openNew, style: addButtonStyle }, "+ ", strings.common.add), /* @__PURE__ */ React.createElement(Section, { title: strings.adminChores.active, empty: active.length === 0 && strings.adminChores.empty }, active.map((c, i) => /* @__PURE__ */ React.createElement(
      ChoreRow,
      {
        key: c.id,
        chore: c,
        category: catById[c.category_id],
        onEdit: () => openEdit(c),
        onArchive: () => setArchiveTarget(c),
        onUp: () => move(active, i, -1),
        onDown: () => move(active, i, 1),
        canUp: i > 0,
        canDown: i < active.length - 1
      }
    ))), archived.length > 0 && /* @__PURE__ */ React.createElement(Section, { title: strings.adminChores.archived }, archived.map((c) => /* @__PURE__ */ React.createElement(ChoreRow, { key: c.id, chore: c, category: catById[c.category_id], archived: true, onEdit: () => openEdit(c), onArchive: () => setArchiveTarget(c) }))), /* @__PURE__ */ React.createElement(Sheet, { open: !!editing, onClose: close }, editing && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink } }, editing === "new" ? strings.adminChores.addTitle : strings.adminChores.editTitle), /* @__PURE__ */ React.createElement("div", { style: labelStyle }, strings.adminChores.emojiLabel, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(EmojiPicker, { value: form.emoji, onChange: (v) => setForm({ ...form, emoji: v }), ariaLabel: strings.adminChores.emojiLabel }))), /* @__PURE__ */ React.createElement("label", { style: labelStyle }, strings.adminChores.titleLabel, /* @__PURE__ */ React.createElement("input", { value: form.title, onChange: (e) => setForm({ ...form, title: e.target.value }), style: fieldStyle })), /* @__PURE__ */ React.createElement("label", { style: labelStyle }, strings.adminChores.descriptionLabel, /* @__PURE__ */ React.createElement("textarea", { value: form.description, onChange: (e) => setForm({ ...form, description: e.target.value }), rows: 2, style: { ...fieldStyle, height: "auto", padding: 10, resize: "vertical" } })), /* @__PURE__ */ React.createElement("label", { style: labelStyle }, strings.adminChores.categoryLabel, /* @__PURE__ */ React.createElement("select", { value: form.category_id || "", onChange: (e) => setForm({ ...form, category_id: e.target.value }), style: fieldStyle }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u2014"), categories.map((c) => /* @__PURE__ */ React.createElement("option", { key: c.id, value: c.id }, c.emoji, " ", c.name)))), /* @__PURE__ */ React.createElement("label", { style: labelStyle }, strings.adminChores.pointsLabel, /* @__PURE__ */ React.createElement("input", { type: "number", inputMode: "numeric", value: form.points, onChange: (e) => setForm({ ...form, points: e.target.value }), style: fieldStyle })), error && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: theme.bad, fontWeight: 700 } }, error), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: close, style: cancelBtn }, strings.common.cancel), /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: save, style: { ...saveBtn2, opacity: busy ? 0.6 : 1 } }, strings.common.save)))), /* @__PURE__ */ React.createElement(
      ConfirmSheet,
      {
        open: !!archiveTarget,
        title: archiveTarget && (archiveTarget.active ? strings.adminChores.archiveConfirm(archiveTarget.title) : strings.adminChores.unarchiveConfirm(archiveTarget.title)),
        confirmLabel: archiveTarget && archiveTarget.active ? strings.common.archive : strings.common.unarchive,
        onConfirm: () => toggleActive(archiveTarget),
        onCancel: () => setArchiveTarget(null),
        danger: archiveTarget && archiveTarget.active
      }
    ));
  }
  function Section({ title, empty, children }) {
    return /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 20, color: "#7C6A5C", marginBottom: 8 } }, title), empty ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: theme.muted } }, empty) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, children));
  }
  function ChoreRow({ chore, category, archived, onEdit, onArchive, onUp, onDown, canUp, canDown }) {
    return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: "10px 12px", opacity: archived ? 0.6 : 1 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 20 } }, chore.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 14, color: theme.ink } }, chore.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: theme.muted } }, category ? `${category.emoji} ${category.name} \xB7 ` : "", "+", chore.points)), !archived && onUp && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement(IconBtn, { label: strings.adminChores.moveUp, disabled: !canUp, onClick: onUp }, "\u25B2"), /* @__PURE__ */ React.createElement(IconBtn, { label: strings.adminChores.moveDown, disabled: !canDown, onClick: onDown }, "\u25BC")), /* @__PURE__ */ React.createElement(IconBtn, { label: strings.common.edit, onClick: onEdit }, "\u270E"), /* @__PURE__ */ React.createElement(IconBtn, { label: archived ? strings.common.unarchive : strings.common.archive, onClick: onArchive }, archived ? "\u21BA" : "\u{1F5C4}"));
  }
  function IconBtn({ label, onClick, disabled, children }) {
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: disabled ? -1 : 0,
        "aria-label": label,
        onClick: disabled ? void 0 : onClick,
        onKeyDown: (e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onClick();
          }
        },
        style: { width: 30, height: 30, borderRadius: 9, background: "#F6E9DC", border: "1px solid #EBD8C6", display: "grid", placeItems: "center", fontSize: 12, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1, color: "#8A6F5E" }
      },
      children
    );
  }
  var addButtonStyle = {
    alignSelf: "flex-start",
    padding: "10px 16px",
    borderRadius: 14,
    background: theme.ink,
    color: "#FBF3EA",
    fontWeight: 800,
    fontSize: 13.5,
    cursor: "pointer"
  };
  var cancelBtn = { flex: 1, height: 48, borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#7C6A5C", cursor: "pointer" };
  var saveBtn2 = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };

  // marsova-opravila/admin/Categories.jsx
  var { useState: useState5, useCallback: useCallback5, useMemo: useMemo3 } = React;
  var fieldStyle2 = {
    width: "100%",
    height: 46,
    borderRadius: 14,
    border: `1.5px solid ${theme.cardBorder}`,
    background: "#FFFCF7",
    padding: "0 14px",
    fontSize: 14.5,
    color: theme.ink,
    fontFamily: theme.fontBody,
    marginTop: 4
  };
  var labelStyle2 = { fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft };
  function emptyForm2() {
    return { emoji: "", name: "", color: "" };
  }
  function AdminCategories({ token, callAdmin, categories, chores, onSaved, onFailed }) {
    const [editing, setEditing] = useState5(null);
    const [form, setForm] = useState5(emptyForm2);
    const [busy, setBusy] = useState5(false);
    const [error, setError] = useState5(null);
    const [deleteTarget, setDeleteTarget] = useState5(null);
    const [reassignTo, setReassignTo] = useState5("");
    const usageCount = useMemo3(() => {
      const map = {};
      chores.forEach((c) => {
        if (c.category_id) map[c.category_id] = (map[c.category_id] || 0) + 1;
      });
      return map;
    }, [chores]);
    const openNew = useCallback5(() => {
      setForm(emptyForm2());
      setError(null);
      setEditing("new");
    }, []);
    const openEdit = useCallback5((c) => {
      setForm({ emoji: c.emoji, name: c.name, color: c.color || "" });
      setError(null);
      setEditing(c);
    }, []);
    const close = useCallback5(() => setEditing(null), []);
    const save = useCallback5(async () => {
      if (busy) return;
      if (!form.name.trim()) return setError(strings.adminCategories.validationName);
      setBusy(true);
      setError(null);
      try {
        if (editing === "new") await callAdmin(adminCreateCategory, form.emoji.trim() || "\u{1F3F7}\uFE0F", form.name.trim(), form.color.trim());
        else await callAdmin(adminUpdateCategory, editing.id, form.emoji.trim() || "\u{1F3F7}\uFE0F", form.name.trim(), form.color.trim());
        onSaved(strings.adminCategories.saveSuccess);
        setEditing(null);
      } catch (err) {
        setError(resolveError(err));
      } finally {
        setBusy(false);
      }
    }, [busy, form, editing, callAdmin, onSaved]);
    const move = useCallback5(async (index, dir) => {
      const next = index + dir;
      if (next < 0 || next >= categories.length) return;
      const ids = categories.map((c) => c.id);
      [ids[index], ids[next]] = [ids[next], ids[index]];
      try {
        await callAdmin(adminReorderCategories, ids);
      } catch (err) {
        onFailed(resolveError(err));
      }
    }, [categories, callAdmin, onFailed]);
    const openDelete = useCallback5((c) => {
      setDeleteTarget(c);
      setReassignTo("");
    }, []);
    const confirmDelete = useCallback5(async () => {
      const inUse = (usageCount[deleteTarget.id] || 0) > 0;
      if (inUse && !reassignTo) return;
      try {
        await callAdmin(adminDeleteCategory, deleteTarget.id, inUse ? reassignTo : null);
        onSaved(strings.adminCategories.saveSuccess);
      } catch (err) {
        onFailed(resolveError(err));
      } finally {
        setDeleteTarget(null);
      }
    }, [deleteTarget, reassignTo, usageCount, callAdmin, onSaved, onFailed]);
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: openNew, style: addButtonStyle }, "+ ", strings.common.add), categories.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: theme.muted } }, strings.adminCategories.empty) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, categories.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: c.id, style: { display: "flex", gap: 10, alignItems: "center", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: "10px 12px" } }, c.color && /* @__PURE__ */ React.createElement("span", { style: { width: 10, height: 10, borderRadius: "50%", background: c.color, flex: "0 0 auto" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 20 } }, c.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 14, color: theme.ink } }, c.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: theme.muted } }, usageCount[c.id] || 0, " opravil")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement(IconBtn, { label: strings.adminChores.moveUp, disabled: i === 0, onClick: () => move(i, -1) }, "\u25B2"), /* @__PURE__ */ React.createElement(IconBtn, { label: strings.adminChores.moveDown, disabled: i === categories.length - 1, onClick: () => move(i, 1) }, "\u25BC")), /* @__PURE__ */ React.createElement(IconBtn, { label: strings.common.edit, onClick: () => openEdit(c) }, "\u270E"), /* @__PURE__ */ React.createElement(IconBtn, { label: strings.common.delete, onClick: () => openDelete(c) }, "\u{1F5D1}")))), /* @__PURE__ */ React.createElement(Sheet, { open: !!editing, onClose: close }, editing && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink } }, editing === "new" ? strings.adminCategories.addTitle : strings.adminCategories.editTitle), /* @__PURE__ */ React.createElement("div", { style: labelStyle2 }, strings.adminCategories.emojiLabel, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(EmojiPicker, { value: form.emoji, onChange: (v) => setForm({ ...form, emoji: v }), ariaLabel: strings.adminCategories.emojiLabel }))), /* @__PURE__ */ React.createElement("label", { style: labelStyle2 }, strings.adminCategories.nameLabel, /* @__PURE__ */ React.createElement("input", { value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }), style: fieldStyle2 })), /* @__PURE__ */ React.createElement("label", { style: labelStyle2 }, strings.adminCategories.colorLabel, /* @__PURE__ */ React.createElement("input", { type: "color", value: form.color || "#EFE2D3", onChange: (e) => setForm({ ...form, color: e.target.value }), style: { ...fieldStyle2, padding: 4, height: 40 } })), error && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: theme.bad, fontWeight: 700 } }, error), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: close, style: cancelBtn2 }, strings.common.cancel), /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: save, style: { ...saveBtn3, opacity: busy ? 0.6 : 1 } }, strings.common.save)))), /* @__PURE__ */ React.createElement(Sheet, { open: !!deleteTarget, onClose: () => setDeleteTarget(null) }, deleteTarget && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink } }, strings.adminCategories.deleteTitle), (usageCount[deleteTarget.id] || 0) > 0 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, color: "#7C6A5C" } }, strings.adminCategories.inUseBody(usageCount[deleteTarget.id])), /* @__PURE__ */ React.createElement("label", { style: labelStyle2 }, strings.adminCategories.reassignLabel, /* @__PURE__ */ React.createElement("select", { value: reassignTo, onChange: (e) => setReassignTo(e.target.value), style: fieldStyle2 }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u2014"), categories.filter((c) => c.id !== deleteTarget.id).map((c) => /* @__PURE__ */ React.createElement("option", { key: c.id, value: c.id }, c.emoji, " ", c.name))))) : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, color: "#7C6A5C" } }, strings.adminCategories.deleteEmptyBody), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: () => setDeleteTarget(null), style: cancelBtn2 }, strings.common.cancel), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: confirmDelete,
        style: { ...saveBtn3, background: theme.bad, opacity: (usageCount[deleteTarget.id] || 0) > 0 && !reassignTo ? 0.5 : 1 }
      },
      strings.adminCategories.deleteConfirm
    )))));
  }
  var cancelBtn2 = { flex: 1, height: 48, borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#7C6A5C", cursor: "pointer" };
  var saveBtn3 = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };

  // marsova-opravila/admin/Rewards.jsx
  var { useState: useState6, useCallback: useCallback6, useMemo: useMemo4 } = React;
  var fieldStyle3 = {
    width: "100%",
    height: 46,
    borderRadius: 14,
    border: `1.5px solid ${theme.cardBorder}`,
    background: "#FFFCF7",
    padding: "0 14px",
    fontSize: 14.5,
    color: theme.ink,
    fontFamily: theme.fontBody,
    marginTop: 4
  };
  var labelStyle3 = { fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft };
  function emptyForm3() {
    return { emoji: "", title: "", description: "", cost: "" };
  }
  function AdminRewards({ token, callAdmin, rewards, onSaved, onFailed }) {
    const [editing, setEditing] = useState6(null);
    const [form, setForm] = useState6(emptyForm3);
    const [busy, setBusy] = useState6(false);
    const [error, setError] = useState6(null);
    const [archiveTarget, setArchiveTarget] = useState6(null);
    const active = useMemo4(() => rewards.filter((r) => r.active), [rewards]);
    const archived = useMemo4(() => rewards.filter((r) => !r.active), [rewards]);
    const openNew = useCallback6(() => {
      setForm(emptyForm3());
      setError(null);
      setEditing("new");
    }, []);
    const openEdit = useCallback6((r) => {
      setForm({ emoji: r.emoji, title: r.title, description: r.description || "", cost: String(r.cost) });
      setError(null);
      setEditing(r);
    }, []);
    const close = useCallback6(() => setEditing(null), []);
    const save = useCallback6(async () => {
      if (busy) return;
      if (!form.title.trim()) return setError(strings.adminRewards.validationTitle);
      const cost = parseInt(form.cost, 10);
      if (!Number.isInteger(cost) || cost <= 0) return setError(strings.adminRewards.validationCost);
      setBusy(true);
      setError(null);
      try {
        if (editing === "new") await callAdmin(adminCreateReward, form.emoji.trim() || "\u{1F381}", form.title.trim(), form.description.trim(), cost);
        else await callAdmin(adminUpdateReward, editing.id, form.emoji.trim() || "\u{1F381}", form.title.trim(), form.description.trim(), cost);
        onSaved(strings.adminRewards.saveSuccess);
        setEditing(null);
      } catch (err) {
        setError(resolveError(err));
      } finally {
        setBusy(false);
      }
    }, [busy, form, editing, callAdmin, onSaved]);
    const toggleActive = useCallback6(async (reward) => {
      try {
        await callAdmin(adminSetRewardActive, reward.id, !reward.active);
        onSaved(strings.adminRewards.saveSuccess);
      } catch (err) {
        onFailed(resolveError(err));
      } finally {
        setArchiveTarget(null);
      }
    }, [callAdmin, onSaved, onFailed]);
    const move = useCallback6(async (list, index, dir) => {
      const next = index + dir;
      if (next < 0 || next >= list.length) return;
      const ids = list.map((r) => r.id);
      [ids[index], ids[next]] = [ids[next], ids[index]];
      try {
        await callAdmin(adminReorderRewards, ids);
      } catch (err) {
        onFailed(resolveError(err));
      }
    }, [callAdmin, onFailed]);
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 } }, /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: openNew, style: addButtonStyle }, "+ ", strings.common.add), /* @__PURE__ */ React.createElement(Section2, { title: strings.adminRewards.active, empty: active.length === 0 && strings.adminRewards.empty }, active.map((r, i) => /* @__PURE__ */ React.createElement(
      RewardRow,
      {
        key: r.id,
        reward: r,
        onEdit: () => openEdit(r),
        onArchive: () => setArchiveTarget(r),
        onUp: () => move(active, i, -1),
        onDown: () => move(active, i, 1),
        canUp: i > 0,
        canDown: i < active.length - 1
      }
    ))), archived.length > 0 && /* @__PURE__ */ React.createElement(Section2, { title: strings.adminRewards.archived }, archived.map((r) => /* @__PURE__ */ React.createElement(RewardRow, { key: r.id, reward: r, archived: true, onEdit: () => openEdit(r), onArchive: () => setArchiveTarget(r) }))), /* @__PURE__ */ React.createElement(Sheet, { open: !!editing, onClose: close }, editing && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink } }, editing === "new" ? strings.adminRewards.addTitle : strings.adminRewards.editTitle), /* @__PURE__ */ React.createElement("div", { style: labelStyle3 }, strings.adminRewards.emojiLabel, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(EmojiPicker, { value: form.emoji, onChange: (v) => setForm({ ...form, emoji: v }), ariaLabel: strings.adminRewards.emojiLabel }))), /* @__PURE__ */ React.createElement("label", { style: labelStyle3 }, strings.adminRewards.titleLabel, /* @__PURE__ */ React.createElement("input", { value: form.title, onChange: (e) => setForm({ ...form, title: e.target.value }), style: fieldStyle3 })), /* @__PURE__ */ React.createElement("label", { style: labelStyle3 }, strings.adminRewards.descriptionLabel, /* @__PURE__ */ React.createElement("textarea", { value: form.description, onChange: (e) => setForm({ ...form, description: e.target.value }), rows: 2, style: { ...fieldStyle3, height: "auto", padding: 10, resize: "vertical" } })), /* @__PURE__ */ React.createElement("label", { style: labelStyle3 }, strings.adminRewards.costLabel, /* @__PURE__ */ React.createElement("input", { type: "number", inputMode: "numeric", value: form.cost, onChange: (e) => setForm({ ...form, cost: e.target.value }), style: fieldStyle3 })), error && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: theme.bad, fontWeight: 700 } }, error), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: close, style: cancelBtn3 }, strings.common.cancel), /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: save, style: { ...saveBtn4, opacity: busy ? 0.6 : 1 } }, strings.common.save)))), /* @__PURE__ */ React.createElement(
      ConfirmSheet,
      {
        open: !!archiveTarget,
        title: archiveTarget && (archiveTarget.active ? strings.adminRewards.archiveConfirm(archiveTarget.title) : strings.adminRewards.unarchiveConfirm(archiveTarget.title)),
        confirmLabel: archiveTarget && archiveTarget.active ? strings.common.archive : strings.common.unarchive,
        onConfirm: () => toggleActive(archiveTarget),
        onCancel: () => setArchiveTarget(null),
        danger: archiveTarget && archiveTarget.active
      }
    ));
  }
  function Section2({ title, empty, children }) {
    return /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 20, color: "#7C6A5C", marginBottom: 8 } }, title), empty ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: theme.muted } }, empty) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, children));
  }
  function RewardRow({ reward, archived, onEdit, onArchive, onUp, onDown, canUp, canDown }) {
    return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: "10px 12px", opacity: archived ? 0.6 : 1 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 20 } }, reward.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 14, color: theme.ink } }, reward.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: theme.muted } }, reward.cost, " to\u010Dk")), !archived && onUp && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement(IconBtn, { label: strings.adminChores.moveUp, disabled: !canUp, onClick: onUp }, "\u25B2"), /* @__PURE__ */ React.createElement(IconBtn, { label: strings.adminChores.moveDown, disabled: !canDown, onClick: onDown }, "\u25BC")), /* @__PURE__ */ React.createElement(IconBtn, { label: strings.common.edit, onClick: onEdit }, "\u270E"), /* @__PURE__ */ React.createElement(IconBtn, { label: archived ? strings.common.unarchive : strings.common.archive, onClick: onArchive }, archived ? "\u21BA" : "\u{1F5C4}"));
  }
  var cancelBtn3 = { flex: 1, height: 48, borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#7C6A5C", cursor: "pointer" };
  var saveBtn4 = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };

  // marsova-opravila/admin/Requests.jsx
  var { useState: useState7, useCallback: useCallback7, useMemo: useMemo5 } = React;
  var STATUS_LABEL = {
    pending: () => strings.rewards.statusPending,
    approved: () => strings.rewards.statusApproved,
    declined: () => strings.rewards.statusDeclined,
    cancelled: () => strings.rewards.statusCancelled,
    fulfilled: () => strings.rewards.statusFulfilled
  };
  function AdminRequests({ token, callAdmin, requests, points, onSaved, onFailed }) {
    const [action, setAction] = useState7(null);
    const [message, setMessage] = useState7("");
    const [busy, setBusy] = useState7(false);
    const pending = useMemo5(() => requests.filter((r) => r.status === "pending").sort((a, b) => new Date(a.requested_at) - new Date(b.requested_at)), [requests]);
    const history = useMemo5(() => requests.filter((r) => r.status !== "pending"), [requests]);
    const open2 = useCallback7((kind, request) => {
      setAction({ kind, request });
      setMessage("");
    }, []);
    const close = useCallback7(() => setAction(null), []);
    const confirm = useCallback7(async () => {
      if (!action || busy) return;
      setBusy(true);
      try {
        if (action.kind === "approve") await callAdmin(adminApproveRequest, action.request.id, message.trim());
        else if (action.kind === "decline") await callAdmin(adminDeclineRequest, action.request.id, message.trim());
        else await callAdmin(adminFulfillRequest, action.request.id);
        onSaved(strings.adminChores.saveSuccess);
        setAction(null);
      } catch (err) {
        onFailed(resolveError(err));
        setAction(null);
      } finally {
        setBusy(false);
      }
    }, [action, message, busy, callAdmin, onSaved, onFailed]);
    const previewAvailable = action && action.kind === "decline" ? points.available + action.request.cost : points.available;
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 } }, requests.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: theme.muted } }, strings.adminRequests.empty), pending.length > 0 && /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: sectionTitle }, strings.adminRequests.pendingSection, " (", pending.length, ")"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, pending.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.id, style: card }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 22 } }, r.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 15, color: theme.ink } }, r.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: theme.muted } }, formatPoints(r.cost), " to\u010Dk \xB7 ", strings.adminRequests.requestedAt(formatTime(r.requested_at)))), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 16, color: theme.rose } }, r.cost)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 10 } }, /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: () => open2("decline", r), style: declineBtn }, strings.adminRequests.decline), /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: () => open2("approve", r), style: approveBtn }, strings.adminRequests.approve)))))), (() => {
      const approvedNotFulfilled = requests.filter((r) => r.status === "approved");
      if (approvedNotFulfilled.length === 0) return null;
      return /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: sectionTitle }, strings.rewards.statusApproved), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, approvedNotFulfilled.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.id, style: card }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 22 } }, r.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 15, color: theme.ink } }, r.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: theme.muted } }, formatPoints(r.cost), " to\u010Dk \xB7 ", formatDayLabel(r.decided_at)))), /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: () => open2("fulfill", r), style: { ...approveBtn, marginTop: 10 } }, strings.adminRequests.fulfill)))));
    })(), history.length > 0 && /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: sectionTitle }, strings.adminRequests.historySection), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, history.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.id, style: { display: "flex", gap: 10, alignItems: "center", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: "10px 12px", opacity: 0.85 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, r.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13.5, color: theme.ink } }, r.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: theme.muted } }, STATUS_LABEL[r.status](), " \xB7 ", formatTime(r.decided_at || r.fulfilled_at || r.requested_at)), r.admin_message && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: theme.mutedSoft, fontStyle: "italic", marginTop: 2 } }, "\u201C", r.admin_message, "\u201D")), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 14, color: theme.muted } }, r.cost))))), /* @__PURE__ */ React.createElement(Sheet, { open: !!action, onClose: close }, action && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink } }, action.kind === "approve" ? strings.adminRequests.approveConfirm : action.kind === "decline" ? strings.adminRequests.declineConfirm : strings.adminRequests.fulfillConfirm), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, color: "#7C6A5C" } }, action.request.emoji, " ", action.request.title, " \xB7 ", formatPoints(action.request.cost), " to\u010Dk"), (action.kind === "approve" || action.kind === "decline") && /* @__PURE__ */ React.createElement("label", { style: { fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft } }, strings.adminRequests.messageLabel, /* @__PURE__ */ React.createElement(
      "textarea",
      {
        value: message,
        onChange: (e) => setMessage(e.target.value),
        rows: 2,
        placeholder: strings.adminRequests.messagePlaceholder,
        style: { width: "100%", marginTop: 4, borderRadius: 14, border: `1.5px solid ${theme.cardBorder}`, background: "#FFFCF7", padding: 10, fontSize: 14, fontFamily: theme.fontBody, resize: "vertical" }
      }
    )), action.kind === "decline" && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: theme.muted } }, strings.adminRequests.resultingBalance(formatPoints(previewAvailable))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: close, style: cancelBtn4 }, strings.common.cancel), /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: confirm, style: { ...saveBtn5, opacity: busy ? 0.6 : 1 } }, action.kind === "approve" ? strings.adminRequests.approve : action.kind === "decline" ? strings.adminRequests.decline : strings.adminRequests.fulfill)))));
  }
  var sectionTitle = { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 20, color: "#7C6A5C", marginBottom: 8 };
  var card = { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 18, padding: 12 };
  var declineBtn = { flex: 1, height: 42, borderRadius: 14, background: theme.badBg, border: `1px solid ${theme.bad}33`, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, color: theme.bad, cursor: "pointer" };
  var approveBtn = { flex: 1, height: 42, borderRadius: 14, background: theme.sageBg, border: `1px solid ${theme.sageBorder}`, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, color: theme.sage, cursor: "pointer" };
  var cancelBtn4 = { flex: 1, height: 48, borderRadius: 15, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#7C6A5C", cursor: "pointer" };
  var saveBtn5 = { flex: 1, height: 48, borderRadius: 15, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#FBF3EA", cursor: "pointer" };

  // marsova-opravila/AdminApp.jsx
  var { useState: useState8, useEffect: useEffect4, useCallback: useCallback8, useMemo: useMemo6 } = React;
  var MARS_IDLE3 = "./marsova-opravila/mars-idle.jpg";
  var TABS = [
    { id: "pregled", name: () => strings.adminNav.pregled, icon: "\u{1F3E1}" },
    { id: "opravila", name: () => strings.adminNav.opravila, icon: "\u{1F9F9}" },
    { id: "kategorije", name: () => strings.adminNav.kategorije, icon: "\u{1F3F7}\uFE0F" },
    { id: "nagrade", name: () => strings.adminNav.nagrade, icon: "\u{1F381}" },
    { id: "zahtevki", name: () => strings.adminNav.zahtevki, icon: "\u{1F4EE}" },
    { id: "dogajanje", name: () => strings.adminNav.dogajanje, icon: "\u{1F570}\uFE0F" },
    { id: "nastavitve", name: () => strings.adminNav.nastavitve, icon: "\u2699" }
  ];
  function AdminApp({ onExit }) {
    const [session, setSession] = useState8(() => getAdminSession());
    const [checked, setChecked] = useState8(false);
    useEffect4(() => {
      let cancelled = false;
      const local = getAdminSession();
      if (!local) {
        setChecked(true);
        return void 0;
      }
      adminSessionValid(local.token).then((valid) => {
        if (cancelled) return;
        if (!valid) {
          clearAdminSession();
          setSession(null);
        }
        setChecked(true);
      }).catch(() => {
        if (!cancelled) setChecked(true);
      });
      return () => {
        cancelled = true;
      };
    }, []);
    const onExpired = useCallback8(() => {
      clearAdminSession();
      setSession(null);
    }, []);
    if (!checked) {
      return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", display: "grid", placeItems: "center", background: theme.bgGrad } });
    }
    if (!session) {
      return /* @__PURE__ */ React.createElement(AdminPin, { onSuccess: () => setSession(getAdminSession()), onCancel: onExit });
    }
    return /* @__PURE__ */ React.createElement(AdminShell, { session, onExpired, onExit });
  }
  function AdminShell({ session, onExpired, onExit }) {
    const [tab, setTab] = useState8("pregled");
    const [categories, setCategories] = useState8([]);
    const [chores, setChores] = useState8([]);
    const [rewards, setRewards] = useState8([]);
    const [requests, setRequests] = useState8([]);
    const [log, setLog] = useState8([]);
    const [points, setPoints] = useState8({ current_balance: 0, reserved: 0, available: 0, lifetime: 0 });
    const [settings, setSettings] = useState8({ display_name: "" });
    const [loading2, setLoading] = useState8(true);
    const [loadError, setLoadError] = useState8(false);
    const [toast, setToast] = useState8(null);
    const loadAll = useCallback8(async () => {
      try {
        const [cats, chs, rws, reqs, lg, pts, st] = await Promise.all([
          fetchCategories(),
          fetchChores(),
          fetchRewards(),
          fetchRewardRequests(),
          fetchActivityLog(),
          fetchPointsSummary(),
          fetchSettings()
        ]);
        setCategories(cats);
        setChores(chs);
        setRewards(rws);
        setRequests(reqs);
        setLog(lg);
        setPoints(pts);
        setSettings(st);
        setLoadError(false);
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }, []);
    useEffect4(() => {
      loadAll();
    }, [loadAll]);
    useEffect4(() => {
      const unsubscribe = subscribeToChanges(({ table: table2 }) => {
        if (table2 === "mo_categories") fetchCategories().then(setCategories).catch(() => {
        });
        if (table2 === "mo_chores") fetchChores().then(setChores).catch(() => {
        });
        if (table2 === "mo_rewards") fetchRewards().then(setRewards).catch(() => {
        });
        if (table2 === "mo_settings") fetchSettings().then(setSettings).catch(() => {
        });
        if (table2 === "mo_reward_requests") {
          fetchRewardRequests().then(setRequests).catch(() => {
          });
          fetchPointsSummary().then(setPoints).catch(() => {
          });
        }
        if (table2 === "mo_activity_log") {
          fetchActivityLog().then(setLog).catch(() => {
          });
          fetchPointsSummary().then(setPoints).catch(() => {
          });
        }
      });
      return unsubscribe;
    }, []);
    const flashToast = useCallback8((text, bad) => {
      setToast({ text, bad });
      setTimeout(() => setToast(null), 3200);
    }, []);
    const callAdmin = useCallback8(async (fn, ...args) => {
      try {
        return await fn(session.token, ...args);
      } catch (err) {
        if (err.code === "unauthorized") onExpired();
        throw err;
      }
    }, [session.token, onExpired]);
    const lock = useCallback8(async () => {
      try {
        await adminLogout(session.token);
      } catch {
      }
      onExpired();
    }, [session.token, onExpired]);
    const pendingCount = useMemo6(() => requests.filter((r) => r.status === "pending").length, [requests]);
    return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: theme.bgGrad } }, /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 720, margin: "0 auto", minHeight: "100vh", background: theme.panel, display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "max(16px, env(safe-area-inset-top)) 20px 12px", background: theme.headerGrad, borderBottom: `1px solid ${theme.headerBorder}`, display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ React.createElement("img", { src: MARS_IDLE3, alt: "", style: { width: 38, height: 38, borderRadius: "50%", objectFit: "cover", border: "2px solid #fff", flex: "0 0 auto" } }), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 22, color: theme.ink, lineHeight: 1 } }, strings.adminPin.titleLogin)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 50 } }, /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: onExit, style: navLinkStyle }, strings.adminNav.backToApp), /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: lock, style: { ...navLinkStyle, color: theme.bad } }, strings.adminNav.lock))), /* @__PURE__ */ React.createElement("div", { className: "mo-hs", style: { display: "flex", gap: 8, padding: "12px 20px", overflowX: "auto", borderBottom: `1px solid ${theme.headerBorder}` } }, TABS.map((t) => {
      const on = tab === t.id;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: t.id,
          role: "button",
          tabIndex: 0,
          onClick: () => setTab(t.id),
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setTab(t.id);
            }
          },
          style: {
            position: "relative",
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 38,
            padding: "0 14px",
            borderRadius: 13,
            cursor: "pointer",
            fontWeight: on ? 800 : 700,
            fontSize: 13.5,
            background: on ? theme.ink : "#FFFCF7",
            color: on ? "#FBF3EA" : "#6E5A4E",
            border: on ? "none" : `1px solid ${theme.cardBorder}`
          }
        },
        /* @__PURE__ */ React.createElement("span", null, t.icon),
        t.name(),
        t.id === "zahtevki" && pendingCount > 0 && /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: -5, right: -5, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 9, background: theme.rose, color: "#fff", fontSize: 10.5, fontWeight: 800, display: "grid", placeItems: "center" } }, pendingCount)
      );
    })), /* @__PURE__ */ React.createElement("div", { className: "mo-hs", style: { flex: 1, overflowY: "auto", position: "relative" } }, loadError && /* @__PURE__ */ React.createElement("div", { style: { margin: "12px 20px 0", background: theme.badBg, borderRadius: 16, padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", null, "\u{1F648}"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, fontSize: 13, color: theme.bad } }, strings.common.genericError), /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: loadAll, style: { fontWeight: 800, fontSize: 13, color: theme.bad, cursor: "pointer" } }, strings.common.retry)), loading2 ? /* @__PURE__ */ React.createElement(SkeletonList, { count: 3 }) : /* @__PURE__ */ React.createElement(React.Fragment, null, tab === "pregled" && /* @__PURE__ */ React.createElement(
      Pregled,
      {
        points,
        requests,
        log,
        onGoto: setTab,
        onAddChore: () => setTab("opravila"),
        onAddReward: () => setTab("nagrade"),
        onAdjust: () => setTab("nastavitve")
      }
    ), tab === "opravila" && /* @__PURE__ */ React.createElement(
      AdminChores,
      {
        token: session.token,
        callAdmin,
        chores,
        categories,
        onSaved: (msg) => flashToast(msg),
        onFailed: (msg) => flashToast(msg, true)
      }
    ), tab === "kategorije" && /* @__PURE__ */ React.createElement(
      AdminCategories,
      {
        token: session.token,
        callAdmin,
        categories,
        chores,
        onSaved: (msg) => flashToast(msg),
        onFailed: (msg) => flashToast(msg, true)
      }
    ), tab === "nagrade" && /* @__PURE__ */ React.createElement(
      AdminRewards,
      {
        token: session.token,
        callAdmin,
        rewards,
        onSaved: (msg) => flashToast(msg),
        onFailed: (msg) => flashToast(msg, true)
      }
    ), tab === "zahtevki" && /* @__PURE__ */ React.createElement(
      AdminRequests,
      {
        token: session.token,
        callAdmin,
        requests,
        points,
        onSaved: (msg) => flashToast(msg),
        onFailed: (msg) => flashToast(msg, true)
      }
    ), tab === "dogajanje" && /* @__PURE__ */ React.createElement(AdminLog, { log, available: points.available }), tab === "nastavitve" && /* @__PURE__ */ React.createElement(
      Nastavitve,
      {
        token: session.token,
        callAdmin,
        settings,
        points,
        onLock: lock,
        onSaved: (msg) => flashToast(msg),
        onFailed: (msg) => flashToast(msg, true)
      }
    ))), toast && /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 80, background: toast.bad ? theme.bad : theme.ink, color: "#fff", padding: "10px 18px", borderRadius: 14, fontWeight: 700, fontSize: 13.5, boxShadow: "0 10px 24px -8px rgba(0,0,0,.35)", maxWidth: "90vw", textAlign: "center" } }, toast.text)));
  }
  var navLinkStyle = { fontSize: 12.5, fontWeight: 700, color: theme.mutedSoft, cursor: "pointer", whiteSpace: "nowrap" };
  function StatCard({ label, value, color }) {
    return /* @__PURE__ */ React.createElement("div", { style: { flex: 1, padding: "12px 14px", borderRadius: 16, background: theme.sand, border: `1px solid ${theme.sandBorder}` } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 600, fontSize: 15, color: "#9A8A76" } }, label), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 22, color: color || theme.inkSoft } }, formatPoints(value)));
  }
  function Pregled({ points, requests, log, onGoto, onAddChore, onAddReward, onAdjust }) {
    const pending = requests.filter((r) => r.status === "pending");
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 } }, /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: sectionTitle2 }, strings.adminOverview.pendingTitle), pending.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: emptyNote }, strings.adminOverview.pendingEmpty) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, pending.slice(0, 3).map((r) => /* @__PURE__ */ React.createElement("div", { key: r.id, style: rowCard }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 20 } }, r.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 14, color: theme.ink } }, r.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: theme.muted } }, formatPoints(r.cost), " \xB7 ", formatTime(r.requested_at))))), /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, onClick: () => onGoto("zahtevki"), style: { ...navLinkStyle, alignSelf: "flex-start", marginTop: 2 } }, strings.adminOverview.pendingCta, " (", pending.length, ")"))), /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: sectionTitle2 }, strings.adminOverview.pointsTitle), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 9 } }, /* @__PURE__ */ React.createElement(StatCard, { label: strings.adminOverview.current, value: points.current_balance, color: theme.inkSoft }), /* @__PURE__ */ React.createElement(StatCard, { label: strings.adminOverview.reserved, value: points.reserved, color: "#7C6A5C" }), /* @__PURE__ */ React.createElement(StatCard, { label: strings.adminOverview.available, value: points.available, color: theme.rose }))), /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: sectionTitle2 }, strings.adminOverview.quickActions), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 9, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(QuickAction, { label: strings.adminOverview.addChore, onClick: onAddChore }), /* @__PURE__ */ React.createElement(QuickAction, { label: strings.adminOverview.addReward, onClick: onAddReward }), /* @__PURE__ */ React.createElement(QuickAction, { label: strings.adminOverview.adjustPoints, onClick: onAdjust }))), /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: sectionTitle2 }, strings.adminOverview.recentActivity), log.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: emptyNote }, strings.adminOverview.recentEmpty) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, log.slice(0, 6).map((e) => {
      const d = describeEntry(e, /* @__PURE__ */ new Set(), points.available);
      return /* @__PURE__ */ React.createElement("div", { key: e.id, style: rowCard }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, d.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13.5, color: theme.ink } }, d.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: theme.muted } }, d.sub)));
    }))));
  }
  function QuickAction({ label, onClick }) {
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick,
        style: { padding: "12px 16px", borderRadius: 15, background: theme.roseBgFlat, border: `1px solid ${theme.roseBorder}`, fontWeight: 800, fontSize: 13.5, color: theme.rose, cursor: "pointer" }
      },
      label
    );
  }
  function AdminLog({ log, available }) {
    const undoneRefIds = useMemo6(() => new Set(log.filter((e) => e.kind === "chore_undone").map((e) => e.ref_id)), [log]);
    if (log.length === 0) return /* @__PURE__ */ React.createElement("div", { style: { padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: emptyNote }, strings.log.emptyBody));
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8 } }, log.map((e) => {
      const d = describeEntry(e, undoneRefIds, available);
      const color = d.amountClass === "pos" ? theme.sage : d.amountClass === "neg" ? theme.rose : "#B0A093";
      return /* @__PURE__ */ React.createElement("div", { key: e.id, style: rowCard }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, d.emoji), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13.5, color: theme.ink } }, d.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: theme.muted } }, d.sub)), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 14, color } }, d.amountText));
    }));
  }
  function Nastavitve({ token, callAdmin, settings, points, onLock, onSaved, onFailed }) {
    const [name, setName] = useState8(settings.display_name || "");
    const [savingName, setSavingName] = useState8(false);
    const [adjustOpen, setAdjustOpen] = useState8(false);
    useEffect4(() => {
      setName(settings.display_name || "");
    }, [settings.display_name]);
    const saveName = useCallback8(async () => {
      if (!name.trim() || savingName) return;
      setSavingName(true);
      try {
        await callAdmin(adminUpdateSettings, name.trim());
        onSaved(strings.adminSettings.displayNameSaved);
      } catch (err) {
        onFailed(resolveError(err));
      } finally {
        setSavingName(false);
      }
    }, [name, savingName, callAdmin, onSaved, onFailed]);
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 } }, /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: sectionTitle2 }, strings.adminSettings.displayNameLabel), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("input", { value: name, onChange: (e) => setName(e.target.value), style: fieldStyle4 }), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: saveName,
        style: { padding: "0 18px", borderRadius: 14, background: theme.ink, color: "#FBF3EA", fontWeight: 800, fontSize: 13.5, display: "grid", placeItems: "center", cursor: "pointer", opacity: savingName ? 0.6 : 1 }
      },
      strings.common.save
    ))), /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: sectionTitle2 }, strings.adminPointAdjust.title), /* @__PURE__ */ React.createElement(QuickAction, { label: strings.adminOverview.adjustPoints, onClick: () => setAdjustOpen(true) })), /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { style: sectionTitle2 }, strings.adminNav.nastavitve), /* @__PURE__ */ React.createElement("div", { style: emptyNote }, strings.adminSettings.lockedNote), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: onLock,
        style: { marginTop: 10, padding: "12px 16px", borderRadius: 15, background: theme.badBg, border: `1px solid ${theme.bad}33`, fontWeight: 800, fontSize: 13.5, color: theme.bad, cursor: "pointer", display: "inline-block" }
      },
      strings.adminSettings.lockNow
    )), /* @__PURE__ */ React.createElement(PointAdjustSheet, { open: adjustOpen, onClose: () => setAdjustOpen(false), points, callAdmin, onSaved, onFailed }));
  }
  function PointAdjustSheet({ open: open2, onClose, points, callAdmin, onSaved, onFailed }) {
    const [amount, setAmount] = useState8("");
    const [busy, setBusy] = useState8(false);
    const [error, setError] = useState8(null);
    const delta = parseInt(amount, 10);
    const valid = Number.isInteger(delta) && delta !== 0;
    const previewCurrent = valid ? points.current_balance + delta : points.current_balance;
    const previewAvailable = valid ? points.available + delta : points.available;
    useEffect4(() => {
      if (open2) {
        setAmount("");
        setError(null);
      }
    }, [open2]);
    const submit = useCallback8(async () => {
      if (!valid || busy) {
        if (!valid) setError(strings.adminPointAdjust.invalidAmount);
        return;
      }
      if (previewAvailable < 0) {
        setError(strings.adminPointAdjust.negativeBlocked);
        return;
      }
      setBusy(true);
      try {
        await callAdmin(adminAdjustPoints, delta);
        onSaved(strings.adminPointAdjust.success);
        onClose();
      } catch (err) {
        setError(resolveError(err));
      } finally {
        setBusy(false);
      }
    }, [valid, busy, delta, previewAvailable, callAdmin, onSaved, onClose]);
    return /* @__PURE__ */ React.createElement(Sheet, { open: open2, onClose }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink } }, strings.adminPointAdjust.title), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        inputMode: "numeric",
        placeholder: "+10 / -10",
        value: amount,
        onChange: (e) => setAmount(e.target.value),
        style: { ...fieldStyle4, fontSize: 20, textAlign: "center", fontFamily: theme.fontDisplay, fontWeight: 700 },
        "aria-label": strings.adminPointAdjust.amountLabel
      }
    ), error && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: theme.bad, fontWeight: 700, textAlign: "center" } }, error), /* @__PURE__ */ React.createElement("div", { style: { borderRadius: 16, background: "#F8F3EA", border: "1px solid #EDE4D6", padding: "10px 14px", display: "flex", justifyContent: "space-around", fontSize: 12.5, color: "#7C6A5C" } }, /* @__PURE__ */ React.createElement("div", null, strings.adminPointAdjust.current, /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("strong", { style: { fontFamily: theme.fontDisplay, fontSize: 16, color: theme.inkSoft } }, formatPoints(previewCurrent))), /* @__PURE__ */ React.createElement("div", null, strings.adminPointAdjust.available, /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("strong", { style: { fontFamily: theme.fontDisplay, fontSize: 16, color: theme.rose } }, formatPoints(previewAvailable)))), /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: submit,
        style: { height: 52, borderRadius: 17, background: theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#FBF3EA", cursor: "pointer", opacity: busy ? 0.6 : 1 }
      },
      strings.adminPointAdjust.submit
    )));
  }
  var sectionTitle2 = { fontFamily: theme.fontScript, fontWeight: 700, fontSize: 20, color: "#7C6A5C", marginBottom: 8 };
  var emptyNote = { fontSize: 13, color: theme.muted, padding: "10px 2px" };
  var rowCard = { display: "flex", gap: 10, alignItems: "center", background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: "10px 12px" };
  var fieldStyle4 = {
    flex: 1,
    height: 46,
    borderRadius: 14,
    border: `1.5px solid ${theme.cardBorder}`,
    background: "#FFFCF7",
    padding: "0 14px",
    fontSize: 14.5,
    color: theme.ink,
    fontFamily: theme.fontBody
  };

  // marsova-opravila/Root.jsx
  var { useState: useState9, useEffect: useEffect5 } = React;
  function currentRoute() {
    return window.location.hash === "#/admin" ? "admin" : "user";
  }
  function Root() {
    const [route, setRoute] = useState9(currentRoute);
    useEffect5(() => {
      const onHashChange = () => setRoute(currentRoute());
      window.addEventListener("hashchange", onHashChange);
      return () => window.removeEventListener("hashchange", onHashChange);
    }, []);
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("style", null, globalCss), route === "admin" ? /* @__PURE__ */ React.createElement(AdminApp, { onExit: () => {
      window.location.hash = "";
    } }) : /* @__PURE__ */ React.createElement(UserApp, { onOpenAdmin: () => {
      window.location.hash = "#/admin";
    } }));
  }

  // marsova-opravila-app.jsx
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(Root, null));
})();
