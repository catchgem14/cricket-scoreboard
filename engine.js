(() => {
  const M = (window.Maiden = window.Maiden || {});

  const FORMAT_RULES = {
    t20: { label: 'T20 International', short: 'T20I', defaultOvers: 20, bowlerOvers: 4, powerplayOvers: 6, deathOvers: 5 },
    odi: { label: 'One Day International', short: 'ODI', defaultOvers: 50, bowlerOvers: 10, powerplayOvers: 10, deathOvers: 10 },
    test: { label: 'Test', short: 'TEST', defaultOvers: null, bowlerOvers: null, powerplayOvers: null, deathOvers: null },
  };
  const BOWLER_WICKETS = new Set(['bowled', 'caught', 'lbw', 'stumped', 'hitWicket']);
  const NO_BALL_WICKETS = new Set(['runOut', 'obstructing', 'hitBallTwice']);
  const WICKET_LABELS = {
    bowled: 'Bowled', caught: 'Caught', lbw: 'LBW', runOut: 'Run out', stumped: 'Stumped',
    hitWicket: 'Hit wicket', hitBallTwice: 'Hit the ball twice', obstructing: 'Obstructing the field',
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  )[character]);

  const formatOvers = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;
  const clampRuns = (value, max = 10) => Math.min(max, Math.max(0, Math.round(Number(value) || 0)));

  function uid(prefix) {
    const bytes = new Uint8Array(6);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
    return `${prefix}_${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 9)}`;
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }

  // Breaks one delivery into its scoring parts; shared by scorecards, charts and standings.
  function deliveryInfo(delivery) {
    const noBall = Boolean(delivery.noBall);
    const wide = Boolean(delivery.wide && !noBall);
    const wideTotal = wide ? 1 + delivery.wideRuns : 0;
    const noBallPenalty = noBall ? 1 : 0;
    const extras = noBallPenalty + wideTotal + delivery.byes + delivery.legByes + delivery.penaltyRuns;
    return { noBall, wide, wideTotal, noBallPenalty, legal: !noBall && !wide, extras, total: delivery.batRuns + extras };
  }

  function getInningsStats(innings) {
    const stats = {
      runs: 0, wickets: 0, legalBalls: 0, extras: { noBall: 0, wide: 0, bye: 0, legBye: 0, penalty: 0 },
      batters: {}, bowlers: {}, falls: [], bowledOvers: {},
    };
    if (!innings) return stats;

    const batter = (id) => {
      if (!stats.batters[id]) stats.batters[id] = { id, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: '' };
      return stats.batters[id];
    };
    const bowler = (name) => {
      if (!stats.bowlers[name]) stats.bowlers[name] = { name, runs: 0, legalBalls: 0, wickets: 0, wides: 0, noBalls: 0, overRuns: {}, overBalls: {} };
      return stats.bowlers[name];
    };

    innings.deliveries.forEach((delivery) => {
      const striker = batter(delivery.strikerId);
      batter(delivery.nonStrikerId);
      const currentBowler = bowler(delivery.bowler);
      const info = deliveryInfo(delivery);
      stats.runs += info.total;
      stats.extras.noBall += info.noBallPenalty;
      stats.extras.wide += info.wideTotal;
      stats.extras.bye += delivery.byes;
      stats.extras.legBye += delivery.legByes;
      stats.extras.penalty += delivery.penaltyRuns;
      if (!info.wide) striker.balls += 1;
      striker.runs += delivery.batRuns;
      if (delivery.batRuns === 4) striker.fours += 1;
      if (delivery.batRuns === 6) striker.sixes += 1;
      const conceded = delivery.batRuns + info.noBallPenalty + info.wideTotal;
      currentBowler.runs += conceded;
      currentBowler.noBalls += info.noBall ? 1 : 0;
      currentBowler.wides += info.wide ? 1 : 0;
      currentBowler.legalBalls += info.legal ? 1 : 0;
      currentBowler.overRuns[delivery.overIndex] = (currentBowler.overRuns[delivery.overIndex] || 0) + conceded;
      currentBowler.overBalls[delivery.overIndex] = (currentBowler.overBalls[delivery.overIndex] || 0) + (info.legal ? 1 : 0);
      stats.bowledOvers[delivery.bowler] ||= new Set();
      stats.bowledOvers[delivery.bowler].add(delivery.overIndex);
      if (info.legal) stats.legalBalls += 1;
      if (delivery.wicket) {
        stats.wickets += 1;
        const dismissed = batter(delivery.dismissedId);
        dismissed.out = true;
        dismissed.dismissal = WICKET_LABELS[delivery.wicket] || delivery.wicket;
        if (BOWLER_WICKETS.has(delivery.wicket)) currentBowler.wickets += 1;
        stats.falls.push({ wickets: stats.wickets, runs: stats.runs, over: formatOvers(stats.legalBalls), player: innings.playerNames[delivery.dismissedId] || 'Batter' });
      }
    });

    // A maiden is a completed six-ball over with no runs charged to the bowler.
    Object.values(stats.bowlers).forEach((entry) => {
      entry.maidens = Object.keys(entry.overRuns).filter((over) => entry.overBalls[over] === 6 && entry.overRuns[over] === 0).length;
    });
    return stats;
  }

  function teamInnings(state, teamIndex, includeSuperOvers = false) {
    return state.innings.filter((innings) => innings.teamIndex === teamIndex && (includeSuperOvers || !innings.isSuperOver));
  }

  function teamRuns(state, teamIndex, includeSuperOvers = false) {
    return teamInnings(state, teamIndex, includeSuperOvers).reduce((total, innings) => total + getInningsStats(innings).runs, 0);
  }

  // Runs the innings at `index` must reach to win, or null when it is not a chase.
  function targetFor(state, index) {
    const innings = state.innings[index];
    if (!innings) return null;
    if (innings.isSuperOver) {
      if (index !== state.superOverStart + 1) return null;
      return getInningsStats(state.innings[state.superOverStart]).runs + 1;
    }
    if (state.format !== 'test' && index === 1) return getInningsStats(state.innings[0]).runs + 1;
    if (state.format === 'test' && index === 3) {
      const earlier = state.innings.filter((item, position) => position < index && !item.isSuperOver);
      const own = earlier.filter((item) => item.teamIndex === innings.teamIndex).reduce((total, item) => total + getInningsStats(item).runs, 0);
      const opposition = earlier.filter((item) => item.teamIndex !== innings.teamIndex).reduce((total, item) => total + getInningsStats(item).runs, 0);
      return opposition - own + 1;
    }
    return null;
  }

  // Short score text such as "168/7 (20.0)" or "312 & 118/3" for one side of a match.
  function teamScoreText(state, teamIndex) {
    const list = teamInnings(state, teamIndex);
    if (!list.length) return 'Yet to bat';
    const parts = list.map((innings) => {
      const stats = getInningsStats(innings);
      const wickets = stats.wickets >= innings.maxWickets && innings.maxWickets === 10 ? '' : `/${stats.wickets}`;
      return state.format === 'test' ? `${stats.runs}${wickets}` : `${stats.runs}/${stats.wickets} (${formatOvers(stats.legalBalls)})`;
    });
    return parts.join(' & ');
  }

  function matchTitle(state) {
    return `${state.teams[0]} v ${state.teams[1]}`;
  }

  function statusLabel(state) {
    if (state.status === 'playing') return state.innings[state.currentIndex]?.isSuperOver ? 'Super over' : 'Live';
    if (state.status === 'innings-break') return 'Innings break';
    if (state.status === 'complete') return 'Result';
    return 'Not started';
  }

  M.engine = {
    FORMAT_RULES, BOWLER_WICKETS, NO_BALL_WICKETS, WICKET_LABELS,
    escapeHtml, formatOvers, clampRuns, uid, initials, relativeTime,
    deliveryInfo, getInningsStats, teamInnings, teamRuns, targetFor, teamScoreText, matchTitle, statusLabel,
  };
})();
