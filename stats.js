(() => {
  const M = (window.Maiden = window.Maiden || {});
  const { FORMAT_RULES, WICKET_LABELS, escapeHtml: esc, formatOvers, getInningsStats, deliveryInfo, targetFor } = M.engine;

  const SERIES_COLORS = ['#00b9c7', '#f2a900', '#0b4a56', '#e0626b'];
  let chartCounter = 0;

  const fixed = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : '0.00');
  const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10 < 4 ? n % 10 : 0]}`;
  const empty = (text) => `<p class="mn-empty-note">${esc(text)}</p>`;

  function niceScale(maxValue, ticks = 4) {
    const raw = Math.max(maxValue, 1) / ticks;
    if (raw <= 5) {
      const step = Math.max(1, Math.ceil(raw));
      return { step, max: step * ticks };
    }
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((multiplier) => multiplier * power).find((candidate) => candidate >= raw) || 10 * power;
    return { step, max: step * ticks };
  }

  // Powerplay / middle / death split, scaled for shortened matches.
  function phasesFor(format, limit) {
    const rules = FORMAT_RULES[format];
    if (!rules?.defaultOvers || !limit) return [];
    const ratio = limit / rules.defaultOvers;
    const powerplay = Math.min(limit, Math.max(1, Math.round(rules.powerplayOvers * ratio)));
    const death = Math.min(limit - powerplay, Math.max(1, Math.round(rules.deathOvers * ratio)));
    const middle = limit - powerplay - death;
    const list = [{ label: 'Powerplay', from: 0, to: powerplay }];
    if (middle > 0) list.push({ label: 'Middle overs', from: powerplay, to: powerplay + middle });
    if (death > 0) list.push({ label: 'Death overs', from: powerplay + middle, to: limit });
    return list;
  }

  function analyzeInnings(state, index) {
    const innings = state.innings[index];
    if (!innings) return null;
    const stats = getInningsStats(innings);
    const nameOf = (id) => innings.playerNames[id] || 'Batter';
    const overs = [];
    const worm = [{ x: 0, y: 0 }];
    const wicketMarks = [];
    const sources = { running: 0, fours: 0, sixes: 0, extras: 0 };
    const partnerships = [];
    let runs = 0;
    let legal = 0;
    let dots = 0;
    let partner = null;

    innings.deliveries.forEach((delivery) => {
      const info = deliveryInfo(delivery);
      if (!partner) partner = { startRuns: runs, startBalls: legal, a: delivery.strikerId, b: delivery.nonStrikerId };
      const over = overs[delivery.overIndex] || (overs[delivery.overIndex] = { index: delivery.overIndex, runs: 0, wickets: 0, legal: 0, bowler: delivery.bowler });
      runs += info.total;
      over.runs += info.total;
      if (info.legal) {
        legal += 1;
        over.legal += 1;
        if (info.total === 0) dots += 1;
      }
      if (delivery.batRuns === 4) sources.fours += 4;
      else if (delivery.batRuns === 6) sources.sixes += 6;
      else sources.running += delivery.batRuns;
      sources.extras += info.extras;

      const x = legal / 6;
      const last = worm[worm.length - 1];
      if (last.x === x) last.y = runs;
      else worm.push({ x, y: runs });

      if (delivery.wicket) {
        over.wickets += 1;
        wicketMarks.push({ x, y: runs, label: `${nameOf(delivery.dismissedId)} · ${WICKET_LABELS[delivery.wicket] || 'Out'} · ${formatOvers(legal)} ov` });
        partnerships.push({ runs: runs - partner.startRuns, balls: legal - partner.startBalls, pair: [nameOf(partner.a), nameOf(partner.b)], broken: true });
        partner = null;
      }
    });
    if (partner) partnerships.push({ runs: runs - partner.startRuns, balls: legal - partner.startBalls, pair: [nameOf(partner.a), nameOf(partner.b)], broken: false });

    const limit = innings.oversLimit;
    const target = targetFor(state, index);
    const ballsLeft = limit ? Math.max(0, limit * 6 - legal) : null;
    const runRate = legal ? runs / (legal / 6) : 0;
    const required = target ? Math.max(0, target - runs) : null;
    const phases = phasesFor(state.format, limit).map((phase) => {
      const slice = overs.filter((over) => over && over.index >= phase.from && over.index < phase.to);
      return {
        ...phase, runs: slice.reduce((total, over) => total + over.runs, 0),
        wickets: slice.reduce((total, over) => total + over.wickets, 0), started: slice.length > 0,
      };
    });
    const recent = overs.filter(Boolean).slice(-5);
    const batters = Object.values(stats.batters).filter((entry) => entry.balls > 0 || entry.out)
      .map((entry) => ({ ...entry, name: nameOf(entry.id), strikeRate: entry.balls ? (entry.runs / entry.balls) * 100 : 0 }));
    const bowlers = Object.values(stats.bowlers)
      .map((entry) => ({ ...entry, balls: entry.legalBalls, economy: entry.legalBalls ? entry.runs / (entry.legalBalls / 6) : 0 }));

    return {
      index, innings, team: state.teams[innings.teamIndex], stats, overs, worm, wicketMarks, sources, partnerships, phases,
      runs, wickets: stats.wickets, legal, dots, runRate, target, required, ballsLeft,
      requiredRate: target && ballsLeft ? required / (ballsLeft / 6) : null,
      projected: limit && !target && !innings.completed && legal >= 6 ? Math.round(runRate * limit) : null,
      boundaries: { fours: batters.reduce((t, b) => t + b.fours, 0), sixes: batters.reduce((t, b) => t + b.sixes, 0) },
      lastFive: { runs: recent.reduce((t, o) => t + o.runs, 0), wickets: recent.reduce((t, o) => t + o.wickets, 0), count: recent.length },
      batters, bowlers,
    };
  }

  /* ---------- SVG charts ---------- */

  function wormChart(analyses, selected) {
    const width = 640; const height = 300; const m = { l: 46, r: 18, t: 18, b: 34 };
    const innerW = width - m.l - m.r; const innerH = height - m.t - m.b;
    const limit = analyses.find((item) => item.innings.oversLimit)?.innings.oversLimit;
    const maxX = Math.max(limit || 0, ...analyses.map((item) => item.legal / 6), 5);
    const yScale = niceScale(Math.max(...analyses.map((item) => item.runs), 10), 4);
    const x = (value) => m.l + (value / maxX) * innerW;
    const y = (value) => m.t + innerH - (value / yScale.max) * innerH;
    const xStep = maxX <= 10 ? 1 : maxX <= 25 ? 5 : maxX <= 60 ? 10 : 20;
    const id = `mnw${chartCounter += 1}`;

    let grid = '';
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = tick * yScale.step;
      grid += `<line class="mn-grid" x1="${m.l}" x2="${width - m.r}" y1="${y(value)}" y2="${y(value)}"/><text class="mn-axis" x="${m.l - 8}" y="${y(value) + 4}" text-anchor="end">${value}</text>`;
    }
    for (let value = 0; value <= maxX; value += xStep) {
      grid += `<text class="mn-axis" x="${x(value)}" y="${height - 10}" text-anchor="middle">${value}</text>`;
    }

    let areas = ''; let lines = ''; let marks = '';
    analyses.forEach((item, position) => {
      const color = SERIES_COLORS[position % SERIES_COLORS.length];
      const path = item.worm.map((point, step) => `${step ? 'L' : 'M'}${x(point.x).toFixed(1)} ${y(point.y).toFixed(1)}`).join('');
      const lastPoint = item.worm[item.worm.length - 1];
      if (item.index === selected) {
        areas += `<path class="mn-area" d="${path}L${x(lastPoint.x).toFixed(1)} ${y(0)}L${x(0)} ${y(0)}Z" fill="url(#${id}${position})"/>`;
      }
      areas += `<defs><linearGradient id="${id}${position}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".3"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
      lines += `<path class="mn-line ${item.index === selected ? 'is-selected' : ''}" pathLength="1" d="${path}" stroke="${color}"/>`;
      item.wicketMarks.forEach((mark) => {
        marks += `<circle class="mn-mark" cx="${x(mark.x).toFixed(1)}" cy="${y(mark.y).toFixed(1)}" r="5" stroke="${color}"><title>${esc(mark.label)}</title></circle>`;
      });
    });
    const legend = analyses.map((item, position) => `<li><i style="background:${SERIES_COLORS[position % SERIES_COLORS.length]}"></i>${esc(item.team)}${item.innings.isSuperOver ? ' (super over)' : ''} <b>${item.runs}/${item.wickets}</b></li>`).join('');
    return `<svg class="mn-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Run progression by over for each innings">${grid}${areas}${lines}${marks}<text class="mn-axis-title" x="${m.l + innerW / 2}" y="${height - 0}" text-anchor="middle">OVERS</text></svg><ul class="mn-legend">${legend}</ul><p class="mn-chart-hint">Hollow dots mark wickets.</p>`;
  }

  function overChart(analysis) {
    const width = 640; const height = 260; const m = { l: 40, r: 12, t: 22, b: 30 };
    const innerW = width - m.l - m.r; const innerH = height - m.t - m.b;
    const limit = analysis.innings.oversLimit;
    const count = Math.max(analysis.overs.length, limit && limit <= 20 ? limit : 0, 1);
    const maxRuns = Math.max(...analysis.overs.filter(Boolean).map((over) => over.runs), 6);
    const scale = niceScale(maxRuns, 3);
    const slot = innerW / count; const barWidth = Math.min(34, slot * 0.68);
    const base = m.t + innerH;
    const labelStep = count <= 20 ? 1 : count <= 50 ? 5 : 10;
    let svg = '';
    for (let tick = 0; tick <= 3; tick += 1) {
      const value = tick * scale.step; const yy = base - (value / scale.max) * innerH;
      svg += `<line class="mn-grid" x1="${m.l}" x2="${width - m.r}" y1="${yy}" y2="${yy}"/><text class="mn-axis" x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${value}</text>`;
    }
    for (let i = 0; i < count; i += 1) {
      const over = analysis.overs[i];
      const cx = m.l + slot * i + slot / 2;
      if (over) {
        const barHeight = Math.max(2, (over.runs / scale.max) * innerH);
        const tone = over.runs >= 12 ? 'is-hot' : over.runs >= 8 ? 'is-warm' : 'is-cool';
        const maiden = over.legal === 6 && over.runs === 0;
        svg += `<rect class="mn-bar-rect ${tone}" style="--i:${i}" x="${(cx - barWidth / 2).toFixed(1)}" y="${(base - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3"><title>Over ${i + 1}: ${over.runs} run${over.runs === 1 ? '' : 's'}${over.wickets ? `, ${over.wickets} wicket${over.wickets === 1 ? '' : 's'}` : ''}${maiden ? ' · maiden' : ''} · ${esc(over.bowler)}</title></rect>`;
        if (count <= 25 && over.runs > 0) svg += `<text class="mn-bar-value" x="${cx.toFixed(1)}" y="${(base - barHeight - (over.wickets ? 18 : 6)).toFixed(1)}" text-anchor="middle">${over.runs}</text>`;
        if (maiden) svg += `<text class="mn-bar-value is-maiden" x="${cx.toFixed(1)}" y="${base - 6}" text-anchor="middle">M</text>`;
        for (let w = 0; w < over.wickets; w += 1) svg += `<circle class="mn-wkt-dot" cx="${cx.toFixed(1)}" cy="${(base - barHeight - 8 - w * 11).toFixed(1)}" r="4.5"/>`;
      }
      if (i % labelStep === 0) svg += `<text class="mn-axis" x="${cx.toFixed(1)}" y="${height - 10}" text-anchor="middle">${i + 1}</text>`;
    }
    return `<svg class="mn-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Runs scored in each over">${svg}</svg><p class="mn-chart-hint">Red dots mark wickets, M marks a maiden over.</p>`;
  }

  function donut(analysis) {
    const s = analysis.sources;
    const items = [
      { label: 'Singles, twos & threes', value: s.running, color: '#00b9c7' },
      { label: 'Fours', value: s.fours, color: '#0b4a56' },
      { label: 'Sixes', value: s.sixes, color: '#f2a900' },
      { label: 'Extras', value: s.extras, color: '#e0626b' },
    ];
    const total = items.reduce((sum, item) => sum + item.value, 0);
    if (!total) return empty('Runs will be broken down here once the innings is under way.');
    const radius = 52; const circumference = 2 * Math.PI * radius;
    let offset = 0; let rings = '';
    items.filter((item) => item.value > 0).forEach((item) => {
      const length = (item.value / total) * circumference;
      rings += `<circle class="mn-ring" cx="70" cy="70" r="${radius}" stroke="${item.color}" stroke-dasharray="${Math.max(length - 2, 0.5).toFixed(2)} ${(circumference - length + 2).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 70 70)"><title>${item.label}: ${item.value}</title></circle>`;
      offset += length;
    });
    const legend = items.map((item) => `<li><i style="background:${item.color}"></i><span>${item.label}</span><b>${item.value}</b><em>${Math.round((item.value / total) * 100)}%</em></li>`).join('');
    return `<div class="mn-donut"><svg viewBox="0 0 140 140" role="img" aria-label="Share of runs by type">${rings}<text class="mn-donut-total" x="70" y="73" text-anchor="middle">${total}</text><text class="mn-donut-caption" x="70" y="90" text-anchor="middle">RUNS</text></svg><ul class="mn-donut-legend">${legend}</ul></div>`;
  }

  /* ---------- HTML blocks ---------- */

  const bar = (value, max) => `<i class="mn-meter" style="--w:${max ? Math.max(3, Math.round((value / max) * 100)) : 0}%"></i>`;
  const kpi = (label, value, note = '') => `<div class="mn-kpi"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ''}</div>`;

  function phaseBlock(analysis) {
    if (!analysis.phases.length) return empty('Phases of play apply to limited-overs innings.');
    const max = Math.max(...analysis.phases.map((phase) => phase.runs), 1);
    return `<ul class="mn-rows">${analysis.phases.map((phase) => `<li><div class="mn-row-head"><strong>${phase.label}</strong><small>Overs ${phase.from + 1}–${phase.to}</small><b>${phase.started ? `${phase.runs}/${phase.wickets}` : '—'}</b></div>${bar(phase.runs, max)}</li>`).join('')}</ul>`;
  }

  function partnershipBlock(analysis) {
    if (!analysis.partnerships.length) return empty('Partnerships appear after the first delivery.');
    const max = Math.max(...analysis.partnerships.map((item) => item.runs), 1);
    return `<ul class="mn-rows">${analysis.partnerships.map((item, position) => `<li><div class="mn-row-head"><strong>${esc(item.pair[0])} &amp; ${esc(item.pair[1])}</strong><small>${item.broken ? `${ordinal(position + 1)} wicket` : 'Unbroken'}</small><b>${item.runs} (${item.balls})</b></div>${bar(item.runs, max)}</li>`).join('')}</ul>`;
  }

  function leadersBlock(rows, valueText, noteText, emptyText) {
    if (!rows.length) return empty(emptyText);
    const max = Math.max(...rows.map((row) => row.sortValue), 1);
    return `<ol class="mn-leader-list">${rows.map((row, position) => `<li><span class="mn-rank">${position + 1}</span><div><strong>${esc(row.name)}</strong><small>${noteText(row)}</small>${bar(row.sortValue, max)}</div><b>${valueText(row)}</b></li>`).join('')}</ol>`;
  }

  function inningsTitle(state, index) {
    const innings = state.innings[index];
    if (innings.isSuperOver) return `${state.teams[innings.teamIndex]} · super over`;
    return state.format === 'test' ? `${state.teams[innings.teamIndex]} · innings ${innings.number}` : state.teams[innings.teamIndex];
  }

  function matchStatsHtml(state, selected) {
    if (!state?.innings?.length) return empty('Start the match to unlock the stats corner.');
    const index = state.innings[selected] ? selected : Math.max(state.currentIndex, 0);
    const analyses = state.innings.map((_, position) => analyzeInnings(state, position));
    const current = analyses[index];
    const picker = state.innings.map((_, position) => `<button class="mn-seg-button ${position === index ? 'is-active' : ''}" type="button" data-stats-innings="${position}" aria-pressed="${position === index}">${esc(inningsTitle(state, position))}</button>`).join('');

    const chase = current.target ? kpi('Required rate', current.requiredRate === null ? '—' : fixed(current.requiredRate), `${current.required} needed${current.ballsLeft === null ? '' : ` off ${current.ballsLeft} balls`}`)
      : current.projected ? kpi('Projected', current.projected, 'at the current run rate')
        : kpi('Innings total', `${current.runs}/${current.wickets}`, `${formatOvers(current.legal)} overs`);
    const boundaryRuns = current.sources.fours + current.sources.sixes;
    const open = current.partnerships[current.partnerships.length - 1];
    const kpis = [
      kpi('Run rate', fixed(current.runRate), `${formatOvers(current.legal)} overs bowled`),
      chase,
      kpi('Boundaries', `${current.boundaries.fours + current.boundaries.sixes}`, `${current.boundaries.fours} fours · ${current.boundaries.sixes} sixes`),
      kpi('Boundary runs', current.runs ? `${Math.round((boundaryRuns / current.runs) * 100)}%` : '0%', `${boundaryRuns} of ${current.runs} runs`),
      kpi('Dot balls', current.legal ? `${Math.round((current.dots / current.legal) * 100)}%` : '0%', `${current.dots} of ${current.legal} balls`),
      kpi(open && !open.broken ? 'Current stand' : 'Last stand', open ? `${open.runs}` : '0', open ? `${open.balls} balls` : 'No partnership yet'),
      current.lastFive.count && state.format !== 'test'
        ? kpi('Last 5 overs', `${current.lastFive.runs}/${current.lastFive.wickets}`, `${current.lastFive.count} over${current.lastFive.count === 1 ? '' : 's'} counted`)
        : kpi('Balls per wicket', current.wickets ? fixed(current.legal / current.wickets, 1) : '—', `${current.wickets} wicket${current.wickets === 1 ? '' : 's'} down`),
      kpi('Extras', `${current.sources.extras}`, 'wides, no-balls, byes, leg-byes'),
    ].join('');

    const batters = leadersBlock(
      [...current.batters].sort((a, b) => b.runs - a.runs || a.balls - b.balls).slice(0, 4).map((row) => ({ ...row, sortValue: row.runs })),
      (row) => `${row.runs}${row.out ? '' : '*'}`,
      (row) => `${row.balls} balls · ${row.fours}×4 · ${row.sixes}×6 · SR ${fixed(row.strikeRate, 1)}`,
      'Batting figures appear once a ball is bowled.',
    );
    const bowlers = leadersBlock(
      [...current.bowlers].sort((a, b) => b.wickets - a.wickets || a.economy - b.economy).slice(0, 4).map((row) => ({ ...row, sortValue: row.wickets * 10 + Math.max(0, 10 - row.economy) })),
      (row) => `${row.wickets}/${row.runs}`,
      (row) => `${formatOvers(row.balls)} ov · ${row.maidens || 0} maidens · econ ${fixed(row.economy)}`,
      'Bowling figures appear once a ball is bowled.',
    );

    return `
      <div class="mn-stats-head"><div><p class="mn-kicker">STATS CORNER</p><h2>Match insights</h2></div><div class="mn-seg" role="group" aria-label="Choose innings">${picker}</div></div>
      <div class="mn-kpis">${kpis}</div>
      <div class="mn-chart-grid">
        <article class="mn-chart-card"><header><h3>Run progression</h3><span>All innings</span></header>${wormChart(analyses, index)}</article>
        <article class="mn-chart-card"><header><h3>Runs per over</h3><span>${esc(current.team)}</span></header>${overChart(current)}</article>
        <article class="mn-chart-card"><header><h3>How the runs came</h3><span>${esc(current.team)}</span></header>${donut(current)}</article>
        <article class="mn-chart-card"><header><h3>Phases of play</h3><span>${esc(current.team)}</span></header>${phaseBlock(current)}</article>
      </div>
      <div class="mn-leaders-grid">
        <article class="mn-chart-card"><header><h3>Top batters</h3><span>${esc(current.team)}</span></header>${batters}</article>
        <article class="mn-chart-card"><header><h3>Best bowlers</h3><span>${esc(state.teams[1 - current.innings.teamIndex])}</span></header>${bowlers}</article>
        <article class="mn-chart-card"><header><h3>Partnerships</h3><span>${esc(current.team)}</span></header>${partnershipBlock(current)}</article>
      </div>`;
  }

  /* ---------- tournament statistics ---------- */

  function tournamentStats(tournament, records) {
    const batters = new Map(); const bowlers = new Map(); const teamTotals = new Map();
    const innings = []; const wins = [];
    const totals = { runs: 0, wickets: 0, sixes: 0, fours: 0, balls: 0, matches: 0 };

    records.filter((record) => record.tournamentId === tournament.id).forEach((record) => {
      const state = record.state;
      let played = false;
      state.innings.filter((item) => !item.isSuperOver).forEach((item, position) => {
        if (!item.deliveries.length) return;
        played = true;
        const stats = getInningsStats(item);
        const batTeam = state.teams[item.teamIndex]; const bowlTeam = state.teams[1 - item.teamIndex];
        totals.runs += stats.runs; totals.wickets += stats.wickets; totals.balls += stats.legalBalls;
        const entry = teamTotals.get(batTeam) || { team: batTeam, runs: 0, balls: 0 };
        entry.runs += stats.runs; entry.balls += stats.legalBalls; teamTotals.set(batTeam, entry);
        innings.push({ team: batTeam, vs: bowlTeam, runs: stats.runs, wickets: stats.wickets, allOut: stats.wickets >= item.maxWickets, first: position === 0 });

        Object.values(stats.batters).filter((row) => row.balls > 0 || row.out).forEach((row) => {
          const name = item.playerNames[row.id] || 'Batter';
          const key = `${batTeam}|${name.toLowerCase()}`;
          const agg = batters.get(key) || { name, team: batTeam, innings: 0, runs: 0, balls: 0, fours: 0, sixes: 0, notOuts: 0, high: 0 };
          agg.innings += 1; agg.runs += row.runs; agg.balls += row.balls; agg.fours += row.fours; agg.sixes += row.sixes;
          agg.notOuts += row.out ? 0 : 1; agg.high = Math.max(agg.high, row.runs);
          totals.fours += row.fours; totals.sixes += row.sixes;
          batters.set(key, agg);
        });
        Object.values(stats.bowlers).forEach((row) => {
          const key = `${bowlTeam}|${row.name.toLowerCase()}`;
          const agg = bowlers.get(key) || { name: row.name, team: bowlTeam, balls: 0, runs: 0, wickets: 0, maidens: 0, best: null };
          agg.balls += row.legalBalls; agg.runs += row.runs; agg.wickets += row.wickets; agg.maidens += row.maidens || 0;
          if (!agg.best || row.wickets > agg.best.w || (row.wickets === agg.best.w && row.runs < agg.best.r)) agg.best = { w: row.wickets, r: row.runs };
          bowlers.set(key, agg);
        });
      });
      if (played) totals.matches += 1;

      if (state.status === 'complete' && state.format !== 'test' && (state.result?.winner === 0 || state.result?.winner === 1)) {
        const main = state.innings.filter((item) => !item.isSuperOver).slice(0, 2);
        if (main.length === 2) {
          const scores = main.map((item) => getInningsStats(item));
          const winnerTeamIndex = state.result.winner;
          const chased = main[1].teamIndex === winnerTeamIndex;
          const margin = chased ? main[1].maxWickets - scores[1].wickets : scores[0].runs - scores[1].runs;
          if (margin > 0) wins.push({ team: state.teams[winnerTeamIndex], vs: state.teams[1 - winnerTeamIndex], chased, margin });
        }
      }
    });

    const economy = (row) => (row.balls ? row.runs / (row.balls / 6) : 0);
    const topBatters = [...batters.values()].map((row) => ({ ...row, strikeRate: row.balls ? (row.runs / row.balls) * 100 : 0 }));
    const topBowlers = [...bowlers.values()].map((row) => ({ ...row, economy: economy(row) }));
    const firsts = innings.filter((item) => item.first);
    const lowest = innings.filter((item) => item.allOut).sort((a, b) => a.runs - b.runs)[0];
    return {
      totals, innings, wins,
      highest: [...innings].sort((a, b) => b.runs - a.runs)[0],
      lowest,
      averageFirst: firsts.length ? firsts.reduce((sum, item) => sum + item.runs, 0) / firsts.length : 0,
      runLeaders: topBatters.filter((row) => row.runs > 0).sort((a, b) => b.runs - a.runs || a.balls - b.balls).slice(0, 5),
      sixLeaders: topBatters.filter((row) => row.sixes > 0).sort((a, b) => b.sixes - a.sixes || b.runs - a.runs).slice(0, 5),
      wicketLeaders: topBowlers.filter((row) => row.wickets > 0).sort((a, b) => b.wickets - a.wickets || a.economy - b.economy).slice(0, 5),
      economyLeaders: topBowlers.filter((row) => row.balls >= 12).sort((a, b) => a.economy - b.economy).slice(0, 5),
      teamRates: [...teamTotals.values()].filter((row) => row.balls > 0).map((row) => ({ ...row, rate: row.runs / (row.balls / 6) })).sort((a, b) => b.rate - a.rate),
      bestRunWin: wins.filter((win) => !win.chased).sort((a, b) => b.margin - a.margin)[0],
      bestChase: wins.filter((win) => win.chased).sort((a, b) => b.margin - a.margin)[0],
    };
  }

  function tournamentStatsHtml(tournament, records, progress) {
    const data = tournamentStats(tournament, records);
    if (!data.totals.matches) {
      return `<div class="mn-stats-empty"><p class="mn-kicker">STATS CORNER</p><h3>No scoring yet</h3><p>Start scoring a fixture and this corner fills with run-scorers, wicket-takers, records and team scoring rates.</p></div>`;
    }
    const t = data.totals;
    const kpis = [
      kpi('Matches', `${progress.done}<em class="mn-kpi-of">/${progress.total}</em>`, `${t.matches} with scoring`),
      kpi('Total runs', t.runs, `${t.balls ? fixed(t.runs / (t.balls / 6)) : '0.00'} per over`),
      kpi('Wickets', t.wickets, `${t.matches ? fixed(t.wickets / t.matches, 1) : '0.0'} per match`),
      kpi('Sixes', t.sixes, `${t.fours} fours`),
      kpi('Avg 1st innings', data.averageFirst ? Math.round(data.averageFirst) : '—', 'batting first'),
      kpi('Highest total', data.highest ? `${data.highest.runs}/${data.highest.wickets}` : '—', data.highest ? `${esc(data.highest.team)} v ${esc(data.highest.vs)}` : ''),
    ].join('');

    const runs = leadersBlock(data.runLeaders.map((row) => ({ ...row, sortValue: row.runs })), (row) => row.runs,
      (row) => `${esc(row.team)} · ${row.innings} inn · HS ${row.high} · SR ${fixed(row.strikeRate, 1)}`, 'No runs recorded yet.');
    const wickets = leadersBlock(data.wicketLeaders.map((row) => ({ ...row, sortValue: row.wickets })), (row) => row.wickets,
      (row) => `${esc(row.team)} · best ${row.best.w}/${row.best.r} · econ ${fixed(row.economy)}`, 'No wickets yet.');
    const sixes = leadersBlock(data.sixLeaders.map((row) => ({ ...row, sortValue: row.sixes })), (row) => row.sixes,
      (row) => `${esc(row.team)} · ${row.runs} runs · ${row.fours}×4`, 'No sixes yet.');
    const economy = leadersBlock(data.economyLeaders.map((row) => ({ ...row, sortValue: Math.max(0, 14 - row.economy) })), (row) => fixed(row.economy),
      (row) => `${esc(row.team)} · ${formatOvers(row.balls)} ov · ${row.wickets} wkts`, 'Needs a bowler with two completed overs.');

    const maxRate = Math.max(...data.teamRates.map((row) => row.rate), 1);
    const rates = data.teamRates.length ? `<ul class="mn-rows">${data.teamRates.map((row) => `<li><div class="mn-row-head"><strong>${esc(row.team)}</strong><small>${row.runs} runs</small><b>${fixed(row.rate)}</b></div>${bar(row.rate, maxRate)}</li>`).join('')}</ul>` : empty('Team scoring rates appear after the first match.');

    const records_ = [
      data.highest && ['Highest total', `${data.highest.runs}/${data.highest.wickets}`, `${esc(data.highest.team)} v ${esc(data.highest.vs)}`],
      data.lowest && ['Lowest all-out total', `${data.lowest.runs}`, `${esc(data.lowest.team)} v ${esc(data.lowest.vs)}`],
      data.bestRunWin && ['Biggest win batting first', `${data.bestRunWin.margin} runs`, `${esc(data.bestRunWin.team)} v ${esc(data.bestRunWin.vs)}`],
      data.bestChase && ['Biggest chase win', `${data.bestChase.margin} wickets`, `${esc(data.bestChase.team)} v ${esc(data.bestChase.vs)}`],
    ].filter(Boolean).map(([label, value, note]) => `<li><span>${label}</span><strong>${value}</strong><small>${note}</small></li>`).join('');

    return `
      <div class="mn-stats-head"><div><p class="mn-kicker">STATS CORNER</p><h2>Tournament insights</h2></div></div>
      <div class="mn-kpis">${kpis}</div>
      <div class="mn-leaders-grid mn-leaders-four">
        <article class="mn-chart-card"><header><h3>Top run-scorers</h3><span>RUNS</span></header>${runs}</article>
        <article class="mn-chart-card"><header><h3>Top wicket-takers</h3><span>WKTS</span></header>${wickets}</article>
        <article class="mn-chart-card"><header><h3>Most sixes</h3><span>SIXES</span></header>${sixes}</article>
        <article class="mn-chart-card"><header><h3>Best economy</h3><span>ECON</span></header>${economy}</article>
      </div>
      <div class="mn-chart-grid">
        <article class="mn-chart-card"><header><h3>Team scoring rate</h3><span>RUNS PER OVER</span></header>${rates}</article>
        <article class="mn-chart-card"><header><h3>Records</h3><span>SO FAR</span></header>${records_ ? `<ul class="mn-records">${records_}</ul>` : empty('Records appear once innings are complete.')}</article>
      </div>`;
  }

  M.stats = { analyzeInnings, matchStatsHtml, tournamentStats, tournamentStatsHtml, phasesFor, inningsTitle };
})();
