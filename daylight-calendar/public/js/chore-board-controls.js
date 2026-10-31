// Assignment and movement use the same server operation for mouse, touch and keyboard.
const choreLanePages = new Map();
const choreLaneNames = { 'up-for-grabs': 'Up for Grabs', needs_action: 'To Do', completed: 'Done' };
let choreBoardResizeObserver;
let choreBoardFocusUid = null;
let choreMobileLane = 'up-for-grabs';

function getChoreLane(chore) {
  return chore.status === 'completed' ? 'completed'
    : (chore.assignedProfileIds || []).length ? 'needs_action' : 'up-for-grabs';
}

function showChoreBoardMessage(message, error = false) {
  const element = document.getElementById('chore-board-message');
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('is-error', error);
  element.setAttribute('role', error ? 'alert' : 'status');
}

async function moveChoreToLane(chore, lane, assignedProfileIds) {
  const board = document.getElementById('chore-board');
  if (!board || board.dataset.moving === 'true') return false;
  board.dataset.moving = 'true';
  board.setAttribute('aria-busy', 'true');
  const controls = [...board.querySelectorAll('button, select')];
  const disabledBefore = new Map(controls.map(control => [control, control.disabled]));
  controls.forEach(control => { control.disabled = true; });
  showChoreBoardMessage('');
  try {
    await choreRequest(`api/chores/${encodeURIComponent(chore.uid)}/move`, {
      method: 'POST', body: JSON.stringify({ lane, expectedLane: getChoreLane(chore),
        ...(assignedProfileIds === undefined ? {} : { assignedProfileIds }) })
    });
    if (lane === 'completed' && !showCompletedChores) {
      showCompletedChores = true;
      const toggle = document.getElementById('toggle-completed');
      if (toggle) toggle.innerHTML = '<i class="material-icons">visibility_off</i> Hide Completed';
    }
    choreBoardFocusUid = chore.uid;
    choreMobileLane = lane;
    board.dataset.moving = 'false';
    await fetchAndDisplayChores();
    board.querySelector(`[data-chore-id="${CSS.escape(chore.uid)}"]`)?.focus();
    showChoreBoardMessage(`${chore.summary} moved to ${choreLaneNames[lane]}.`);
    return true;
  } catch (error) {
    showChoreBoardMessage(error.message || 'Could not move this chore. Try again.', true);
    throw error;
  } finally {
    board.dataset.moving = 'false';
    board.removeAttribute('aria-busy');
    controls.filter(control => control.isConnected).forEach(control => { control.disabled = disabledBefore.get(control); });
  }
}

function openChoreAssignment(chore, afterSave) {
  const modal = document.getElementById('claim-chore-modal');
  const options = document.getElementById('claim-profile-options');
  const error = document.getElementById('claim-chore-error');
  if (!modal || !options || !error) return;
  document.getElementById('chore-detail-modal')?.classList.remove('show');
  document.getElementById('chore-assignment-title').textContent = 'Assign chore';
  document.getElementById('claim-chore-message').textContent = `Who will do “${chore.summary}”?`;
  error.textContent = '';
  options.innerHTML = choreProfiles.length ? choreProfiles.map(profile => `
    <button type="button" class="claim-profile" data-profile-id="${escapeHtml(profile.id)}" style="--profile-color:${escapeHtml(getValidCalendarColor(profile.color))}">
      <span aria-hidden="true">${escapeHtml(getProfileInitials(profile.name))}</span>${escapeHtml(profile.name || 'Unnamed')}
    </button>`).join('') : '<p>Add a household profile in Settings to assign chores.</p>';
  options.onclick = async event => {
    const button = event.target.closest('[data-profile-id]');
    if (!button || button.disabled) return;
    options.querySelectorAll('button').forEach(control => { control.disabled = true; });
    error.textContent = '';
    try {
      if (await moveChoreToLane(chore, 'needs_action', [button.dataset.profileId])) {
        modal.classList.remove('show');
        afterSave?.();
      }
    } catch (err) { error.textContent = err.message; }
    finally { options.querySelectorAll('button').forEach(control => { control.disabled = false; }); }
  };
  modal.classList.add('show');
  options.querySelector('button')?.focus();
}

function requestChoreMove(chore, lane, afterSave) {
  if (lane === getChoreLane(chore)) return;
  if (lane === 'needs_action' && !(chore.assignedProfileIds || []).length) {
    openChoreAssignment(chore, afterSave);
    return;
  }
  moveChoreToLane(chore, lane).then(saved => { if (saved) afterSave?.(); }).catch(() => {});
}

function createChoreActions(chore, afterSave) {
  const actions = document.createElement('div');
  actions.className = 'chore-board-actions';
  actions.dataset.choreActions = '';
  const currentLane = getChoreLane(chore);
  const assigned = (chore.assignedProfileIds || []).length > 0;
  actions.innerHTML = `
    ${chore.status !== 'completed' ? `<button type="button" class="btn btn-secondary chore-assign-button" aria-label="${assigned ? 'Reassign' : 'Assign'} ${escapeHtml(chore.summary)}"><i class="material-icons" aria-hidden="true">person_add</i><span>${assigned ? 'Reassign' : 'Assign'}</span></button>` : ''}
    <label class="chore-move-field"><span>Move to</span><select aria-label="Move ${escapeHtml(chore.summary)} to">${Object.entries(choreLaneNames).map(([value, label]) => `<option value="${value}" ${currentLane === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
  actions.querySelector('button')?.addEventListener('click', () => openChoreAssignment(chore, afterSave));
  const select = actions.querySelector('select');
  select.addEventListener('change', () => {
    const lane = select.value;
    select.value = currentLane;
    requestChoreMove(chore, lane, afterSave);
  });
  return actions;
}

function setupChoreDetailControls(content, chore) {
  const summary = content.querySelector('.chore-detail-summary');
  summary?.append(createChoreActions(chore, () => {
    document.getElementById('chore-detail-modal')?.classList.remove('show');
  }));
}

function setupChoreBoardControls(board, chores) {
  choreBoardResizeObserver?.disconnect();
  board.classList.add('chore-board-interactive');
  document.getElementById('chore-lane-switcher')?.remove();
  const switcher = document.createElement('div');
  switcher.id = 'chore-lane-switcher';
  switcher.className = 'chore-lane-switcher';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'Choose chore column');
  switcher.innerHTML = Object.entries(choreLaneNames).map(([lane, name]) => {
    const count = chores.filter(chore => getChoreLane(chore) === lane).length;
    return `<button type="button" class="chore-lane-tab" data-lane="${lane}" aria-pressed="${lane === choreMobileLane}">${name}<span>${count}</span></button>`;
  }).join('');
  board.before(switcher);
  function selectMobileLane(lane) {
    choreMobileLane = lane;
    board.querySelectorAll('.kanban-lane').forEach(column => column.classList.toggle('is-active-lane', column.dataset.lane === lane));
    switcher.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lane === lane)));
    requestAnimationFrame(() => board.querySelectorAll('.kanban-lane').forEach(column => column.paginateChores?.()));
  }
  switcher.onclick = event => {
    const button = event.target.closest('button');
    if (button) selectMobileLane(button.dataset.lane);
  };
  const byId = new Map(chores.map(chore => [chore.uid, chore]));
  let draggedUid = null;
  let touchDrag = null;
  function clearDrag() {
    draggedUid = null;
    board.dataset.dragging = 'false';
    [...board.querySelectorAll('.is-drop-target, .is-dragging'), ...switcher.querySelectorAll('.is-drop-target')].forEach(element => element.classList.remove('is-drop-target', 'is-dragging'));
  }
  function highlight(lane) {
    board.querySelectorAll('.is-drop-target').forEach(element => element.classList.remove('is-drop-target'));
    switcher.querySelectorAll('.is-drop-target').forEach(element => element.classList.remove('is-drop-target'));
    lane?.classList.add('is-drop-target');
  }
  function finishDrag(lane) {
    const chore = byId.get(draggedUid);
    clearDrag();
    if (chore && lane) requestChoreMove(chore, lane.dataset.lane);
  }
  for (const card of board.querySelectorAll('.chore-card')) {
    const chore = byId.get(card.dataset.choreId);
    if (!chore) continue;
    card.draggable = true;
    card.append(createChoreActions(chore));
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'chore-drag-handle';
    handle.setAttribute('aria-label', `Drag ${chore.summary} to a column, or use Move to`);
    handle.innerHTML = '<i class="material-icons" aria-hidden="true">drag_indicator</i>';
    card.querySelector('.chore-header').prepend(handle);
    card.ondragstart = event => {
      if (board.dataset.moving === 'true' || (event.target.closest('button, select') && !event.target.closest('.chore-drag-handle'))) return event.preventDefault();
      draggedUid = chore.uid;
      board.dataset.dragging = 'true';
      event.dataTransfer.setData('text/plain', chore.uid);
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    };
    card.ondragend = clearDrag;
    handle.onpointerdown = event => {
      if (event.pointerType === 'mouse' || board.dataset.moving === 'true') return;
      touchDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, started: false };
      handle.setPointerCapture(event.pointerId);
    };
    handle.onpointermove = event => {
      if (!touchDrag || touchDrag.id !== event.pointerId) return;
      if (!touchDrag.started && Math.hypot(event.clientX - touchDrag.x, event.clientY - touchDrag.y) < 8) return;
      touchDrag.started = true;
      draggedUid = chore.uid;
      board.dataset.dragging = 'true';
      card.classList.add('is-dragging');
      const lane = document.elementFromPoint(event.clientX, event.clientY)?.closest('.kanban-lane, .chore-lane-tab');
      highlight(lane && (board.contains(lane) || switcher.contains(lane)) ? lane : null);
      event.preventDefault();
    };
    handle.onpointerup = event => {
      if (!touchDrag || touchDrag.id !== event.pointerId) return;
      const started = touchDrag.started;
      touchDrag = null;
      const lane = document.elementFromPoint(event.clientX, event.clientY)?.closest('.kanban-lane, .chore-lane-tab');
      if (started) finishDrag(lane && (board.contains(lane) || switcher.contains(lane)) ? lane : null);
      else clearDrag();
    };
    handle.onpointercancel = () => { touchDrag = null; clearDrag(); };
  }
  for (const lane of board.querySelectorAll('.kanban-lane')) {
    lane.ondragover = event => {
      if (!draggedUid) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      highlight(lane);
    };
    lane.ondragleave = event => {
      if (!lane.contains(event.relatedTarget)) lane.classList.remove('is-drop-target');
    };
    lane.ondrop = event => {
      if (!draggedUid) return;
      event.preventDefault();
      finishDrag(lane);
    };
    const content = lane.querySelector('.lane-content');
    const cards = [...content.querySelectorAll('.chore-card')];
    const navigation = document.createElement('div');
    navigation.className = 'chore-lane-pages';
    navigation.innerHTML = `<button type="button" aria-label="Previous chores in ${choreLaneNames[lane.dataset.lane]}"><i class="material-icons" aria-hidden="true">chevron_left</i></button><span></span><button type="button" aria-label="Next chores in ${choreLaneNames[lane.dataset.lane]}"><i class="material-icons" aria-hidden="true">chevron_right</i></button>`;
    lane.querySelector('.lane-header').append(navigation);
    const buttons = navigation.querySelectorAll('button');
    let capacity = Math.max(1, cards.length);
    function paginate(direction = 0) {
      // Measure the tallest card so every page fits without a lane scrollbar.
      cards.forEach(card => { card.hidden = false; });
      const gap = parseFloat(getComputedStyle(content).gap) || 0;
      const tallest = Math.max(1, ...cards.map(card => card.getBoundingClientRect().height));
      capacity = Math.max(1, Math.floor((content.clientHeight + gap - 4) / (tallest + gap)));
      const pages = Math.max(1, Math.ceil(cards.length / capacity));
      let page = Math.min(pages - 1, Math.max(0, (choreLanePages.get(lane.dataset.lane) || 0) + direction));
      if (direction) choreBoardFocusUid = null;
      const focusIndex = cards.findIndex(card => card.dataset.choreId === choreBoardFocusUid);
      if (focusIndex >= 0) page = Math.floor(focusIndex / capacity);
      choreLanePages.set(lane.dataset.lane, page);
      cards.forEach((card, index) => { card.hidden = index < page * capacity || index >= (page + 1) * capacity; });
      navigation.hidden = pages === 1;
      navigation.querySelector('span').textContent = `${page + 1}/${pages}`;
      buttons[0].disabled = page === 0;
      buttons[1].disabled = page === pages - 1;
    }
    buttons[0].onclick = () => paginate(-1);
    buttons[1].onclick = () => paginate(1);
    lane.paginateChores = paginate;
    if (!cards.length) {
      const empty = document.createElement('p');
      empty.className = 'chore-lane-empty';
      empty.textContent = lane.dataset.lane === 'completed' && !showCompletedChores ? 'Completed chores are hidden.' : 'Drop a chore here, or use Move to.';
      content.append(empty);
    }
  }
  switcher.querySelectorAll('button').forEach(button => {
    button.ondragover = event => { if (draggedUid) { event.preventDefault(); highlight(button); } };
    button.ondrop = event => { if (draggedUid) { event.preventDefault(); finishDrag(button); } };
  });
  selectMobileLane(choreMobileLane);
  const paginateAll = () => board.querySelectorAll('.kanban-lane').forEach(lane => lane.paginateChores());
  choreBoardResizeObserver = new ResizeObserver(paginateAll);
  choreBoardResizeObserver.observe(board);
  requestAnimationFrame(paginateAll);
}
