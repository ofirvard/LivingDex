(() => {
  const { games, entries, spriteBase } = window.DEX;
  const STORE_KEY = "livingdex.caught.v1";
  const PREFS_KEY = "livingdex.prefs.v1";
  const BOX_SIZE = 30;
  const GEN_RANGES = [[1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025]];
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
  const gameByCode = Object.fromEntries(games.map(g => [g.code, g]));

  // Availability code tokens from the Bulbapedia key. Two-letter tokens are matched first.
  const TOKENS = {
    CC: ["Requires communicating with another game", "conditional"],
    CD: ["Caught in paid DLC", "native"],
    DA: ["Dynamax Adventure (Crown Tundra DLC)", "native"],
    DS: ["Dual-slot mode (needs a GBA game inserted)", "conditional"],
    DR: ["Dream Radar", "external"],
    DW: ["Dream World (discontinued)", "external"],
    ET: ["Evolve an earlier stage by trading", "conditional"],
    TE: ["Transfer an earlier stage elsewhere and evolve it", "conditional"],
    EV: ["In-game event / event item", "conditional"],
    Ev: ["Real-life event distribution", "external"],
    FS: ["Friend Safari", "conditional"],
    PW: ["Pokéwalker", "external"],
    C: ["Catch in the wild", "native"],
    S: ["Catch at certain times only (swarm, outbreak, rotation)", "native"],
    R: ["Received (gift, starter, fossil, in-game trade)", "native"],
    E: ["Evolve an earlier stage", "native"],
    B: ["Breed from a later stage", "native"],
    D: ["Max Raid Den (Sw/Sh) — or, as a suffix, only in paid DLC", "native"],
    T: ["Trade or transfer from another game only", "external"],
  };
  // "Can I catch it in this game" for the Catch filter: meet it in the wild (including DLC, raids and
  // Dynamax Adventures), evolve it, or breed it. Gifts and NPC trades (R), trade evolutions (ET),
  // event items (EV), Friend Safari, dual-slot, trades/transfers and anything needing another game don't count.
  const IN_GAME_START = new Set(["C", "S", "E", "B", "D", "DA", "CD"]);
  const codeCache = new Map();
  function parseCode(code) {
    if (codeCache.has(code)) return codeCache.get(code);
    const parts = [];
    for (let i = 0; i < code.length;) {
      const two = code.slice(i, i + 2);
      const tok = TOKENS[two] ? two : code[i];
      parts.push(tok);
      i += tok.length;
    }
    const first = TOKENS[parts[0]];
    const res = {
      inGame: IN_GAME_START.has(parts[0]),
      tier: first ? first[1] : "external",
      text: parts.map((p, i) => (i && p === "D" ? "only in paid DLC" : (TOKENS[p] || [p])[0])).join(" → "),
    };
    codeCache.set(code, res);
    return res;
  }

  // ---------- state ----------
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
  const caught = new Set(load(STORE_KEY, []));
  const savedPrefs = load(PREFS_KEY, {});
  const prefs = Object.assign(
    { view: "boxes", zoom: 96, gen: "", status: "", games: [], catchMode: "can" },
    savedPrefs,
    { cats: { base: true, regional: true, variant: true, gender: true, changeable: false, ...savedPrefs.cats } },
  );
  // Progress is saved to progress.json through server.py (safe across restarts and cleared browser data),
  // with a browser copy as a fallback for when the app is opened without the server.
  let serverOk = false, saveTimer;
  function setSaveStatus(state) {
    const el = document.querySelector("#save-status");
    const text = { disk: "✓ Saved to file", saving: "Saving…", browser: "⚠ Saved in this browser only", error: "⚠ Couldn't save to file" }[state];
    el.textContent = text;
    el.className = `save-status ${state}`;
    el.title = state === "browser" || state === "error"
      ? "Start the app with start.bat (or python server.py) to save progress to progress.json on disk."
      : "Progress is stored in progress.json in the LivingDex folder.";
  }
  async function pushToServer(keepalive = false) {
    try {
      const res = await fetch("api/progress", {
        method: "PUT", keepalive,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caught: [...caught] }),
      });
      if (!res.ok) throw new Error(res.status);
      setSaveStatus("disk");
    } catch {
      setSaveStatus("error");
    }
  }
  function persistCaught() {
    save(STORE_KEY, [...caught]);
    if (!serverOk) return;
    setSaveStatus("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushToServer, 400);
  }
  window.addEventListener("pagehide", () => {
    if (serverOk && saveTimer) { clearTimeout(saveTimer); pushToServer(true); }
  });
  const persistPrefs = () => save(PREFS_KEY, prefs);

  // ---------- elements ----------
  const $ = s => document.querySelector(s);
  const dexEl = $("#dex");
  const search = $("#search"), genSel = $("#gen-filter"), statusSel = $("#status-filter");
  const catchBtn = $("#catch-btn"), catchDialog = $("#catch-dialog"), gameList = $("#game-list");

  GEN_RANGES.forEach((_, i) => genSel.add(new Option(`Generation ${ROMAN[i]}`, i + 1)));
  prefs.games = (prefs.games || []).filter(c => gameByCode[c]);
  if (prefs.catchMode !== "cant") prefs.catchMode = "can";
  gameList.innerHTML = ROMAN.map((r, i) => `
    <fieldset>
      <legend><label><input type="checkbox" data-game-gen="${i + 1}"> Generation ${r}</label></legend>
      ${games.filter(g => g.gen === i + 1).map(g => `
        <label class="game-opt" style="--gc:${g.color}"><input type="checkbox" value="${g.code}"> ${g.name}</label>`).join("")}
    </fieldset>`).join("");
  function syncGameMenu() {
    const chosen = new Set(prefs.games);
    gameList.querySelectorAll("input[value]").forEach(cb => { cb.checked = chosen.has(cb.value); });
    gameList.querySelectorAll("[data-game-gen]").forEach(cb => {
      const inGen = games.filter(g => g.gen === +cb.dataset.gameGen);
      const n = inGen.filter(g => chosen.has(g.code)).length;
      cb.checked = n === inGen.length;
      cb.indeterminate = n > 0 && n < inGen.length;
    });
    const cant = prefs.catchMode === "cant";
    catchDialog.querySelectorAll("[name=catch-mode]").forEach(r => { r.checked = r.value === prefs.catchMode; });
    const which = chosen.size <= 2 ? prefs.games.map(c => gameByCode[c].name).join(", ") : `${chosen.size} games`;
    catchBtn.textContent = !chosen.size ? "Catch" : `${cant ? "Can't catch" : "Can catch"}: ${which}`;
    catchBtn.classList.toggle("active", chosen.size > 0);
    $("#catch-hint").textContent = cant
      ? "Show Pokémon you can't catch in any of these games. Catching means meeting it in the wild (DLC, raids included), evolving or breeding it — not gifts, NPC trades, trade evolutions, events, Friend Safari or dual-slot."
      : "Show Pokémon you can catch in at least one of these games: meet it in the wild (DLC, raids included), evolve or breed it — not gifts, NPC trades, trade evolutions, events, Friend Safari or dual-slot.";
  }

  genSel.value = prefs.gen; statusSel.value = prefs.status;
  syncGameMenu();
  document.querySelectorAll("[data-cat]").forEach(cb => { cb.checked = !!prefs.cats[cb.dataset.cat]; });
  document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === prefs.view));

  // ---------- filtering ----------
  const genOf = num => GEN_RANGES.findIndex(([a, b]) => num >= a && num <= b) + 1;
  const pad = n => String(n).padStart(4, "0");
  // Species with a female variant get a ♂ marker on the default entry while gender forms are tracked.
  // A default entry only names its form (e.g. "Unown A", "Shellos West") when another form of that
  // species is on screen; otherwise it's just the plain species name, like a normal Pokédex.
  let speciesWithForms = new Set();
  function labelOf(e) {
    const label = e.cat === "base" && !speciesWithForms.has(e.num) ? "" : e.label;
    return e.hasFemale && prefs.cats.gender ? [label, "♂"].filter(Boolean).join(" ") : label;
  }
  const displayName = e => labelOf(e) ? `${e.name} (${labelOf(e)})` : e.name;

  // Caught keys:
  //  - "<id>"           a specific entry (Unown A, Alolan Rattata, Pikachu with gender unknown…)
  //  - "<id>-male"      the ♂ of a species with a visible female difference ("<id>-female" is the ♀ entry)
  //  - "<dex>-species"  "I have this Pokémon" marked on its plain name, without saying which form/gender
  // A species with only one entry (e.g. Bulbasaur) always uses "<id>".
  const entryById = new Map(entries.map(e => [e.id, e]));
  const speciesKeys = new Map(); // every key belonging to a species
  for (const e of entries) {
    const keys = speciesKeys.get(e.num) || [];
    keys.push(...(e.hasFemale ? [e.id, `${e.id}-male`] : [e.id]));
    speciesKeys.set(e.num, keys);
  }
  for (const [num, keys] of speciesKeys) if (keys.length > 1) keys.push(`${num}-species`);
  const speciesKey = num => (speciesKeys.get(num).length > 1 ? `${num}-species` : String(num));

  // A default entry shown as the plain species name stands for the whole species,
  // so catching any of its forms (Unown B, Alolan Rattata, Pikachu ♀…) counts.
  const isPlainBase = e => e.cat === "base" && !speciesWithForms.has(e.num);
  const genderSplit = e => e.hasFemale && prefs.cats.gender;
  function caughtKey(e) {
    if (isPlainBase(e)) return speciesKey(e.num);
    return genderSplit(e) ? `${e.id}-male` : e.id;
  }
  // Keys that clicking this card adds or removes.
  function ownKeys(e) {
    if (isPlainBase(e)) return speciesKeys.get(e.num).length > 1 ? unspecifiedKeys(e.num) : [e.id];
    return e.hasFemale && !prefs.cats.gender ? [e.id, `${e.id}-male`, `${e.id}-female`] : [caughtKey(e)];
  }
  const anyCaught = keys => keys.some(k => caught.has(k));
  // On a plain species name: orange until you say which form/gender you have, dashed green while
  // only some of its versions are caught, solid green once every version is.
  const speciesEntries = new Map();
  for (const e of entries) speciesEntries.set(e.num, [...(speciesEntries.get(e.num) || []), e]);
  // Marks that say "I have this Pokémon" without naming the version: the plain-name mark, and a
  // gender-difference species marked without picking ♂ or ♀ (e.g. "Venusaur" with gender unknown).
  const unspecifiedKeys = num => [`${num}-species`, ...speciesEntries.get(num).filter(x => x.hasFemale).map(x => x.id)];
  const specificCaught = num => {
    const loose = new Set(unspecifiedKeys(num));
    return speciesKeys.get(num).some(k => !loose.has(k) && caught.has(k));
  };
  const allVersionsCaught = num => speciesEntries.get(num)
    .filter(x => x.cat !== "changeable" || prefs.cats.changeable)
    .every(x => caught.has(x.hasFemale ? `${x.id}-male` : x.id));
  const caughtViaForm = e => isPlainBase(e) && specificCaught(e.num) && !allVersionsCaught(e.num);
  const lockedByForms = e => isPlainBase(e) && specificCaught(e.num) && !anyCaught(ownKeys(e));
  function isCaught(e) {
    if (isPlainBase(e)) return anyCaught(speciesKeys.get(e.num));
    return anyCaught(ownKeys(e));
  }
  // Marked as caught without saying which form or gender: the species was marked on its plain name
  // and no specific form is marked, or the gender was left open and neither ♂ nor ♀ is marked.
  function isUnsure(e) {
    if (isPlainBase(e)) return speciesKeys.get(e.num).length > 1 && anyCaught(unspecifiedKeys(e.num)) && !specificCaught(e.num);
    if (isCaught(e)) return false;
    const sk = `${e.num}-species`;
    if (caught.has(sk) && !speciesKeys.get(e.num).some(k => k !== sk && caught.has(k))) return true;
    const parent = e.cat === "gender" ? e.id.slice(0, -"-female".length) : e.hasFemale ? e.id : null;
    return !!parent && prefs.cats.gender && caught.has(parent) && !caught.has(`${parent}-male`) && !caught.has(`${parent}-female`);
  }
  const stateClass = e => (isCaught(e) ? " caught" : "") + (caughtViaForm(e) ? " via-form" : "") + (isUnsure(e) ? " unsure" : "");
  function stateTitle(e) {
    if (caughtViaForm(e)) return "Some of its forms/genders are caught, not all · right-click for details";
    if (isUnsure(e) && isPlainBase(e)) return "Caught — turn on its form types and click the one you have (click here to unmark)";
    if (isUnsure(e)) return "You marked this Pokémon without saying which form/gender — click the one you have";
    return "Click to toggle caught · right-click for details";
  }

  // The dex (what counts toward completion) depends only on which form types are tracked.
  // Each toggle adds its group; turning off "Base forms" leaves only the alternate forms you ticked.
  // A species' default entry still shows as ♂ when gender differences are on.
  function trackedEntries() {
    return entries.filter(e => {
      if (e.cat === "base") return prefs.cats.base || (e.hasFemale && prefs.cats.gender);
      if (!prefs.cats[e.cat]) return false;
      return !e.parentCat || e.parentCat === "base" || prefs.cats[e.parentCat];
    });
  }

  function matchesFilters(e) {
    const q = search.value.trim().toLowerCase();
    if (q) {
      const numQ = q.replace(/^#/, "");
      const hit = /^\d+$/.test(numQ) ? String(e.num) === String(+numQ) : displayName(e).toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (prefs.gen && genOf(e.num) !== +prefs.gen) return false;
    if (prefs.status === "caught" && !isCaught(e)) return false;
    if (prefs.status === "missing" && isCaught(e)) return false;
    if (prefs.games.length) {
      const can = prefs.games.some(g => e.avail[g] && parseCode(e.avail[g]).inGame);
      if (can !== (prefs.catchMode === "can")) return false;
    }
    return true;
  }

  // ---------- rendering ----------
  function spriteUrl(e) {
    return /^https?:/.test(e.sprite) ? e.sprite : spriteBase + e.sprite;
  }

  function card(e, slot) {
    const el = document.createElement("button");
    el.className = "mon" + stateClass(e);
    el.dataset.id = e.id;
    el.title = `#${pad(e.num)} ${displayName(e)}${e.inherited ? " *" : ""}\n` +
      stateTitle(e);
    el.innerHTML = `
      ${slot ? `<span class="slot">${slot}</span>` : ""}
      <img loading="lazy" src="${spriteUrl(e)}" alt="" width="68" height="68">
      <span class="num">#${pad(e.num)}</span>
      <span class="name">${e.name}</span>
      ${labelOf(e) ? `<span class="form">${labelOf(e)}${e.inherited ? "*" : ""}</span>` : ""}
      <span class="info" data-info aria-label="Details">i</span>`;
    return el;
  }

  function availStrip(e) {
    return GEN_RANGES.map((_, i) => `<span class="gen">${games.filter(g => g.gen === i + 1).map(g => {
      const code = e.avail[g.code];
      if (!code) return `<span class="g none" title="${g.name}: not obtainable">${g.code}</span>`;
      const { tier, text } = parseCode(code);
      return `<span class="g ${tier}" style="--gc:${g.color}" title="${g.name}: ${code} — ${text}">${g.code}</span>`;
    }).join("")}</span>`).join("");
  }

  const boxCount = slice => `${slice.filter(isCaught).length}/${slice.length}`;

  function updateProgress(tracked) {
    const done = tracked.filter(isCaught).length;
    const pct = tracked.length ? (done / tracked.length) * 100 : 0;
    $("#progress-text").textContent = `${done} / ${tracked.length} (${Math.floor(pct)}%)`;
    $("#progress-fill").style.width = `${pct}%`;
  }

  function render() {
    const tracked = trackedEntries();
    const perSpecies = new Map();
    tracked.forEach(e => perSpecies.set(e.num, (perSpecies.get(e.num) || 0) + 1));
    speciesWithForms = new Set([...perSpecies].filter(([, n]) => n > 1).map(([num]) => num));
    updateProgress(tracked);

    dexEl.className = `view-${prefs.view}`;
    dexEl.replaceChildren();
    const frag = document.createDocumentFragment();
    let shown = 0;

    if (prefs.view === "boxes") {
      // Box layout is fixed by dex order of tracked entries so it matches your real boxes.
      for (let b = 0; b * BOX_SIZE < tracked.length; b++) {
        const slice = tracked.slice(b * BOX_SIZE, (b + 1) * BOX_SIZE);
        const visible = slice.map((e, i) => [e, i]).filter(([e]) => matchesFilters(e));
        if (!visible.length) continue;
        const box = document.createElement("section");
        box.className = "box";
        box.dataset.box = b;
        box.innerHTML = `<h2>Box ${b + 1} <small>#${pad(slice[0].num)} – #${pad(slice.at(-1).num)} · <span class="box-count">${boxCount(slice)}</span></small></h2>`;
        const grid = document.createElement("div");
        grid.className = "grid";
        const filtering = visible.length !== slice.length;
        for (let i = 0; i < slice.length; i++) {
          const e = slice[i];
          if (filtering && !matchesFilters(e)) { grid.append(Object.assign(document.createElement("div"), { className: "mon ghost" })); continue; }
          grid.append(card(e, `${Math.floor(i / 6) + 1}-${(i % 6) + 1}`));
          shown++;
        }
        box.append(grid);
        frag.append(box);
      }
    } else if (prefs.view === "grid") {
      const grid = document.createElement("div");
      grid.className = "plain-grid";
      for (const e of tracked) {
        if (!matchesFilters(e)) continue;
        grid.append(card(e));
        shown++;
      }
      frag.append(grid);
    } else {
      const list = document.createElement("div");
      list.className = "rows";
      for (const e of tracked) {
        if (!matchesFilters(e)) continue;
        const row = document.createElement("div");
        row.className = "row";
        row.append(card(e));
        const strip = document.createElement("div");
        strip.className = "strip";
        strip.innerHTML = availStrip(e);
        row.append(strip);
        list.append(row);
        shown++;
      }
      frag.append(list);
    }
    if (!shown) frag.append(Object.assign(document.createElement("p"), { className: "empty", textContent: "No Pokémon match these filters." }));
    dexEl.append(frag);
  }

  function updateCard(id) {
    // A mark can change how the species' other cards look (♂/♀, "unsure"), so refresh them all.
    const num = entryById.get(id).num;
    document.querySelectorAll(".mon[data-id]").forEach(el => {
      const e = entryById.get(el.dataset.id);
      if (e.num !== num) return;
      el.className = "mon" + stateClass(e);
      el.title = `#${pad(e.num)} ${displayName(e)}${e.inherited ? " *" : ""}\n${stateTitle(e)}`;
    });
    const tracked = trackedEntries();
    updateProgress(tracked);
    if (prefs.status) return render(); // the entry may no longer match the caught/missing filter
    document.querySelectorAll(".box").forEach(box => {
      if (!box.querySelector(`.mon[data-id="${CSS.escape(id)}"]`)) return;
      const b = +box.dataset.box;
      box.querySelector(".box-count").textContent = boxCount(tracked.slice(b * BOX_SIZE, (b + 1) * BOX_SIZE));
    });
  }

  // ---------- detail dialog ----------
  const detail = $("#detail");
  function openDetail(id) {
    const e = entries.find(x => x.id === id);
    const byGen = {};
    for (const g of games) if (e.avail[g.code]) (byGen[g.gen] ||= []).push(g);
    const rows = Object.entries(byGen).map(([gen, gs]) => `
      <h4>Generation ${ROMAN[gen - 1]}</h4>
      <ul>${gs.map(g => {
        const code = e.avail[g.code];
        const note = e.notes?.[g.code];
        const { tier, text } = parseCode(code);
        return `<li class="${tier}"><span class="gname">${g.name}</span><span><b>${code}</b> ${text}${note ? ` <em>(${note})</em>` : ""}</span></li>`;
      }).join("")}</ul>`).join("");
    const missing = games.filter(g => !e.avail[g.code]).map(g => g.name);
    const nativeIn = games.filter(g => e.avail[g.code] && parseCode(e.avail[g.code]).tier === "native").map(g => g.name);
    const bulbaName = encodeURIComponent(`${e.name}_(Pokémon)`.replace(/ /g, "_"));
    $("#detail-body").innerHTML = `
      <div class="detail-head">
        <img src="${spriteUrl(e)}" alt="" width="96" height="96">
        <div>
          <div class="num">#${pad(e.num)}</div>
          <h3>${displayName(e)}</h3>
          <label class="caught-toggle"><input type="checkbox" ${isCaught(e) ? "checked" : ""} ${lockedByForms(e) ? "disabled" : ""} data-detail-toggle="${e.id}"> ${lockedByForms(e) ? "Caught (through its forms)" : "Caught"}</label>
          <a href="https://bulbapedia.bulbagarden.net/wiki/${bulbaName}#Game_locations" target="_blank" rel="noopener">Locations on Bulbapedia ↗</a>
        </div>
      </div>
      ${e.inherited ? `<p class="hint">* Bulbapedia lists this form together with the species, so this shows the species' availability. Some forms (e.g. Vivillon patterns, Alcremie) have extra conditions.</p>` : ""}
      <p class="summary">${nativeIn.length ? `<b>Get it in:</b> ${nativeIn.join(", ")}` : "<b>Not obtainable in-game normally</b> — needs trades, transfers or events."}</p>
      <div class="legend"><span class="native">Obtainable in-game</span><span class="conditional">Conditional</span><span class="external">Trade / transfer / event only</span></div>
      ${rows}
      ${missing.length ? `<details class="missing"><summary>Not in ${missing.length} games</summary>${missing.join(", ")}</details>` : ""}`;
    detail.showModal();
  }

  // ---------- events ----------
  function toggle(id) {
    const e = entryById.get(id);
    if (isPlainBase(e) && specificCaught(e.num)) {
      // Caught through its forms; the only thing to undo here is an unspecified "I have it" mark.
      if (!ownKeys(e).map(k => caught.delete(k)).some(Boolean)) return;
    } else if (!isCaught(e)) caught.add(caughtKey(e));
    else ownKeys(e).forEach(k => caught.delete(k));
    persistCaught();
    updateCard(id);
  }

  dexEl.addEventListener("click", ev => {
    const mon = ev.target.closest(".mon[data-id]");
    if (!mon) return;
    if (ev.target.closest("[data-info]")) openDetail(mon.dataset.id);
    else toggle(mon.dataset.id);
  });
  dexEl.addEventListener("contextmenu", ev => {
    const mon = ev.target.closest(".mon[data-id]");
    if (!mon) return;
    ev.preventDefault();
    openDetail(mon.dataset.id);
  });
  detail.addEventListener("change", ev => {
    const id = ev.target.dataset.detailToggle;
    if (id) toggle(id);
  });
  detail.addEventListener("click", ev => { if (ev.target === detail) detail.close(); });

  let searchTimer;
  search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); });
  genSel.addEventListener("change", () => { prefs.gen = genSel.value; persistPrefs(); render(); });
  statusSel.addEventListener("change", () => { prefs.status = statusSel.value; persistPrefs(); render(); });
  const zoom = $("#zoom");
  const applyZoom = () => dexEl.style.setProperty("--card", `${prefs.zoom}px`);
  zoom.value = prefs.zoom;
  applyZoom();
  zoom.addEventListener("input", () => { prefs.zoom = +zoom.value; applyZoom(); });
  zoom.addEventListener("change", persistPrefs);
  gameList.addEventListener("change", ev => {
    const cb = ev.target;
    let chosen = new Set(prefs.games);
    if (cb.dataset.gameGen) {
      games.filter(g => g.gen === +cb.dataset.gameGen).forEach(g => (cb.checked ? chosen.add(g.code) : chosen.delete(g.code)));
    } else {
      cb.checked ? chosen.add(cb.value) : chosen.delete(cb.value);
    }
    prefs.games = games.map(g => g.code).filter(c => chosen.has(c)); // keep release order
    syncGameMenu(); persistPrefs(); render();
  });
  catchDialog.querySelectorAll("[name=catch-mode]").forEach(r => r.addEventListener("change", () => {
    prefs.catchMode = r.value; syncGameMenu(); persistPrefs(); render();
  }));
  $("#game-clear").addEventListener("click", () => { prefs.games = []; syncGameMenu(); persistPrefs(); render(); });
  catchBtn.addEventListener("click", () => catchDialog.showModal());
  catchDialog.addEventListener("click", ev => { if (ev.target === catchDialog) catchDialog.close(); });
  document.querySelectorAll("[data-cat]").forEach(cb => cb.addEventListener("change", () => {
    prefs.cats[cb.dataset.cat] = cb.checked; persistPrefs(); render();
  }));
  document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => {
    prefs.view = b.dataset.view;
    document.querySelectorAll("[data-view]").forEach(x => x.classList.toggle("active", x === b));
    persistPrefs(); render();
  }));

  $("#export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ caught: [...caught], exported: new Date().toISOString() }, null, 1)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "living-dex-progress.json" });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#import-input").addEventListener("change", async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const ids = new Set([...speciesKeys.values()].flat());
      const list = (data.caught || []).filter(id => ids.has(id));
      if (!confirm(`Import ${list.length} caught entries? This replaces your current progress.`)) return;
      caught.clear(); list.forEach(id => caught.add(id));
      persistCaught(); render();
    } catch { alert("That file isn't a Living Dex export."); }
    ev.target.value = "";
  });
  $("#reset-btn").addEventListener("click", () => {
    if (!confirm("Clear all caught marks?")) return;
    caught.clear(); persistCaught(); render();
  });

  render();

  (async () => {
    try {
      const res = await fetch("api/progress", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      serverOk = true;
      if (data.caught.length || !caught.size) {
        caught.clear();
        data.caught.forEach(id => caught.add(id));
        save(STORE_KEY, [...caught]);
        render();
        setSaveStatus("disk");
      } else {
        await pushToServer(); // first run with the server: move browser progress into the file
      }
    } catch {
      setSaveStatus("browser");
    }
  })();
})();
