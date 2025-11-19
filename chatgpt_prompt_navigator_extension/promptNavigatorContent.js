(() => {
  'use strict';

  // ===========================================================================
  // 1. Logger
  // ===========================================================================
  class Logger {
    constructor() {
      this.debugMode = false;
      try {
        this.debugMode = localStorage.getItem('prompt-nav-debug') === '1';
      } catch (_) { }
    }

    log(...args) {
      if (this.debugMode) console.log('[PromptNav]', ...args);
    }

    warn(...args) {
      console.warn('[PromptNav]', ...args);
    }

    error(...args) {
      console.error('[PromptNav]', ...args);
    }

    debug(...args) {
      if (this.debugMode) console.debug('[PromptNav]', ...args);
    }
  }

  const logger = new Logger();

  // ===========================================================================
  // 2. PromptDetector
  // ===========================================================================
  class PromptDetector {
    constructor() {
      this.prompts = [];
    }

    /**
     * Scans the DOM for conversation turns and filters for user prompts.
     * @returns {HTMLElement[]} Array of user prompt elements.
     */
    scan() {
      const main = this._getConversationMain();
      if (!main) {
        logger.debug('Scan: No <main> found.');
        this.prompts = [];
        return [];
      }

      const turns = this._collectTurns(main);
      const userPrompts = [];

      turns.forEach((turn, index) => {
        if (!this._isVisible(turn)) return;
        const role = this._determineRole(turn, index);
        if (role === 'user') {
          userPrompts.push(turn);
        }
      });

      // Fallback: If no user prompts found but turns exist, treat all turns as prompts
      if (userPrompts.length === 0 && turns.length > 0) {
        logger.warn('Scan: No user prompts identified. Falling back to all visible turns.');
        this.prompts = turns.filter(t => this._isVisible(t));
      } else {
        this.prompts = userPrompts;
      }

      logger.debug(`Scan: Found ${this.prompts.length} prompts out of ${turns.length} turns.`);
      return this.prompts;
    }

    getPrompts() {
      return this.prompts;
    }

    _getConversationMain() {
      // Priority: main#main > main[role="main"] > main
      return (
        document.querySelector('main#main') ||
        document.querySelector('main[role="main"]') ||
        document.querySelector('main')
      );
    }

    _collectTurns(root) {
      // 1. Try modern data-testid selectors
      const candidates = Array.from(
        root.querySelectorAll('[data-testid^="conversation-turn"], [data-message-author-role]')
      );

      if (candidates.length === 0) {
        // 2. Fallback to <article>
        return Array.from(root.querySelectorAll('article'));
      }

      // Deduplicate
      const seen = new Set();
      const turns = [];
      candidates.forEach(node => {
        const container =
          node.closest('[data-testid^="conversation-turn"]') ||
          node.closest('article') ||
          node;

        if (container && !seen.has(container)) {
          seen.add(container);
          turns.push(container);
        }
      });
      return turns;
    }

    _isVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 || rect.width === 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    _determineRole(el, index) {
      // 1. Check data-message-author-role
      const roleAttr = el.getAttribute('data-message-author-role') || el.dataset?.messageAuthorRole;
      if (roleAttr) return roleAttr;

      const nestedRoleEl = el.querySelector('[data-message-author-role]');
      if (nestedRoleEl) {
        return nestedRoleEl.getAttribute('data-message-author-role');
      }

      // 2. Check data-testid
      const testId = (el.getAttribute('data-testid') || '').toLowerCase();
      if (testId.includes('user')) return 'user';
      if (testId.includes('assistant') || testId.includes('model') || testId.includes('gpt')) return 'assistant';

      // 3. Check aria-label
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('you')) return 'user';
      if (ariaLabel.includes('chatgpt') || ariaLabel.includes('assistant')) return 'assistant';

      // 4. Fallback: Alternating index
      return index % 2 === 0 ? 'user' : 'assistant';
    }
  }

  // ===========================================================================
  // 3. Navigator
  // ===========================================================================
  class Navigator {
    constructor(promptDetector) {
      this.detector = promptDetector;
      this.lastJumpTime = 0;
      this.lastAnchor = null;
    }

    jump(direction) {
      const prompts = this.detector.getPrompts();
      if (!prompts.length) {
        return { success: false, reason: 'no_prompts' };
      }

      const context = this._getScrollContext();
      const anchors = this._buildAnchors(prompts, context);

      if (!anchors.length) {
        return { success: false, reason: 'no_anchors' };
      }

      const target = this._findTargetAnchor(anchors, context, direction);

      if (!target) {
        return { success: false, reason: 'no_target' };
      }

      this._scrollToAnchor(target, context);
      this.lastAnchor = { element: target.element, kind: target.kind };

      return {
        success: true,
        promptIndex: target.promptIndex,
        total: prompts.length,
        element: target.element
      };
    }

    getCurrentPromptIndex() {
      const prompts = this.detector.getPrompts();
      if (!prompts.length) return -1;

      const context = this._getScrollContext();
      const viewportCenter = context.scrollTop + (context.viewHeight / 2);

      // Find the prompt closest to the center
      let closestIndex = -1;
      let minDiff = Infinity;

      prompts.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        const topY = context.scrollTop + (rect.top - context.containerTop);
        const bottomY = topY + rect.height;
        const centerY = (topY + bottomY) / 2;

        const diff = Math.abs(centerY - viewportCenter);
        if (diff < minDiff) {
          minDiff = diff;
          closestIndex = index;
        }
      });

      return closestIndex;
    }

    _getScrollContext() {
      let container = null;
      const prompts = this.detector.getPrompts();

      if (prompts.length > 0) {
        container = this._findScrollParent(prompts[0]);
      } else {
        const main = this.detector._getConversationMain();
        if (main && this._isScrollable(main)) {
          container = main;
        } else {
          container = window;
        }
      }

      if (container === window || container === document.documentElement || container === document.body) {
        return {
          container: window,
          scrollTop: window.scrollY,
          viewHeight: window.innerHeight,
          containerTop: 0,
          isWindow: true
        };
      }

      const rect = container.getBoundingClientRect();
      return {
        container: container,
        scrollTop: container.scrollTop,
        viewHeight: rect.height,
        containerTop: rect.top,
        isWindow: false
      };
    }

    _findScrollParent(element) {
      let current = element.parentElement;
      while (current) {
        if (this._isScrollable(current)) {
          return current;
        }
        if (current === document.body || current === document.documentElement) {
          return window;
        }
        current = current.parentElement;
      }
      return window;
    }

    _isScrollable(element) {
      const style = window.getComputedStyle(element);
      const isOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll';
      return isOverflow && element.scrollHeight > element.clientHeight;
    }

    _buildAnchors(prompts, context) {
      const anchors = [];
      const largeThreshold = context.viewHeight * 0.8;

      prompts.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        const topY = context.scrollTop + (rect.top - context.containerTop);
        const height = rect.height;
        const bottomY = topY + height;

        anchors.push({
          element: el,
          kind: 'top',
          y: topY,
          promptIndex: index
        });

        if (height > largeThreshold) {
          anchors.push({
            element: el,
            kind: 'bottom',
            y: bottomY,
            promptIndex: index
          });
        }
      });

      let scrollHeight = 0;
      if (context.isWindow) {
        scrollHeight = document.documentElement.scrollHeight;
      } else {
        scrollHeight = context.container.scrollHeight;
      }

      anchors.push({
        element: null,
        kind: 'chat-bottom',
        y: scrollHeight,
        promptIndex: prompts.length
      });

      return anchors.sort((a, b) => a.y - b.y);
    }

    _findTargetAnchor(anchors, context, direction) {
      const viewportCenter = context.scrollTop + (context.viewHeight / 2);

      let currentIndex = -1;

      if (this.lastAnchor) {
        currentIndex = anchors.findIndex(a =>
          a.element === this.lastAnchor.element && a.kind === this.lastAnchor.kind
        );
      }

      if (currentIndex === -1) {
        let minDiff = Infinity;
        anchors.forEach((a, i) => {
          const diff = Math.abs(a.y - viewportCenter);
          if (diff < minDiff) {
            minDiff = diff;
            currentIndex = i;
          }
        });
      }

      if (direction === 'next') {
        if (currentIndex >= anchors.length - 1) return anchors[anchors.length - 1];
        return anchors[currentIndex + 1];
      } else {
        if (currentIndex <= 0) return anchors[0];
        return anchors[currentIndex - 1];
      }
    }

    _scrollToAnchor(anchor, context) {
      const now = Date.now();
      const isRapid = (now - this.lastJumpTime) < 300;
      this.lastJumpTime = now;
      const behavior = isRapid ? 'auto' : 'smooth';

      let targetScrollTop = 0;

      if (anchor.kind === 'chat-bottom') {
        if (context.isWindow) {
          targetScrollTop = document.documentElement.scrollHeight - context.viewHeight;
        } else {
          targetScrollTop = context.container.scrollHeight - context.viewHeight;
        }
      } else {
        if (anchor.kind === 'top') {
          const padding = context.viewHeight * 0.15;
          targetScrollTop = anchor.y - padding;
        } else {
          const padding = context.viewHeight * 0.2;
          targetScrollTop = anchor.y - context.viewHeight + padding;
        }
      }

      const maxScroll = (context.isWindow ? document.documentElement.scrollHeight : context.container.scrollHeight) - context.viewHeight;
      targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));

      if (context.isWindow) {
        window.scrollTo({ top: targetScrollTop, behavior });
      } else {
        context.container.scrollTo({ top: targetScrollTop, behavior });
      }
    }
  }

  // ===========================================================================
  // 4. UI
  // ===========================================================================
  class UI {
    constructor() {
      this.widgetId = 'prompt-navigator-widget';
      this.styleId = 'prompt-navigator-style';
      this.widgetLabel = null;
      this.revertTimer = null;
    }

    injectStyles() {
      if (document.getElementById(this.styleId)) return;
      const style = document.createElement('style');
      style.id = this.styleId;
      style.textContent = `
        #${this.widgetId} {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 99999;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: #202123;
          color: #ececf1;
          border: 1px solid #565869;
          border-radius: 6px;
          font-family: sans-serif;
          font-size: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          user-select: none;
          opacity: 0.9;
          transition: opacity 0.2s;
        }
        #${this.widgetId}:hover {
          opacity: 1;
        }
        #${this.widgetId} button {
          background: transparent;
          border: none;
          color: inherit;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
        }
        #${this.widgetId} button:hover {
          background: rgba(255,255,255,0.1);
        }
        .pn-label {
          font-weight: 600;
          min-width: 80px;
          text-align: center;
        }
        .pn-error {
          border-color: #ef4444 !important;
          color: #ef4444 !important;
        }
      `;
      document.head.appendChild(style);
    }

    createWidget(onPrev, onNext) {
      if (document.getElementById(this.widgetId)) return;

      const container = document.createElement('div');
      container.id = this.widgetId;

      const label = document.createElement('span');
      label.className = 'pn-label';
      label.textContent = 'PromptNav';
      this.widgetLabel = label;

      const btnUp = document.createElement('button');
      btnUp.textContent = '▲';
      btnUp.title = 'Previous Prompt (Alt+E)';
      btnUp.onclick = (e) => { e.stopPropagation(); onPrev(); };

      const btnDown = document.createElement('button');
      btnDown.textContent = '▼';
      btnDown.title = 'Next Prompt (Alt+D)';
      btnDown.onclick = (e) => { e.stopPropagation(); onNext(); };

      container.appendChild(label);
      container.appendChild(btnUp);
      container.appendChild(btnDown);
      document.body.appendChild(container);
    }

    updateStatus(currentIndex, total) {
      if (this.widgetLabel && !this.revertTimer) {
        if (total === 0) {
          this.widgetLabel.textContent = 'No Prompts';
        } else if (currentIndex >= 0) {
          this.widgetLabel.textContent = `${currentIndex + 1} / ${total}`;
        } else {
          this.widgetLabel.textContent = `- / ${total}`;
        }
      }
    }

    flashMessage(msg, isError = false) {
      if (!this.widgetLabel) return;

      const widget = document.getElementById(this.widgetId);
      if (isError && widget) widget.classList.add('pn-error');

      this.widgetLabel.textContent = msg;

      if (this.revertTimer) clearTimeout(this.revertTimer);
      this.revertTimer = setTimeout(() => {
        if (widget) widget.classList.remove('pn-error');
        this.revertTimer = null;
        document.dispatchEvent(new CustomEvent('prompt-nav-refresh-ui'));
      }, 1500);
    }
  }

  // ===========================================================================
  // 5. InputHandler
  // ===========================================================================
  class InputHandler {
    constructor(onJump) {
      this.onJump = onJump;
    }

    init() {
      window.addEventListener('keydown', (e) => this._handleKey(e), { capture: true });
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'PROMPT_JUMP') {
          logger.debug('Command received:', msg.direction);
          this.onJump(msg.direction);
          sendResponse({ received: true });
        }
      });
    }

    _handleKey(e) {
      const target = e.target;
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) {
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        if (e.code === 'KeyE') {
          e.preventDefault();
          e.stopPropagation();
          this.onJump('previous');
        } else if (e.code === 'KeyD') {
          e.preventDefault();
          e.stopPropagation();
          this.onJump('next');
        }
      }
    }
  }

  // ===========================================================================
  // 6. App (Main Controller)
  // ===========================================================================
  class App {
    constructor() {
      this.detector = new PromptDetector();
      this.navigator = new Navigator(this.detector);
      this.ui = new UI();
      this.inputHandler = new InputHandler((dir) => this.handleJump(dir));

      this.refreshTimer = null;
      this.scrollTimer = null;
    }

    init() {
      logger.debug('Initializing...');
      this.ui.injectStyles();
      this.ui.createWidget(
        () => this.handleJump('previous'),
        () => this.handleJump('next')
      );
      this.inputHandler.init();

      this.scanAndRefresh();

      this._setupMutationObserver();
      this._setupScrollListener();

      document.addEventListener('prompt-nav-refresh-ui', () => this.updateUI());
      setInterval(() => this.scanAndRefresh(), 2000);
    }

    scanAndRefresh() {
      this.detector.scan();
      this.updateUI();
    }

    updateUI() {
      const prompts = this.detector.getPrompts();
      const currentIndex = this.navigator.getCurrentPromptIndex();
      this.ui.updateStatus(currentIndex, prompts.length);
    }

    handleJump(direction) {
      try {
        this.detector.scan();
        const result = this.navigator.jump(direction);

        if (result.success) {
          // No highlighting anymore
          // The scroll listener will update the UI status automatically as we scroll,
          // but we can force an update here for responsiveness if we want.
          // Actually, let's rely on the scroll listener or updateUI.
          this.updateUI();
        } else {
          logger.warn('Jump failed:', result.reason);
          if (result.reason === 'no_prompts') {
            this.ui.flashMessage('No Prompts', true);
          } else if (result.reason === 'no_target') {
            this.ui.flashMessage('End of Chat', false);
          } else {
            this.ui.flashMessage('Error', true);
          }
        }
      } catch (err) {
        logger.error('Jump Error:', err);
        this.ui.flashMessage('Error!', true);
      }
    }

    _setupMutationObserver() {
      const observer = new MutationObserver((mutations) => {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
          this.scanAndRefresh();
        }, 500);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    _setupScrollListener() {
      // We need to listen to scroll on the correct container.
      // Since the container can change (window vs main), we might need to attach to window 
      // and capture, or attach to both.
      // Window scroll events capture most things.
      window.addEventListener('scroll', () => {
        if (this.scrollTimer) return;
        this.scrollTimer = setTimeout(() => {
          this.updateUI();
          this.scrollTimer = null;
        }, 100);
      }, { capture: true, passive: true });
    }
  }

  // Start
  const app = new App();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
  } else {
    app.init();
  }

})();
