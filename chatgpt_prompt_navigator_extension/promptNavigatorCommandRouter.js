'use strict';

const COMMAND_TO_DIRECTION = {
  'jump-to-prev-user-prompt': 'previous',
  'jump-to-next-user-prompt': 'next'
};

const CHATGPT_ORIGINS = ['https://chatgpt.com/', 'https://chat.openai.com/'];

function isChatGptUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }
  return CHATGPT_ORIGINS.some((origin) => url.startsWith(origin));
}

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.warn('Prompt Navigator: tab query failed', chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(tabs && tabs.length ? tabs[0] : null);
    });
  });
}

function sendJumpMessage(tabId, direction) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'PROMPT_JUMP', direction }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        // Ignore "Receiving end does not exist" which happens if content script isn't ready
        if (!lastError.message.includes('Receiving end does not exist')) {
          console.warn('Prompt Navigator: content script message failed', lastError.message);
        }
      } else {
        console.debug('Prompt Navigator (bg): message sent, response:', response);
      }
      resolve();
    });
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  const direction = COMMAND_TO_DIRECTION[command];
  if (!direction) {
    return;
  }

  console.debug('Prompt Navigator (bg): command received', command);

  const activeTab = await queryActiveTab();
  if (!activeTab || !activeTab.id || !isChatGptUrl(activeTab.url)) {
    if (activeTab && activeTab.url) {
      console.debug('Prompt Navigator (bg): active tab URL not ChatGPT', activeTab.url);
    } else {
      console.debug('Prompt Navigator (bg): no suitable active tab');
    }
    return;
  }

  console.debug('Prompt Navigator (bg): sending message to tab', activeTab.id, 'direction', direction);
  await sendJumpMessage(activeTab.id, direction);
});
