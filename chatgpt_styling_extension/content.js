(() => {
    'use strict';

    const USER_CLASS = 'chatgpt-styling-user-prompt';
    const MODEL_CLASS = 'chatgpt-styling-model-response';

    function getConversationMain() {
        return (
            document.querySelector('main#main') ||
            document.querySelector('main[role="main"]') ||
            document.querySelector('main')
        );
    }

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function determineRole(el, index) {
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

    function styleTurns() {
        const main = getConversationMain();
        if (!main) return;

        // Selectors from the other extension
        const candidates = Array.from(
            main.querySelectorAll('[data-testid^="conversation-turn"], [data-message-author-role]')
        );

        let turns = [];
        if (candidates.length === 0) {
            turns = Array.from(main.querySelectorAll('article'));
        } else {
            const seen = new Set();
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
        }

        turns.forEach((turn, index) => {
            if (!isVisible(turn)) return;

            // Try to find a tighter wrapper.
            // Strategy: Look for the element with data-message-author-role if it's nested.
            // If not, look for the first substantial child div.
            let target = turn.querySelector('[data-message-author-role]');

            // If no nested role element, or if it's the turn itself, try to go one level deeper
            // to get "closer to the core text".
            if (!target || target === turn) {
                // Try finding a child that looks like a message wrapper
                // Often there is a wrapper div for the avatar and message
                const childDiv = turn.querySelector('div');
                if (childDiv) {
                    target = childDiv;
                    // Try one more level if possible, as requested ("one more nested div")
                    const grandChild = childDiv.querySelector('div');
                    if (grandChild && isVisible(grandChild)) {
                        target = grandChild;
                    }
                } else {
                    target = turn;
                }
            }

            // Avoid re-processing if already styled
            if (target.classList.contains(USER_CLASS) || target.classList.contains(MODEL_CLASS)) return;

            const role = determineRole(turn, index);
            if (role === 'user') {
                target.classList.add(USER_CLASS);
            } else {
                target.classList.add(MODEL_CLASS);
            }
        });
    }

    // Initial run
    styleTurns();

    // Observer
    // Debounce the observer slightly to avoid too many calls
    let timeout;
    const observer = new MutationObserver(() => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            styleTurns();
        }, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
