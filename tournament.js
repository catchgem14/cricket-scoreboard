(() => {
  const M = (window.Maiden = window.Maiden || {});
  const { uid, getInningsStats } = M.engine;

  const WORLD_CUP_TEAMS = [
    'India', 'Australia', 'England', 'South Africa', 'New Zealand', 'Pakistan', 'Sri Lanka', 'Bangladesh',
    'Afghanistan', 'West Indies', 'Ireland', 'Zimbabwe', 'Netherlands', 'Scotland', 'Namibia', 'USA',
  ];
  const GROUP_LETTERS = 'ABCDEFGH';
  const POINTS = {
    t20: { win: 2, tie: 1, nr: 1, draw: 0 },
    odi: { win: 2, tie: 1, nr: 1, draw: 0 },
    test: { win: 12, tie: 6, nr: 0, draw: 4 },
  };

  const presetTeams = (count) => WORLD_CUP_TEAMS.slice(0, count);

  // Circle method: every team plays once per round.
  function roundRobin(teams) {
    const list = teams.slice();
    if (list.length % 2) list.push(null);
    const size = list.length;
    const rounds = [];
    for (let round = 0; round < size - 1; round += 1) {
      const pairs = [];
      for (let index = 0; index < size / 2; index += 1) {
        const home = list[index];
        const away = list[size - 1 - index];
        if (home !== null && away !== null) pairs.push(round % 2 ? [away, home] : [home, away]);
      }
      rounds.push(pairs);
      list.splice(1, 0, list.pop());
    }
    return rounds;
  }

  // Seeds teams across groups in a snake order (A, B, B, A, A, B, ...).
  function snakeGroups(teams, count) {
    const groups = Array.from({ length: count }, () => []);
    teams.forEach((team, index) => {
      const row = Math.floor(index / count);
      const column = index % count;
      groups[row % 2 ? count - 1 - column : column].push(team);
    });
    return groups;
  }

  function newFixture(fields) {
    return {
      id: uid('f'), stage: 'group', group: 0, round: 0, label: '', teamA: '', teamB: '',
      scorer: '', venue: '', scheduledAt: '', matchId: '', source: null, ...fields,
    };
  }

  function buildTournament(options) {
    const teams = options.teams || [];
    const tournament = {
      id: uid('t'), createdAt: Date.now(), template: options.template,
      name: options.name, season: options.season || '', host: options.host || '', venue: options.venue || '',
      city: options.city || '', country: options.country || '', startDate: options.startDate || '', endDate: options.endDate || '',
      format: options.format, overs: options.format === 'test' ? null : options.overs,
      teams: [...teams], groups: [], fixtures: [],
    };
    if (options.template === 'custom') return tournament;

    const groupCount = options.template === 'worldcup' ? 2 : 1;
    tournament.groups = groupCount === 2 ? snakeGroups(teams, 2) : [[...teams]];
    const schedules = tournament.groups.map(roundRobin);
    const rounds = Math.max(...schedules.map((list) => list.length));
    let number = 1;
    for (let round = 0; round < rounds; round += 1) {
      tournament.groups.forEach((group, groupIndex) => {
        (schedules[groupIndex][round] || []).forEach(([teamA, teamB]) => {
          tournament.fixtures.push(newFixture({ stage: 'group', group: groupIndex, round: round + 1, label: `Match ${number}`, teamA, teamB }));
          number += 1;
        });
      });
    }

    const rank = (group, position) => ({ type: 'rank', group, rank: position });
    const semiOne = newFixture({ stage: 'semi', label: 'Semi-final 1', source: groupCount === 2 ? [rank(0, 1), rank(1, 2)] : [rank(0, 1), rank(0, 4)] });
    const semiTwo = newFixture({ stage: 'semi', label: 'Semi-final 2', source: groupCount === 2 ? [rank(1, 1), rank(0, 2)] : [rank(0, 2), rank(0, 3)] });
    const final = newFixture({
      stage: 'final', label: 'Final',
      source: [{ type: 'winner', fixture: semiOne.id }, { type: 'winner', fixture: semiTwo.id }],
    });
    tournament.fixtures.push(semiOne, semiTwo, final);
    return tournament;
  }

  function fixtureCountFor(template, teamCount) {
    if (template === 'custom') return 0;
    const pairs = (size) => (size * (size - 1)) / 2;
    if (template === 'league') return pairs(teamCount) + 3;
    const first = Math.ceil(teamCount / 2);
    return pairs(first) + pairs(teamCount - first) + 3;
  }

  function addFixture(tournament, fields) {
    const number = tournament.fixtures.length + 1;
    const fixture = newFixture({ stage: 'league', label: `Match ${number}`, ...fields });
    return { ...tournament, fixtures: [...tournament.fixtures, fixture] };
  }

  function groupsOf(tournament) {
    if (tournament.template !== 'custom') return tournament.groups;
    const names = [];
    tournament.fixtures.forEach((fixture) => [fixture.teamA, fixture.teamB].forEach((name) => {
      if (name && !names.includes(name)) names.push(name);
    }));
    return [names];
  }

  const groupName = (tournament, index) => (tournament.template === 'worldcup' ? `Group ${GROUP_LETTERS[index]}` : 'Points table');
  const isTableFixture = (fixture) => fixture.stage === 'group' || fixture.stage === 'league';
  const emptyRow = (team) => ({ team, p: 0, w: 0, l: 0, t: 0, d: 0, nr: 0, pts: 0, rf: 0, of: 0, ra: 0, oa: 0, nrr: 0, form: [] });

  function indexByFixture(records) {
    const index = new Map();
    records.forEach((record) => { if (record.fixtureId) index.set(record.fixtureId, record); });
    return index;
  }

  function addRunRate(rows, state) {
    state.innings.filter((innings) => !innings.isSuperOver).slice(0, 2).forEach((innings, position) => {
      const stats = getInningsStats(innings);
      const allOut = stats.wickets >= innings.maxWickets;
      const chaseWon = position === 1 && state.result?.winner === innings.teamIndex;
      const overs = innings.oversLimit && allOut && !chaseWon ? innings.oversLimit : stats.legalBalls / 6;
      rows[innings.teamIndex].rf += stats.runs;
      rows[innings.teamIndex].of += overs;
      rows[1 - innings.teamIndex].ra += stats.runs;
      rows[1 - innings.teamIndex].oa += overs;
    });
  }

  function applyResult(table, state) {
    const result = state.result || {};
    const points = POINTS[state.format] || POINTS.t20;
    const rows = state.teams.map((name) => {
      if (!table.rows.has(name)) table.rows.set(name, emptyRow(name));
      return table.rows.get(name);
    });
    rows.forEach((row) => { row.p += 1; });
    if (result.winner === 0 || result.winner === 1) {
      rows[result.winner].w += 1; rows[result.winner].pts += points.win; rows[result.winner].form.push('W');
      rows[1 - result.winner].l += 1; rows[1 - result.winner].form.push('L');
    } else if (result.tied) {
      rows.forEach((row) => { row.t += 1; row.pts += points.tie; row.form.push('T'); });
    } else if (result.draw || /drawn/i.test(result.text || '')) {
      rows.forEach((row) => { row.d += 1; row.pts += points.draw; row.form.push('D'); });
    } else {
      rows.forEach((row) => { row.nr += 1; row.pts += points.nr; row.form.push('N'); });
    }
    if (state.format !== 'test') addRunRate(rows, state);
  }

  // Points table(s) from completed league/group fixtures.
  function standings(tournament, records) {
    const byFixture = indexByFixture(records);
    const tables = groupsOf(tournament).map((teams, index) => ({
      index, name: groupName(tournament, index), rows: new Map(teams.map((team) => [team, emptyRow(team)])), played: 0, total: 0,
    }));
    const finished = [];
    tournament.fixtures.filter(isTableFixture).forEach((fixture) => {
      const table = tables[fixture.group] || tables[0];
      if (!table) return;
      table.total += 1;
      const record = byFixture.get(fixture.id);
      if (record?.state.status === 'complete') {
        table.played += 1;
        finished.push({ record, table });
      }
    });
    finished.sort((a, b) => a.record.updatedAt - b.record.updatedAt).forEach(({ record, table }) => applyResult(table, record.state));

    return tables.map((table) => {
      const rows = [...table.rows.values()].map((row) => ({
        ...row,
        nrr: (row.of ? row.rf / row.of : 0) - (row.oa ? row.ra / row.oa : 0),
        form: row.form.slice(-5),
      })).sort((a, b) => b.pts - a.pts || b.w - a.w || b.nrr - a.nrr || a.team.localeCompare(b.team));
      return { index: table.index, name: table.name, rows, played: table.played, total: table.total, complete: table.total > 0 && table.played === table.total };
    });
  }

  function slotText(tournament, source) {
    if (source.type === 'rank') return tournament.template === 'worldcup' ? `${groupName(tournament, source.group)} #${source.rank}` : `Rank ${source.rank} after league`;
    const target = tournament.fixtures.find((fixture) => fixture.id === source.fixture);
    return `Winner of ${target?.label || 'previous match'}`;
  }

  function resolveSlot(source, tables, views) {
    if (source.type === 'rank') {
      const table = tables[source.group];
      return table?.complete ? (table.rows[source.rank - 1]?.team || '') : '';
    }
    const state = views.get(source.fixture)?.record?.state;
    const winner = state?.result?.winner;
    return state?.status === 'complete' && (winner === 0 || winner === 1) ? state.teams[winner] : '';
  }

  // One view-model per fixture: resolved teams, linked match and status.
  function fixtureViews(tournament, records, tables = standings(tournament, records)) {
    const byFixture = indexByFixture(records);
    const byId = new Map();
    const list = tournament.fixtures.map((fixture) => {
      const record = byFixture.get(fixture.id) || null;
      let teamA = fixture.teamA;
      let teamB = fixture.teamB;
      let labelA = teamA;
      let labelB = teamB;
      if (fixture.source) {
        teamA = resolveSlot(fixture.source[0], tables, byId);
        teamB = resolveSlot(fixture.source[1], tables, byId);
        labelA = teamA || slotText(tournament, fixture.source[0]);
        labelB = teamB || slotText(tournament, fixture.source[1]);
      }
      if (record) {
        [teamA, teamB] = record.state.teams;
        [labelA, labelB] = record.state.teams;
      }
      const state = record?.state;
      const view = {
        fixture, record, teamA, teamB, labelA, labelB, ready: Boolean(teamA && teamB),
        status: !record ? 'upcoming' : state.status === 'complete' ? 'complete' : 'live',
      };
      byId.set(fixture.id, view);
      return view;
    });
    return list;
  }

  function championOf(views) {
    const final = views.find((view) => view.fixture.stage === 'final');
    const state = final?.record?.state;
    const winner = state?.result?.winner;
    return state?.status === 'complete' && (winner === 0 || winner === 1) ? state.teams[winner] : '';
  }

  function progressOf(views) {
    const done = views.filter((view) => view.status === 'complete').length;
    const live = views.filter((view) => view.status === 'live').length;
    return { done, live, total: views.length, percent: views.length ? Math.round((done / views.length) * 100) : 0 };
  }

  M.tournament = {
    WORLD_CUP_TEAMS, POINTS, presetTeams, buildTournament, fixtureCountFor, addFixture,
    groupsOf, groupName, standings, fixtureViews, championOf, progressOf,
  };
})();
