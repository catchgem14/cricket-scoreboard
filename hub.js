(() => {
  const M = (window.Maiden = window.Maiden || {});
  const E = M.engine;
  const T = M.tournament;
  const { escapeHtml: esc, relativeTime, teamScoreText, matchTitle, statusLabel, FORMAT_RULES } = E;
  const { toast, router, $, $$ } = M.app;
  const store = M.store;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const view = () => document.body.dataset.view;

  /* ---------- ambient effects ---------- */

  function bindEffects() {
    let frame = 0;
    document.addEventListener('pointermove', (event) => {
      const card = event.target.closest?.('.mn-spot');
      if (!card || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - box.left}px`);
        card.style.setProperty('--my', `${event.clientY - box.top}px`);
      });
    }, { passive: true });

    const ribbon = $('ribbon');
    const onScroll = () => ribbon.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if ('IntersectionObserver' in window && !reduceMotion) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('is-in'); observer.unobserve(entry.target); } });
      }, { threshold: 0.12 });
      $$('.mn-reveal').forEach((node) => observer.observe(node));
    } else $$('.mn-reveal').forEach((node) => node.classList.add('is-in'));
  }

  /* ---------- home ---------- */

  const DEMO_BALLS = ['1', '0', '4', '1', 'W', '2', '6', '1', '0', '4', '1', '1', '0', '4', '2', '1', '6', 'W', '1', '1', '4', '0', '6', '2', '1', '4', '1', '0', 'W', '6', '2', '1', '4', '1', '6', '1'];
  const demo = { step: 0, runs: 0, wkts: 0, points: [[0, 0]], timer: 0, target: 0 };
  const demoRuns = (symbol) => (symbol === 'W' ? 0 : Number(symbol));
  demo.target = Math.round(DEMO_BALLS.reduce((sum, symbol) => sum + demoRuns(symbol), 0) * 0.94);

  function paintDemo() {
    const balls = demo.step;
    $('demoRuns').textContent = demo.runs;
    $('demoWkts').textContent = demo.wkts;
    $('demoOvers').textContent = E.formatOvers(balls);
    $('demoRate').textContent = balls ? (demo.runs / (balls / 6)).toFixed(2) : '0.00';
    const need = Math.max(0, demo.target - demo.runs);
    $('demoNeed').textContent = need === 0 && balls ? 'WON' : `${need} off ${36 - balls}`;
    const x = (n) => 10 + (n / 36) * 300;
    const y = (r) => 100 - Math.min(1, r / (demo.target * 1.1)) * 90;
    const line = demo.points.map(([n, r], index) => `${index ? 'L' : 'M'}${x(n).toFixed(1)} ${y(r).toFixed(1)}`).join('');
    const last = demo.points[demo.points.length - 1];
    $('demoWorm').setAttribute('d', line);
    $('demoWormArea').setAttribute('d', `${line}L${x(last[0]).toFixed(1)} 100L10 100Z`);
    $('demoTargetLine').setAttribute('d', `M10 ${y(demo.target).toFixed(1)}H310`);
    const overStart = Math.floor(Math.max(balls - 1, 0) / 6) * 6;
    $('demoOver').innerHTML = DEMO_BALLS.slice(overStart, balls).map((symbol) => `<span class="mn-ball ${symbol === 'W' ? 'is-wicket' : symbol === '6' ? 'is-six' : symbol === '4' ? 'is-four' : ''}">${symbol === '0' ? '\u00b7' : symbol}</span>`).join('');
  }

  function stepDemo() {
    if (demo.step >= 36 || demo.runs >= demo.target) {
      clearTimeout(demo.timer);
      demo.timer = setTimeout(() => { Object.assign(demo, { step: 0, runs: 0, wkts: 0, points: [[0, 0]] }); paintDemo(); loopDemo(); }, 2600);
      return;
    }
    const symbol = DEMO_BALLS[demo.step];
    demo.step += 1;
    demo.runs += demoRuns(symbol);
    if (symbol === 'W') demo.wkts += 1;
    demo.points.push([demo.step, demo.runs]);
    paintDemo();
    if (symbol === '4' || symbol === '6') {
      const burst = $('demoBurst');
      burst.textContent = symbol === '6' ? 'SIX!' : 'FOUR';
      burst.className = 'mn-demo-burst';
      void burst.offsetWidth;
      burst.className = `mn-demo-burst is-on ${symbol === '6' ? 'is-six' : ''}`;
    }
    loopDemo();
  }

  function loopDemo() {
    clearTimeout(demo.timer);
    demo.timer = setTimeout(stepDemo, 780);
  }

  function runDemo() {
    clearTimeout(demo.timer);
    if (reduceMotion) {
      demo.step = 30; demo.runs = DEMO_BALLS.slice(0, 30).reduce((sum, s) => sum + demoRuns(s), 0); demo.wkts = 3;
      demo.points = [[0, 0]];
      let total = 0;
      DEMO_BALLS.slice(0, 30).forEach((symbol, index) => { total += demoRuns(symbol); demo.points.push([index + 1, total]); });
      paintDemo();
      return;
    }
    Object.assign(demo, { step: 0, runs: 0, wkts: 0, points: [[0, 0]] });
    paintDemo();
    loopDemo();
  }

  function renderResume() {
    const strip = $('resumeStrip');
    const id = store.getCurrentId();
    const record = (id && store.getMatch(id)) || store.listMatches().find((item) => item.state.status !== 'complete');
    strip.hidden = !record || record.state.status === 'complete';
    if (strip.hidden) return;
    const { state } = record;
    strip.setAttribute('href', `#/match/${record.id}`);
    $('resumeStatus').textContent = statusLabel(state).toUpperCase();
    $('resumeTitle').textContent = matchTitle(state);
    const innings = state.innings[state.currentIndex];
    $('resumeMeta').textContent = innings ? `${state.teams[innings.teamIndex]} ${teamScoreText(state, innings.teamIndex)}` : FORMAT_RULES[state.format].label;
  }

  router.register('home', {
    enter() { renderResume(); runDemo(); },
    leave() { clearTimeout(demo.timer); },
  });

  /* ---------- matches ---------- */

  let matchFilter = 'all';

  function matchCard(record) {
    const { state } = record;
    const live = state.status !== 'complete';
    const innings = state.innings[state.currentIndex];
    const tournament = record.tournamentId ? store.getTournament(record.tournamentId) : null;
    const rows = [0, 1].map((team) => `<div class="mn-mc-team ${state.result?.winner === team ? 'is-winner' : ''}"><span>${esc(state.teams[team])}</span><b>${esc(teamScoreText(state, team))}</b></div>`).join('');
    const headline = state.result?.text || (innings ? `${state.teams[innings.teamIndex]} batting` : 'Not started');
    return `<article class="mn-match-card mn-spot ${live ? 'is-live' : ''}">
      <a class="mn-mc-link" href="#/match/${record.id}" aria-label="Open ${esc(matchTitle(state))}"></a>
      <div class="mn-mc-top"><span class="mn-format-badge">${FORMAT_RULES[state.format].short}</span>${tournament ? `<span class="mn-mc-tag">${esc(tournament.name)}</span>` : ''}<span class="mn-status ${live ? 'is-live' : 'is-result'}"><i></i> ${statusLabel(state).toUpperCase()}</span></div>
      <div class="mn-mc-teams">${rows}</div>
      <p class="mn-mc-line">${esc(headline)}</p>
      <div class="mn-mc-foot"><span>${record.scorer ? `Scorer ${esc(record.scorer)}` : 'No scorer'}</span><span>${relativeTime(record.updatedAt)}</span><a class="mn-mc-stats" href="#/match/${record.id}/stats">Stats corner &rarr;</a></div>
    </article>`;
  }

  function renderMatches() {
    const all = store.listMatches();
    const list = all.filter((record) => matchFilter === 'all' || (matchFilter === 'live') === (record.state.status !== 'complete'));
    $('matchesGrid').innerHTML = list.length ? list.map(matchCard).join('')
      : `<div class="mn-empty-state"><h3>${all.length ? 'Nothing in this filter' : 'No matches yet'}</h3><p>${all.length ? 'Try another filter.' : 'Start your first match and it will appear here, ready to resume at any time.'}</p><a class="mn-button mn-button-primary" href="#/score/new">Start scoring</a></div>`;
    $$('[data-match-filter]').forEach((button) => {
      const on = button.dataset.matchFilter === matchFilter;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    const usage = store.usage();
    $('storageNote').textContent = usage.persistent ? `${all.length} saved \u00b7 ${(usage.bytes / 1024).toFixed(0)} KB on this device` : 'Private mode: matches will not survive closing this tab';
  }

  function renderLiveCount() {
    const live = store.listMatches().filter((record) => record.state.status !== 'complete').length;
    const badge = $('liveCount');
    badge.hidden = !live;
    badge.textContent = live;
  }

  router.register('matches', { enter: renderMatches });

  /* ---------- tournaments ---------- */

  let detailId = '';
  let detailTab = 'fixtures';

  function recordsOf(id) { return store.listMatches().filter((record) => record.tournamentId === id); }

  function tournamentCard(tournament) {
    const views = T.fixtureViews(tournament, recordsOf(tournament.id));
    const progress = T.progressOf(views);
    const champion = T.championOf(views);
    const label = tournament.template === 'worldcup' ? 'World Cup' : tournament.template === 'league' ? 'League' : 'Custom';
    return `<a class="mn-tournament-card mn-spot" href="#/tournaments/${tournament.id}">
      <div class="mn-tc-top"><span class="mn-format-badge">${FORMAT_RULES[tournament.format].short}</span><span class="mn-mc-tag">${label}</span>${progress.live ? `<span class="mn-live"><i></i> ${progress.live} LIVE</span>` : ''}</div>
      <h3>${esc(tournament.name)}</h3>
      <p>${tournament.season ? `${esc(tournament.season)} \u00b7 ` : ''}${tournament.teams.length || T.groupsOf(tournament)[0].length} teams \u00b7 ${progress.total} fixtures</p>
      ${champion ? `<p class="mn-champion-line">Champions: <b>${esc(champion)}</b></p>` : ''}
      <div class="mn-progress"><i style="--w:${progress.percent}%"></i></div>
      <small>${progress.done} of ${progress.total} complete</small>
    </a>`;
  }

  function renderTournamentList() {
    const list = store.listTournaments();
    $('tournamentList').innerHTML = list.length ? list.map(tournamentCard).join('')
      : `<div class="mn-empty-state"><h3>No tournaments yet</h3><p>Create a World Cup, a league or your own fixture list. Maiden builds the groups, fixtures, table and knockouts for you.</p><div class="mn-empty-actions"><button class="mn-button mn-button-gold" type="button" data-new-template="worldcup">Build a World Cup</button><button class="mn-button mn-button-muted" type="button" data-new-template="league">Create a league</button></div></div>`;
  }

  const statusChip = (status) => `<span class="mn-chip is-${status}">${status === 'live' ? 'LIVE' : status === 'complete' ? 'FINAL' : 'UPCOMING'}</span>`;

  function fixtureCard(tournament, item) {
    const { fixture, record } = item;
    const state = record?.state;
    const sides = [0, 1].map((team) => {
      const name = team ? item.labelB : item.labelA;
      const won = state?.result?.winner === team;
      return `<div class="mn-fx-team ${won ? 'is-winner' : ''} ${(team ? item.teamB : item.teamA) ? '' : 'is-tbd'}"><span>${esc(name || 'To be decided')}</span>${state ? `<b>${esc(teamScoreText(state, team))}</b>` : ''}</div>`;
    }).join('');
    const action = record ? `<a class="mn-button mn-button-small ${item.status === 'live' ? 'mn-button-primary' : 'mn-button-muted'}" href="#/match/${record.id}">${item.status === 'live' ? 'Resume' : 'Scorecard'}</a><a class="mn-text-link" href="#/match/${record.id}/stats">Stats</a>`
      : item.ready ? `<a class="mn-button mn-button-small mn-button-primary" href="#/score/new/${tournament.id}/${fixture.id}">Start scoring</a>`
        : '<span class="mn-hint">Awaiting results</span>';
    return `<article class="mn-fixture mn-spot is-${item.status}">
      <div class="mn-fx-head"><strong>${esc(fixture.label)}</strong>${statusChip(item.status)}</div>
      <div class="mn-fx-teams">${sides}</div>
      ${state?.result ? `<p class="mn-fx-result">${esc(state.result.text)}</p>` : ''}
      <label class="mn-fx-scorer"><span>Scorer</span><input type="text" maxlength="40" value="${esc(record?.scorer || fixture.scorer)}" placeholder="Assign a scorer" data-fixture-scorer="${fixture.id}" ${state?.status === 'complete' ? 'disabled' : ''} /></label>
      <div class="mn-fx-actions">${action}</div>
    </article>`;
  }

  function fixturesTab(tournament, views) {
    const stageName = { group: 'Group stage', league: 'League matches', semi: 'Semi-finals', final: 'Final' };
    const order = ['group', 'league', 'semi', 'final'];
    const sections = order.map((stage) => {
      const items = views.filter((item) => item.fixture.stage === stage);
      if (!items.length) return '';
      return `<section class="mn-fx-section"><h3>${stageName[stage]}</h3><div class="mn-fixture-grid">${items.map((item) => fixtureCard(tournament, item)).join('')}</div></section>`;
    }).join('');
    const add = tournament.template === 'custom' ? '<button id="addFixtureBtn" class="mn-button mn-button-primary" type="button">Add fixture</button>' : '';
    return `<div class="mn-tab-actions">${add}</div>${sections || '<div class="mn-empty-state"><h3>No fixtures yet</h3><p>Add your first fixture to get going.</p></div>'}`;
  }

  function tableTab(tournament, records) {
    const tables = T.standings(tournament, records);
    return tables.map((table) => `<section class="mn-table-card"><header><h3>${esc(table.name)}</h3><span>${table.played} of ${table.total} played</span></header>
      <div class="mn-table-wrap"><table class="mn-table mn-standings"><thead><tr><th>#</th><th>TEAM</th><th>P</th><th>W</th><th>L</th><th>${tournament.format === 'test' ? 'D' : 'T/NR'}</th><th>NRR</th><th>PTS</th><th>FORM</th></tr></thead><tbody>
      ${table.rows.map((row, index) => `<tr class="${index < (tournament.template === 'worldcup' ? 2 : 4) ? 'is-qualifying' : ''}"><td>${index + 1}</td><td><strong>${esc(row.team)}</strong></td><td>${row.p}</td><td>${row.w}</td><td>${row.l}</td><td>${tournament.format === 'test' ? row.d : row.t + row.nr}</td><td>${tournament.format === 'test' ? '\u2014' : (row.nrr >= 0 ? '+' : '') + row.nrr.toFixed(3)}</td><td><b>${row.pts}</b></td><td><span class="mn-form">${row.form.map((f) => `<i class="is-${f}">${f}</i>`).join('')}</span></td></tr>`).join('')}
      </tbody></table></div></section>`).join('') || '<div class="mn-empty-state"><h3>No table yet</h3><p>Add fixtures to see standings.</p></div>';
  }

  function bracketTab(tournament, views) {
    const ko = views.filter((item) => item.fixture.stage === 'semi' || item.fixture.stage === 'final');
    if (!ko.length) return '<div class="mn-empty-state"><h3>No knockout stage</h3><p>This tournament has no semi-finals or final.</p></div>';
    const node = (item) => `<div class="mn-bk-node mn-spot is-${item.status}"><small>${esc(item.fixture.label)}</small>${[0, 1].map((team) => {
      const name = team ? item.labelB : item.labelA;
      const state = item.record?.state;
      return `<div class="mn-bk-team ${state?.result?.winner === team ? 'is-winner' : ''} ${(team ? item.teamB : item.teamA) ? '' : 'is-tbd'}"><span>${esc(name)}</span>${state ? `<b>${esc(teamScoreText(state, team).split(' ')[0])}</b>` : ''}</div>`;
    }).join('')}${item.record ? `<a href="#/match/${item.record.id}">Open</a>` : item.ready ? `<a href="#/score/new/${tournament.id}/${item.fixture.id}">Start</a>` : ''}</div>`;
    const champion = T.championOf(views);
    return `<div class="mn-bracket"><div class="mn-bk-col"><h4>Semi-finals</h4>${ko.filter((item) => item.fixture.stage === 'semi').map(node).join('')}</div>
      <div class="mn-bk-col"><h4>Final</h4>${ko.filter((item) => item.fixture.stage === 'final').map(node).join('')}</div>
      <div class="mn-bk-col mn-bk-champ ${champion ? 'is-set' : ''}"><h4>Champions</h4><div class="mn-trophy-mini" aria-hidden="true">&#127942;</div><strong>${champion ? esc(champion) : 'To be decided'}</strong></div></div>`;
  }

  function renderDetail() {
    const tournament = store.getTournament(detailId);
    if (!tournament) { toast('Tournament not found.'); return router.go('#/tournaments'); }
    const records = recordsOf(tournament.id);
    const tables = T.standings(tournament, records);
    const views = T.fixtureViews(tournament, records, tables);
    const progress = T.progressOf(views);
    const champion = T.championOf(views);
    const hasKnockout = views.some((item) => item.fixture.stage === 'semi');
    const tabs = [['fixtures', 'Fixtures'], ['table', 'Points table'], ...(hasKnockout ? [['bracket', 'Knockouts']] : []), ['stats', 'Stats corner']];
    if (!tabs.some(([key]) => key === detailTab)) detailTab = 'fixtures';
    const meta = [FORMAT_RULES[tournament.format].label, tournament.overs ? `${tournament.overs} overs` : '', tournament.season, tournament.host, [tournament.venue, tournament.city, tournament.country].filter(Boolean).join(', '),
      tournament.startDate ? `${tournament.startDate}${tournament.endDate ? ` to ${tournament.endDate}` : ''}` : ''].filter(Boolean).map(esc).join(' \u00b7 ');
    const body = detailTab === 'table' ? tableTab(tournament, records)
      : detailTab === 'bracket' ? bracketTab(tournament, views)
        : detailTab === 'stats' ? M.stats.tournamentStatsHtml(tournament, records, progress) : fixturesTab(tournament, views);
    $('tournamentDetail').innerHTML = `
      <div class="mn-page-heading"><div><a class="mn-crumb" href="#/tournaments">&larr; Tournaments</a><p class="mn-kicker">${tournament.template === 'worldcup' ? 'WORLD CUP MODE' : 'TOURNAMENT'}</p><h1>${esc(tournament.name)}</h1><p class="mn-subtitle">${meta}</p></div>
        <div class="mn-heading-actions"><button class="mn-button mn-button-muted" type="button" id="deleteTournamentBtn">Delete</button></div></div>
      ${champion ? `<div class="mn-champion-banner"><span aria-hidden="true">&#127942;</span><div><small>CHAMPIONS</small><strong>${esc(champion)}</strong></div></div>` : ''}
      <div class="mn-progress-row"><div class="mn-progress"><i style="--w:${progress.percent}%"></i></div><span>${progress.done} of ${progress.total} fixtures complete${progress.live ? ` \u00b7 ${progress.live} live` : ''}</span></div>
      <div class="mn-tabs" role="tablist" aria-label="Tournament views">${tabs.map(([key, label]) => `<button class="mn-tab ${key === detailTab ? 'is-active' : ''}" role="tab" aria-selected="${key === detailTab}" type="button" data-tour-tab="${key}">${label}</button>`).join('')}</div>
      <div class="mn-tab-body">${body}</div>`;
  }

  /* ---------- tournament dialogs ---------- */

  function templateValue() { return document.querySelector('input[name="template"]:checked').value; }

  function syncTournamentForm() {
    const template = templateValue();
    const format = $('tbFormat').value;
    $('tbTeamsBlock').hidden = template === 'custom';
    $('tbOversField').hidden = format === 'test';
    const teams = $('tbTeams').value.split('\n').map((line) => line.trim()).filter(Boolean);
    $('tbSummary').textContent = template === 'custom' ? 'You will add fixtures yourself after creating it.' : `${teams.length} teams \u00b7 ${T.fixtureCountFor(template, teams.length)} fixtures${template === 'worldcup' ? ' including semi-finals and final' : ''}`;
  }

  function openTournamentDialog(template = 'worldcup') {
    const form = $('tournamentForm');
    form.reset();
    document.querySelector(`input[name="template"][value="${template}"]`).checked = true;
    $('tbName').value = template === 'worldcup' ? 'Maiden World Cup' : '';
    $('tbSeason').value = String(new Date().getFullYear());
    $('tbFormat').value = template === 'worldcup' ? 'odi' : 't20';
    $('tbOvers').value = $('tbFormat').value === 'odi' ? '50' : '20';
    $('tbTeamCount').value = template === 'worldcup' ? '8' : '6';
    $('tbTeams').value = T.presetTeams(Number($('tbTeamCount').value)).join('\n');
    $('tbMessage').textContent = '';
    syncTournamentForm();
    $('tournamentDialog').showModal();
  }

  function bindTournamentForm() {
    $('newTournamentBtn').addEventListener('click', () => openTournamentDialog('worldcup'));
    $$('input[name="template"]').forEach((input) => input.addEventListener('change', () => {
      if (templateValue() === 'worldcup' && !$('tbName').value.trim()) $('tbName').value = 'Maiden World Cup';
      syncTournamentForm();
    }));
    $('tbFormat').addEventListener('change', () => {
      const format = $('tbFormat').value;
      if (format !== 'test') $('tbOvers').value = format === 'odi' ? '50' : '20';
      $('tbOvers').max = format === 'odi' ? '50' : '20';
      syncTournamentForm();
    });
    $('tbTeamCount').addEventListener('change', () => { $('tbTeams').value = T.presetTeams(Number($('tbTeamCount').value)).join('\n'); syncTournamentForm(); });
    $('tbTeams').addEventListener('input', syncTournamentForm);
    $('tournamentForm').addEventListener('submit', (event) => {
      const template = templateValue();
      const teams = [...new Set($('tbTeams').value.split('\n').map((line) => line.trim()).filter(Boolean))];
      const fail = (text) => { event.preventDefault(); $('tbMessage').textContent = text; };
      const name = $('tbName').value.trim();
      if (!name) return fail('Give the tournament a name.');
      if (template === 'worldcup' && teams.length < 4) return fail('A World Cup needs at least 4 teams.');
      if (template === 'league' && teams.length < 4) return fail('A league needs at least 4 teams for semi-finals.');
      if (teams.length > 20) return fail('Use 20 teams or fewer.');
      const format = $('tbFormat').value;
      const max = FORMAT_RULES[format].defaultOvers;
      const tournament = T.buildTournament({
        template, name, season: $('tbSeason').value.trim(), format, overs: max ? Math.min(max, Math.max(1, Number($('tbOvers').value) || max)) : null,
        teams: template === 'custom' ? [] : teams, host: $('tbHost').value.trim(), venue: $('tbVenue').value.trim(), city: $('tbCity').value.trim(),
        country: $('tbCountry').value.trim(), startDate: $('tbStart').value, endDate: $('tbEnd').value,
      });
      store.saveTournament(tournament);
      toast(`${name} created`);
      detailTab = 'fixtures';
      router.go(`#/tournaments/${tournament.id}`);
    });

    $('fixtureForm').addEventListener('submit', (event) => {
      const tournament = store.getTournament(detailId);
      const a = $('fxTeamA').value.trim(); const b = $('fxTeamB').value.trim();
      if (!tournament || !a || !b || a.toLowerCase() === b.toLowerCase()) { event.preventDefault(); $('fxMessage').textContent = 'Enter two different teams.'; return; }
      const next = T.addFixture(tournament, { teamA: a, teamB: b, scorer: $('fxScorer').value.trim(), venue: $('fxVenue').value.trim(), scheduledAt: $('fxTime').value });
      store.saveTournament(next);
    });
  }

  function bindDetail() {
    const root = $('tournamentDetail');
    root.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-tour-tab]');
      if (tab) { detailTab = tab.dataset.tourTab; router.go(`#/tournaments/${detailId}/${detailTab}`); return; }
      if (event.target.closest('#addFixtureBtn')) {
        $('fixtureForm').reset(); $('fxMessage').textContent = '';
        $('fxScorer').value = store.getProfile().scorerName;
        $('fixtureDialog').showModal();
      }
      if (event.target.closest('#deleteTournamentBtn')) {
        if (!window.confirm('Delete this tournament? Its matches stay on this device as standalone matches.')) return;
        store.deleteTournament(detailId);
        toast('Tournament deleted');
        router.go('#/tournaments');
      }
    });
    root.addEventListener('change', (event) => {
      const input = event.target.closest('[data-fixture-scorer]');
      if (!input) return;
      const tournament = store.getTournament(detailId);
      const fixture = tournament?.fixtures.find((item) => item.id === input.dataset.fixtureScorer);
      if (!fixture) return;
      fixture.scorer = input.value.trim();
      store.saveTournament(tournament);
      const record = store.listMatches().find((item) => item.fixtureId === fixture.id);
      if (record) store.saveMatch({ ...record, scorer: fixture.scorer });
      toast(fixture.scorer ? `${fixture.scorer} assigned to ${fixture.label}` : 'Scorer cleared');
    });
    $('tournamentList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-new-template]');
      if (button) openTournamentDialog(button.dataset.newTemplate);
    });
  }

  router.register('tournaments', {
    enter(params) {
      if (params[0] === 'new') {
        history.replaceState(null, '', '#/tournaments');
        $('tournamentsHome').hidden = false; $('tournamentDetail').hidden = true;
        renderTournamentList();
        return openTournamentDialog(params[1] === 'league' || params[1] === 'custom' ? params[1] : 'worldcup');
      }
      if (params[0]) {
        if (detailId !== params[0]) detailTab = 'fixtures';
        detailId = params[0];
        if (params[1]) detailTab = params[1];
        $('tournamentsHome').hidden = true; $('tournamentDetail').hidden = false;
        return renderDetail();
      }
      detailId = '';
      $('tournamentsHome').hidden = false; $('tournamentDetail').hidden = true;
      renderTournamentList();
    },
  });

  /* ---------- live refresh ---------- */

  let refreshTimer = 0;
  store.subscribe(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      renderLiveCount();
      const current = view();
      if (current === 'matches') renderMatches();
      else if (current === 'home') renderResume();
      else if (current === 'tournaments' && !$('tournamentDialog').open && !$('fixtureDialog').open && !(document.activeElement && document.activeElement.matches?.('[data-fixture-scorer]'))) {
        if (detailId) renderDetail(); else renderTournamentList();
      }
    }, 60);
  });

  $$('[data-match-filter]').forEach((button) => button.addEventListener('click', () => { matchFilter = button.dataset.matchFilter; renderMatches(); }));
  bindEffects();
  bindTournamentForm();
  bindDetail();
  renderLiveCount();
  router.start();
})();
