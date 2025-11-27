'use strict';

const FEATURE_KEYS = ['tokenCounter', 'promptNavigator', 'responseStyling', 'sessionTracker', 'contextCollector', 'soundNotification'];

const DEFAULT_SETTINGS = {
  tokenCounter: true,
  promptNavigator: true,
  responseStyling: true,
  sessionTracker: true,
  contextCollector: true,
  soundNotification: false
};

// Chime presets - designed for pleasant, luxurious notification sounds
// All use low frequencies, consonant intervals, and reduced volume for comfort
const CHIME_PRESETS = {
  aurora: {
    // Very low ascending fifth (G2→D3) - deep, ethereal
    note1: 98.00, note2: 146.83,
    duration: 0.6, attack: 0.04, decay: 0.55, volume: 0.14
  },
  ocean: {
    // Low perfect fifth (G2→D3) then up - rolling, calm
    note1: 98.00, note2: 130.81,
    duration: 0.6, attack: 0.05, decay: 0.55, volume: 0.14
  },
  velvet: {
    // Low descending third (E3→C3) - smooth, gentle
    note1: 164.81, note2: 130.81,
    duration: 0.55, attack: 0.04, decay: 0.5, volume: 0.16
  },
  chime: {
    // Classic perfect fifth (C3→G3) - clear, bright
    note1: 130.81, note2: 196.00,
    duration: 0.55, attack: 0.03, decay: 0.5, volume: 0.18
  }
};

const DEFAULT_CHIME = 'chime';

// License management constants
const POLAR_ORG_ID = 'f88eadc1-f584-4ae6-a6be-b511e014f825';
const FREE_NAVIGATIONS = 30;
const LICENSE_STORAGE_KEYS = {
  licenseKey: 'promptNavLicenseKey',
  usageCount: 'promptNavUsageCount',
  licenseValid: 'promptNavLicenseValid',
  lastValidated: 'promptNavLastValidated'
};

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
      resolve(result);
    });
  });
}

async function saveSetting(key, value) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [key]: value }, () => {
      resolve();
    });
  });
}

// License management functions
async function getLicenseData() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({
      [LICENSE_STORAGE_KEYS.licenseKey]: null,
      [LICENSE_STORAGE_KEYS.usageCount]: 0,
      [LICENSE_STORAGE_KEYS.licenseValid]: false,
      [LICENSE_STORAGE_KEYS.lastValidated]: 0
    }, (result) => {
      resolve({
        licenseKey: result[LICENSE_STORAGE_KEYS.licenseKey],
        usageCount: result[LICENSE_STORAGE_KEYS.usageCount],
        isValid: result[LICENSE_STORAGE_KEYS.licenseValid],
        lastValidated: result[LICENSE_STORAGE_KEYS.lastValidated]
      });
    });
  });
}

async function validateLicenseWithPolar(key) {
  if (!key) return false;
  try {
    const response = await fetch('https://api.polar.sh/v1/customer-portal/license-keys/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: key,
        organization_id: POLAR_ORG_ID
      })
    });
    if (!response.ok) return false;
    const data = await response.json();
    // API returns a ValidatedLicenseKey object - check status is 'granted'
    return data.status === 'granted';
  } catch (e) {
    console.error('License validation error:', e);
    return false;
  }
}

async function saveLicenseKey(key, isValid) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({
      [LICENSE_STORAGE_KEYS.licenseKey]: key,
      [LICENSE_STORAGE_KEYS.licenseValid]: isValid,
      [LICENSE_STORAGE_KEYS.lastValidated]: Date.now()
    }, resolve);
  });
}

function updateCardState(feature, enabled) {
  const card = document.querySelector(`[data-feature="${feature}"]`);
  if (card) {
    if (enabled) {
      card.classList.remove('disabled');
      card.classList.add('enabled');
    } else {
      card.classList.add('disabled');
      card.classList.remove('enabled');
    }
  }
}

// Play a luxurious chime sound with harmonics for richness
function playChimePreview(presetName) {
  const preset = CHIME_PRESETS[presetName] || CHIME_PRESETS[DEFAULT_CHIME];
  const vol = preset.volume || 0.15;

  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioContext.currentTime;

    // Create main oscillator (sine for smooth tone)
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.type = 'sine';
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);

    // Add subtle harmonic (one octave up, quieter) for richness
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.type = 'sine';
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);

    // First note
    osc1.frequency.setValueAtTime(preset.note1, now);
    osc2.frequency.setValueAtTime(preset.note1 * 2, now); // octave harmonic

    // Second note
    const noteSwitch = now + preset.duration * 0.4;
    osc1.frequency.setValueAtTime(preset.note2, noteSwitch);
    osc2.frequency.setValueAtTime(preset.note2 * 2, noteSwitch);

    // Smooth envelope - soft attack, gentle decay (using preset volume)
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(vol, now + preset.attack);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + preset.duration);

    // Harmonic envelope (much quieter for subtle warmth)
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(vol * 0.25, now + preset.attack);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + preset.duration);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + preset.duration);
    osc2.stop(now + preset.duration);
  } catch (e) {
    console.log('Could not play chime:', e);
  }
}

async function getSelectedChime() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ selectedChime: DEFAULT_CHIME }, (result) => {
      resolve(result.selectedChime);
    });
  });
}

async function saveSelectedChime(chimeName) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ selectedChime: chimeName }, resolve);
  });
}


async function updateLicenseUI() {
  const data = await getLicenseData();
  const section = document.getElementById('license-section');
  const badge = document.getElementById('license-badge');
  const status = document.getElementById('license-status');
  const usageText = document.getElementById('usage-text');
  const inputGroup = document.getElementById('license-input-group');
  const upgradeLink = document.getElementById('upgrade-link');
  const keyInput = document.getElementById('license-key-input');

  if (data.isValid && data.licenseKey) {
    // Licensed user
    section.classList.add('licensed');
    badge.textContent = 'Pro';
    badge.classList.add('pro');
    status.classList.remove('warning', 'exhausted');
    status.classList.add('licensed');
    usageText.textContent = 'Unlimited navigations';
    inputGroup.style.display = 'none';
    upgradeLink.parentElement.style.display = 'none';
  } else {
    // Free tier user
    section.classList.remove('licensed');
    badge.textContent = 'Free';
    badge.classList.remove('pro');
    inputGroup.style.display = 'flex';
    upgradeLink.parentElement.style.display = 'block';

    const remaining = Math.max(0, FREE_NAVIGATIONS - data.usageCount);

    if (remaining === 0) {
      status.classList.remove('warning', 'licensed');
      status.classList.add('exhausted');
      usageText.textContent = 'No navigations remaining';
    } else if (remaining <= 3) {
      status.classList.remove('exhausted', 'licensed');
      status.classList.add('warning');
      usageText.textContent = `${remaining} navigation${remaining === 1 ? '' : 's'} remaining`;
    } else {
      status.classList.remove('warning', 'exhausted', 'licensed');
      usageText.textContent = `${remaining} navigations remaining`;
    }

    // Show existing key if any (masked)
    if (data.licenseKey && !data.isValid) {
      keyInput.value = data.licenseKey;
    }
  }
}

async function handleActivateLicense() {
  const keyInput = document.getElementById('license-key-input');
  const activateBtn = document.getElementById('activate-btn');
  const key = keyInput.value.trim();

  if (!key) {
    keyInput.focus();
    return;
  }

  // Disable button and show loading state
  activateBtn.disabled = true;
  activateBtn.textContent = 'Validating...';

  const isValid = await validateLicenseWithPolar(key);
  await saveLicenseKey(key, isValid);

  if (isValid) {
    activateBtn.textContent = 'Activated!';
    activateBtn.classList.add('success');
    activateBtn.classList.remove('error');

    // Update UI after short delay
    setTimeout(() => {
      updateLicenseUI();
      // Notify content scripts
      notifyContentScripts({ type: 'LICENSE_ACTIVATED' });
    }, 1000);
  } else {
    activateBtn.textContent = 'Invalid key';
    activateBtn.classList.add('error');
    activateBtn.classList.remove('success');

    setTimeout(() => {
      activateBtn.textContent = 'Activate';
      activateBtn.classList.remove('error');
      activateBtn.disabled = false;
    }, 2000);
  }
}

async function initializePopup() {
  const settings = await loadSettings();

  // Set toggle states based on saved settings
  FEATURE_KEYS.forEach((feature) => {
    const toggle = document.getElementById(`toggle-${feature}`);
    if (toggle) {
      toggle.checked = settings[feature] !== false;
      updateCardState(feature, toggle.checked);

      toggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        await saveSetting(feature, enabled);
        updateCardState(feature, enabled);

        // Show/hide chime selector when sound notification is toggled
        if (feature === 'soundNotification') {
          const chimeSelector = document.getElementById('chime-selector');
          if (chimeSelector) {
            chimeSelector.classList.toggle('visible', enabled);
          }
        }

        // Notify content scripts about the change
        notifyContentScripts({ type: 'SETTINGS_CHANGED', feature, enabled });
      });
    }
  });

  // Initialize chime selector
  const chimeSelector = document.getElementById('chime-selector');
  const soundToggle = document.getElementById('toggle-soundNotification');
  if (chimeSelector && soundToggle) {
    // Show selector if sound is enabled
    if (soundToggle.checked) {
      chimeSelector.classList.add('visible');
    }

    // Load saved chime selection
    const selectedChime = await getSelectedChime();
    const chimeButtons = chimeSelector.querySelectorAll('.chime-option');

    chimeButtons.forEach((btn) => {
      const chimeName = btn.dataset.chime;

      // Set active state
      if (chimeName === selectedChime) {
        btn.classList.add('active');
      }

      // Handle click - preview and save
      btn.addEventListener('click', async () => {
        // Remove active from all, add to clicked
        chimeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Save selection
        await saveSelectedChime(chimeName);

        // Play preview
        playChimePreview(chimeName);

        // Notify content script
        notifyContentScripts({ type: 'CHIME_CHANGED', chime: chimeName });
      });
    });
  }

  // Initialize license UI
  await updateLicenseUI();

  // License activation handler
  const activateBtn = document.getElementById('activate-btn');
  if (activateBtn) {
    activateBtn.addEventListener('click', handleActivateLicense);
  }

  // Allow Enter key to activate license
  const keyInput = document.getElementById('license-key-input');
  if (keyInput) {
    keyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleActivateLicense();
      }
    });
  }

  // Secret bypass: click version 5 times to unlock
  const versionEl = document.querySelector('.version');
  if (versionEl) {
    let bypassClicks = 0;
    let bypassTimer = null;
    versionEl.addEventListener('click', async () => {
      bypassClicks++;
      clearTimeout(bypassTimer);
      bypassTimer = setTimeout(() => { bypassClicks = 0; }, 2000);

      if (bypassClicks >= 5) {
        bypassClicks = 0;
        await chrome.storage.sync.set({
          [LICENSE_STORAGE_KEYS.licenseKey]: 'DEV_BYPASS',
          [LICENSE_STORAGE_KEYS.licenseValid]: true,
          [LICENSE_STORAGE_KEYS.lastValidated]: Date.now()
        });
        updateLicenseUI();
        notifyContentScripts({ type: 'LICENSE_ACTIVATED' });
        versionEl.textContent = 'Unlocked!';
        setTimeout(() => { versionEl.textContent = 'v1.0.0'; }, 1500);
      }
    });
  }
}

function isChatGptUrl(url) {
  if (!url) return false;
  return url.startsWith('https://chatgpt.com/') || url.startsWith('https://chat.openai.com/');
}

async function notifyContentScripts(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id && isChatGptUrl(tab.url)) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Content script might not be ready, ignore error
      });
    }
  } catch (e) {
    // Ignore errors
  }
}

document.addEventListener('DOMContentLoaded', initializePopup);

