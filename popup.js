(() => {
  "use strict";

  const API_ROOT = "https://api.frankfurter.dev/v1";
  const COINLY_URL = "https://coinly.app";
  const MAX_HISTORY = 50;
  const CACHE_TTL = 4 * 60 * 60 * 1000;

  const FALLBACK_CURRENCIES = {
    AUD: "Dollar australien",
    BGN: "Lev bulgare",
    BRL: "Réal brésilien",
    CAD: "Dollar canadien",
    CHF: "Franc suisse",
    CNY: "Yuan chinois",
    CZK: "Couronne tchèque",
    DKK: "Couronne danoise",
    EUR: "Euro",
    GBP: "Livre sterling",
    HKD: "Dollar de Hong Kong",
    HUF: "Forint hongrois",
    IDR: "Roupie indonésienne",
    ILS: "Shekel israélien",
    INR: "Roupie indienne",
    ISK: "Couronne islandaise",
    JPY: "Yen japonais",
    KRW: "Won sud-coréen",
    MXN: "Peso mexicain",
    MYR: "Ringgit malaisien",
    NOK: "Couronne norvégienne",
    NZD: "Dollar néo-zélandais",
    PHP: "Peso philippin",
    PLN: "Zloty polonais",
    RON: "Leu roumain",
    SEK: "Couronne suédoise",
    SGD: "Dollar de Singapour",
    THB: "Baht thaïlandais",
    TRY: "Livre turque",
    USD: "Dollar américain",
    ZAR: "Rand sud-africain"
  };

  const FLAG_BY_CURRENCY = {
    AUD: "🇦🇺", BGN: "🇧🇬", BRL: "🇧🇷", CAD: "🇨🇦", CHF: "🇨🇭",
    CNY: "🇨🇳", CZK: "🇨🇿", DKK: "🇩🇰", EUR: "🇪🇺", GBP: "🇬🇧",
    HKD: "🇭🇰", HUF: "🇭🇺", IDR: "🇮🇩", ILS: "🇮🇱", INR: "🇮🇳",
    ISK: "🇮🇸", JPY: "🇯🇵", KRW: "🇰🇷", MXN: "🇲🇽", MYR: "🇲🇾",
    NOK: "🇳🇴", NZD: "🇳🇿", PHP: "🇵🇭", PLN: "🇵🇱", RON: "🇷🇴",
    SEK: "🇸🇪", SGD: "🇸🇬", THB: "🇹🇭", TRY: "🇹🇷", USD: "🇺🇸",
    ZAR: "🇿🇦"
  };

  const dom = {
    amount: document.querySelector("#amount-input"),
    amountCode: document.querySelector("#amount-code"),
    from: document.querySelector("#from-currency"),
    to: document.querySelector("#to-currency"),
    resultCard: document.querySelector("#result-card"),
    resultSource: document.querySelector("#result-source"),
    result: document.querySelector("#result-display"),
    rateLabel: document.querySelector("#rate-label"),
    updateTime: document.querySelector("#update-time"),
    liveBadge: document.querySelector("#live-badge"),
    status: document.querySelector("#status-message"),
    copy: document.querySelector("#btn-copy"),
    favorite: document.querySelector("#btn-favorite"),
    favoritesSection: document.querySelector("#favorites-section"),
    favoritesList: document.querySelector("#favorites-list"),
    historyList: document.querySelector("#history-list"),
    historyCount: document.querySelector("#history-count"),
    clearHistory: document.querySelector("#btn-clear-history"),
    swap: document.querySelector("#btn-swap"),
    openSite: document.querySelector("#btn-open-site"),
    tabs: [...document.querySelectorAll(".tab")],
    panels: [...document.querySelectorAll(".panel")]
  };

  const state = {
    currencies: FALLBACK_CURRENCIES,
    rates: null,
    ratesBase: null,
    rateDate: null,
    favorites: [],
    history: [],
    cache: {},
    lastHistorySignature: "",
    userHasInteracted: false,
    historyTimer: null,
    requestId: 0
  };

  function storageGet(keys) {
    if (globalThis.chrome?.storage?.local) {
      return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
    }
    const result = {};
    keys.forEach((key) => {
      try {
        result[key] = JSON.parse(localStorage.getItem(key));
      } catch {
        result[key] = null;
      }
    });
    return Promise.resolve(result);
  }

  function storageSet(items) {
    if (globalThis.chrome?.storage?.local) {
      return new Promise((resolve) => chrome.storage.local.set(items, resolve));
    }
    Object.entries(items).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
    return Promise.resolve();
  }

  function getPair() {
    return `${dom.from.value}/${dom.to.value}`;
  }

  function getFlag(code) {
    return FLAG_BY_CURRENCY[code] || "¤";
  }

  function populateCurrencies(selectedFrom = "EUR", selectedTo = "USD") {
    const codes = Object.keys(state.currencies).sort((a, b) => a.localeCompare(b));

    [dom.from, dom.to].forEach((select) => {
      select.replaceChildren();
      codes.forEach((code) => {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = `${getFlag(code)} ${code}`;
        option.title = state.currencies[code];
        select.append(option);
      });
    });

    dom.from.value = codes.includes(selectedFrom) ? selectedFrom : "EUR";
    dom.to.value = codes.includes(selectedTo) ? selectedTo : "USD";
    dom.amountCode.textContent = dom.from.value;
  }

  async function loadCurrencies() {
    try {
      const response = await fetch(`${API_ROOT}/currencies`);
      if (!response.ok) return;
      const currencies = await response.json();
      if (currencies && typeof currencies === "object") {
        const selectedFrom = dom.from.value;
        const selectedTo = dom.to.value;
        state.currencies = currencies;
        populateCurrencies(selectedFrom, selectedTo);
      }
    } catch {
      // La liste embarquée permet de continuer hors ligne.
    }
  }

  function setLoading(isLoading) {
    dom.resultCard.classList.toggle("loading", isLoading);
    dom.liveBadge.classList.remove("error");
    dom.liveBadge.innerHTML = `<span class="live-dot"></span>${isLoading ? " Actualisation" : " En direct"}`;
    if (isLoading) dom.updateTime.textContent = "Connexion…";
  }

  function setError(message) {
    dom.resultCard.classList.add("error");
    dom.resultCard.classList.remove("loading");
    dom.result.textContent = message;
    dom.liveBadge.classList.add("error");
    dom.liveBadge.innerHTML = '<span class="live-dot"></span> Hors ligne';
    setStatus("Connexion impossible", "error");
  }

  function clearError() {
    dom.resultCard.classList.remove("error");
    dom.liveBadge.classList.remove("error");
  }

  function setStatus(message = "", kind = "") {
    dom.status.textContent = message;
    dom.status.className = kind;
  }

  function formatAmount(value, currency) {
    if (!Number.isFinite(value)) return "—";
    const magnitude = Math.abs(value);
    const maximumFractionDigits = magnitude > 1000 ? 2 : magnitude >= 1 ? 4 : 6;
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: 2,
      maximumFractionDigits
    }).format(value);
  }

  function formatPlain(value) {
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 }).format(value);
  }

  function formatDate(dateString) {
    if (!dateString) return "Taux récent";
    const date = new Date(`${dateString}T12:00:00`);
    return `Mis à jour le ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(date)}`;
  }

  function cacheIsFresh(entry) {
    return entry && Date.now() - entry.fetchedAt < CACHE_TTL;
  }

  async function ensureRates(force = false) {
    const base = dom.from.value;
    const requestId = ++state.requestId;
    const cached = state.cache[base];

    if (!force && cacheIsFresh(cached)) {
      applyRates(base, cached.rates, cached.date, false);
      return;
    }

    setLoading(true);
    setStatus();

    try {
      const response = await fetch(`${API_ROOT}/latest?base=${encodeURIComponent(base)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !data.rates) throw new Error("Réponse invalide");
      if (requestId !== state.requestId) return;

      const entry = {
        rates: { ...data.rates, [base]: 1 },
        date: data.date || null,
        fetchedAt: Date.now()
      };
      state.cache[base] = entry;
      await storageSet({ rateCache: state.cache });
      applyRates(base, entry.rates, entry.date, false);
    } catch {
      if (requestId !== state.requestId) return;
      if (cached && cached.rates) {
        applyRates(base, cached.rates, cached.date, true);
      } else {
        setError("Taux indisponibles");
      }
    }
  }

  function applyRates(base, rates, date, stale) {
    state.ratesBase = base;
    state.rates = rates;
    state.rateDate = date;
    setLoading(false);
    clearError();
    dom.updateTime.textContent = stale ? "Données hors ligne" : formatDate(date);
    dom.liveBadge.innerHTML = `<span class="live-dot"></span>${stale ? " Cache" : " En direct"}`;
    if (stale) setStatus("Mode hors ligne", "");
    renderConversion();
  }

  function getConversion() {
    const amount = Number.parseFloat(dom.amount.value);
    const from = dom.from.value;
    const to = dom.to.value;
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (from === to) return { amount, result: amount, rate: 1, from, to };
    if (state.ratesBase !== from || !state.rates || !state.rates[to]) return null;
    return { amount, result: amount * state.rates[to], rate: state.rates[to], from, to };
  }

  function renderConversion() {
    const amount = Number.parseFloat(dom.amount.value);
    const conversion = getConversion();
    dom.amountCode.textContent = dom.from.value;
    dom.resultSource.textContent = Number.isFinite(amount)
      ? `${formatPlain(amount)} ${dom.from.value}`
      : `Montant en ${dom.from.value}`;

    if (!Number.isFinite(amount) || amount < 0) {
      clearError();
      dom.result.textContent = "Saisissez un montant";
      dom.result.classList.add("placeholder");
      dom.rateLabel.textContent = "Taux de référence";
      return;
    }

    if (!conversion) {
      if (state.ratesBase === dom.from.value) setError("Conversion indisponible");
      return;
    }

    clearError();
    dom.result.classList.remove("placeholder");
    dom.result.textContent = formatAmount(conversion.result, conversion.to);
    dom.rateLabel.textContent = `1 ${conversion.from} = ${formatPlain(conversion.rate)} ${conversion.to}`;
    updateFavoriteButton();
    savePreferences();
    scheduleHistory(conversion);
  }

  async function savePreferences() {
    await storageSet({
      preferences: {
        from: dom.from.value,
        to: dom.to.value,
        amount: dom.amount.value
      }
    });
  }

  function scheduleHistory(conversion) {
    if (!state.userHasInteracted || conversion.amount <= 0) return;
    clearTimeout(state.historyTimer);
    state.historyTimer = setTimeout(() => addHistory(conversion), 850);
  }

  async function addHistory(conversion) {
    const signature = `${conversion.amount}|${conversion.from}|${conversion.to}|${conversion.result.toFixed(6)}`;
    if (signature === state.lastHistorySignature) return;
    state.lastHistorySignature = signature;

    const item = {
      amount: conversion.amount,
      from: conversion.from,
      to: conversion.to,
      result: conversion.result,
      time: Date.now()
    };
    state.history = [item, ...state.history].slice(0, MAX_HISTORY);
    await storageSet({ history: state.history });
    renderHistory();
  }

  function renderHistory() {
    dom.historyCount.textContent = String(state.history.length);
    dom.historyList.replaceChildren();

    if (!state.history.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = '<span class="empty-icon">↔</span><strong>Aucune conversion</strong><span>Vos conversions récentes apparaîtront ici.</span>';
      dom.historyList.append(empty);
      return;
    }

    state.history.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-item";

      const pair = document.createElement("span");
      pair.className = "history-pair";
      pair.textContent = `${item.from}\n${item.to}`;

      const details = document.createElement("span");
      details.className = "history-details";
      const source = document.createElement("strong");
      source.textContent = `${formatPlain(item.amount)} ${item.from}`;
      const result = document.createElement("span");
      result.textContent = `= ${formatAmount(item.result, item.to)}`;
      details.append(source, result);

      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(item.time);

      button.append(pair, details, time);
      button.addEventListener("click", () => restoreHistoryItem(item));
      dom.historyList.append(button);
    });
  }

  function restoreHistoryItem(item) {
    dom.from.value = item.from;
    dom.to.value = item.to;
    dom.amount.value = item.amount;
    state.userHasInteracted = false;
    switchPanel("converter-panel");
    ensureRates();
  }

  async function clearHistory() {
    state.history = [];
    state.lastHistorySignature = "";
    await storageSet({ history: [] });
    renderHistory();
    setStatus("Historique effacé", "success");
  }

  function updateFavoriteButton() {
    const active = state.favorites.includes(getPair());
    dom.favorite.classList.toggle("active", active);
    dom.favorite.querySelector("span").textContent = active ? "Retirer des favoris" : "Ajouter aux favoris";
  }

  async function toggleFavorite() {
    const pair = getPair();
    state.favorites = state.favorites.includes(pair)
      ? state.favorites.filter((favorite) => favorite !== pair)
      : [pair, ...state.favorites].slice(0, 12);
    await storageSet({ favorites: state.favorites });
    renderFavorites();
    updateFavoriteButton();
  }

  async function removeFavorite(pair) {
    state.favorites = state.favorites.filter((favorite) => favorite !== pair);
    await storageSet({ favorites: state.favorites });
    renderFavorites();
    updateFavoriteButton();
  }

  function renderFavorites() {
    dom.favoritesSection.hidden = state.favorites.length === 0;
    dom.favoritesList.replaceChildren();

    state.favorites.forEach((pair) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "favorite-chip";
      const label = document.createElement("span");
      label.textContent = pair.replace("/", " → ");
      const remove = document.createElement("span");
      remove.className = "favorite-remove";
      remove.textContent = "×";
      remove.title = "Retirer";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeFavorite(pair);
      });
      chip.append(label, remove);
      chip.addEventListener("click", () => {
        const [from, to] = pair.split("/");
        dom.from.value = from;
        dom.to.value = to;
        state.userHasInteracted = true;
        ensureRates();
      });
      dom.favoritesList.append(chip);
    });
  }

  function swapCurrencies() {
    const previous = dom.from.value;
    dom.from.value = dom.to.value;
    dom.to.value = previous;
    state.userHasInteracted = true;
    dom.amountCode.textContent = dom.from.value;
    ensureRates();
  }

  async function copyResult() {
    const conversion = getConversion();
    if (!conversion) return;
    const text = `${formatPlain(conversion.amount)} ${conversion.from} = ${formatPlain(conversion.result)} ${conversion.to}`;
    try {
      await navigator.clipboard.writeText(text);
      dom.copy.classList.add("copied");
      setStatus("Résultat copié", "success");
      setTimeout(() => dom.copy.classList.remove("copied"), 1300);
    } catch {
      setStatus("Copie impossible", "error");
    }
  }

  function switchPanel(panelId) {
    dom.tabs.forEach((tab) => {
      const active = tab.dataset.panel === panelId;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    dom.panels.forEach((panel) => {
      const active = panel.id === panelId;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  }

  function bindEvents() {
    dom.amount.addEventListener("input", () => {
      state.userHasInteracted = true;
      renderConversion();
    });
    dom.from.addEventListener("change", () => {
      state.userHasInteracted = true;
      dom.amountCode.textContent = dom.from.value;
      ensureRates();
    });
    dom.to.addEventListener("change", () => {
      state.userHasInteracted = true;
      renderConversion();
    });
    dom.swap.addEventListener("click", swapCurrencies);
    dom.copy.addEventListener("click", copyResult);
    dom.favorite.addEventListener("click", toggleFavorite);
    dom.clearHistory.addEventListener("click", clearHistory);
    dom.openSite.addEventListener("click", () => {
      if (globalThis.chrome?.tabs) chrome.tabs.create({ url: COINLY_URL });
      else window.open(COINLY_URL, "_blank", "noopener");
    });
    dom.tabs.forEach((tab) => tab.addEventListener("click", () => switchPanel(tab.dataset.panel)));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") window.close();
    });
  }

  async function init() {
    const stored = await storageGet(["preferences", "favorites", "history", "rateCache"]);
    state.favorites = Array.isArray(stored.favorites) ? stored.favorites : [];
    state.history = Array.isArray(stored.history) ? stored.history : [];
    state.cache = stored.rateCache && typeof stored.rateCache === "object" ? stored.rateCache : {};

    const preferences = stored.preferences || {};
    populateCurrencies(preferences.from || "EUR", preferences.to || "USD");
    dom.amount.value = preferences.amount || "100";
    dom.amountCode.textContent = dom.from.value;
    renderFavorites();
    renderHistory();
    updateFavoriteButton();
    bindEvents();

    await Promise.all([loadCurrencies(), ensureRates()]);
    state.userHasInteracted = false;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
