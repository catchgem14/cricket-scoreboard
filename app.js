(() => {
  const M = (window.Maiden = window.Maiden || {});
  const E = M.engine;
  const { FORMAT_RULES, NO_BALL_WICKETS, WICKET_LABELS, escapeHtml: esc, formatOvers, clampRuns, uid, initials, getInningsStats, teamRuns, targetFor } = E;
  const store = M.store;
  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /* ---------- toast + router ---------- */

  let toastTimer;
  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2800);
  }

  const handlers = {};
  let activeView = '';
  const router = {
    register(name, handler) { handlers[name] = handler; },
    go(hash) { if (location.hash === hash) router.run(); else location.hash = hash; },
    run() {
      const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
      const first = parts[0] || 'home';
      const view = first === 'match' ? 'score' : (handlers[first] ? first : 'home');
      const params = first === 'match' ? ['match', ...parts.slice(1)] : parts.slice(1);
      if (activeView && activeView !== view) handlers[activeView]?.leave?.();
      const changed = activeView !== view;
      activeView = view;
      document.body.dataset.view = view;
      $$('.mn-view').forEach((section) => { section.hidden = section.dataset.view !== view; });
      $$('[data-nav]').forEach((link) => {
        const on = link.dataset.nav === view;
        link.classList.toggle('is-active', on);
        if (on) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      });
      handlers[view]?.enter?.(params);
      if (changed) window.scrollTo({ top: 0 });
      const titles = { home: 'Cricket scoring for every format', score: 'Score', matches: 'Matches', tournaments: 'Tournaments' };
      document.title = `${titles[view] || ''} | Maiden by SportsCo`.replace(/^ \| /, '');
    },
    start() {
      window.addEventListener('hashchange', router.run);
      router.run();
    },
  };

  /* ---------- scorer profile ---------- */

  function renderProfile() {
    const name = store.getProfile().scorerName;
    $('scorerName').textContent = name || 'Add your name';
    $('scorerAvatar').textContent = name ? initials(name) : '?';
    $('scorerChip').classList.toggle('is-empty', !name);
  }

  function bindProfile() {
    const dialog = $('scorerDialog');
    $('scorerChip').addEventListener('click', () => {
      $('scorerDialogInput').value = store.getProfile().scorerName;
      dialog.showModal();
      $('scorerDialogInput').focus();
    });
    $('scorerForm').addEventListener('submit', () => {
      const name = $('scorerDialogInput').value.trim();
      store.saveProfile({ scorerName: name });
      if (name) toast(`Scoring as ${name}`);
    });
    $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog')?.close()));
    $$('dialog').forEach((dialog_) => dialog_.addEventListener('click', (event) => { if (event.target === dialog_) dialog_.close(); }));
  }

  /* ---------- match state ---------- */

  function freshState() {
    return {
      started: false, status: 'setup', format: 't20', overs: 20, teams: ['Team A', 'Team B'], battingFirst: 0,
      inningsOrder: [], innings: [], currentIndex: -1, result: null, followOn: false, superOverRound: 0, superOverStart: -1,
    };
  }

  function makeInnings(teamIndex, number, oversLimit, striker, nonStriker, bowler, options = {}) {
    return {
      teamIndex, number, oversLimit, isSuperOver: Boolean(options.isSuperOver), superOverRound: options.superOverRound || 0,
      maxWickets: options.isSuperOver ? 2 : 10, completed: false, deliveries: [], playerNames: { striker, nonStriker },
      striker: 'striker', nonStriker: 'nonStriker', currentBowler: bowler, lastOverBowler: '', freeHitPending: false,
    };
  }

  // Working copy of the match being viewed; commit() writes it back to the store.
  const cur = { id: '', record: null, state: freshState(), tab: 'live', statsIndex: -1 };
  let message = '';

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const activeInnings = () => (cur.state.currentIndex >= 0 ? cur.state.innings[cur.state.currentIndex] : null);
  const oversLimitFor = (innings) => (innings.isSuperOver ? 1 : innings.oversLimit);
  const maxBowlerOvers = (innings) => (innings.isSuperOver ? 1 : cur.state.format === 'test' ? null : Math.ceil(innings.oversLimit / 5));

  function commit() {
    cur.record = store.saveMatch({ ...cur.record, id: cur.id, state: cur.state });
    store.setCurrentId(cur.id);
  }

  function setChaseResult(innings, score) {
    const left = innings.maxWickets - getInningsStats(innings).wickets;
    cur.state.result = { winner: innings.teamIndex, tied: false, margin: score, text: `${cur.state.teams[innings.teamIndex]} won by ${left} wicket${left === 1 ? '' : 's'}.` };
    cur.state.status = 'complete';
    innings.completed = true;
  }

  function limitedResult() {
    const pair = cur.state.innings.filter((item) => !item.isSuperOver).slice(-2);
    if (pair.length < 2) return;
    const scores = pair.map((item) => getInningsStats(item).runs);
    if (scores[0] === scores[1]) cur.state.result = { winner: null, tied: true, text: 'The match is tied.' };
    else {
      const winner = scores[0] > scores[1] ? pair[0].teamIndex : pair[1].teamIndex;
      const margin = Math.abs(scores[0] - scores[1]);
      cur.state.result = { winner, tied: false, text: `${cur.state.teams[winner]} won by ${margin} run${margin === 1 ? '' : 's'}.` };
    }
    cur.state.status = 'complete';
  }

  function superOverResult() {
    const first = cur.state.innings[cur.state.superOverStart];
    const second = cur.state.innings[cur.state.superOverStart + 1];
    if (!first || !second) return;
    const a = getInningsStats(first).runs;
    const b = getInningsStats(second).runs;
    if (a === b) cur.state.result = { winner: null, tied: true, text: `Super over ${cur.state.superOverRound} is tied.` };
    else {
      const winner = a > b ? first.teamIndex : second.teamIndex;
      cur.state.result = { winner, tied: false, text: `${cur.state.teams[winner]} won super over ${cur.state.superOverRound}.` };
    }
    cur.state.status = 'complete';
  }

  function closeInnings() {
    const innings = activeInnings();
    if (!innings || innings.completed) return;
    const { state } = cur;
    innings.completed = true;
    state.status = 'innings-break';
    if (innings.isSuperOver && state.currentIndex === state.superOverStart + 1) superOverResult();
    else if (state.format !== 'test' && !innings.isSuperOver && state.currentIndex === 1) limitedResult();
    else if (state.format === 'test' && state.currentIndex === 3) {
      const totals = [teamRuns(state, 0), teamRuns(state, 1)];
      if (totals[0] === totals[1]) state.result = { winner: null, tied: true, text: 'The Test match is tied.' };
      else {
        const winner = totals[0] > totals[1] ? 0 : 1;
        const margin = Math.abs(totals[0] - totals[1]);
        state.result = { winner, tied: false, text: `${state.teams[winner]} won by ${margin} run${margin === 1 ? '' : 's'}.` };
      }
      state.status = 'complete';
    }
  }

  // Returns an error message when the delivery is not allowed, otherwise ''.
  function makeDelivery(input) {
    const { state } = cur;
    const innings = activeInnings();
    if (!innings || state.status !== 'playing' || innings.completed) return '';
    const before = getInningsStats(innings);
    const noBall = Boolean(input.noBall);
    const wide = Boolean(input.wide && !noBall);
    const batRuns = clampRuns(input.batRuns, 6);
    const wideRuns = wide ? clampRuns(input.wideRuns, 6) : 0;
    const byes = clampRuns(input.byes, 6);
    const legByes = clampRuns(input.legByes, 6);
    const penaltyRuns = clampRuns(input.penaltyRuns, 10);
    const wicket = input.wicket || '';
    const wasFreeHit = innings.freeHitPending;
    const bowler = ($('activeBowler').value || innings.currentBowler).trim();
    const legal = !noBall && !wide;
    const overIndex = Math.floor(before.legalBalls / 6);

    if (!bowler) return 'Enter the bowler for this over.';
    if (wide && (batRuns || byes || legByes)) return 'Record running wide runs with the wide-run field only.';
    if (byes && legByes) return 'Choose byes or leg-byes for one delivery, not both.';
    if ((byes || legByes) && batRuns) return 'A delivery cannot score both bat runs and byes.';
    if (wicket && before.wickets >= innings.maxWickets) return 'The innings has no wickets remaining.';
    if (wicket && (noBall || wasFreeHit) && !NO_BALL_WICKETS.has(wicket)) return 'On a no-ball or free hit, only run out, hit the ball twice or obstructing the field can be recorded.';
    const thisOver = innings.deliveries.filter((delivery) => delivery.overIndex === overIndex);
    if (thisOver.length && thisOver[0].bowler !== bowler) return 'One bowler must complete the over.';
    if (!thisOver.length && innings.lastOverBowler && innings.lastOverBowler === bowler) return 'The same bowler cannot bowl consecutive overs.';
    const quota = maxBowlerOvers(innings);
    const bowled = before.bowledOvers[bowler] || new Set();
    if (quota !== null && !bowled.has(overIndex) && bowled.size >= quota) return `${bowler} has reached the ${quota}-over limit.`;

    const strikerId = innings.striker;
    const nonStrikerId = innings.nonStriker;
    const dismissedId = wicket ? (input.dismissed === 'nonStriker' ? nonStrikerId : strikerId) : '';
    const wicketNumber = before.wickets + 1;
    const incomingId = wicket && wicketNumber < innings.maxWickets ? `batter-${innings.deliveries.length + 3}` : '';
    const incomingName = input.incomingName?.trim() || `Batter ${wicketNumber + 2}`;

    innings.deliveries.push({
      batRuns, noBall, wide, wideRuns, byes, legByes, penaltyRuns, wicket, dismissedId, strikerId, nonStrikerId, bowler,
      overIndex, ballInOver: (before.legalBalls % 6) + 1, wasFreeHit, incomingId, incomingName, at: Date.now(),
    });
    innings.currentBowler = bowler;
    if (incomingId) innings.playerNames[incomingId] = incomingName;
    if ((batRuns + byes + legByes + wideRuns) % 2 === 1) [innings.striker, innings.nonStriker] = [innings.nonStriker, innings.striker];
    const after = getInningsStats(innings);
    if (legal && after.legalBalls > 0 && after.legalBalls % 6 === 0) {
      [innings.striker, innings.nonStriker] = [innings.nonStriker, innings.striker];
      innings.lastOverBowler = bowler;
      innings.currentBowler = '';
    }
    if (wicket && incomingId) {
      if (innings.striker === dismissedId) innings.striker = incomingId;
      else if (innings.nonStriker === dismissedId) innings.nonStriker = incomingId;
    }
    if (noBall) innings.freeHitPending = true;
    else if (legal) innings.freeHitPending = false;

    const target = targetFor(state, state.currentIndex);
    const total = getInningsStats(innings).runs;
    if (target && total >= target) setChaseResult(innings, total);
    else {
      const updated = getInningsStats(innings);
      const limit = oversLimitFor(innings);
      if (updated.wickets >= innings.maxWickets || (limit !== null && updated.legalBalls >= limit * 6)) closeInnings();
    }
    commit();
    return '';
  }

  function startNextInnings(useFollowOn) {
    const { state } = cur;
    const nextIndex = state.innings.length;
    const previous = activeInnings();
    if (!previous?.completed) return;
    if (previous.isSuperOver && nextIndex === state.superOverStart + 1) {
      state.innings.push(makeInnings(1 - previous.teamIndex, 1, 1, 'Batter 1', 'Batter 2', 'Bowler 1', { isSuperOver: true, superOverRound: state.superOverRound }));
    } else if (previous.isSuperOver) {
      return startSuperOver();
    } else {
      if (state.format === 'test' && nextIndex === 2 && useFollowOn) {
        state.inningsOrder = [state.inningsOrder[0], state.inningsOrder[1], state.inningsOrder[1], state.inningsOrder[0]];
        state.followOn = true;
      }
      const teamIndex = state.inningsOrder[nextIndex];
      if (teamIndex === undefined) return;
      const number = state.innings.filter((item) => item.teamIndex === teamIndex && !item.isSuperOver).length + 1;
      const name = state.teams[teamIndex];
      state.innings.push(makeInnings(teamIndex, number, state.format === 'test' ? null : state.overs, `${name} batter ${number * 2 - 1}`, `${name} batter ${number * 2}`, `${state.teams[1 - teamIndex]} bowler 1`));
    }
    state.currentIndex = nextIndex;
    state.status = 'playing';
    state.result = null;
    commit();
    render();
  }

  function startSuperOver() {
    const { state } = cur;
    if (!state.innings.length) return;
    state.superOverRound += 1;
    state.superOverStart = state.innings.length;
    const first = state.superOverRound % 2 ? state.battingFirst : 1 - state.battingFirst;
    state.innings.push(makeInnings(first, 1, 1, 'Batter 1', 'Batter 2', 'Bowler 1', { isSuperOver: true, superOverRound: state.superOverRound }));
    state.currentIndex = state.innings.length - 1;
    state.status = 'playing';
    state.result = null;
    commit();
    render();
  }

  function undoDelivery() {
    const innings = activeInnings();
    if (!innings?.deliveries.length) return setMessage('There is no delivery to undo.');
    const removed = innings.deliveries.pop();
    innings.playerNames = { striker: innings.playerNames.striker, nonStriker: innings.playerNames.nonStriker };
    innings.deliveries.forEach((delivery) => { if (delivery.incomingId) innings.playerNames[delivery.incomingId] = delivery.incomingName; });
    innings.striker = removed.strikerId;
    innings.nonStriker = removed.nonStrikerId;
    innings.currentBowler = removed.bowler;
    innings.completed = false;
    cur.state.status = 'playing';
    cur.state.result = null;
    let freeHit = false;
    innings.deliveries.forEach((delivery) => { if (delivery.noBall) freeHit = true; else if (!delivery.wide) freeHit = false; });
    innings.freeHitPending = freeHit;
    const stats = getInningsStats(innings);
    const last = innings.deliveries[innings.deliveries.length - 1];
    const lastOver = last && stats.legalBalls > 0 && stats.legalBalls % 6 === 0 ? last.bowler : '';
    innings.lastOverBowler = lastOver || (removed.overIndex > 0 ? (innings.deliveries.filter((delivery) => delivery.overIndex < removed.overIndex).pop()?.bowler || '') : '');
    commit();
    setMessage('');
    render();
  }

  /* ---------- scoring view ---------- */

  function setMessage(text) {
    message = text;
    const node = $('actionMessage');
    node.textContent = text;
    node.classList.toggle('is-error', Boolean(text));
  }

  function deliveryLabel(delivery) {
    const parts = [];
    if (delivery.noBall) parts.push('NB');
    else if (delivery.wide) parts.push('WD');
    if (delivery.batRuns) parts.push(String(delivery.batRuns));
    if (delivery.wideRuns) parts.push(`+${delivery.wideRuns}`);
    if (delivery.byes) parts.push(`B${delivery.byes}`);
    if (delivery.legByes) parts.push(`LB${delivery.legByes}`);
    if (delivery.penaltyRuns) parts.push(`P${delivery.penaltyRuns}`);
    if (delivery.wicket) parts.push('W');
    return parts.join(' ') || '\u00b7';
  }

  function phaseText(stats) {
    const { format } = cur.state;
    if (format === 'test') return `${formatOvers(stats.legalBalls)} overs bowled`;
    const overs = stats.legalBalls / 6;
    const rules = FORMAT_RULES[format];
    const ratio = cur.state.overs / rules.defaultOvers;
    const powerplay = Math.max(1, Math.round(rules.powerplayOvers * ratio));
    const death = Math.max(1, Math.round(rules.deathOvers * ratio));
    if (overs < powerplay) return 'Powerplay';
    return overs >= cur.state.overs - death ? 'Death overs' : 'Middle overs';
  }

  function renderBatting(innings, stats) {
    const rows = Object.values(stats.batters);
    const live = new Set([innings.striker, innings.nonStriker]);
    const present = new Set(rows.map((row) => row.id));
    [innings.striker, innings.nonStriker].forEach((id) => { if (!present.has(id)) rows.push({ id, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: '' }); });
    rows.sort((a, b) => Number(live.has(b.id)) - Number(live.has(a.id)));
    $('battingRows').innerHTML = rows.map((row) => {
      const strike = row.id === innings.striker;
      const status = row.out ? esc(row.dismissal) : live.has(row.id) ? 'not out' : 'did not bat';
      return `<tr class="${strike ? 'is-striker' : ''}"><td><strong>${esc(innings.playerNames[row.id] || 'Batter')}${strike ? ' *' : ''}</strong><small>${status}</small></td><td>${row.runs}</td><td>${row.balls}</td><td>${row.fours}</td><td>${row.sixes}</td><td>${row.balls ? ((row.runs / row.balls) * 100).toFixed(1) : '0.0'}</td></tr>`;
    }).join('');
    $('fallOfWickets').textContent = stats.falls.length ? stats.falls.map((fall) => `${fall.wickets}-${fall.runs} (${fall.player}, ${fall.over})`).join(' \u00b7 ') : '\u2014';
  }

  function renderBowling(innings, stats) {
    const list = Object.values(stats.bowlers);
    if (innings.currentBowler && !stats.bowlers[innings.currentBowler]) list.push({ name: innings.currentBowler, runs: 0, legalBalls: 0, maidens: 0, wickets: 0 });
    $('bowlingRows').innerHTML = list.map((bowler) => `<tr><td><strong>${esc(bowler.name)}</strong></td><td>${formatOvers(bowler.legalBalls)}</td><td>${bowler.maidens || 0}</td><td>${bowler.runs}</td><td>${bowler.wickets}</td><td>${bowler.legalBalls ? (bowler.runs / (bowler.legalBalls / 6)).toFixed(2) : '0.00'}</td></tr>`).join('')
      || '<tr><td colspan="6" class="mn-empty-cell">No bowler recorded yet.</td></tr>';
    const quota = maxBowlerOvers(innings);
    $('bowlerQuota').textContent = quota === null ? 'No innings quota' : `Limit ${quota} overs`;
    $('quotaFact').textContent = quota === null ? 'No limit' : `${quota} overs`;
    $('bowlerOptions').innerHTML = [...new Set(innings.deliveries.map((delivery) => delivery.bowler))].map((name) => `<option value="${esc(name)}"></option>`).join('');
  }

  function renderCommentary(innings) {
    const list = innings.deliveries.slice(-30).reverse();
    $('deliveryCount').textContent = `${innings.deliveries.length} deliver${innings.deliveries.length === 1 ? 'y' : 'ies'}`;
    $('commentaryList').innerHTML = list.length ? list.map((delivery) => {
      const note = delivery.wicket ? `${WICKET_LABELS[delivery.wicket]} \u00b7 ${innings.playerNames[delivery.dismissedId] || 'Batter'}`
        : delivery.noBall ? 'No-ball \u00b7 next legal delivery is a free hit'
          : delivery.wide ? 'Wide \u00b7 not a legal ball'
            : delivery.byes ? 'Byes' : delivery.legByes ? 'Leg-byes' : `${innings.playerNames[delivery.strikerId] || 'Batter'} off the bat`;
      return `<li><span class="mn-commentary-over">${delivery.overIndex}.${delivery.ballInOver}</span><span class="mn-event-pill">${esc(deliveryLabel(delivery))}</span><span class="mn-commentary-copy">${esc(note)}</span><span class="mn-commentary-bowler">${esc(delivery.bowler)}</span></li>`;
    }).join('') : '<li class="mn-empty-cell">Ball-by-ball entries will appear here.</li>';
  }

  function renderOver(innings, stats) {
    const index = stats.legalBalls > 0 && stats.legalBalls % 6 === 0 && !innings.currentBowler ? Math.floor((stats.legalBalls - 1) / 6) : Math.floor(stats.legalBalls / 6);
    const events = innings.deliveries.filter((delivery) => delivery.overIndex === index);
    $('overBalls').innerHTML = events.length ? events.map((delivery) => {
      const tone = delivery.wicket ? 'is-wicket' : delivery.noBall || delivery.wide ? 'is-extra' : delivery.batRuns === 6 ? 'is-six' : delivery.batRuns === 4 ? 'is-four' : '';
      return `<span class="mn-ball ${tone}">${esc(deliveryLabel(delivery))}</span>`;
    }).join('') : '<span class="mn-ball-empty">\u2014</span>';
    const legal = events.filter((delivery) => !delivery.noBall && !delivery.wide).length;
    $('overStatus').textContent = events.length ? `Over ${index + 1} \u00b7 ${legal} legal ball${legal === 1 ? '' : 's'}` : 'Waiting for first ball';
  }

  function renderInningsList() {
    const { state } = cur;
    $('inningsList').innerHTML = state.innings.map((innings, index) => {
      const stats = getInningsStats(innings);
      const label = innings.isSuperOver ? `Super over ${innings.superOverRound}` : `Innings ${index + 1}`;
      const now = index === state.currentIndex;
      return `<li class="${now ? 'is-current' : ''}"><span><small>${label}</small><strong>${esc(state.teams[innings.teamIndex])}</strong></span><b>${stats.runs}/${stats.wickets}</b><em>${innings.completed ? 'DONE' : now ? 'LIVE' : '\u2014'}</em></li>`;
    }).join('') || '<li>Match innings will show here.</li>';
  }

  function tournamentFor(record) {
    return record?.tournamentId ? store.getTournament(record.tournamentId) : null;
  }

  function render() {
    const { state, record } = cur;
    const innings = activeInnings();
    const live = state.status === 'playing';
    const tournament = tournamentFor(record);
    const fixture = tournament?.fixtures.find((item) => item.id === record.fixtureId);
    const rules = FORMAT_RULES[state.format];

    $('playKicker').textContent = tournament ? `${tournament.name.toUpperCase()}${fixture ? ` \u00b7 ${fixture.label.toUpperCase()}` : ''}` : 'MATCH CENTRE';
    $('playTitle').textContent = E.matchTitle(state);
    $('playMeta').textContent = [rules.label, state.overs ? `${state.overs} overs` : '', record.venue, record.scorer ? `Scorer ${record.scorer}` : ''].filter(Boolean).join(' \u00b7 ');
    $('backLink').setAttribute('href', tournament ? `#/tournaments/${tournament.id}` : '#/matches');
    $('backLink').textContent = tournament ? `\u2190 ${tournament.name}` : '\u2190 Matches';
    $('formatBadge').textContent = rules.short;
    $('matchStatus').className = `mn-status ${live ? 'is-live' : state.status === 'complete' ? 'is-result' : ''}`;
    $('matchStatus').innerHTML = `<i></i> ${E.statusLabel(state).toUpperCase()}`;
    $('resultBanner').hidden = !state.result;
    $('resultBanner').textContent = state.result?.text || '';
    $('scorerLine').textContent = record.scorer || 'Unassigned';
    $('activeScorer').value = record.scorer || '';
    $('matchFormatFact').textContent = innings?.isSuperOver ? 'SUPER OVER' : rules.short;

    if (!innings) return;
    const stats = getInningsStats(innings);
    const target = targetFor(state, state.currentIndex);
    const team = state.teams[innings.teamIndex];
    $('battingTeamName').textContent = team;
    $('bowlingTeamName').textContent = state.teams[1 - innings.teamIndex];
    $('inningsLabel').textContent = innings.isSuperOver ? `Super over ${innings.superOverRound}` : `${team} \u00b7 innings ${innings.number}`;
    $('runsValue').textContent = stats.runs;
    $('wicketsValue').textContent = stats.wickets;
    $('oversValue').textContent = `${formatOvers(stats.legalBalls)}${innings.oversLimit ? ` / ${innings.oversLimit}` : ''}`;
    $('runRateValue').textContent = stats.legalBalls ? (stats.runs / (stats.legalBalls / 6)).toFixed(2) : '0.00';
    $('targetLabel').textContent = target ? 'TARGET' : state.format === 'test' ? 'LEAD / TRAIL' : 'INNINGS';
    $('targetValue').textContent = target ? String(target) : state.format === 'test' ? `${teamRuns(state, innings.teamIndex) - teamRuns(state, 1 - innings.teamIndex)}` : 'Setting a target';
    if (target) {
      const need = Math.max(0, target - stats.runs);
      const left = innings.oversLimit ? Math.max(0, oversLimitFor(innings) * 6 - stats.legalBalls) : null;
      $('requiredValue').textContent = `${need} needed${left === null ? '' : ` off ${left} balls`}`;
    } else $('requiredValue').textContent = '';
    $('inningsFact').textContent = innings.isSuperOver ? `SO ${innings.superOverRound}` : `${innings.number} of ${state.format === 'test' ? 2 : 1}`;
    $('phaseFact').textContent = phaseText(stats);
    $('activeStriker').value = innings.playerNames[innings.striker] || '';
    $('activeNonStriker').value = innings.playerNames[innings.nonStriker] || '';
    $('activeBowler').value = innings.currentBowler || '';
    $('freeHitNotice').hidden = !innings.freeHitPending;
    $('scoringPanel').hidden = !live;
    $('endInningsBtn').textContent = state.format === 'test' ? 'Declare / close innings' : 'End innings';
    $('endInningsBtn').disabled = !live;
    $('drawBtn').hidden = state.format !== 'test' || state.status === 'complete';

    const ahead = state.format === 'test' && state.innings.length === 2 && !innings.isSuperOver
      ? teamRuns(state, state.innings[0].teamIndex) - teamRuns(state, state.innings[1].teamIndex) : 0;
    const canFollowOn = state.status === 'innings-break' && ahead >= 200;
    const gap = state.status === 'innings-break' || state.status === 'complete';
    $('nextStep').hidden = !gap;
    $('nextStepTitle').textContent = state.status === 'complete' ? 'Match complete' : 'Innings complete';
    $('nextStepCopy').textContent = state.status === 'complete' ? (state.result?.text || '') : `${team} finished on ${stats.runs}/${stats.wickets}.`;
    $('followOnOptions').hidden = !canFollowOn;
    if (canFollowOn) $('followOnCopy').textContent = `${state.teams[state.innings[0].teamIndex]} lead by ${ahead}. Follow-on can be enforced.`;
    $('continueBtn').hidden = state.status !== 'innings-break';
    $('continueBtn').textContent = canFollowOn ? 'Continue without follow-on' : 'Continue to next innings';
    $('superOverBtn').hidden = !(state.status === 'complete' && state.result?.tied && state.format !== 'test');
    $('viewStatsBtn').hidden = state.status !== 'complete';
    $('backToTournament').hidden = !(state.status === 'complete' && tournament);
    if (tournament) $('backToTournament').setAttribute('href', `#/tournaments/${tournament.id}`);
    $('nextMatchLink').hidden = !(state.status === 'complete' && !tournament);

    const ex = stats.extras;
    $('extrasBreakdown').textContent = `NB ${ex.noBall} \u00b7 WD ${ex.wide} \u00b7 B ${ex.bye} \u00b7 LB ${ex.legBye} \u00b7 P ${ex.penalty}`;
    $('battingExtras').textContent = `Extras ${ex.noBall + ex.wide + ex.bye + ex.legBye + ex.penalty}`;
    renderBatting(innings, stats);
    renderBowling(innings, stats);
    renderCommentary(innings);
    renderOver(innings, stats);
    renderInningsList();
    renderTab();
    $('actionMessage').textContent = message || (live && !innings.currentBowler ? 'Over complete. Enter the next bowler under Match controls.' : '');
  }

  function renderTab() {
    const statsOn = cur.tab === 'stats';
    $$('[data-score-tab]').forEach((button) => {
      const on = button.dataset.scoreTab === cur.tab;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', String(on));
    });
    $('liveTab').hidden = statsOn;
    $('statsTab').hidden = !statsOn;
    if (statsOn) $('statsTab').innerHTML = M.stats.matchStatsHtml(cur.state, cur.statsIndex);
  }

  /* ---------- dialog (detailed entry) ---------- */

  function updateDismissalFields() {
    const has = Boolean($('detailWicket').value);
    $('dismissalFields').hidden = !has;
    $('incomingBatter').disabled = !has;
  }

  function openDeliveryDialog(wicket = '') {
    const innings = activeInnings();
    if (!innings || cur.state.status !== 'playing') return;
    ['detailBatRuns', 'detailWideRuns', 'detailByes', 'detailLegByes', 'detailPenalty'].forEach((id) => { $(id).value = '0'; });
    $('detailNoBall').checked = false;
    $('detailWide').checked = false;
    $('detailWicket').value = wicket;
    $('detailDismissed').value = 'striker';
    $('incomingBatter').value = `Batter ${getInningsStats(innings).wickets + 3}`;
    $('dialogMessage').textContent = '';
    updateDismissalFields();
    $('deliveryDialog').showModal();
  }

  function submitDetailed() {
    const error = makeDelivery({
      batRuns: $('detailBatRuns').value, wideRuns: $('detailWideRuns').value, noBall: $('detailNoBall').checked, wide: $('detailWide').checked,
      byes: $('detailByes').value, legByes: $('detailLegByes').value, penaltyRuns: $('detailPenalty').value,
      wicket: $('detailWicket').value, dismissed: $('detailDismissed').value, incomingName: $('incomingBatter').value,
    });
    if (error) { $('dialogMessage').textContent = error; return; }
    $('deliveryDialog').close();
    setMessage('');
    render();
  }

  function score(input) {
    const error = makeDelivery(input);
    setMessage(error);
    if (!error) render();
  }

  function bindScoring() {
    $$('.mn-run-button').forEach((button) => button.addEventListener('click', () => score({ batRuns: button.dataset.runs })));
    $$('.mn-extra-button[data-extra]').forEach((button) => button.addEventListener('click', () => {
      const kind = button.dataset.extra;
      score({ wide: kind === 'wide', noBall: kind === 'noBall', byes: kind === 'bye' ? 1 : 0, legByes: kind === 'legBye' ? 1 : 0 });
    }));
    $('wicketBtn').addEventListener('click', () => openDeliveryDialog('bowled'));
    $('detailsBtn').addEventListener('click', () => openDeliveryDialog());
    $('saveDeliveryBtn').addEventListener('click', submitDetailed);
    $('detailWicket').addEventListener('change', updateDismissalFields);
    $('undoBtn').addEventListener('click', undoDelivery);
    $('endInningsBtn').addEventListener('click', () => {
      if (!window.confirm('End this innings now?')) return;
      closeInnings(); commit(); render();
    });
    $('continueBtn').addEventListener('click', () => startNextInnings(false));
    $('followOnBtn').addEventListener('click', () => startNextInnings(true));
    $('superOverBtn').addEventListener('click', startSuperOver);
    $('drawBtn').addEventListener('click', () => {
      if (!window.confirm('End this Test as a draw?')) return;
      cur.state.status = 'complete';
      cur.state.result = { winner: null, tied: false, draw: true, text: 'Match drawn.' };
      commit(); render();
    });
    $('viewStatsBtn').addEventListener('click', () => router.go(`#/match/${cur.id}/stats`));
    $('deleteMatchBtn').addEventListener('click', () => {
      if (!window.confirm('Delete this match from this device? This cannot be undone.')) return;
      store.deleteMatch(cur.id);
      toast('Match deleted');
      router.go('#/matches');
    });

    const rename = (role, value) => {
      const innings = activeInnings();
      const name = value.trim();
      if (innings && name) { innings.playerNames[innings[role]] = name; commit(); }
      render();
    };
    $('activeStriker').addEventListener('change', (event) => rename('striker', event.target.value));
    $('activeNonStriker').addEventListener('change', (event) => rename('nonStriker', event.target.value));
    $('activeBowler').addEventListener('change', (event) => {
      const innings = activeInnings();
      if (!innings) return;
      const next = event.target.value.trim();
      const over = Math.floor(getInningsStats(innings).legalBalls / 6);
      const thisOver = innings.deliveries.filter((delivery) => delivery.overIndex === over);
      if (thisOver.length && thisOver[0].bowler !== next) { toast('The current bowler must complete this over.'); event.target.value = innings.currentBowler; return; }
      innings.currentBowler = next;
      commit();
    });
    $('activeScorer').addEventListener('change', (event) => {
      cur.record = { ...cur.record, scorer: event.target.value.trim() };
      commit(); render();
    });

    $$('[data-score-tab]').forEach((button) => button.addEventListener('click', () => router.go(`#/match/${cur.id}${button.dataset.scoreTab === 'stats' ? '/stats' : ''}`)));
    $('statsTab').addEventListener('click', (event) => {
      const button = event.target.closest('[data-stats-innings]');
      if (!button) return;
      cur.statsIndex = Number(button.dataset.statsInnings);
      renderTab();
    });

    document.addEventListener('keydown', (event) => {
      if (activeView !== 'score' || !cur.id || cur.tab !== 'live' || cur.state.status !== 'playing') return;
      if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      const key = event.key.toLowerCase();
      if (/^[0-46]$/.test(key)) score({ batRuns: key });
      else if (key === 'w') openDeliveryDialog('bowled');
      else if (key === 'u') undoDelivery();
    });
  }

  /* ---------- setup ---------- */

  let fixtureCtx = null;

  function setupValues() {
    const format = document.querySelector('input[name="format"]:checked').value;
    const teams = [$('teamAInput').value.trim() || 'Team A', $('teamBInput').value.trim() || 'Team B'];
    return { format, teams, rules: FORMAT_RULES[format] };
  }

  function updatePreview() {
    const { format, teams, rules } = setupValues();
    const toss = Number($('tossWinnerInput').value);
    const bat = $('tossDecisionInput').value === 'bat';
    $('previewFormat').textContent = rules.short;
    $('previewTeamA').textContent = teams[0];
    $('previewTeamB').textContent = teams[1];
    $('previewToss').textContent = `${teams[toss]} win the toss and ${bat ? 'bat' : 'field'} first.`;
    $('previewRules').textContent = format === 'test' ? 'Up to 4 innings' : `${$('oversInput').value || rules.defaultOvers} overs`;
    $('previewScorer').textContent = $('scorerInput').value.trim() || 'Add a name';
    $('previewVenue').textContent = $('venueInput').value.trim() || 'Not set';
  }

  function onFormatChange() {
    const { format, rules } = setupValues();
    $('oversField').hidden = format === 'test';
    if (format !== 'test') {
      $('oversInput').max = String(rules.defaultOvers);
      $('oversInput').value = String(rules.defaultOvers);
      $('oversHint').textContent = format === 't20' ? 'Shorten it for a quick match, up to 20 overs.' : 'Shorten it for a rain-reduced match, up to 50 overs.';
    }
    updatePreview();
  }

  function syncToss() {
    const [a, b] = setupValues().teams;
    const select = $('tossWinnerInput');
    const keep = select.value;
    select.innerHTML = `<option value="0">${esc(a)}</option><option value="1">${esc(b)}</option>`;
    select.value = keep || '0';
    updatePreview();
  }

  function resetSetup() {
    fixtureCtx = null;
    $('setupForm').reset();
    $('teamAInput').readOnly = false;
    $('teamBInput').readOnly = false;
    $$('input[name="format"]').forEach((input) => { input.disabled = false; });
    $('oversInput').readOnly = false;
    $('fixtureNote').hidden = true;
    $('scorerInput').value = store.getProfile().scorerName;
    onFormatChange();
    syncToss();
  }

  function prepareFixture(tournamentId, fixtureId) {
    const tournament = store.getTournament(tournamentId);
    const view = tournament && M.tournament.fixtureViews(tournament, store.listMatches().filter((record) => record.tournamentId === tournamentId)).find((item) => item.fixture.id === fixtureId);
    if (!view) { toast('That fixture could not be found.'); return router.go('#/tournaments'); }
    if (view.record) return router.go(`#/match/${view.record.id}`);
    if (!view.ready) { toast('Teams for this fixture are not decided yet.'); return router.go(`#/tournaments/${tournamentId}`); }
    resetSetup();
    fixtureCtx = { tournament, view };
    document.querySelector(`input[name="format"][value="${tournament.format}"]`).checked = true;
    onFormatChange();
    $$('input[name="format"]').forEach((input) => { input.disabled = !input.checked; });
    if (tournament.overs) { $('oversInput').value = String(tournament.overs); $('oversInput').readOnly = true; }
    $('teamAInput').value = view.teamA; $('teamBInput').value = view.teamB;
    $('teamAInput').readOnly = true; $('teamBInput').readOnly = true;
    $('scorerInput').value = view.fixture.scorer || store.getProfile().scorerName;
    $('venueInput').value = view.fixture.venue || tournament.venue || '';
    $('fixtureNote').hidden = false;
    $('fixtureNote').innerHTML = `<strong>${esc(tournament.name)}</strong> \u00b7 ${esc(view.fixture.label)} \u00b7 ${esc(view.teamA)} v ${esc(view.teamB)}`;
    syncToss();
  }

  function startMatch(event) {
    event.preventDefault();
    const { format, teams, rules } = setupValues();
    if (teams[0].toLowerCase() === teams[1].toLowerCase()) return toast('Enter two different team names.');
    const scorer = $('scorerInput').value.trim();
    if (!scorer) return toast('Add the scorer\u2019s name.');
    const toss = Number($('tossWinnerInput').value);
    const battingFirst = $('tossDecisionInput').value === 'bat' ? toss : 1 - toss;
    const overs = format === 'test' ? null : Math.min(rules.defaultOvers, Math.max(1, clampRuns($('oversInput').value, rules.defaultOvers)));
    const state = freshState();
    Object.assign(state, {
      started: true, status: 'playing', format, overs, teams, battingFirst, currentIndex: 0,
      inningsOrder: format === 'test' ? [battingFirst, 1 - battingFirst, battingFirst, 1 - battingFirst] : [battingFirst, 1 - battingFirst],
    });
    state.innings.push(makeInnings(battingFirst, 1, overs, $('openerInput').value.trim() || 'Batter 1', $('nonStrikerInput').value.trim() || 'Batter 2', $('bowlerInput').value.trim() || 'Bowler 1'));
    const id = uid('m');
    store.saveProfile({ scorerName: scorer });
    const record = store.saveMatch({
      id, scorer, venue: $('venueInput').value.trim(), state,
      tournamentId: fixtureCtx?.tournament.id || '', fixtureId: fixtureCtx?.view.fixture.id || '',
    });
    if (fixtureCtx) store.linkFixture(fixtureCtx.tournament.id, fixtureCtx.view.fixture.id, id);
    store.setCurrentId(id);
    cur.id = id; cur.record = record; cur.state = state;
    router.go(`#/match/${id}`);
  }

  function bindSetup() {
    $('setupForm').addEventListener('submit', startMatch);
    $$('input[name="format"]').forEach((input) => input.addEventListener('change', onFormatChange));
    ['teamAInput', 'teamBInput'].forEach((id) => $(id).addEventListener('input', syncToss));
    ['tossWinnerInput', 'tossDecisionInput', 'oversInput', 'scorerInput', 'venueInput'].forEach((id) => {
      $(id).addEventListener('input', updatePreview);
      $(id).addEventListener('change', updatePreview);
    });
  }

  /* ---------- score view enter ---------- */

  function showSetup(on) {
    $('setupView').hidden = !on;
    $('playView').hidden = on;
  }

  function loadMatch(id, tab) {
    const record = store.getMatch(id);
    if (!record) { toast('That match is no longer on this device.'); return router.go('#/matches'); }
    if (cur.id !== id) { message = ''; cur.statsIndex = -1; }
    cur.id = id; cur.record = record; cur.state = clone(record.state); cur.tab = tab;
    store.setCurrentId(id);
    showSetup(false);
    render();
  }

  router.register('score', {
    enter(params) {
      if (params[0] === 'match') return loadMatch(params[1], params[2] === 'stats' ? 'stats' : 'live');
      if (params[0] === 'new') {
        showSetup(true);
        if (params[1] && params[2]) return prepareFixture(params[1], params[2]);
        return resetSetup();
      }
      const current = store.getCurrentId();
      const record = current && store.getMatch(current);
      if (record && record.state.status !== 'complete') return router.go(`#/match/${current}`);
      return router.go('#/score/new');
    },
  });

  store.subscribe((type) => {
    if (type === 'external' && activeView === 'score' && cur.id && !$('playView').hidden) {
      const record = store.getMatch(cur.id);
      if (record) { cur.record = record; cur.state = clone(record.state); render(); }
    }
    if (type === 'profile') renderProfile();
  });

  M.app = { toast, router, $, $$ };

  bindProfile();
  bindScoring();
  bindSetup();
  renderProfile();
  $('yearNow').textContent = new Date().getFullYear();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
})();
