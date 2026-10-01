'use strict';

(function exposeVoicePresence(root) {
  const VALID_STATES = new Set(['idle', 'wake', 'listening', 'thinking', 'speaking', 'error']);

  function createPresence() {
    const overlay = document.getElementById('voice-presence');
    const orb = document.getElementById('voice-orb');
    const stateLabel = document.getElementById('voice-state-label');
    const heardLabel = document.getElementById('voice-heard-text');
    const replyLabel = document.getElementById('voice-reply-text');
    let state = 'idle';
    let hideTimer = null;
    let transientTimer = null;

    function setState(nextState) {
      if (!VALID_STATES.has(nextState) || !overlay || !orb) return;
      clearTimeout(hideTimer);
      clearTimeout(transientTimer);
      state = nextState;
      overlay.dataset.voiceState = nextState;
      if (nextState !== 'idle') overlay.classList.add('is-visible');
      orb.setAttribute('aria-label', ({
        idle: 'Voice assistant idle', wake: 'Wake word heard', listening: 'Listening',
        thinking: 'Thinking', speaking: 'Speaking', error: 'Voice assistant error'
      })[nextState]);
      if (stateLabel) stateLabel.textContent = ({
        idle: '', wake: 'I heard you', listening: 'I’m listening', thinking: 'Thinking…',
        speaking: 'Daylight', error: 'Something went wrong'
      })[nextState];
      if (nextState === 'idle') {
        hideTimer = setTimeout(() => {
          if (state === 'idle') overlay.classList.remove('is-visible');
        }, 4000);
      } else if (nextState === 'error') {
        transientTimer = setTimeout(() => {
          if (state === 'error') setState('idle');
        }, 4000);
      }
    }

    function setLevel(value) {
      if (!overlay) return;
      const level = Math.max(0, Math.min(1, Number(value) || 0));
      overlay.style.setProperty('--voice-level', level.toFixed(3));
    }

    function showText(heard, reply) {
      if (heardLabel) heardLabel.textContent = heard || '';
      if (replyLabel) replyLabel.textContent = reply || '';
      overlay?.classList.toggle('has-caption', Boolean(heard || reply));
    }

    return { setState, setLevel, showText };
  }

  // A future avatar can replace createPresence() as long as it implements this same three-method
  // interface: setState(state), setLevel(0..1), and showText(heard, reply).
  root.DaylightVoicePresence = { createPresence };
}(typeof window !== 'undefined' ? window : globalThis));
