(function () {
  'use strict';

  if (window.__chatgptTokenCounterLoaded) {
    return;
  }
  window.__chatgptTokenCounterLoaded = true;

  const estimator = window.ChatGPTTokenEstimator;
  if (!estimator) {
    console.warn('ChatGPT Token Counter: estimator not available.');
    return;
  }

  const COUNTER_ID = 'chatgpt-token-counter';
  const DETAILS_STORAGE_KEY = 'chatgptTokenCounterDetails';
  const UPDATE_DEBOUNCE_MS = 400;
  const NEXT_DATA_BOOTSTRAP_RETRY_MS = 150;
  const NEXT_DATA_BOOTSTRAP_MAX_ATTEMPTS = 8;
  const ATTACHMENT_SELECTORS = [
    '[data-testid*="attachment"]',
    '[data-testid*="upload"]',
    '[data-testid*="file"]',
    '[data-testid*="resource"]',
    'a[download]',
    '[data-file-name]',
    '[data-filename]',
    '[aria-label*="attachment" i]',
    '[aria-label*="uploaded" i]'
  ];
  const SIZE_PATTERN = /([\d.,]+\s*(?:[kmgt]i?b|[kmgt]?b|bytes?))/i;

  let pendingUpdate = null;
  let lastSignature = '';
  let mutationObserver = null;
  let counterDismissed = false;
  let nextDataHydrated = false;
  let nextDataBootstrapAttempts = 0;
  let nextDataObserver = null;

  function createMetaRow(labelText, dataRole) {
    const row = document.createElement('div');
    row.className = 'token-counter__meta-row';

    const label = document.createElement('span');
    label.className = 'token-counter__meta-label';
    label.textContent = labelText;

    const value = document.createElement('span');
    value.className = 'token-counter__meta-value';
    value.dataset.role = dataRole;

    const defaults = {
      'user-token-count': '0 tokens',
      'assistant-token-count': '0 tokens',
      'word-count': '0 words',
      'attachment-count': '0 attachments'
    };
    value.textContent = defaults[dataRole] || '0';

    row.appendChild(label);
    row.appendChild(value);
    return row;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return null;
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
  }

  function parseBytesValue(value, source) {
    if (value == null) {
      return null;
    }

    const string = String(value).trim();
    if (!string) {
      return null;
    }

    const patternMatch = string.match(SIZE_PATTERN);
    if (patternMatch) {
      const sizeText = patternMatch[1];
      const bytes = estimator.parseFileSizeToBytes(sizeText);
      if (bytes) {
        return {
          sizeText,
          bytes,
          source
        };
      }
    }

    const numeric = string.replace(/[^0-9.]/g, '');
    if (!numeric) {
      return null;
    }

    const bytes = Number(numeric);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return null;
    }

    return {
      sizeText: formatBytes(bytes),
      bytes,
      source
    };
  }

  function resolveAttachmentSize(element, candidates) {
    let resolved = null;

    for (const candidate of candidates) {
      const parsed = parseBytesValue(candidate, 'text');
      if (parsed) {
        resolved = parsed;
        if (parsed.sizeText && parsed.bytes) {
          break;
        }
      }
    }

    const attributeNames = [
      'data-size',
      'data-filesize',
      'data-file-size',
      'data-size-bytes',
      'data-bytes',
      'data-byte-size',
      'data-file-bytes'
    ];

    const attributeCandidates = [];
    attributeNames.forEach((name) => {
      const attr = element.getAttribute(name);
      if (attr) {
        attributeCandidates.push({
          value: attr,
          source: `attr:${name}`
        });
      }
    });

    if (element.dataset) {
      Object.entries(element.dataset).forEach(([key, value]) => {
        if (/size|byte/i.test(key) && value) {
          attributeCandidates.push({
            value,
            source: `dataset:${key}`
          });
        }
      });
    }

    for (const candidate of attributeCandidates) {
      const parsed = parseBytesValue(candidate.value, candidate.source);
      if (!parsed) {
        continue;
      }

      if (!resolved) {
        resolved = parsed;
        if (parsed.sizeText && parsed.bytes) {
          break;
        }
        continue;
      }

      if (!resolved.bytes && parsed.bytes) {
        resolved = {
          sizeText: resolved.sizeText || parsed.sizeText,
          bytes: parsed.bytes,
          source: parsed.source
        };
      } else if (!resolved.sizeText && parsed.sizeText) {
        resolved = {
          sizeText: parsed.sizeText,
          bytes: resolved.bytes || parsed.bytes,
          source: parsed.source
        };
      }

      if (resolved.sizeText && resolved.bytes) {
        break;
      }
    }

    if (!resolved) {
      return {
        sizeText: null,
        bytes: null,
        source: null
      };
    }

    return resolved;
  }

  function setDetailsVisibility(container, expanded, persistPreference) {
    const details = container.querySelector('.token-counter__details');
    const toggle = container.querySelector('[data-role="details-toggle"]');
    if (!details || !toggle) {
      return;
    }

    details.hidden = !expanded;
    container.classList.toggle('token-counter--expanded', expanded);
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.textContent = expanded ? '-' : '+';
    toggle.title = expanded ? 'Hide details' : 'Show details';

    if (persistPreference) {
      try {
        localStorage.setItem(DETAILS_STORAGE_KEY, expanded ? 'expanded' : 'collapsed');
      } catch (error) {
        console.debug('ChatGPT Token Counter: failed to persist details state', error);
      }
    }
  }

  function applyStoredDetailsPreference(container) {
    let expanded = false;
    try {
      const stored = localStorage.getItem(DETAILS_STORAGE_KEY);
      if (stored === 'expanded') {
        expanded = true;
      } else if (stored === 'collapsed') {
        expanded = false;
      }
    } catch (error) {
      console.debug('ChatGPT Token Counter: unable to read details state', error);
    }
    setDetailsVisibility(container, expanded, false);
  }

  function hideCounter(container) {
    const target = container || document.getElementById(COUNTER_ID);
    if (!target) {
      return;
    }
    counterDismissed = true;
    target.remove();
  }

  function createCounterElement() {
    const container = document.createElement('section');
    container.id = COUNTER_ID;
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');

    const header = document.createElement('div');
    header.className = 'token-counter__header';

    const title = document.createElement('span');
    title.className = 'token-counter__title';
    title.textContent = 'Tokens';

    const actions = document.createElement('div');
    actions.className = 'token-counter__actions';

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'token-counter__toggle';
    toggleButton.dataset.role = 'details-toggle';
    toggleButton.setAttribute('aria-expanded', 'false');
    toggleButton.title = 'Show details';
    toggleButton.textContent = '+';
    toggleButton.addEventListener('click', () => {
      const expanded = toggleButton.getAttribute('aria-expanded') !== 'true';
      setDetailsVisibility(container, expanded, true);
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'token-counter__close';
    closeButton.title = 'Hide counter';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => hideCounter(container));

    actions.appendChild(toggleButton);
    actions.appendChild(closeButton);

    header.appendChild(title);
    header.appendChild(actions);

    const primary = document.createElement('div');
    primary.className = 'token-counter__primary';

    const countLabel = document.createElement('span');
    countLabel.textContent = 'Tokens';
    countLabel.className = 'token-counter__approx-label';

    const countValue = document.createElement('strong');
    countValue.dataset.role = 'token-count';
    countValue.textContent = '~0';

    primary.appendChild(countLabel);
    primary.appendChild(countValue);

    const meta = document.createElement('div');
    meta.className = 'token-counter__meta';

    const metaDefinitions = [
      ['You', 'user-token-count'],
      ['ChatGPT', 'assistant-token-count'],
      ['Words', 'word-count'],
      ['Attachments', 'attachment-count']
    ];

    metaDefinitions.forEach(([label, role]) => {
      meta.appendChild(createMetaRow(label, role));
    });

    const details = document.createElement('div');
    details.className = 'token-counter__details';
    details.hidden = true;
    details.appendChild(meta);

    container.appendChild(header);
    container.appendChild(primary);
    container.appendChild(details);

    document.body.appendChild(container);
    return container;
  }

  function ensureCounterElement() {
    if (counterDismissed) {
      return null;
    }

    let container = document.getElementById(COUNTER_ID);
    if (!container) {
      container = createCounterElement();
      applyStoredDetailsPreference(container);
    }

    return container;
  }

  function determineRole(article, index) {
    const datasetRole = article.getAttribute('data-message-author-role') || article.dataset.messageAuthorRole;
    if (datasetRole) {
      return datasetRole;
    }

    const testId = (article.getAttribute('data-testid') || '').toLowerCase();
    if (testId.includes('user')) {
      return 'user';
    }
    if (testId.includes('assistant') || testId.includes('model') || testId.includes('gpt')) {
      return 'assistant';
    }
    if (testId.includes('system')) {
      return 'system';
    }

    const ariaLabel = (article.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('you')) {
      return 'user';
    }
    if (ariaLabel.includes('chatgpt') || ariaLabel.includes('assistant')) {
      return 'assistant';
    }

    return index % 2 === 0 ? 'user' : 'assistant';
  }

  function extractMessageId(article, fallbackIndex) {
    return (
      article.getAttribute('data-message-id') ||
      article.dataset.messageId ||
      article.id ||
      `msg-${fallbackIndex}`
    );
  }

  function extractArticleText(article) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = article.innerHTML;
    wrapper.querySelectorAll(
      'button, svg, style, script, textarea, input, select, [role="button"], [aria-hidden="true"], [hidden]'
    ).forEach((element) => {
      element.remove();
    });

    const text = (wrapper.innerText || wrapper.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    return text;
  }

  function getAttachmentAnchor(element) {
    return (
      element.closest('[data-testid*="attachment"]') ||
      element.closest('[data-testid*="upload"]') ||
      element.closest('[data-testid*="file"]') ||
      element.closest('[data-testid*="resource"]') ||
      element
    );
  }

  function sanitizeAttachmentLabel(text, sizeText) {
    if (!text) {
      return '';
    }

    let label = text;
    if (sizeText) {
      label = label.replace(sizeText, ' ');
    }
    label = label.replace(SIZE_PATTERN, ' ');
    label = label.replace(/[\u2022•·|]/g, ' ');
    label = label.replace(/\s+/g, ' ').trim();

    if (!label) {
      return '';
    }

    const separators = [' • ', ' · ', ' - ', ' | '];
    for (const separator of separators) {
      const index = label.indexOf(separator);
      if (index > 0) {
        label = label.slice(0, index).trim();
        break;
      }
    }

    if (label.length > 80) {
      label = `${label.slice(0, 77)}…`;
    }

    return label;
  }

  function collectAttachmentCandidateStrings(element) {
    const strings = new Set();
    const attributeNames = [
      'data-file-name',
      'data-filename',
      'data-original-name',
      'data-name',
      'data-size',
      'data-filesize',
      'aria-label',
      'title'
    ];

    attributeNames.forEach((name) => {
      if (element.hasAttribute(name)) {
        strings.add(element.getAttribute(name));
      }
    });

    const textContent = element.textContent ? element.textContent.trim() : '';
    if (textContent) {
      strings.add(textContent);
    }

    element
      .querySelectorAll('[data-file-name], [data-filename], [data-original-name], [data-name], [data-size], [data-filesize]')
      .forEach((child) => {
        attributeNames.forEach((name) => {
          if (child.hasAttribute(name)) {
            strings.add(child.getAttribute(name));
          }
        });
        const childText = child.textContent ? child.textContent.trim() : '';
        if (childText) {
          strings.add(childText);
        }
      });

    return Array.from(strings).filter(Boolean);
  }

  function parseAttachmentCandidate(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    const candidates = collectAttachmentCandidateStrings(element);
    const resolvedSize = resolveAttachmentSize(element, candidates);
    const sizeText = resolvedSize.sizeText;
    const bytes = resolvedSize.bytes;
    const sizeSource = resolvedSize.source;

    let label = null;
    const preferredAttributes = ['data-file-name', 'data-filename', 'data-original-name'];
    for (const attribute of preferredAttributes) {
      if (element.hasAttribute(attribute)) {
        const sanitized = sanitizeAttachmentLabel(element.getAttribute(attribute), sizeText);
        if (sanitized) {
          label = sanitized;
          break;
        }
      }
    }

    if (!label) {
      for (const candidate of candidates) {
        const sanitized = sanitizeAttachmentLabel(candidate, sizeText);
        if (sanitized) {
          label = sanitized;
          break;
        }
      }
    }

    if (!label) {
      label = 'Attachment';
    }

    const hasSizeInformation = Number.isFinite(bytes) || (!!sizeText && SIZE_PATTERN.test(sizeText));
    if (!hasSizeInformation) {
      return null;
    }

    return {
      label,
      sizeText,
      bytes,
      sizeSource
    };
  }

  function gatherAttachments(root) {
    const scope = root instanceof HTMLElement ? root : document;
    const elements = Array.from(scope.querySelectorAll(ATTACHMENT_SELECTORS.join(', ')));
    const anchors = new Set();

    elements.forEach((element) => {
      anchors.add(getAttachmentAnchor(element));
    });

    const attachments = [];
    const seen = new Set();

    anchors.forEach((anchor) => {
      const parsed = parseAttachmentCandidate(anchor);
      if (!parsed) {
        return;
      }
      const signature = `${parsed.label}|${parsed.sizeText || ''}|${parsed.bytes || ''}`.toLowerCase();
      if (seen.has(signature)) {
        return;
      }
      seen.add(signature);
      attachments.push(parsed);
    });

    return attachments;
  }

  function gatherConversation() {
    const main = document.querySelector('main');
    if (!main) {
      return {
        messages: [],
        attachments: []
      };
    }

    const articles = Array.from(main.querySelectorAll('article'));
    const messages = articles
      .map((article, index) => {
        const text = extractArticleText(article);
        if (!text) {
          return null;
        }
        return {
          id: extractMessageId(article, index),
          role: determineRole(article, index),
          text
        };
      })
      .filter(Boolean);

    return {
      messages,
      attachments: gatherAttachments(main)
    };
  }

  function buildSignature(messages, attachments, totalTokens) {
    const messageSignature = messages
      .map((message) => `${message.id}:${message.role}:${message.stats.tokens}:${message.stats.words}:${message.text.length}`)
      .join('|');
    const attachmentSignature = attachments
      .map(
        (item) =>
          `${item.label}:${item.sizeText || 'unknown'}:${Number.isFinite(item.bytes) ? item.bytes : 'unknown'}:${item.tokens}`
      )
      .join('|');
    return `${location.href}|${totalTokens}|${messageSignature}|${attachmentSignature}`;
  }

  function formatNumber(value) {
    return Number.isFinite(value) ? value.toLocaleString() : '0';
  }

  function renderCounterSnapshot(container, snapshot) {
    if (!container || !snapshot) {
      return;
    }

    const totalTokens = Number.isFinite(snapshot.totalTokens) ? snapshot.totalTokens : 0;
    const userTokens = Number.isFinite(snapshot.userTokens) ? snapshot.userTokens : 0;
    const assistantTokens = Number.isFinite(snapshot.assistantTokens) ? snapshot.assistantTokens : 0;
    const totalWords = Number.isFinite(snapshot.totalWords) ? snapshot.totalWords : 0;
    const attachments = Array.isArray(snapshot.attachments) ? snapshot.attachments : [];

    const tokenNode = container.querySelector('[data-role="token-count"]');
    const userTokenNode = container.querySelector('[data-role="user-token-count"]');
    const assistantTokenNode = container.querySelector('[data-role="assistant-token-count"]');
    const wordsNode = container.querySelector('[data-role="word-count"]');
    const attachmentsNode = container.querySelector('[data-role="attachment-count"]');

    if (tokenNode) {
      tokenNode.textContent = `~${formatNumber(totalTokens)}`;
    }

    if (userTokenNode) {
      userTokenNode.textContent = `${formatNumber(userTokens)} tokens`;
    }

    if (assistantTokenNode) {
      assistantTokenNode.textContent = `${formatNumber(assistantTokens)} tokens`;
    }

    if (wordsNode) {
      wordsNode.textContent = `${formatNumber(totalWords)} words`;
    }

    if (attachmentsNode) {
      const attachmentCount = attachments.length;
      const attachmentTokens = attachments.reduce((sum, item) => {
        return sum + (Number.isFinite(item.tokens) ? item.tokens : 0);
      }, 0);

      if (attachmentTokens) {
        attachmentsNode.textContent = `+${formatNumber(attachmentTokens)} tokens`;
        attachmentsNode.title = attachments
          .map((item) => {
            const label = item.label || 'Attachment';
            const sizeText = item.sizeText ? ` (${item.sizeText})` : '';
            const tokenText = formatNumber(Number.isFinite(item.tokens) ? item.tokens : 0);
            return `${label}${sizeText} ≈ ${tokenText} tokens`;
          })
          .join('\n');
      } else if (attachmentCount) {
        attachmentsNode.textContent = `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`;
        attachmentsNode.title =
          attachments
            .map((item) => `${item.label || 'Attachment'}${item.sizeText ? ` (${item.sizeText})` : ''}`)
            .join('\n') || 'Attachments detected (size not available)';
      } else {
        attachmentsNode.textContent = '0 attachments';
        attachmentsNode.removeAttribute('title');
      }
    }
  }

  function estimateConversationStats(messages, attachments) {
    const safeMessages = Array.isArray(messages)
      ? messages
          .map((message, index) => {
            if (!message || typeof message !== 'object') {
              return null;
            }
            const text = typeof message.text === 'string' ? message.text.trim() : '';
            if (!text) {
              return null;
            }
            return {
              id: message.id || `msg-${index}`,
              role: message.role || 'assistant',
              text
            };
          })
          .filter(Boolean)
      : [];

    const safeAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];

    if (!safeMessages.length && !safeAttachments.length) {
      return null;
    }

    const enrichedMessages = safeMessages.map((message) => {
      const stats = estimator.estimateTokensFromText(message.text);
      return {
        ...message,
        stats
      };
    });

    const totals = enrichedMessages.reduce(
      (acc, message) => {
        acc.totalTokens += message.stats.tokens;
        acc.totalWords += message.stats.words;
        acc.byRole[message.role] = (acc.byRole[message.role] || 0) + message.stats.tokens;
        return acc;
      },
      {
        totalTokens: 0,
        totalWords: 0,
        byRole: {}
      }
    );

    const attachmentDetails = safeAttachments.map((attachment) => {
      let bytes = Number.isFinite(attachment.bytes) ? attachment.bytes : null;
      let sizeText = attachment.sizeText || null;
      let tokens = 0;

      if (!bytes && sizeText) {
        const estimation = estimator.estimateTokensFromFileSizeString(sizeText);
        bytes = Number.isFinite(estimation.bytes) ? estimation.bytes : null;
        tokens = estimation.tokens || 0;
      } else if (bytes) {
        tokens = estimator.estimateTokensFromBytes(bytes);
      }

      if (!sizeText && bytes) {
        sizeText = formatBytes(bytes);
      }

      return {
        ...attachment,
        sizeText,
        bytes,
        tokens
      };
    });

    const attachmentTokens = attachmentDetails.reduce((sum, item) => sum + item.tokens, 0);
    const totalTokens = totals.totalTokens + attachmentTokens;

    const attachmentSnapshot = attachmentDetails.map((item) => ({
      label: item.label,
      sizeText: item.sizeText,
      tokens: item.tokens
    }));

    return {
      enrichedMessages,
      attachmentDetails,
      snapshot: {
        totalTokens,
        userTokens: totals.byRole.user || 0,
        assistantTokens: totals.byRole.assistant || 0,
        totalWords: totals.totalWords,
        attachments: attachmentSnapshot
      }
    };
  }

  function getNextDataPayload() {
    try {
      const script = document.getElementById('__NEXT_DATA__');
      if (!script || !script.textContent) {
        return null;
      }
      return JSON.parse(script.textContent);
    } catch (error) {
      console.debug('ChatGPT Token Counter: unable to parse __NEXT_DATA__ payload', error);
      return null;
    }
  }

  function collectNextDataMessageCandidates(node, results, visited) {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (!visited) {
      visited = new WeakSet();
    }
    if (visited.has(node)) {
      return;
    }
    visited.add(node);

    if (Array.isArray(node)) {
      const hasMessageShape = node.some((item) => {
        return item && typeof item === 'object' && (item.content || item.parts || item.text || item.message || item.metadata);
      });
      if (hasMessageShape) {
        results.push(node);
      }
      node.forEach((child) => collectNextDataMessageCandidates(child, results, visited));
      return;
    }

    if (node.mapping && typeof node.mapping === 'object') {
      const mappingMessages = Object.values(node.mapping)
        .map((entry) => (entry && (entry.message || entry.data || entry.node)) || null)
        .map((entry) => {
          if (!entry) {
            return null;
          }
          if (entry.message) {
            return entry.message;
          }
          return entry;
        })
        .filter(Boolean);
      if (mappingMessages.length) {
        results.push(mappingMessages);
      }
    }

    Object.values(node).forEach((value) => {
      collectNextDataMessageCandidates(value, results, visited);
    });
  }

  function extractTextFromMessageContent(message) {
    const segments = [];
    const visited = new WeakSet();

    function appendSegment(value) {
      if (value == null) {
        return;
      }

      const valueType = typeof value;
      if (valueType === 'string' || valueType === 'number') {
        const text = String(value).trim();
        if (text) {
          segments.push(text);
        }
        return;
      }

      if (valueType === 'boolean') {
        return;
      }

      if (valueType !== 'object') {
        return;
      }

      if (visited.has(value)) {
        return;
      }
      visited.add(value);

      if (Array.isArray(value)) {
        value.forEach(appendSegment);
        return;
      }

      if (typeof value.text === 'string' || typeof value.text === 'number') {
        appendSegment(value.text);
      } else if (Array.isArray(value.text)) {
        value.text.forEach(appendSegment);
      }

      if (value.content != null) {
        appendSegment(value.content);
      }
      if (value.parts != null) {
        appendSegment(value.parts);
      }
      if (value.value != null) {
        appendSegment(value.value);
      }
      if (value.message != null) {
        appendSegment(value.message);
      }
      if (value.body != null) {
        appendSegment(value.body);
      }
      if (value.metadata && typeof value.metadata === 'object') {
        if (value.metadata.text) {
          appendSegment(value.metadata.text);
        }
        if (value.metadata.content) {
          appendSegment(value.metadata.content);
        }
        if (value.metadata.message) {
          appendSegment(value.metadata.message);
        }
      }
      if (value.annotations && Array.isArray(value.annotations)) {
        value.annotations.forEach(appendSegment);
      }
      if (value.data && typeof value.data === 'string') {
        appendSegment(value.data);
      }
    }

    if (message) {
      if (message.content != null) {
        appendSegment(message.content);
      } else if (message.parts != null) {
        appendSegment(message.parts);
      } else if (typeof message.text === 'string' || typeof message.text === 'number') {
        appendSegment(message.text);
      }

      if (!segments.length && typeof message.message === 'string') {
        appendSegment(message.message);
      }
      if (!segments.length && typeof message.body === 'string') {
        appendSegment(message.body);
      }
    }

    return segments.join('\n').trim();
  }

  function normalizeNextDataMessages(rawMessages) {
    if (!Array.isArray(rawMessages)) {
      return [];
    }

    return rawMessages
      .map((message, index) => {
        if (!message || typeof message !== 'object') {
          return null;
        }
        const text = extractTextFromMessageContent(message);
        if (!text) {
          return null;
        }

        const rawRole =
          (typeof message.role === 'string' && message.role) ||
          (message.author && typeof message.author === 'string' && message.author) ||
          (message.author && typeof message.author === 'object' && message.author.role) ||
          null;

        const normalizedRole = (rawRole || '').toLowerCase();
        let role = 'assistant';
        if (normalizedRole === 'user' || normalizedRole === 'system' || normalizedRole === 'assistant') {
          role = normalizedRole;
        } else if (normalizedRole === 'tool' || normalizedRole === 'function') {
          role = 'assistant';
        }

        return {
          id: message.id || message.message_id || message.turnId || `next-${index}`,
          role,
          text
        };
      })
      .filter(Boolean);
  }

  function extractMessagesFromNextData() {
    const payload = getNextDataPayload();
    if (!payload) {
      return [];
    }

    const candidates = [];
    collectNextDataMessageCandidates(payload, candidates, new WeakSet());

    let bestMessages = [];
    let bestScore = 0;

    candidates.forEach((candidate) => {
      const normalized = normalizeNextDataMessages(candidate);
      if (!normalized.length) {
        return;
      }
      const roles = new Set(normalized.map((message) => message.role));
      let score = normalized.length;
      if (roles.has('user')) {
        score += 2;
      }
      if (roles.has('assistant')) {
        score += 2;
      }
      if (roles.has('system')) {
        score += 1;
      }
      if (score > bestScore) {
        bestMessages = normalized;
        bestScore = score;
      }
    });

    return bestMessages;
  }

  function disconnectNextDataObserver() {
    if (nextDataObserver) {
      nextDataObserver.disconnect();
      nextDataObserver = null;
    }
  }

  function bootstrapCounterFromNextData(container, options) {
    const force = options && options.force;
    if (!container) {
      return;
    }

    if (nextDataHydrated && !force) {
      return;
    }

    const messages = extractMessagesFromNextData();
    if (!messages.length) {
      if (nextDataBootstrapAttempts < NEXT_DATA_BOOTSTRAP_MAX_ATTEMPTS) {
        nextDataBootstrapAttempts += 1;
        setTimeout(() => bootstrapCounterFromNextData(container), NEXT_DATA_BOOTSTRAP_RETRY_MS);
      }
      return;
    }

    const estimation = estimateConversationStats(messages, []);
    if (!estimation) {
      return;
    }

    nextDataHydrated = true;
    nextDataBootstrapAttempts = 0;
    disconnectNextDataObserver();
    renderCounterSnapshot(container, estimation.snapshot);
  }

  function ensureNextDataObserver(container) {
    if (nextDataObserver || typeof MutationObserver === 'undefined') {
      return;
    }

    const target = document.documentElement || document.body || document;
    if (!target) {
      return;
    }

    nextDataObserver = new MutationObserver(() => {
      const script = document.getElementById('__NEXT_DATA__');
      if (!script || !script.textContent) {
        return;
      }
      bootstrapCounterFromNextData(container, { force: true });
      if (nextDataHydrated) {
        disconnectNextDataObserver();
      }
    });

    nextDataObserver.observe(target, {
      childList: true,
      subtree: true
    });
  }

  function updateCounter() {
    pendingUpdate = null;

    const container = ensureCounterElement();
    if (!container) {
      return;
    }

    const { messages, attachments } = gatherConversation();

    const estimation = estimateConversationStats(messages, attachments);
    if (!estimation) {
      return;
    }

    const { enrichedMessages, attachmentDetails, snapshot } = estimation;

    const signature = buildSignature(enrichedMessages, attachmentDetails, snapshot.totalTokens);
    if (signature === lastSignature) {
      return;
    }
    lastSignature = signature;

    renderCounterSnapshot(container, snapshot);

    if (attachmentDetails.length && window.__CHATGPT_TOKEN_COUNTER_DEBUG_ATTACHMENTS) {
      console.debug('ChatGPT Token Counter: attachments detected', attachmentDetails);
    }
  }

  function scheduleUpdate() {
    if (pendingUpdate) {
      clearTimeout(pendingUpdate);
    }
    pendingUpdate = setTimeout(updateCounter, UPDATE_DEBOUNCE_MS);
  }

  function initializeObservers() {
    if (mutationObserver) {
      return;
    }
    mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true
    });
  }

  function initialize() {
    const container = ensureCounterElement();
    bootstrapCounterFromNextData(container);
    if (!nextDataHydrated) {
      ensureNextDataObserver(container);
    }
    scheduleUpdate();
    initializeObservers();

    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('hashchange', scheduleUpdate);
    document.addEventListener('visibilitychange', scheduleUpdate);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initialize();
  } else {
    window.addEventListener('DOMContentLoaded', initialize);
  }
})();
