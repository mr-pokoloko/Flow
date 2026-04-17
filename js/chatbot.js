(function() {
    const STORAGE_KEY = 'flow_chatbot_history_v2';

    const PAGE_CONFIG = {
        'Flow Dashboard': {
            intro: 'I am watching your dashboard view. I can explain budget pressure, savings progress, and which numbers deserve attention first using the data already inside Flow.',
            suggestions: [
                'Summarize my budget status',
                'How can I save more this cycle?',
                'What should I do first on this dashboard?'
            ]
        },
        'Flow - Analytics': {
            intro: 'I can break down the analytics for you, explain trends, and point out what looks unusually high or healthy from the information already saved in Flow.',
            suggestions: [
                'Explain my spending trend simply',
                'What is my riskiest spending pattern?',
                'How should I read these charts?'
            ]
        },
        'Flow - Transactions': {
            intro: 'I can help you review transaction patterns, category behavior, and clean up spending habits one step at a time from your recorded Flow transactions.',
            suggestions: [
                'What should I look for in my transactions?',
                'How do I reduce unnecessary expenses?',
                'Which categories usually need a limit?'
            ]
        },
        'Flow - Reports': {
            intro: 'I can help you understand which report to generate and what insights to look for after you open it based on the data already in Flow.',
            suggestions: [
                'Which report should I generate first?',
                'What should I check in my reports?',
                'How do I turn reports into action?'
            ]
        },
        'Flow - Settings': {
            intro: 'I can guide you through budget settings, alert thresholds, currency choices, and what each option really changes inside Flow.',
            suggestions: [
                'What budget threshold should I use?',
                'How should I set notifications?',
                'What settings matter most?'
            ]
        },
        'Flow Profile': {
            intro: 'I can help you understand the profile view, currency comparison, and what personal details affect your budgeting setup inside Flow.',
            suggestions: [
                'How should I compare currencies here?',
                'What does this profile page help with?',
                'How does currency choice affect budgeting?'
            ]
        },
        'Flow - Login': {
            intro: 'I can explain what Flow does and how the different pages work before you sign in, but I do not connect to your bank account.',
            suggestions: [
                'What can Flow help me with?',
                'What do the main pages do?',
                'How should I use this app daily?'
            ]
        },
        'Flow - Sign Up': {
            intro: 'I can show new users how to get started and what to set up first after creating an account, using data they enter into Flow themselves.',
            suggestions: [
                'What should I do after signup?',
                'How do I set up my budget well?',
                'What is the best first workflow?'
            ]
        },
        'Flow - Smart Expense & Bill Prediction System': {
            intro: 'I can introduce Flow, explain the product, and help visitors understand why the app is useful without implying any direct bank connection.',
            suggestions: [
                'What makes Flow useful?',
                'How does Flow help with budgeting?',
                'What should a new user do first?'
            ]
        }
    };

    function getPageConfig() {
        return PAGE_CONFIG[document.title] || {
            intro: 'I can help with budgets, spending, reports, and using the Flow app more confidently using only the data already available in Flow.',
            suggestions: [
                'Help me understand this page',
                'How can I improve my spending habits?',
                'What should I check first?'
            ]
        };
    }

    function getHistory() {
        try {
            const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(value) ? value : [];
        } catch {
            return [];
        }
    }

    function saveHistory(history) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-24)));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildContext() {
        const context = {
            page: document.title
        };

        if (!window.FinCastData) {
            return context;
        }

        try {
            context.user = FinCastData.getCurrentUser?.() || FinCastData.getUserData?.() || {};
            context.budget = FinCastData.getBudget?.() || {};
            context.analytics = FinCastData.getAnalytics?.() || {};
        } catch (error) {
            console.warn('Unable to collect Flow AI context:', error);
        }

        return context;
    }

    function createWidget(pageConfig) {
        const root = document.createElement('div');
        root.className = 'flow-chatbot';
        root.innerHTML = `
            <div class="flow-chatbot-panel" aria-live="polite">
                <div class="flow-chatbot-header">
                    <div class="flow-chatbot-title">
                        <div class="flow-chatbot-badge"><i class="fas fa-sparkles"></i></div>
                        <div>
                            <h3>Flow AI Assistant</h3>
                            <p>${escapeHtml(pageConfig.intro)}</p>
                        </div>
                    </div>
                    <button type="button" class="flow-chatbot-close" aria-label="Close chat">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="flow-chatbot-messages"></div>
                <div class="flow-chatbot-suggestions"></div>
                <form class="flow-chatbot-form">
                    <textarea class="flow-chatbot-input" rows="1" placeholder="Ask Flow AI for help with your money questions..."></textarea>
                    <button class="flow-chatbot-submit" type="submit" aria-label="Send message">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </form>
            </div>
            <button type="button" class="flow-chatbot-toggle" aria-label="Open Flow AI">
                <span class="flow-chatbot-toggle-icon"><i class="fas fa-comments"></i></span>
                <span class="flow-chatbot-toggle-copy">
                    <strong>Ask Flow AI</strong>
                    <small>Budget help</small>
                </span>
            </button>
        `;
        document.body.appendChild(root);
        return root;
    }

    function renderMessages(container, history) {
        container.innerHTML = history.map(item => `
            <div class="flow-chatbot-message ${item.role === 'user' ? 'user' : 'bot'}">${escapeHtml(item.text)}</div>
        `).join('');
        container.scrollTop = container.scrollHeight;
    }

    function appendMessage(history, role, text) {
        history.push({ role, text });
        saveHistory(history);
        return history;
    }

    function ensureStarterMessage(history, pageConfig) {
        if (history.length) {
            return history;
        }

        history.push({
            role: 'assistant',
            text: `Hi, I am Flow AI. ${pageConfig.intro} I do not connect directly to bank accounts.`
        });
        saveHistory(history);
        return history;
    }

    async function sendMessage(state, text) {
        const trimmed = text.trim();
        if (!trimmed || state.loading) return;

        state.loading = true;
        appendMessage(state.history, 'user', trimmed);
        renderMessages(state.messages, state.history);
        state.form.reset();
        state.input.style.height = '52px';
        state.input.disabled = true;
        state.submit.disabled = true;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: trimmed,
                    history: state.history,
                    context: buildContext()
                })
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || 'Flow AI could not answer right now.');
            }

            appendMessage(state.history, 'assistant', payload.reply || 'I could not generate a response.');
            renderMessages(state.messages, state.history);
        } catch (error) {
            appendMessage(state.history, 'assistant', error.message || 'Flow AI could not answer right now.');
            renderMessages(state.messages, state.history);
        } finally {
            state.loading = false;
            state.input.disabled = false;
            state.submit.disabled = false;
            state.input.focus();
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        const pageConfig = getPageConfig();
        const root = createWidget(pageConfig);
        const toggle = root.querySelector('.flow-chatbot-toggle');
        const close = root.querySelector('.flow-chatbot-close');
        const messages = root.querySelector('.flow-chatbot-messages');
        const suggestions = root.querySelector('.flow-chatbot-suggestions');
        const form = root.querySelector('.flow-chatbot-form');
        const input = root.querySelector('.flow-chatbot-input');
        const submit = root.querySelector('.flow-chatbot-submit');

        const state = {
            history: ensureStarterMessage(getHistory(), pageConfig),
            loading: false,
            form,
            input,
            submit,
            messages
        };

        renderMessages(messages, state.history);
        suggestions.innerHTML = pageConfig.suggestions.map(text => `
            <button type="button" class="flow-chatbot-suggestion">${escapeHtml(text)}</button>
        `).join('');

        toggle.addEventListener('click', function() {
            root.classList.toggle('open');
            if (root.classList.contains('open')) {
                input.focus();
                messages.scrollTop = messages.scrollHeight;
            }
        });

        close.addEventListener('click', function() {
            root.classList.remove('open');
        });

        suggestions.querySelectorAll('.flow-chatbot-suggestion').forEach(button => {
            button.addEventListener('click', function() {
                root.classList.add('open');
                sendMessage(state, button.textContent || '');
            });
        });

        input.addEventListener('input', function() {
            this.style.height = '52px';
            this.style.height = `${Math.min(this.scrollHeight, 120)}px`;
        });

        input.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                form.requestSubmit();
            }
        });

        form.addEventListener('submit', function(event) {
            event.preventDefault();
            sendMessage(state, input.value);
        });

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                root.classList.remove('open');
            }
        });
    });
})();
