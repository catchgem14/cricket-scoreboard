(() => {
  const $ = (id) => document.getElementById(id);
  const refs = {
    portal: $('portalApp'), scorer: $('scorerApp'), auth: $('authPanel'), dashboard: $('dashboardPanel'),
    accountTools: $('accountTools'), accountIdentity: $('accountIdentity'), authForm: $('authForm'), authEmail: $('authEmail'),
    authSubmit: $('authSubmit'), authMessage: $('authMessage'), cloudSetup: $('cloudSetupNotice'), localDemo: $('localDemoBtn'),
    signOut: $('signOutBtn'), dashboardMessage: $('dashboardMessage'), tournamentList: $('tournamentList'), tournamentCount: $('tournamentCount'),
    tournamentForm: $('newTournamentForm'), tournamentName: $('tournamentName'), tournamentSeason: $('tournamentSeason'),
    tournamentHost: $('tournamentHost'), tournamentVenue: $('tournamentVenue'), tournamentCity: $('tournamentCity'),
    tournamentCountry: $('tournamentCountry'), tournamentStart: $('tournamentStart'), tournamentEnd: $('tournamentEnd'),
    joinForm: $('joinTournamentForm'), joinCode: $('tournamentInviteInput'), overview: $('tournamentOverview'),
    tournamentTitle: $('selectedTournamentTitle'), tournamentMeta: $('selectedTournamentMeta'), tournamentRole: $('selectedTournamentRole'),
    tournamentDetails: $('selectedTournamentDetails'), inviteRow: $('inviteCodeRow'), inviteValue: $('inviteCodeValue'),
    copyInvite: $('copyInviteBtn'), matchPanel: $('newMatchPanel'), matchForm: $('newMatchForm'), teamA: $('newMatchTeamA'), teamB: $('newMatchTeamB'),
    format: $('newMatchFormat'), overs: $('newMatchOvers'), oversField: $('newMatchOversField'), venue: $('newMatchVenue'),
    scheduled: $('newMatchTime'), tossWinner: $('newMatchToss'), tossDecision: $('newMatchDecision'), striker: $('newMatchStriker'),
    nonStriker: $('newMatchNonStriker'), bowler: $('newMatchBowler'), assignedScorer: $('newMatchScorer'), matchesPanel: $('matchesPanel'),
    matchList: $('matchList'), matchCount: $('matchCount'), membersPanel: $('membersPanel'), membersList: $('memberList'), backButton: $('backToPortalBtn'),
  };
  const config = window.CRICNOVA_SUPABASE || {};
  let client = null;
  let user = null;
  let tournaments = [];
  let selectedTournament = null;
  let members = [];
  let matches = [];
  let activeMatch = null;
  let canScore = false;
  let stateVersion = 0;
  let nextVersion = 0;
  let saveQueue = Promise.resolve();
  let realtime = null;

  function setMessage(element, text, isError = false) {
    element.textContent = text || '';
    element.classList.toggle('is-error', Boolean(isError));
  }

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function setMode(mode) {
    refs.portal.hidden = mode === 'scorer';
    refs.scorer.hidden = mode !== 'scorer';
    refs.auth.hidden = mode !== 'auth';
    refs.dashboard.hidden = mode !== 'dashboard';
    refs.accountTools.hidden = mode === 'auth';
    refs.backButton.hidden = mode !== 'scorer';
  }

  function makeInviteCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  }

  function seedScoreState(match, details = {}) {
    const tossWinner = Number(details.toss_winner ?? 0);
    const battingFirst = details.toss_decision === 'field' ? 1 - tossWinner : tossWinner;
    const opposition = 1 - battingFirst;
    return {
      started: true, status: 'scheduled', format: match.format, overs: match.format === 'test' ? null : match.overs,
      teams: [match.team_a, match.team_b], battingFirst,
      inningsOrder: match.format === 'test' ? [battingFirst, opposition, battingFirst, opposition] : [battingFirst, opposition],
      innings: [{
        teamIndex: battingFirst, number: 1, oversLimit: match.format === 'test' ? null : match.overs,
        isSuperOver: false, superOverRound: 0, maxWickets: 10, completed: false, deliveries: [],
        playerNames: { striker: details.opening_striker || 'Batter 1', nonStriker: details.opening_non_striker || 'Batter 2' },
        striker: 'striker', nonStriker: 'nonStriker', currentBowler: details.opening_bowler || 'Bowler 1',
        lastOverBowler: '', freeHitPending: false,
      }],
      currentIndex: 0, result: null, followOn: false, superOverRound: 0, superOverStart: -1,
    };
  }

  async function signIn(event) {
    event.preventDefault();
    if (!client) return setMessage(refs.authMessage, 'Cloud scoring is not configured yet.', true);
    refs.authSubmit.disabled = true;
    setMessage(refs.authMessage, 'Sending sign-in link…');
    const { error } = await client.auth.signInWithOtp({
      email: refs.authEmail.value.trim(),
      options: { emailRedirectTo: `${location.origin}${location.pathname}` },
    });
    refs.authSubmit.disabled = false;
    setMessage(refs.authMessage, error ? error.message : 'Check your email for a secure sign-in link.', Boolean(error));
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    await returnToPortal();
    user = null;
    setMode('auth');
  }

  async function onSession(nextUser) {
    if (!nextUser) {
      user = null;
      setMode('auth');
      return;
    }
    user = nextUser;
    refs.accountIdentity.textContent = nextUser.email || 'Signed in';
    await loadDashboard();
  }

  async function loadDashboard(preferredId = '') {
    if (!client || !user) return;
    setMode('dashboard');
    setMessage(refs.dashboardMessage, 'Loading tournaments…');
    const { data, error } = await client.from('tournament_members')
      .select('tournament_id, role, tournaments(id, name, season, host, venue, city, country, start_date, end_date, invite_code, owner_id)')
      .eq('user_id', user.id);
    if (error) return setMessage(refs.dashboardMessage, error.message, true);
    tournaments = (data || []).filter((item) => item.tournaments).map((item) => ({ ...item.tournaments, role: item.role }));
    refs.tournamentCount.textContent = String(tournaments.length);
    const selectedId = preferredId || selectedTournament?.id;
    selectedTournament = tournaments.find((item) => item.id === selectedId) || tournaments[0] || null;
    renderTournamentList();
    await loadSelectedTournament();
    setMessage(refs.dashboardMessage, '');
  }

  function renderTournamentList() {
    refs.tournamentList.innerHTML = tournaments.length ? tournaments.map((item) => `
      <li><button class="cn-tournament-choice ${selectedTournament?.id === item.id ? 'is-selected' : ''}" type="button" data-tournament-id="${escape(item.id)}">
        <strong>${escape(item.name)}</strong><small>${escape(item.season || 'Tournament')} · ${escape(item.role)}</small>
      </button></li>`).join('') : '<li class="cn-empty-cell">Create a tournament or join with an invite code.</li>';
    refs.tournamentList.querySelectorAll('[data-tournament-id]').forEach((button) => button.addEventListener('click', () => loadDashboard(button.dataset.tournamentId)));
  }

  async function loadSelectedTournament() {
    const exists = Boolean(selectedTournament);
    refs.overview.hidden = !exists;
    refs.matchPanel.hidden = !exists || selectedTournament?.role !== 'admin';
    refs.matchesPanel.hidden = !exists;
    refs.membersPanel.hidden = !exists;
    refs.inviteRow.hidden = !exists || selectedTournament?.role !== 'admin';
    if (!exists) {
      members = [];
      matches = [];
      refs.matchList.innerHTML = '<p class="cn-empty-cell">Create or join a tournament to see its matches.</p>';
      refs.membersList.innerHTML = '';
      return;
    }
    refs.tournamentTitle.textContent = selectedTournament.name;
    refs.tournamentMeta.textContent = [selectedTournament.season, selectedTournament.host].filter(Boolean).join(' · ') || 'TOURNAMENT';
    refs.tournamentRole.textContent = selectedTournament.role;
    refs.inviteValue.textContent = selectedTournament.invite_code;
    refs.tournamentDetails.innerHTML = [selectedTournament.venue, selectedTournament.city, selectedTournament.country,
      selectedTournament.start_date, selectedTournament.end_date].filter(Boolean).map((value) => `<span>${escape(value)}</span>`).join('');
    setMessage(refs.dashboardMessage, 'Loading fixtures and scorer roles…');
    const [memberResult, matchResult] = await Promise.all([
      client.from('tournament_members').select('user_id, role, profiles!tournament_members_user_id_fkey(email, display_name)').eq('tournament_id', selectedTournament.id),
      client.from('matches').select('id, title, team_a, team_b, format, overs, venue, scheduled_at, assigned_scorer, status, score_state, state_version').eq('tournament_id', selectedTournament.id).order('scheduled_at', { ascending: true, nullsFirst: false }),
    ]);
    if (memberResult.error || matchResult.error) return setMessage(refs.dashboardMessage, memberResult.error?.message || matchResult.error?.message || 'Could not load tournament data.', true);
    members = memberResult.data || [];
    matches = matchResult.data || [];
    renderScorerOptions();
    renderMatches();
    renderMembers();
    setMessage(refs.dashboardMessage, '');
  }

  function memberName(member) {
    return member?.profiles?.display_name || member?.profiles?.email || member?.user_id?.slice(0, 8) || 'Scorer';
  }

  function renderScorerOptions() {
    const eligible = members.filter((member) => member.role === 'admin' || member.role === 'scorer');
    refs.assignedScorer.innerHTML = eligible.map((member) => `<option value="${escape(member.user_id)}">${escape(memberName(member))}${member.user_id === user.id ? ' (you)' : ''}</option>`).join('');
    if (!eligible.length) refs.assignedScorer.innerHTML = '<option value="">No scorer members yet</option>';
  }

  function renderMatches() {
    refs.matchCount.textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'}`;
    refs.matchList.innerHTML = matches.length ? matches.map((match) => {
      const scorer = members.find((member) => member.user_id === match.assigned_scorer);
      const score = match.score_state?.innings?.[match.score_state.currentIndex];
      const canOpenForScoring = match.assigned_scorer === user.id;
      const scoreSummary = score ? `${match.score_state.teams[score.teamIndex]} · ${match.score_state.status === 'scheduled' ? 'Not started' : match.score_state.status}` : 'Not started';
      const assignment = selectedTournament.role === 'admin'
        ? `<label class="cn-assignment-control">SCORER<select aria-label="Assigned scorer for ${escape(match.title)}" data-assign-match="${escape(match.id)}">${members.filter((member) => member.role === 'admin' || member.role === 'scorer').map((member) => `<option value="${escape(member.user_id)}" ${member.user_id === match.assigned_scorer ? 'selected' : ''}>${escape(memberName(member))}</option>`).join('')}</select></label>`
        : `<span class="cn-role-badge">${escape(match.status)}</span>`;
      return `<article class="cn-match-card ${selectedTournament.role === 'admin' ? 'is-admin' : ''}"><div class="cn-match-meta"><div class="cn-match-title"><strong>${escape(match.team_a)} v ${escape(match.team_b)}</strong><span>${escape(match.format.toUpperCase())}</span></div><small>${escape(match.venue || selectedTournament.venue || 'Venue TBC')} · ${escape(scorer ? memberName(scorer) : 'No scorer assigned')}</small><small>${escape(match.scheduled_at ? new Date(match.scheduled_at).toLocaleString() : 'Time TBC')} · ${escape(scoreSummary)}</small></div>${assignment}<button class="cn-button ${canOpenForScoring ? 'cn-button-primary' : 'cn-button-muted'}" type="button" data-match-id="${escape(match.id)}">${canOpenForScoring ? 'Open scorer' : 'View live'}</button></article>`;
    }).join('') : '<p class="cn-empty-cell">No fixtures yet. Schedule a match to assign its scorer.</p>';
    refs.matchList.querySelectorAll('[data-match-id]').forEach((button) => button.addEventListener('click', () => openMatch(button.dataset.matchId)));
    refs.matchList.querySelectorAll('[data-assign-match]').forEach((select) => select.addEventListener('change', () => reassignMatch(select)));
  }

  async function reassignMatch(select) {
    const { error } = await client.from('matches').update({ assigned_scorer: select.value }).eq('id', select.dataset.assignMatch);
    if (error) {
      setMessage(refs.dashboardMessage, error.message, true);
      await loadSelectedTournament();
      return;
    }
    await loadSelectedTournament();
    setMessage(refs.dashboardMessage, 'Match scorer reassigned.');
  }

  function renderMembers() {
    refs.membersList.innerHTML = members.length ? members.map((member) => {
      const assigned = matches.some((match) => match.assigned_scorer === member.user_id && match.status !== 'complete');
      const control = selectedTournament.role === 'admin' && member.user_id !== selectedTournament.owner_id
        ? `<select aria-label="Role for ${escape(memberName(member))}" data-member-id="${escape(member.user_id)}" data-current-role="${escape(member.role)}"><option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option><option value="scorer" ${member.role === 'scorer' ? 'selected' : ''}>Scorer</option><option value="viewer" ${member.role === 'viewer' ? 'selected' : ''} ${assigned ? 'disabled' : ''}>Viewer${assigned ? ' · assigned' : ''}</option></select>`
        : `<span class="cn-role-badge">${escape(member.role)}</span>`;
      return `<div class="cn-member-row"><div><strong>${escape(memberName(member))}${member.user_id === user.id ? ' (you)' : ''}</strong><small>${assigned ? 'Assigned to an active match' : 'No active assignments'}</small></div>${control}</div>`;
    }).join('') : '<p class="cn-empty-cell">No tournament members.</p>';
    refs.membersList.querySelectorAll('select[data-member-id]').forEach((select) => select.addEventListener('change', () => updateMemberRole(select)));
  }

  async function updateMemberRole(select) {
    const { error } = await client.from('tournament_members').update({ role: select.value })
      .eq('tournament_id', selectedTournament.id).eq('user_id', select.dataset.memberId);
    if (error) {
      select.value = select.dataset.currentRole;
      return setMessage(refs.dashboardMessage, error.message, true);
    }
    await loadSelectedTournament();
    setMessage(refs.dashboardMessage, 'Tournament role updated.');
  }

  async function createTournament(event) {
    event.preventDefault();
    const { data, error } = await client.from('tournaments').insert({
      name: refs.tournamentName.value.trim(), season: refs.tournamentSeason.value.trim(), host: refs.tournamentHost.value.trim(),
      venue: refs.tournamentVenue.value.trim(), city: refs.tournamentCity.value.trim(), country: refs.tournamentCountry.value.trim(),
      start_date: refs.tournamentStart.value || null, end_date: refs.tournamentEnd.value || null,
      invite_code: makeInviteCode(), owner_id: user.id,
    }).select('id').single();
    if (error) return setMessage(refs.dashboardMessage, error.message, true);
    refs.tournamentForm.reset();
    await loadDashboard(data.id);
    setMessage(refs.dashboardMessage, 'Tournament created. Share its invite code with scorers.');
  }

  async function joinTournament(event) {
    event.preventDefault();
    const { data, error } = await client.rpc('join_tournament', { code: refs.joinCode.value.trim().toUpperCase() });
    if (error) return setMessage(refs.dashboardMessage, error.message, true);
    refs.joinForm.reset();
    await loadDashboard(data);
    setMessage(refs.dashboardMessage, 'You joined the tournament as a scorer.');
  }

  async function createMatch(event) {
    event.preventDefault();
    const format = refs.format.value;
    const overs = format === 'test' ? null : Math.min(50, Math.max(1, Number(refs.overs.value) || 1));
    const details = {
      toss_winner: Number(refs.tossWinner.value), toss_decision: refs.tossDecision.value,
      opening_striker: refs.striker.value, opening_non_striker: refs.nonStriker.value, opening_bowler: refs.bowler.value,
    };
    const payload = {
      tournament_id: selectedTournament.id,
      title: `${refs.teamA.value.trim()} v ${refs.teamB.value.trim()}`,
      team_a: refs.teamA.value.trim(), team_b: refs.teamB.value.trim(), format, overs,
      venue: refs.venue.value.trim(), scheduled_at: refs.scheduled.value ? new Date(refs.scheduled.value).toISOString() : null,
      assigned_scorer: refs.assignedScorer.value || null, status: 'scheduled', created_by: user.id,
    };
    payload.score_state = seedScoreState(payload, details);
    const { error } = await client.from('matches').insert(payload);
    if (error) return setMessage(refs.dashboardMessage, error.message, true);
    refs.matchForm.reset();
    refs.format.value = 't20';
    refs.overs.value = '20';
    await loadSelectedTournament();
    setMessage(refs.dashboardMessage, 'Match scheduled and scorer assigned.');
  }

  async function openMatch(matchId) {
    const match = matches.find((item) => item.id === matchId);
    if (!match) return;
    if (realtime && client) await client.removeChannel(realtime);
    activeMatch = match;
    stateVersion = match.state_version || 0;
    nextVersion = stateVersion;
    canScore = match.assigned_scorer === user.id;
    setMode('scorer');
    window.dispatchEvent(new CustomEvent('cricnova:openMatch', {
      detail: { match, state: match.score_state || seedScoreState(match), canScore, version: stateVersion },
    }));
    realtime = client.channel(`match-${matchId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, receiveMatchUpdate)
      .subscribe();
  }

  function receiveMatchUpdate(change) {
    const match = change.new;
    if (!activeMatch || match.id !== activeMatch.id) return;
    const scoreChanged = match.state_version > stateVersion;
    const assignmentChanged = match.assigned_scorer !== activeMatch.assigned_scorer;
    if (!scoreChanged && !assignmentChanged) return;
    activeMatch = match;
    stateVersion = Math.max(stateVersion, match.state_version);
    nextVersion = Math.max(nextVersion, stateVersion);
    canScore = match.assigned_scorer === user.id;
    if (scoreChanged) {
      window.dispatchEvent(new CustomEvent('cricnova:remoteState', {
        detail: { match, state: match.score_state, canScore, version: stateVersion },
      }));
    } else window.dispatchEvent(new CustomEvent('cricnova:permissionChanged', { detail: { canScore } }));
  }

  function persistScore(matchId, nextState) {
    if (!client || !activeMatch || activeMatch.id !== matchId || !canScore) return Promise.resolve(false);
    const snapshot = JSON.parse(JSON.stringify(nextState));
    const expectedVersion = nextVersion++;
    saveQueue = saveQueue.then(async () => {
      const { data, error } = await client.rpc('update_match_score', {
        target_match: matchId, expected_version: expectedVersion, next_state: snapshot, next_status: snapshot.status,
      });
      if (error) {
        canScore = false;
        window.dispatchEvent(new CustomEvent('cricnova:permissionChanged', { detail: { canScore: false } }));
        window.dispatchEvent(new CustomEvent('cricnova:cloudError', { detail: { message: /changed elsewhere|reload the latest/i.test(error.message)
          ? 'This match changed in another session. Scoring is paused; return to the fixture list and reopen the latest score.'
          : error.message } }));
        return false;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        stateVersion = row.state_version;
        activeMatch = { ...activeMatch, ...row };
      }
      return true;
    });
    return saveQueue;
  }

  async function returnToPortal() {
    if (realtime && client) await client.removeChannel(realtime);
    realtime = null;
    activeMatch = null;
    canScore = false;
    window.dispatchEvent(new Event('cricnova:closeMatch'));
    setMode(user ? 'dashboard' : 'auth');
    if (user) await loadSelectedTournament();
  }

  function bind() {
    refs.authForm.addEventListener('submit', signIn);
    refs.signOut.addEventListener('click', signOut);
    refs.tournamentForm.addEventListener('submit', createTournament);
    refs.joinForm.addEventListener('submit', joinTournament);
    refs.matchForm.addEventListener('submit', createMatch);
    refs.format.addEventListener('change', () => { refs.oversField.hidden = refs.format.value === 'test'; });
    refs.copyInvite.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(refs.inviteValue.textContent);
        setMessage(refs.dashboardMessage, 'Invite code copied.');
      } catch (error) {
        setMessage(refs.dashboardMessage, `Invite code: ${refs.inviteValue.textContent}`);
      }
    });
    refs.localDemo.addEventListener('click', () => {
      window.CricNovaPortalLocalDemo = true;
      canScore = true;
      setMode('scorer');
      window.dispatchEvent(new CustomEvent('cricnova:openMatch', { detail: { local: true, canScore: true } }));
    });
    refs.backButton.addEventListener('click', returnToPortal);
  }

  async function initialize() {
    bind();
    const configured = Boolean(config.url && config.publishableKey && window.supabase?.createClient);
    refs.cloudSetup.hidden = configured;
    refs.authForm.hidden = !configured;
    refs.authSubmit.disabled = !configured;
    if (!configured) {
      setMessage(refs.authMessage, window.supabase?.createClient ? 'Cloud sign-in is not configured yet.' : 'Cloud sign-in library did not load.');
      setMode('auth');
      return;
    }
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) queueMicrotask(() => onSession(session.user));
      else setMode('auth');
    });
    const { data, error } = await client.auth.getSession();
    if (error) return setMessage(refs.authMessage, error.message, true);
    if (data.session?.user) await onSession(data.session.user);
    else setMode('auth');
  }

  window.CricNovaPortal = { persistScore, returnToPortal, get canScore() { return canScore; } };
  void initialize();
})();
