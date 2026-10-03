(() => {
  const M = (window.Maiden = window.Maiden || {});
  const { uid } = M.engine;

  const PREFIX = 'maiden:';
  const KEY = {
    match: `${PREFIX}match:`, tournament: `${PREFIX}tournament:`, profile: `${PREFIX}profile`,
    current: `${PREFIX}current`, imported: `${PREFIX}legacy-imported`,
  };
  const LEGACY_KEY = 'cricnova-match-state-v1';

  const memory = new Map();
  let persistent = true;
  try {
    localStorage.setItem(`${PREFIX}probe`, '1');
    localStorage.removeItem(`${PREFIX}probe`);
  } catch (error) {
    persistent = false;
  }

  const storage = {
    get(key) {
      try { return persistent ? localStorage.getItem(key) : (memory.get(key) ?? null); } catch (error) { return null; }
    },
    set(key, value) {
      if (persistent) localStorage.setItem(key, value);
      else memory.set(key, value);
    },
    remove(key) {
      try { if (persistent) localStorage.removeItem(key); else memory.delete(key); } catch (error) { /* nothing to remove */ }
    },
    keys(prefix) {
      const found = [];
      if (persistent) {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (key && key.startsWith(prefix)) found.push(key);
        }
      } else memory.forEach((_, key) => { if (key.startsWith(prefix)) found.push(key); });
      return found;
    },
  };

  // Deliveries are stored as compact arrays so a full ODI stays small enough for browser storage.
  const DELIVERY_FIELDS = [
    ['batRuns', 0], ['noBall', 0], ['wide', 0], ['wideRuns', 0], ['byes', 0], ['legByes', 0], ['penaltyRuns', 0],
    ['wicket', ''], ['dismissedId', ''], ['strikerId', ''], ['nonStrikerId', ''], ['bowler', ''],
    ['overIndex', 0], ['ballInOver', 0], ['wasFreeHit', 0], ['incomingId', ''], ['incomingName', ''], ['at', 0],
  ];
  const BOOLEAN_FIELDS = new Set(['noBall', 'wide', 'wasFreeHit']);

  function packState(state) {
    return {
      ...state,
      packed: 1,
      innings: state.innings.map((innings) => ({
        ...innings,
        deliveries: innings.deliveries.map((delivery) => DELIVERY_FIELDS.map(([field]) => (
          BOOLEAN_FIELDS.has(field) ? (delivery[field] ? 1 : 0) : delivery[field]
        ))),
      })),
    };
  }

  function unpackState(state) {
    if (!state?.packed) return state;
    const { packed, ...rest } = state;
    return {
      ...rest,
      innings: rest.innings.map((innings) => ({
        ...innings,
        deliveries: innings.deliveries.map((row) => Object.fromEntries(DELIVERY_FIELDS.map(([field, fallback], index) => {
          const value = row[index] ?? fallback;
          return [field, BOOLEAN_FIELDS.has(field) ? Boolean(value) : value];
        }))),
      })),
    };
  }

  const listeners = new Set();
  const matchCache = new Map();

  function notify(type, id) {
    listeners.forEach((listener) => {
      try { listener(type, id); } catch (error) { /* a faulty listener must not block saves */ }
    });
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.addEventListener('storage', (event) => {
    if (!event.key || !event.key.startsWith(PREFIX)) return;
    matchCache.clear();
    notify('external', event.key);
  });

  function readMatch(id) {
    const raw = storage.get(KEY.match + id);
    if (!raw) return null;
    const hit = matchCache.get(id);
    if (hit && hit.raw === raw) return hit.record;
    try {
      const parsed = JSON.parse(raw);
      const record = { ...parsed, state: unpackState(parsed.state) };
      matchCache.set(id, { raw, record });
      return record;
    } catch (error) {
      return null;
    }
  }

  // Records returned here are shared snapshots: clone `state` before editing it.
  const getMatch = (id) => (id ? readMatch(id) : null);

  function listMatches() {
    return storage.keys(KEY.match)
      .map((key) => readMatch(key.slice(KEY.match.length)))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function saveMatch(input, { touch = true } = {}) {
    const record = {
      v: 1, id: input.id, createdAt: input.createdAt || Date.now(),
      updatedAt: touch ? Date.now() : (input.updatedAt || Date.now()),
      scorer: input.scorer || '', venue: input.venue || '',
      tournamentId: input.tournamentId || '', fixtureId: input.fixtureId || '', state: input.state,
    };
    storage.set(KEY.match + record.id, JSON.stringify({ ...record, state: packState(record.state) }));
    matchCache.delete(record.id);
    notify('match', record.id);
    return record;
  }

  function readTournament(id) {
    const raw = storage.get(KEY.tournament + id);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (error) { return null; }
  }

  const getTournament = (id) => (id ? readTournament(id) : null);

  function listTournaments() {
    return storage.keys(KEY.tournament)
      .map((key) => readTournament(key.slice(KEY.tournament.length)))
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  function saveTournament(tournament) {
    const record = { ...tournament, v: 1, updatedAt: Date.now() };
    storage.set(KEY.tournament + record.id, JSON.stringify(record));
    notify('tournament', record.id);
    return record;
  }

  function linkFixture(tournamentId, fixtureId, matchId) {
    const tournament = readTournament(tournamentId);
    const fixture = tournament?.fixtures.find((item) => item.id === fixtureId);
    if (!fixture) return;
    fixture.matchId = matchId;
    saveTournament(tournament);
  }

  function deleteMatch(id) {
    const record = readMatch(id);
    storage.remove(KEY.match + id);
    matchCache.delete(id);
    if (getCurrentId() === id) storage.remove(KEY.current);
    if (record?.tournamentId) linkFixture(record.tournamentId, record.fixtureId, '');
    notify('match', id);
  }

  function deleteTournament(id) {
    listMatches().filter((record) => record.tournamentId === id)
      .forEach((record) => saveMatch({ ...record, tournamentId: '', fixtureId: '' }, { touch: false }));
    storage.remove(KEY.tournament + id);
    notify('tournament', id);
  }

  function getProfile() {
    try { return { scorerName: '', ...(JSON.parse(storage.get(KEY.profile)) || {}) }; } catch (error) { return { scorerName: '' }; }
  }

  function saveProfile(patch) {
    const profile = { ...getProfile(), ...patch };
    try { storage.set(KEY.profile, JSON.stringify(profile)); } catch (error) { /* profile stays in memory only */ }
    notify('profile', '');
    return profile;
  }

  const getCurrentId = () => storage.get(KEY.current) || '';
  function setCurrentId(id) {
    try { if (id) storage.set(KEY.current, id); else storage.remove(KEY.current); } catch (error) { /* pointer is optional */ }
  }

  function usage() {
    let bytes = 0;
    storage.keys(PREFIX).forEach((key) => { bytes += (key.length + (storage.get(key) || '').length) * 2; });
    return { bytes, persistent };
  }

  // Brings in a match that an earlier build kept under a single storage key.
  function importLegacyMatch() {
    if (storage.get(KEY.imported)) return;
    try {
      const saved = JSON.parse(storage.get(LEGACY_KEY));
      if (saved?.started && Array.isArray(saved.innings) && saved.innings.length) {
        const state = { followOn: false, superOverRound: 0, superOverStart: -1, result: null, ...saved };
        if (state.currentIndex < 0 || state.currentIndex === undefined) state.currentIndex = 0;
        saveMatch({ id: uid('m'), createdAt: Date.now(), state });
      }
    } catch (error) { /* no earlier match to import */ }
    try { storage.set(KEY.imported, '1'); } catch (error) { /* retry next visit */ }
  }

  importLegacyMatch();

  M.store = {
    persistent, subscribe, usage,
    getMatch, listMatches, saveMatch, deleteMatch,
    getTournament, listTournaments, saveTournament, deleteTournament, linkFixture,
    getProfile, saveProfile, getCurrentId, setCurrentId,
  };
})();
