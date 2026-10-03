const STORAGE_KEY = 'cricnova-match-state-v1';
const FORMAT_RULES = {
  t20: { label: 'T20 International', short: 'T20I', defaultOvers: 20, bowlerOvers: 4, powerplayOvers: 6 },
  odi: { label: 'One Day International', short: 'ODI', defaultOvers: 50, bowlerOvers: 10, powerplayOvers: 10 },
  test: { label: 'Test', short: 'TEST', defaultOvers: null, bowlerOvers: null, powerplayOvers: null },
};
const BOWLER_WICKETS = new Set(['bowled', 'caught', 'lbw', 'stumped', 'hitWicket']);
const NO_BALL_WICKETS = new Set(['runOut', 'obstructing', 'hitBallTwice']);
const WICKET_LABELS = {
  bowled: 'Bowled', caught: 'Caught', lbw: 'LBW', runOut: 'Run out', stumped: 'Stumped',
  hitWicket: 'Hit wicket', hitBallTwice: 'Hit the ball twice', obstructing: 'Obstructing the field',
};

const $ = (id) => document.getElementById(id);
const refs = {
  setupForm: $('setupForm'), formatInput: $('formatInput'), oversInput: $('oversInput'), oversField: $('oversField'),
  teamAInput: $('teamAInput'), teamBInput: $('teamBInput'), tossWinnerInput: $('tossWinnerInput'),
  tossDecisionInput: $('tossDecisionInput'), openerInput: $('openerInput'), nonStrikerInput: $('nonStrikerInput'),
  bowlerInput: $('bowlerInput'), setupPanel: $('setupPanel'), inPlayPanel: $('inPlayPanel'), scoringPanel: $('scoringPanel'),
  inningsLabel: $('inningsLabel'), formatBadge: $('formatBadge'), matchStatus: $('matchStatus'), battingTeamName: $('battingTeamName'),
  bowlingTeamName: $('bowlingTeamName'), runsValue: $('runsValue'), wicketsValue: $('wicketsValue'), oversValue: $('oversValue'),
  runRateValue: $('runRateValue'), targetLabel: $('targetLabel'), targetValue: $('targetValue'), requiredValue: $('requiredValue'),
  overBalls: $('overBalls'), overStatus: $('overStatus'), resultBanner: $('resultBanner'), battingRows: $('battingRows'),
  bowlingRows: $('bowlingRows'), battingExtras: $('battingExtras'), extrasBreakdown: $('extrasBreakdown'), fallOfWickets: $('fallOfWickets'),
  bowlerQuota: $('bowlerQuota'), commentaryList: $('commentaryList'), deliveryCount: $('deliveryCount'), inningsList: $('inningsList'),
  matchFormatFact: $('matchFormatFact'), inningsFact: $('inningsFact'), phaseFact: $('phaseFact'), quotaFact: $('quotaFact'),
  activeStriker: $('activeStriker'), activeNonStriker: $('activeNonStriker'), activeBowler: $('activeBowler'), bowlerOptions: $('bowlerOptions'),
  endInningsBtn: $('endInningsBtn'), continueBtn: $('continueBtn'), followOnOptions: $('followOnOptions'), followOnCopy: $('followOnCopy'),
  followOnBtn: $('followOnBtn'), drawBtn: $('drawBtn'), superOverBtn: $('superOverBtn'), freeHitNotice: $('freeHitNotice'),
  undoBtn: $('undoBtn'), actionMessage: $('actionMessage'), deliveryDialog: $('deliveryDialog'), detailBatRuns: $('detailBatRuns'), detailWideRuns: $('detailWideRuns'),
  detailNoBall: $('detailNoBall'), detailWide: $('detailWide'), detailByes: $('detailByes'), detailLegByes: $('detailLegByes'),
  detailPenalty: $('detailPenalty'), detailWicket: $('detailWicket'), dismissalFields: $('dismissalFields'), detailDismissed: $('detailDismissed'),
  incomingBatter: $('incomingBatter'), dialogMessage: $('dialogMessage'), toast: $('toast'),
};

function freshState() {
  return { started: false, status: 'setup', format: 't20', overs: 20, teams: ['Team A', 'Team B'], battingFirst: 0,
    inningsOrder: [], innings: [], currentIndex: -1, result: null, followOn: false, superOverRound: 0, superOverStart: -1 };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.innings)) return freshState();
    const restored = { ...freshState(), ...saved };
    if (restored.started && restored.currentIndex < 0 && restored.innings.length) restored.currentIndex = 0;
    return restored;
  } catch (error) {
    return freshState();
  }
}

let state = loadState();
let toastTimer;

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast('This browser could not save the match locally.');
  }
}

function clampRuns(value, max = 10) {
  return Math.min(max, Math.max(0, Math.round(Number(value) || 0)));
}

function makeInnings(teamIndex, number, oversLimit, strikerName, nonStrikerName, bowlerName, options = {}) {
  return {
    teamIndex, number, oversLimit, isSuperOver: Boolean(options.isSuperOver), superOverRound: options.superOverRound || 0,
    maxWickets: options.isSuperOver ? 2 : 10, completed: false, deliveries: [], playerNames: { striker: strikerName, nonStriker: nonStrikerName },
    striker: 'striker', nonStriker: 'nonStriker', currentBowler: bowlerName, lastOverBowler: '', freeHitPending: false,
  };
}

function activeInnings() {
  return state.currentIndex >= 0 ? state.innings[state.currentIndex] : null;
}

function formatOvers(balls) {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function getInningsStats(innings) {
  const stats = { runs: 0, wickets: 0, legalBalls: 0, extras: { noBall: 0, wide: 0, bye: 0, legBye: 0, penalty: 0 },
    batters: {}, bowlers: {}, falls: [], bowledOvers: {}, overEvents: [] };
  if (!innings) return stats;

  const batter = (id) => {
    if (!stats.batters[id]) stats.batters[id] = { id, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: '' };
    return stats.batters[id];
  };
  const bowler = (name) => {
    if (!stats.bowlers[name]) stats.bowlers[name] = { name, runs: 0, legalBalls: 0, wickets: 0, wides: 0, noBalls: 0, overRuns: {} };
    return stats.bowlers[name];
  };

  innings.deliveries.forEach((delivery) => {
    const striker = batter(delivery.strikerId);
    batter(delivery.nonStrikerId);
    const currentBowler = bowler(delivery.bowler);
    const noBall = Boolean(delivery.noBall);
    const wide = Boolean(delivery.wide && !noBall);
    const wideTotal = wide ? 1 + delivery.wideRuns : 0;
    const noBallPenalty = noBall ? 1 : 0;
    const legal = !noBall && !wide;
    const totalRuns = delivery.batRuns + noBallPenalty + wideTotal + delivery.byes + delivery.legByes + delivery.penaltyRuns;
    stats.runs += totalRuns;
    stats.extras.noBall += noBallPenalty;
    stats.extras.wide += wideTotal;
    stats.extras.bye += delivery.byes;
    stats.extras.legBye += delivery.legByes;
    stats.extras.penalty += delivery.penaltyRuns;
    if (!wide) striker.balls += 1;
    striker.runs += delivery.batRuns;
    if (delivery.batRuns === 4) striker.fours += 1;
    if (delivery.batRuns === 6) striker.sixes += 1;
    currentBowler.runs += delivery.batRuns + noBallPenalty + wideTotal;
    currentBowler.runs += 0;
    currentBowler.noBalls += noBall ? 1 : 0;
    currentBowler.wides += wide ? 1 : 0;
    currentBowler.legalBalls += legal ? 1 : 0;
    currentBowler.overRuns[delivery.overIndex] = (currentBowler.overRuns[delivery.overIndex] || 0) + delivery.batRuns + noBallPenalty + wideTotal;
    stats.bowledOvers[delivery.bowler] ||= new Set();
    stats.bowledOvers[delivery.bowler].add(delivery.overIndex);
    stats.overEvents.push({ ...delivery, totalRuns, legal, wideTotal, noBallPenalty });
    if (legal) stats.legalBalls += 1;
    if (delivery.wicket) {
      stats.wickets += 1;
      const dismissed = batter(delivery.dismissedId);
      dismissed.out = true;
      dismissed.dismissal = WICKET_LABELS[delivery.wicket] || delivery.wicket;
      if (BOWLER_WICKETS.has(delivery.wicket)) currentBowler.wickets += 1;
      stats.falls.push({ wickets: stats.wickets, runs: stats.runs, over: formatOvers(stats.legalBalls), player: innings.playerNames[delivery.dismissedId] || 'Batter' });
    }
  });

  Object.values(stats.bowlers).forEach((currentBowler) => {
    currentBowler.maidens = Object.values(currentBowler.overRuns).filter((runs) => runs === 0).length;
  });
  return stats;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => refs.toast.classList.remove('is-visible'), 2600);
}

function showMessage(message) {
  refs.actionMessage.textContent = message;
  refs.actionMessage.classList.toggle('is-error', Boolean(message));
}

function currentTarget() {
  const innings = activeInnings();
  if (!innings) return null;
  if (innings.isSuperOver) {
    if (state.currentIndex !== state.superOverStart + 1) return null;
    return getInningsStats(state.innings[state.superOverStart]).runs + 1;
  }
  if (state.format !== 'test' && state.currentIndex === 1) return getInningsStats(state.innings[0]).runs + 1;
  if (state.format === 'test' && state.currentIndex === 3) {
    const battingTeam = innings.teamIndex;
    const ownRuns = state.innings.filter((item, index) => index < state.currentIndex && item.teamIndex === battingTeam && !item.isSuperOver)
      .reduce((total, item) => total + getInningsStats(item).runs, 0);
    const opponentRuns = state.innings.filter((item, index) => index < state.currentIndex && item.teamIndex !== battingTeam && !item.isSuperOver)
      .reduce((total, item) => total + getInningsStats(item).runs, 0);
    return opponentRuns - ownRuns + 1;
  }
  return null;
}

function teamRuns(teamIndex, includeSuperOvers = false) {
  return state.innings.reduce((total, innings) => {
    if (innings.teamIndex !== teamIndex || (!includeSuperOvers && innings.isSuperOver)) return total;
    return total + getInningsStats(innings).runs;
  }, 0);
}

function oversLimitFor(innings) {
  if (innings.isSuperOver) return 1;
  return innings.oversLimit;
}

function maxBowlerOvers(innings) {
  if (innings.isSuperOver) return 1;
  if (state.format === 'test') return null;
  return Math.ceil(innings.oversLimit / 5);
}

function makeDelivery(input) {
  const innings = activeInnings();
  if (!innings || state.status !== 'playing' || innings.completed) return;
  const statsBefore = getInningsStats(innings);
  const noBall = Boolean(input.noBall);
  const wide = Boolean(input.wide && !noBall);
  const batRuns = clampRuns(input.batRuns, 6);
  const wideRuns = wide ? clampRuns(input.wideRuns, 6) : 0;
  const byes = clampRuns(input.byes, 6);
  const legByes = clampRuns(input.legByes, 6);
  const penaltyRuns = clampRuns(input.penaltyRuns, 10);
  const wicket = input.wicket || '';
  const wasFreeHit = innings.freeHitPending;
  const bowlerName = (refs.activeBowler.value || innings.currentBowler).trim();
  const legal = !noBall && !wide;
  const overIndex = Math.floor(statsBefore.legalBalls / 6);

  if (!bowlerName) return showMessage('Enter the bowler for this over.');
  if (wide && (batRuns || byes || legByes)) return showMessage('Record running wide runs with the wide-run field only.');
  if (byes && legByes) return showMessage('Choose byes or leg-byes for one delivery, not both.');
  if ((byes || legByes) && batRuns) return showMessage('A delivery cannot score both bat runs and byes.');
  if (wicket && statsBefore.wickets >= innings.maxWickets) return showMessage('The innings has no wickets remaining.');
  if (wicket && (noBall || wasFreeHit) && !NO_BALL_WICKETS.has(wicket)) return showMessage('On a no-ball or free hit, only Run out, Hit the ball twice, or Obstructing the field can be recorded.');

  const ballsInOver = innings.deliveries.filter((delivery) => delivery.overIndex === overIndex);
  if (ballsInOver.length && ballsInOver[0].bowler !== bowlerName) return showMessage('One bowler must complete the over.');
  if (!ballsInOver.length && innings.lastOverBowler && innings.lastOverBowler === bowlerName) return showMessage('The same bowler cannot bowl consecutive overs.');
  const quota = maxBowlerOvers(innings);
  const bowlerOvers = statsBefore.bowledOvers[bowlerName] || new Set();
  if (quota !== null && !bowlerOvers.has(overIndex) && bowlerOvers.size >= quota) return showMessage(`${bowlerName} has reached the ${quota}-over limit.`);

  const strikerId = innings.striker;
  const nonStrikerId = innings.nonStriker;
  const dismissedId = wicket ? (input.dismissed === 'nonStriker' ? nonStrikerId : strikerId) : '';
  const wicketNumber = statsBefore.wickets + 1;
  const incomingId = wicket && wicketNumber < innings.maxWickets ? `batter-${innings.deliveries.length + 3}` : '';
  const incomingName = input.incomingName?.trim() || `Batter ${wicketNumber + 2}`;
  const delivery = {
    batRuns, noBall, wide, wideRuns, byes, legByes, penaltyRuns, wicket, dismissedId,
    strikerId, nonStrikerId, bowler: bowlerName, overIndex, ballInOver: statsBefore.legalBalls % 6 + 1, wasFreeHit,
    incomingId, incomingName, at: Date.now(),
  };

  innings.deliveries.push(delivery);
  innings.currentBowler = bowlerName;
  if (incomingId) innings.playerNames[incomingId] = incomingName;
  const runningRuns = batRuns + byes + legByes + wideRuns;
  if (runningRuns % 2 === 1) [innings.striker, innings.nonStriker] = [innings.nonStriker, innings.striker];
  const statsAfter = getInningsStats(innings);
  if (legal && statsAfter.legalBalls > 0 && statsAfter.legalBalls % 6 === 0) {
    [innings.striker, innings.nonStriker] = [innings.nonStriker, innings.striker];
    innings.lastOverBowler = bowlerName;
    innings.currentBowler = '';
  }
  if (wicket && incomingId) {
    if (innings.striker === dismissedId) innings.striker = incomingId;
    else if (innings.nonStriker === dismissedId) innings.nonStriker = incomingId;
  }
  if (noBall) innings.freeHitPending = true;
  else if (legal) innings.freeHitPending = false;

  const totalNow = getInningsStats(innings).runs;
  const target = currentTarget();
  if (target && totalNow >= target && (innings.isSuperOver || state.format !== 'test' || state.currentIndex === 3)) {
    setChaseResult(innings, totalNow, target);
  } else {
    const updated = getInningsStats(innings);
    const limit = oversLimitFor(innings);
    if (updated.wickets >= innings.maxWickets || (limit !== null && updated.legalBalls >= limit * 6)) {
      closeInnings();
    }
  }
  showMessage('');
  saveState();
  render();
}

function setChaseResult(innings, score, target) {
  const opposition = 1 - innings.teamIndex;
  const wicketsLeft = innings.maxWickets - getInningsStats(innings).wickets;
  const margin = score - target;
  state.result = { winner: innings.teamIndex, text: `${state.teams[innings.teamIndex]} won by ${wicketsLeft} wicket${wicketsLeft === 1 ? '' : 's'}.`, tied: false, margin };
  state.status = 'complete';
  innings.completed = true;
  void opposition;
}

function limitedResult() {
  const first = state.innings.filter((innings) => !innings.isSuperOver).slice(-2);
  if (first.length < 2) return;
  const scores = first.map((innings) => getInningsStats(innings).runs);
  if (scores[0] === scores[1]) {
    state.result = { winner: null, tied: true, text: 'The match is tied.' };
  } else {
    const winnerIndex = scores[0] > scores[1] ? first[0].teamIndex : first[1].teamIndex;
    const loserScore = scores[0] > scores[1] ? scores[1] : scores[0];
    const winnerScore = Math.max(...scores);
    state.result = { winner: winnerIndex, tied: false, text: `${state.teams[winnerIndex]} won by ${winnerScore - loserScore} run${winnerScore - loserScore === 1 ? '' : 's'}.` };
  }
  state.status = 'complete';
}

function superOverResult() {
  const first = state.innings[state.superOverStart];
  const second = state.innings[state.superOverStart + 1];
  if (!first || !second) return;
  const firstScore = getInningsStats(first).runs;
  const secondScore = getInningsStats(second).runs;
  if (firstScore === secondScore) {
    state.result = { winner: null, tied: true, text: `Super Over ${state.superOverRound} is tied.` };
  } else {
    const winnerIndex = firstScore > secondScore ? first.teamIndex : second.teamIndex;
    state.result = { winner: winnerIndex, tied: false, text: `${state.teams[winnerIndex]} won Super Over ${state.superOverRound}.` };
  }
  state.status = 'complete';
}

function closeInnings() {
  const innings = activeInnings();
  if (!innings || innings.completed) return;
  innings.completed = true;
  state.status = 'innings-break';
  if (innings.isSuperOver && state.currentIndex === state.superOverStart + 1) superOverResult();
  else if (state.format !== 'test' && !innings.isSuperOver && state.currentIndex === 1) limitedResult();
  else if (state.format === 'test' && state.currentIndex === 3) {
    const totals = [teamRuns(0), teamRuns(1)];
    if (totals[0] === totals[1]) state.result = { winner: null, tied: true, text: 'The Test match is tied.' };
    else {
      const winnerIndex = totals[0] > totals[1] ? 0 : 1;
      state.result = { winner: winnerIndex, tied: false, text: `${state.teams[winnerIndex]} won by ${Math.abs(totals[0] - totals[1])} run${Math.abs(totals[0] - totals[1]) === 1 ? '' : 's'}.` };
    }
    state.status = 'complete';
  }
}

function startMatch(event) {
  event.preventDefault();
  const format = refs.formatInput.value;
  const rules = FORMAT_RULES[format];
  const teams = [refs.teamAInput.value.trim(), refs.teamBInput.value.trim()];
  if (!teams[0] || !teams[1] || teams[0].toLowerCase() === teams[1].toLowerCase()) {
    showToast('Enter two different team names.');
    return;
  }
  const tossWinner = Number(refs.tossWinnerInput.value);
  const battingFirst = refs.tossDecisionInput.value === 'bat' ? tossWinner : 1 - tossWinner;
  const overs = format === 'test' ? null : clampRuns(refs.oversInput.value, rules.defaultOvers);
  if (format !== 'test' && overs < 1) return showToast('Overs must be at least one.');
  state = freshState();
  state.started = true;
  state.status = 'playing';
  state.format = format;
  state.overs = overs;
  state.teams = teams;
  state.battingFirst = battingFirst;
  state.inningsOrder = format === 'test' ? [battingFirst, 1 - battingFirst, battingFirst, 1 - battingFirst] : [battingFirst, 1 - battingFirst];
  state.innings.push(makeInnings(battingFirst, 1, overs, refs.openerInput.value.trim() || 'Batter 1', refs.nonStrikerInput.value.trim() || 'Batter 2', refs.bowlerInput.value.trim() || 'Bowler 1'));
  state.currentIndex = 0;
  saveState();
  render();
}

function startNextInnings(useFollowOn = false) {
  const nextIndex = state.innings.length;
  const previous = activeInnings();
  if (!previous?.completed) return;
  if (previous.isSuperOver && nextIndex === state.superOverStart + 1) {
    state.innings.push(makeInnings(1 - previous.teamIndex, 1, 1, 'Batter 1', 'Batter 2', 'Bowler 1', { isSuperOver: true, superOverRound: state.superOverRound }));
    state.currentIndex = nextIndex;
    state.status = 'playing';
  } else if (previous.isSuperOver) {
    startSuperOver();
    return;
  } else {
    if (state.format === 'test' && nextIndex === 2 && useFollowOn) {
      state.inningsOrder = [state.inningsOrder[0], state.inningsOrder[1], state.inningsOrder[1], state.inningsOrder[0]];
      state.followOn = true;
    }
    const teamIndex = state.inningsOrder[nextIndex];
    if (teamIndex === undefined) return;
    const number = state.innings.filter((innings) => innings.teamIndex === teamIndex && !innings.isSuperOver).length + 1;
    const name = state.teams[teamIndex];
    state.innings.push(makeInnings(teamIndex, number, state.format === 'test' ? null : state.overs, `${name} batter ${number * 2 - 1}`, `${name} batter ${number * 2}`, `${state.teams[1 - teamIndex]} bowler 1`));
    state.currentIndex = nextIndex;
    state.status = 'playing';
  }
  state.result = null;
  saveState();
  render();
}

function startSuperOver() {
  const previous = state.innings[state.innings.length - 1];
  if (!previous) return;
  state.superOverRound += 1;
  state.superOverStart = state.innings.length;
  const firstTeam = state.superOverRound % 2 ? state.battingFirst : 1 - state.battingFirst;
  state.innings.push(makeInnings(firstTeam, 1, 1, 'Batter 1', 'Batter 2', 'Bowler 1', { isSuperOver: true, superOverRound: state.superOverRound }));
  state.currentIndex = state.innings.length - 1;
  state.status = 'playing';
  state.result = null;
  saveState();
  render();
}

function undoDelivery() {
  const innings = activeInnings();
  if (!innings?.deliveries.length) return showMessage('There is no delivery to undo.');
  const removed = innings.deliveries.pop();
  innings.playerNames = { striker: innings.playerNames.striker, nonStriker: innings.playerNames.nonStriker };
  innings.striker = removed.strikerId;
  innings.nonStriker = removed.nonStrikerId;
  innings.currentBowler = removed.bowler;
  innings.lastOverBowler = '';
  innings.freeHitPending = false;
  innings.completed = false;
  state.status = 'playing';
  state.result = null;
  rebuildRuntimeState(innings);
  saveState();
  render();
}

function rebuildRuntimeState(innings) {
  let freeHit = false;
  let lastOverBowler = '';
  for (const delivery of innings.deliveries) {
    if (delivery.noBall) freeHit = true;
    else if (!delivery.wide) freeHit = false;
    if (delivery.overIndex !== innings.deliveries[innings.deliveries.length - 1]?.overIndex) lastOverBowler = delivery.bowler;
  }
  innings.freeHitPending = freeHit;
  const stats = getInningsStats(innings);
  const last = innings.deliveries[innings.deliveries.length - 1];
  innings.lastOverBowler = last && stats.legalBalls > 0 && stats.legalBalls % 6 === 0 ? last.bowler : lastOverBowler;
}

function changeActiveName(role, value) {
  const innings = activeInnings();
  if (!innings) return;
  const name = value.trim();
  if (!name) return render();
  innings.playerNames[innings[role]] = name;
  saveState();
  render();
}

function changeBowler(value) {
  const innings = activeInnings();
  if (!innings) return;
  const next = value.trim();
  const stats = getInningsStats(innings);
  const overIndex = Math.floor(stats.legalBalls / 6);
  const thisOver = innings.deliveries.filter((delivery) => delivery.overIndex === overIndex);
  if (thisOver.length && thisOver[0].bowler !== next) {
    showToast('The current bowler must complete this over.');
    refs.activeBowler.value = innings.currentBowler;
    return;
  }
  innings.currentBowler = next;
  saveState();
}

function openDeliveryDialog(wicket = '') {
  const innings = activeInnings();
  if (!innings || state.status !== 'playing') return;
  refs.detailBatRuns.value = '0';
  refs.detailWideRuns.value = '0';
  refs.detailNoBall.checked = false;
  refs.detailWide.checked = false;
  refs.detailByes.value = '0';
  refs.detailLegByes.value = '0';
  refs.detailPenalty.value = '0';
  refs.detailWicket.value = wicket;
  refs.detailDismissed.value = 'striker';
  refs.incomingBatter.value = `Batter ${getInningsStats(innings).wickets + 3}`;
  refs.dialogMessage.textContent = '';
  updateDismissalFields();
  refs.deliveryDialog.showModal();
}

function updateDismissalFields() {
  const hasWicket = Boolean(refs.detailWicket.value);
  refs.dismissalFields.hidden = !hasWicket;
  const incomingInput = refs.incomingBatter;
  incomingInput.disabled = !hasWicket;
}

function submitDetailedDelivery() {
  const wicket = refs.detailWicket.value;
  const innings = activeInnings();
  const dismissed = refs.detailDismissed.value;
  makeDelivery({
    batRuns: refs.detailBatRuns.value,
    wideRuns: refs.detailWideRuns.value,
    noBall: refs.detailNoBall.checked,
    wide: refs.detailWide.checked,
    byes: refs.detailByes.value,
    legByes: refs.detailLegByes.value,
    penaltyRuns: refs.detailPenalty.value,
    wicket,
    dismissed,
    incomingName: refs.incomingBatter.value,
  });
  if (state.status !== 'playing' || activeInnings() !== innings || refs.actionMessage.textContent === '') refs.deliveryDialog.close();
  else refs.dialogMessage.textContent = refs.actionMessage.textContent;
}

function getPhase(innings, stats) {
  if (state.format === 'test') return `Day 1 · ${formatOvers(stats.legalBalls)} overs`;
  const overs = stats.legalBalls / 6;
  if (state.format === 't20') return overs < 6 ? 'Powerplay' : 'Middle overs';
  if (overs < 10) return 'Powerplay 1';
  if (overs < 40) return 'Middle overs';
  return 'Powerplay 3 · death overs';
}

function renderBatting(innings, stats) {
  const rows = Object.values(stats.batters);
  const currentIds = new Set([innings.striker, innings.nonStriker]);
  const presentIds = new Set(rows.map((row) => row.id));
  [innings.striker, innings.nonStriker].forEach((id) => {
    if (!presentIds.has(id)) rows.push({ id, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: '' });
  });
  rows.sort((a, b) => Number(currentIds.has(b.id)) - Number(currentIds.has(a.id)));
  refs.battingRows.innerHTML = rows.map((row) => {
    const current = row.id === innings.striker ? ' *' : '';
    const status = row.out ? escapeHtml(row.dismissal) : (currentIds.has(row.id) ? 'not out' : 'did not bat');
    const strikeRate = row.balls ? (row.runs / row.balls * 100).toFixed(1) : '0.0';
    return `<tr class="${row.id === innings.striker ? 'is-striker' : ''}"><td><strong>${escapeHtml(innings.playerNames[row.id] || 'Batter')}${current}</strong><small>${status}</small></td><td>${row.runs}</td><td>${row.balls}</td><td>${row.fours}</td><td>${row.sixes}</td><td>${strikeRate}</td></tr>`;
  }).join('');
  refs.battingExtras.textContent = `Extras ${stats.runs - Object.values(stats.batters).reduce((total, row) => total + row.runs, 0)}`;
  refs.fallOfWickets.textContent = stats.falls.length ? stats.falls.map((fall) => `${fall.wickets}-${fall.runs} (${fall.player}, ${fall.over})`).join(' · ') : '—';
}

function renderBowling(innings, stats) {
  const bowlers = Object.values(stats.bowlers);
  if (innings.currentBowler && !stats.bowlers[innings.currentBowler]) bowlers.push({ name: innings.currentBowler, runs: 0, legalBalls: 0, maidens: 0, wickets: 0 });
  refs.bowlingRows.innerHTML = bowlers.map((bowler) => {
    const overs = formatOvers(bowler.legalBalls);
    const economy = bowler.legalBalls ? (bowler.runs / (bowler.legalBalls / 6)).toFixed(2) : '0.00';
    return `<tr><td><strong>${escapeHtml(bowler.name)}</strong></td><td>${overs}</td><td>${bowler.maidens || 0}</td><td>${bowler.runs}</td><td>${bowler.wickets}</td><td>${economy}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="cn-empty-cell">No bowler recorded yet.</td></tr>';
  const quota = maxBowlerOvers(innings);
  refs.bowlerQuota.textContent = quota === null ? 'No innings quota' : `Limit ${quota} overs`;
  refs.quotaFact.textContent = quota === null ? 'No limit' : `${quota} overs`;
  const bowlersList = [...new Set(innings.deliveries.map((delivery) => delivery.bowler))];
  refs.bowlerOptions.innerHTML = bowlersList.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
}

function eventLabel(delivery) {
  const wide = delivery.wide && !delivery.noBall;
  const pieces = [];
  if (delivery.noBall) pieces.push('NB');
  else if (wide) pieces.push('WD');
  if (delivery.batRuns) pieces.push(String(delivery.batRuns));
  if (delivery.wideRuns) pieces.push(`+${delivery.wideRuns}`);
  if (delivery.byes) pieces.push(`B${delivery.byes}`);
  if (delivery.legByes) pieces.push(`LB${delivery.legByes}`);
  if (delivery.penaltyRuns) pieces.push(`P${delivery.penaltyRuns}`);
  if (delivery.wicket) pieces.push('W');
  return pieces.join(' ') || '·';
}

function renderCommentary(innings, stats) {
  const deliveries = innings.deliveries.slice(-30).reverse();
  refs.deliveryCount.textContent = `${innings.deliveries.length} entr${innings.deliveries.length === 1 ? 'y' : 'ies'}`;
  if (!deliveries.length) {
    refs.commentaryList.innerHTML = '<li class="cn-empty-cell">Ball-by-ball entries will appear here.</li>';
    return;
  }
  refs.commentaryList.innerHTML = deliveries.map((delivery) => {
    const note = delivery.wicket ? `${WICKET_LABELS[delivery.wicket]} · ${innings.playerNames[delivery.dismissedId] || 'Batter'}`
      : delivery.noBall ? 'No-ball · next legal delivery is a free hit'
        : delivery.wide && !delivery.noBall ? 'Wide · does not count as a legal ball'
          : delivery.byes ? 'Byes' : delivery.legByes ? 'Leg-byes' : `${innings.playerNames[delivery.strikerId] || 'Batter'} off the bat`;
    return `<li><span class="cn-commentary-over">${delivery.overIndex}.${delivery.ballInOver}</span><span class="cn-event-pill">${escapeHtml(eventLabel(delivery))}</span><span class="cn-commentary-copy">${escapeHtml(note)}</span><span class="cn-commentary-bowler">${escapeHtml(delivery.bowler)}</span></li>`;
  }).join('');
}

function renderOver(innings, stats) {
  const lastIndex = stats.legalBalls > 0 ? Math.floor((stats.legalBalls - 1) / 6) : 0;
  const events = innings.deliveries.filter((delivery) => delivery.overIndex === lastIndex);
  refs.overBalls.innerHTML = events.length ? events.map((delivery) => `<span class="cn-ball ${delivery.wicket ? 'is-wicket' : ''} ${delivery.noBall ? 'is-extra' : ''} ${delivery.wide && !delivery.noBall ? 'is-extra' : ''}">${escapeHtml(eventLabel(delivery))}</span>`).join('') : '<span class="cn-ball-empty">—</span>';
  refs.overStatus.textContent = events.length ? `${events.filter((delivery) => !delivery.noBall && !delivery.wide).length} legal ball${events.filter((delivery) => !delivery.noBall && !delivery.wide).length === 1 ? '' : 's'}` : 'Waiting for first ball';
}

function renderInningsList() {
  refs.inningsList.innerHTML = state.innings.map((innings, index) => {
    const stats = getInningsStats(innings);
    const label = innings.isSuperOver ? `Super Over ${innings.superOverRound} · innings ${index === state.superOverStart ? '1' : '2'}` : `Innings ${innings.number}`;
    const current = index === state.currentIndex;
    return `<li class="${current ? 'is-current' : ''}"><span><small>${label}</small><strong>${escapeHtml(state.teams[innings.teamIndex])}</strong></span><b>${stats.runs}/${stats.wickets}</b><em>${innings.completed ? 'COMPLETE' : current ? 'LIVE' : '—'}</em></li>`;
  }).join('') || '<li>Match innings will show here.</li>';
}

function render() {
  const innings = activeInnings();
  const inMatch = state.started && innings;
  refs.setupPanel.hidden = Boolean(state.started);
  refs.inPlayPanel.hidden = !state.started;
  refs.scoringPanel.hidden = !inMatch || state.status !== 'playing';
  refs.inningsList.closest('.cn-innings-panel').hidden = !state.started;
  refs.formatBadge.textContent = FORMAT_RULES[state.format]?.short || 'T20I';
  refs.matchStatus.innerHTML = `<i></i> ${state.status === 'playing' ? (innings?.isSuperOver ? 'SUPER OVER' : 'LIVE') : state.status === 'complete' ? 'RESULT' : state.started ? 'INNINGS BREAK' : 'SETUP'}`;
  refs.matchStatus.className = `cn-status ${state.status === 'playing' ? 'is-live' : state.status === 'complete' ? 'is-result' : ''}`;
  refs.resultBanner.hidden = !state.result;
  refs.resultBanner.textContent = state.result?.text || '';
  if (!inMatch) {
    refs.battingTeamName.textContent = 'Batting side';
    refs.bowlingTeamName.textContent = 'Fielding side';
    refs.inningsLabel.textContent = 'Set up a match to begin';
    refs.runsValue.textContent = '0'; refs.wicketsValue.textContent = '0'; refs.oversValue.textContent = '0.0'; refs.runRateValue.textContent = '0.00';
    refs.targetLabel.textContent = 'FIRST INNINGS'; refs.targetValue.textContent = 'No target'; refs.requiredValue.textContent = '';
    refs.inningsFact.textContent = '—'; refs.matchFormatFact.textContent = FORMAT_RULES[state.format].short; refs.phaseFact.textContent = '—'; refs.quotaFact.textContent = '—';
    refs.battingRows.innerHTML = '<tr><td colspan="6" class="cn-empty-cell">Player figures appear when a match starts.</td></tr>';
    refs.bowlingRows.innerHTML = '<tr><td colspan="6" class="cn-empty-cell">Bowler figures appear when a match starts.</td></tr>';
    refs.overBalls.innerHTML = '<span class="cn-ball-empty">—</span>';
    refs.commentaryList.innerHTML = '<li class="cn-empty-cell">Ball-by-ball entries will appear here.</li>';
    refs.inningsList.innerHTML = '<li>Match innings will show here.</li>';
    refs.freeHitNotice.hidden = true;
    refs.continueBtn.hidden = true; refs.followOnOptions.hidden = true; refs.drawBtn.hidden = true; refs.superOverBtn.hidden = true;
    return;
  }

  const stats = getInningsStats(innings);
  const rules = FORMAT_RULES[state.format];
  const target = currentTarget();
  const overs = `${formatOvers(stats.legalBalls)}${innings.oversLimit ? ` / ${innings.oversLimit}` : ''}`;
  const currentTeam = state.teams[innings.teamIndex];
  refs.battingTeamName.textContent = currentTeam;
  refs.bowlingTeamName.textContent = state.teams[1 - innings.teamIndex];
  refs.inningsLabel.textContent = `${innings.isSuperOver ? `Super Over ${innings.superOverRound}` : `${currentTeam} · innings ${innings.number}`}`;
  refs.runsValue.textContent = stats.runs;
  refs.wicketsValue.textContent = stats.wickets;
  refs.oversValue.textContent = overs;
  refs.runRateValue.textContent = stats.legalBalls ? (stats.runs / (stats.legalBalls / 6)).toFixed(2) : '0.00';
  refs.targetLabel.textContent = target ? 'TARGET' : state.format === 'test' ? 'MATCH STATUS' : 'INNINGS';
  refs.targetValue.textContent = target ? String(target) : state.format === 'test' ? (state.currentIndex >= 2 ? `Lead ${Math.abs(teamRuns(innings.teamIndex) - teamRuns(1 - innings.teamIndex))}` : 'Two innings each') : 'First innings';
  if (target) {
    const remaining = Math.max(0, target - stats.runs);
    const ballsRemaining = innings.oversLimit ? Math.max(0, innings.oversLimit * 6 - stats.legalBalls) : null;
    refs.requiredValue.textContent = `${remaining} needed${ballsRemaining === null ? '' : ` · ${ballsRemaining} balls`}`;
  } else refs.requiredValue.textContent = '';
  refs.matchFormatFact.textContent = innings.isSuperOver ? 'SUPER OVER' : rules.short;
  refs.inningsFact.textContent = innings.isSuperOver ? `${innings.superOverRound} · ${state.currentIndex === state.superOverStart ? '1st' : '2nd'}` : `${innings.number} of ${state.format === 'test' ? '4' : '2'}`;
  refs.phaseFact.textContent = getPhase(innings, stats);
  refs.activeStriker.value = innings.playerNames[innings.striker] || '';
  refs.activeNonStriker.value = innings.playerNames[innings.nonStriker] || '';
  refs.activeBowler.value = innings.currentBowler || '';
  refs.freeHitNotice.hidden = !innings.freeHitPending;
  refs.endInningsBtn.textContent = state.format === 'test' ? 'Declare / close innings' : 'End innings';
  refs.endInningsBtn.disabled = state.status !== 'playing';
  const followOnAvailable = state.format === 'test' && state.innings.length === 2 && !innings.isSuperOver && teamRuns(state.innings[0].teamIndex) - teamRuns(state.innings[1].teamIndex) >= 200;
  refs.followOnOptions.hidden = !(state.status === 'innings-break' && followOnAvailable);
  if (followOnAvailable) refs.followOnCopy.textContent = `${state.teams[state.innings[0].teamIndex]} lead by ${teamRuns(state.innings[0].teamIndex) - teamRuns(state.innings[1].teamIndex)}. The 200-run follow-on threshold is met.`;
  refs.continueBtn.hidden = state.status !== 'innings-break' || state.status === 'complete';
  refs.continueBtn.textContent = followOnAvailable ? 'Continue without follow-on' : state.format === 'test' ? 'Continue to next innings' : state.currentIndex === 0 ? 'Start second innings' : 'Continue';
  refs.drawBtn.hidden = state.format !== 'test' || state.status === 'complete';
  refs.superOverBtn.hidden = state.format === 'test' || state.status !== 'complete' || !state.result?.tied;
  refs.scoringPanel.hidden = state.status !== 'playing';
  refs.inPlayPanel.hidden = false;
  renderBatting(innings, stats);
  renderBowling(innings, stats);
  renderCommentary(innings, stats);
  renderOver(innings, stats);
  renderInningsList();
  const ex = stats.extras;
  refs.extrasBreakdown.textContent = `NB ${ex.noBall} · WD ${ex.wide} · B ${ex.bye} · LB ${ex.legBye} · P ${ex.penalty}`;
  refs.battingExtras.textContent = `Extras ${ex.noBall + ex.wide + ex.bye + ex.legBye + ex.penalty}`;
}

function onFormatChange() {
  const format = refs.formatInput.value;
  const rules = FORMAT_RULES[format];
  refs.oversField.hidden = format === 'test';
  if (format !== 'test') refs.oversInput.value = rules.defaultOvers;
  else refs.oversInput.value = '';
}

function resetMatch() {
  if (state.started && !window.confirm('Start a new match? The current scorecard will be cleared from this device.')) return;
  state = freshState();
  saveState();
  render();
}

function updateDismissalFields() {
  refs.dismissalFields.hidden = !refs.detailWicket.value;
}

if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

function bindEvents() {
  refs.setupForm.addEventListener('submit', startMatch);
  refs.formatInput.addEventListener('change', onFormatChange);
  document.querySelectorAll('.cn-run-button').forEach((button) => button.addEventListener('click', () => makeDelivery({ batRuns: button.dataset.runs })));
  document.querySelectorAll('.cn-extra-button[data-extra]').forEach((button) => button.addEventListener('click', () => {
    const kind = button.dataset.extra;
    makeDelivery({ wide: kind === 'wide', noBall: kind === 'noBall', byes: kind === 'bye' ? 1 : 0, legByes: kind === 'legBye' ? 1 : 0 });
  }));
  $('wicketBtn').addEventListener('click', () => openDeliveryDialog('bowled'));
  $('detailsBtn').addEventListener('click', () => openDeliveryDialog());
  $('saveDeliveryBtn').addEventListener('click', submitDetailedDelivery);
  refs.detailWicket.addEventListener('change', updateDismissalFields);
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => refs.deliveryDialog.close()));
  refs.undoBtn.addEventListener('click', undoDelivery);
  refs.endInningsBtn.addEventListener('click', () => { closeInnings(); saveState(); render(); });
  refs.continueBtn.addEventListener('click', () => startNextInnings(false));
  refs.followOnBtn.addEventListener('click', () => startNextInnings(true));
  refs.drawBtn.addEventListener('click', () => {
    state.status = 'complete'; state.result = { winner: null, tied: false, text: 'Match drawn.' }; saveState(); render();
  });
  refs.superOverBtn.addEventListener('click', startSuperOver);
  refs.activeStriker.addEventListener('change', () => changeActiveName('striker', refs.activeStriker.value));
  refs.activeNonStriker.addEventListener('change', () => changeActiveName('nonStriker', refs.activeNonStriker.value));
  refs.activeBowler.addEventListener('change', () => changeBowler(refs.activeBowler.value));
  $('newMatchBtn').addEventListener('click', resetMatch);
  $('resetBtn').addEventListener('click', resetMatch);
  window.addEventListener('online', () => { $('connectionStatus').textContent = 'Online'; });
  window.addEventListener('offline', () => { $('connectionStatus').textContent = 'Offline · saved on device'; });
}

bindEvents();
onFormatChange();
render();
