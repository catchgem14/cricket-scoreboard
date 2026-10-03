const STORAGE_KEY = 'cricket-scoreboard-state-v1';

const defaultState = {
  battingTeam: 'Team A',
  bowlingTeam: 'Team B',
  overs: 20,
  runs: 0,
  wickets: 0,
  balls: 0,
  history: [],
  target: null,
};

const elements = {
  battingTeamInput: document.getElementById('battingTeamInput'),
  bowlingTeamInput: document.getElementById('bowlingTeamInput'),
  oversInput: document.getElementById('oversInput'),
  battingTeamName: document.getElementById('battingTeamName'),
  bowlingTeamName: document.getElementById('bowlingTeamName'),
  runsValue: document.getElementById('runsValue'),
  wicketsValue: document.getElementById('wicketsValue'),
  oversValue: document.getElementById('oversValue'),
  runRateValue: document.getElementById('runRateValue'),
  targetValue: document.getElementById('targetValue'),
  requiredValue: document.getElementById('requiredValue'),
  ballLog: document.getElementById('ballLog'),
  resetBtn: document.getElementById('resetBtn'),
  undoBtn: document.getElementById('undoBtn'),
  applySetupBtn: document.getElementById('applySetupBtn'),
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? { ...defaultState, ...saved } : { ...defaultState };
  } catch (error) {
    return { ...defaultState };
  }
}

let state = loadState();

function normalizeOvers(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 20;
  return Math.min(50, Math.max(1, Math.round(parsed)));
}

function formatOvers(balls) {
  const fullOvers = Math.floor(balls / 6);
  const remainingBalls = balls % 6;
  return `${fullOvers}.${remainingBalls}`;
}

function getRunRate(runs, balls) {
  if (balls === 0) return 0;
  return runs / (balls / 6);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function updateRequiredValue() {
  if (state.target === null || state.target <= state.runs) {
    elements.requiredValue.textContent = 'Completed';
    return;
  }

  const remainingRuns = state.target - state.runs;
  const remainingBalls = Math.max(0, state.overs * 6 - state.balls);
  const requiredRate = remainingBalls === 0 ? 0 : (remainingRuns / (remainingBalls / 6));

  elements.requiredValue.textContent = `${remainingRuns} runs in ${remainingBalls} balls (${requiredRate.toFixed(2)}/over)`;
}

function render() {
  elements.battingTeamName.textContent = state.battingTeam;
  elements.bowlingTeamName.textContent = state.bowlingTeam;
  elements.runsValue.textContent = state.runs;
  elements.wicketsValue.textContent = state.wickets;
  elements.oversValue.textContent = formatOvers(state.balls);
  elements.runRateValue.textContent = getRunRate(state.runs, state.balls).toFixed(2);

  if (state.target === null) {
    elements.targetValue.textContent = '-';
  } else {
    elements.targetValue.textContent = state.target;
  }

  updateRequiredValue();

  elements.battingTeamInput.value = state.battingTeam;
  elements.bowlingTeamInput.value = state.bowlingTeam;
  elements.oversInput.value = state.overs;

  elements.ballLog.innerHTML = '';

  state.history.forEach((item) => {
    const listItem = document.createElement('li');
    listItem.textContent = item.label;
    listItem.classList.add(item.type || 'normal');
    elements.ballLog.appendChild(listItem);
  });
}

function applySetup() {
  const battingTeam = elements.battingTeamInput.value.trim() || 'Team A';
  const bowlingTeam = elements.bowlingTeamInput.value.trim() || 'Team B';
  const overs = normalizeOvers(elements.oversInput.value);

  state.battingTeam = battingTeam;
  state.bowlingTeam = bowlingTeam;
  state.overs = overs;
  state.target = state.target ?? null;
  saveState();
  render();
}

function addBall(runs, type = 'normal', label) {
  const totalBalls = state.overs * 6;
  if (state.balls >= totalBalls) {
    return;
  }

  if (type === 'wide' || type === 'noball') {
    state.runs += runs;
    state.history.push({ type, label: label || `${runs} ${type === 'wide' ? 'wide' : 'no ball'}` });
  } else {
    state.runs += runs;
    state.balls += 1;
    state.history.push({ type, label: label || `${runs}` });
  }

  if (state.target !== null && state.runs >= state.target && state.balls > 0) {
    state.target = state.target;
  }

  saveState();
  render();
}

function addScore(event) {
  const value = Number(event.currentTarget.dataset.runs);
  const label = `${value}`;
  addBall(value, 'normal', label);
}

function addSpecialBall(event) {
  const type = event.currentTarget.dataset.type;
  if (type === 'wide') {
    addBall(1, 'wide', 'WD');
    return;
  }

  if (type === 'noball') {
    addBall(1, 'no-ball', 'NB');
    return;
  }

  if (type === 'wicket') {
    state.wickets += 1;
    state.balls += 1;
    state.history.push({ type: 'wicket', label: 'W' });
    saveState();
    render();
  }
}

function undoLastAction() {
  if (!state.history.length) return;

  const last = state.history.pop();
  if (!last) return;

  if (last.type === 'wide' || last.type === 'no-ball') {
    const priorRuns = last.label.includes('WD') ? 1 : 1;
    state.runs -= priorRuns;
    saveState();
    render();
    return;
  }

  if (last.type === 'wicket') {
    state.wickets = Math.max(0, state.wickets - 1);
    state.balls = Math.max(0, state.balls - 1);
    saveState();
    render();
    return;
  }

  const value = Number(last.label) || 0;
  state.runs = Math.max(0, state.runs - value);
  state.balls = Math.max(0, state.balls - 1);
  saveState();
  render();
}

function resetMatch() {
  state = { ...defaultState };
  saveState();
  render();
}

function setTargetFromRuns() {
  const targetValue = state.runs + 1;
  state.target = targetValue;
  saveState();
  render();
}

function bindEvents() {
  document.querySelectorAll('.score-btn[data-runs]').forEach((button) => {
    button.addEventListener('click', addScore);
  });

  document.querySelectorAll('.score-btn[data-type]').forEach((button) => {
    button.addEventListener('click', addSpecialBall);
  });

  elements.resetBtn.addEventListener('click', resetMatch);
  elements.undoBtn.addEventListener('click', undoLastAction);
  elements.applySetupBtn.addEventListener('click', applySetup);

  elements.battingTeamInput.addEventListener('change', applySetup);
  elements.bowlingTeamInput.addEventListener('change', applySetup);
  elements.oversInput.addEventListener('change', applySetup);
}

bindEvents();
render();

if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
