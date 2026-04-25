const FINCAST_APP_STATE_KEY = 'fincast_app_state_v2';
const FINCAST_SESSION_KEY = 'fincast_session_v2';
const FINCAST_AUTH_GUARD = 'fincast_auth_ready';
const FINCAST_REMOTE_SYNC_BLOCKED = 'fincast_remote_sync_blocked';
const FINCAST_LEGACY_STORAGE_KEY = 'fincast_expenses';
const FINCAST_LEGACY_USER_KEY = 'fincast_user_data';
const FINCAST_LEGACY_BUDGET_KEY = 'fincast_budget';
const FINCAST_LEGACY_SETTINGS_KEY = 'fincast_settings';
const FINCAST_CURRENCY_CACHE_KEY = 'fincast_currency_cache_v1';
const FINCAST_EXCHANGE_API_BASE = 'https://api.frankfurter.dev/v2';

const DEFAULT_BUDGET = {
    monthly: 5000,
    alertThreshold: 80,
    currency: 'INR',
    autoRenew: false,
    renewalDay: 1
};

const DEFAULT_SETTINGS = {
    budgetAlerts: true,
    weeklySummary: true,
    largeExpenseAlerts: false,
    billReminders: true,
    twoFactor: true,
    theme: 'light'
};

const DEFAULT_PROFILE = {
    fullName: 'John Doe',
    username: 'johndoe',
    email: 'john.doe@example.com',
    phone: '+91 98765 43210',
    role: 'Premium Member',
    profileImage: ''
};

const FinCastData = {
    listeners: {},
    _applyingRecurring: false,

    init() {
        const state = this.getState();
        this.migrateLegacyState(state);
        this.ensureDemoUser(state);
        this.setState(state);
        this.syncLegacyStorage();
        this.applyTheme(this.getTheme());
        this.bindSignOutLinks();
        this.bindThemeControls();
        this.bindNotificationControls();
        this.syncSessionFromRemote();
    },

    isRemoteApiAvailable() {
        return window.location.protocol === 'http:' || window.location.protocol === 'https:';
    },

    async requestApi(path, options = {}) {
        if (!this.isRemoteApiAvailable()) return null;

        try {
            const response = await fetch(path, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                }
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || 'Request failed.');
            }
            return payload;
        } catch (error) {
            console.warn(`Flow remote request failed for ${path}:`, error);
            throw error;
        }
    },

    normalizeRemoteUser(user) {
        if (!user) return null;
        return {
            id: user.id,
            username: user.username,
            fullName: user.fullName || user.full_name || user.username || DEFAULT_PROFILE.fullName,
            email: user.email || '',
            phone: user.phone || '',
            role: user.role || DEFAULT_PROFILE.role,
            profileImage: user.profileImage || user.profile_image || '',
            passwordHash: user.passwordHash || user.password_hash || null,
            legacyAccount: Boolean(user.legacyAccount ?? user.legacy_account),
            createdAt: user.createdAt || user.created_at || new Date().toISOString()
        };
    },

    applyRemoteBootstrap(payload, options = {}) {
        const remoteUser = this.normalizeRemoteUser(payload?.user);
        if (!remoteUser?.username) return null;

        const username = remoteUser.username;
        const state = this.getState();
        const existingIndex = state.users.findIndex(user => user.username === username);
        if (existingIndex >= 0) {
            state.users[existingIndex] = {
                ...state.users[existingIndex],
                ...remoteUser
            };
        } else {
            state.users.push(remoteUser);
        }

        state.expensesByUser[username] = this.dedupeExpenses((payload.expenses || []).map(item => ({
            id: item.id,
            name: item.name || item.title,
            amount: Number(item.amount) || 0,
            category: item.category || 'Other',
            date: item.date || new Date().toISOString().split('T')[0],
            recurringId: item.recurringId || item.recurring_id || null,
            sourceType: item.sourceType || item.source_type || 'manual',
            scheduleKey: item.scheduleKey || item.schedule_key || null
        })));
        state.recurringByUser[username] = (payload.recurring || []).map(item => this.normalizeRecurringItem(item));
        state.reportsByUser[username] = (payload.reports || []).map(item => ({
            id: item.id,
            type: item.type || item.report_type || 'monthly',
            name: item.name || 'Report',
            period: item.period || '',
            generatedOn: item.generatedOn || item.generated_on || new Date().toISOString(),
            size: item.size || '0 KB',
            content: item.content || {}
        }));
        state.budgetsByUser[username] = {
            ...DEFAULT_BUDGET,
            ...(payload.budget || {})
        };
        state.settingsByUser[username] = {
            ...DEFAULT_SETTINGS,
            ...(payload.settings || {})
        };
        state.notificationsByUser[username] = state.notificationsByUser[username] || [];
        this.setState(state);
        this.setSession({
            username,
            userId: remoteUser.id,
            loggedInAt: new Date().toISOString()
        });
        this.syncLegacyStorage();
        this.applyTheme(state.settingsByUser[username].theme || DEFAULT_SETTINGS.theme);
        this.notifyDataChange(options.eventName || 'remote_sync_completed', { username });
        return remoteUser;
    },

    async syncSessionFromRemote() {
        const session = this.getSession();
        const username = session?.username;
        if (!username || !this.isRemoteApiAvailable()) return null;

        try {
            const payload = await this.requestApi(`/api/bootstrap/${encodeURIComponent(username)}`);
            return this.applyRemoteBootstrap(payload, { eventName: 'remote_session_synced' });
        } catch {
            return null;
        }
    },

    getState() {
        const raw = localStorage.getItem(FINCAST_APP_STATE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                return this.normalizeState(parsed);
            } catch (error) {
                console.error('Unable to parse Flow app state:', error);
            }
        }

        return this.normalizeState({});
    },

    setState(state) {
        localStorage.setItem(FINCAST_APP_STATE_KEY, JSON.stringify(this.normalizeState(state)));
    },

    normalizeState(state) {
        return {
            users: Array.isArray(state.users) ? state.users : [],
            expensesByUser: state.expensesByUser || {},
            budgetsByUser: state.budgetsByUser || {},
            settingsByUser: state.settingsByUser || {},
            recurringByUser: state.recurringByUser || {},
            reportsByUser: state.reportsByUser || {},
            notificationsByUser: state.notificationsByUser || {}
        };
    },

    migrateLegacyState(state) {
        const legacyUser = localStorage.getItem('fincastUser');
        const legacyFullName = localStorage.getItem('fincastFullName');
        const legacyEmail = localStorage.getItem('fincastEmail');
        const legacyPhone = localStorage.getItem('fincastPhone');
        const legacyLoggedIn = localStorage.getItem('fincastLoggedIn') === 'true';
        const legacyUserData = this.safeParse(localStorage.getItem(FINCAST_LEGACY_USER_KEY), {});
        const legacyBudget = this.safeParse(localStorage.getItem(FINCAST_LEGACY_BUDGET_KEY), {});
        const legacySettings = this.safeParse(localStorage.getItem(FINCAST_LEGACY_SETTINGS_KEY), {});
        const legacyExpenses = this.safeParse(localStorage.getItem(FINCAST_LEGACY_STORAGE_KEY), []);
        const legacyCachedExpenses = this.safeParse(localStorage.getItem('fincast_cached_expenses'), []);

        const username = (legacyUser || legacyUserData.username || DEFAULT_PROFILE.username).trim();
        if (!username) return;

        if (!state.users.some(user => user.username === username)) {
            state.users.push({
                id: this.makeId('user'),
                username,
                fullName: legacyFullName || legacyUserData.username || DEFAULT_PROFILE.fullName,
                email: legacyEmail || legacyUserData.email || DEFAULT_PROFILE.email,
                phone: legacyPhone || legacyUserData.phone || DEFAULT_PROFILE.phone,
                role: legacyUserData.role || DEFAULT_PROFILE.role,
                profileImage: localStorage.getItem('fincastProfileImage') || '',
                passwordHash: null,
                legacyAccount: true,
                createdAt: new Date().toISOString()
            });
        }

        if (!state.expensesByUser[username] && (legacyExpenses.length || legacyCachedExpenses.length)) {
            const mergedExpenses = [...legacyCachedExpenses, ...legacyExpenses].filter(Boolean);
            state.expensesByUser[username] = this.dedupeExpenses(mergedExpenses);
        }

        if (!state.budgetsByUser[username]) {
            state.budgetsByUser[username] = {
                ...DEFAULT_BUDGET,
                ...legacyBudget
            };
        }

        if (!state.settingsByUser[username]) {
            state.settingsByUser[username] = {
                ...DEFAULT_SETTINGS,
                ...legacySettings
            };
        }

        if (!state.recurringByUser[username]) {
            state.recurringByUser[username] = [];
        }

        if (!state.reportsByUser[username]) {
            state.reportsByUser[username] = [];
        }

        if (legacyLoggedIn && username) {
            this.setSession({
                username,
                loggedInAt: new Date().toISOString()
            });
        }
    },

    ensureDemoUser(state) {
        if (state.users.length > 0) return;

        const username = DEFAULT_PROFILE.username;
        state.users.push({
            id: this.makeId('user'),
            username,
            fullName: DEFAULT_PROFILE.fullName,
            email: DEFAULT_PROFILE.email,
            phone: DEFAULT_PROFILE.phone,
            role: DEFAULT_PROFILE.role,
            profileImage: DEFAULT_PROFILE.profileImage,
            passwordHash: null,
            legacyAccount: true,
            createdAt: new Date().toISOString()
        });
        state.expensesByUser[username] = [];
        state.budgetsByUser[username] = { ...DEFAULT_BUDGET };
        state.settingsByUser[username] = { ...DEFAULT_SETTINGS };
        state.recurringByUser[username] = [];
        state.reportsByUser[username] = [];
        state.notificationsByUser[username] = [];
    },

    safeParse(value, fallback) {
        if (!value) return fallback;
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    },

    getSession() {
        const storageValue = sessionStorage.getItem(FINCAST_SESSION_KEY) || localStorage.getItem(FINCAST_SESSION_KEY);
        return this.safeParse(storageValue, null);
    },

    setSession(session) {
        const payload = JSON.stringify(session);
        sessionStorage.setItem(FINCAST_SESSION_KEY, payload);
        localStorage.setItem(FINCAST_SESSION_KEY, payload);
        localStorage.setItem('fincastLoggedIn', 'true');
        localStorage.setItem('fincastUser', session.username);
    },

    clearSession() {
        sessionStorage.removeItem(FINCAST_SESSION_KEY);
        localStorage.removeItem(FINCAST_SESSION_KEY);
        localStorage.removeItem('fincastLoggedIn');
        localStorage.removeItem('fincastUser');
        sessionStorage.removeItem(FINCAST_AUTH_GUARD);
    },

    isAuthenticated() {
        const session = this.getSession();
        if (!session || !session.username) return false;
        return Boolean(this.getUserByUsername(session.username));
    },

    requireAuth() {
        if (this.isAuthenticated()) {
            sessionStorage.setItem(FINCAST_AUTH_GUARD, 'true');
            return true;
        }

        if (!window.location.pathname.includes('/templates/login.html')) {
            window.location.href = '/templates/login.html';
        }
        return false;
    },

    getCurrentUsername() {
        return this.getSession()?.username || this.getState().users[0]?.username || DEFAULT_PROFILE.username;
    },

    getUserByUsername(username) {
        return this.getState().users.find(user => user.username === username) || null;
    },

    getCurrentUser() {
        return this.getUserByUsername(this.getCurrentUsername());
    },

    getAccountStartYear() {
        const createdAt = this.getCurrentUser()?.createdAt;
        const createdDate = createdAt ? new Date(createdAt) : new Date();
        return Number.isNaN(createdDate.getTime()) ? new Date().getFullYear() : createdDate.getFullYear();
    },

    getDisplayName() {
        const user = this.getCurrentUser();
        return user?.fullName || user?.username || DEFAULT_PROFILE.fullName;
    },

    getProfileImage() {
        return this.getCurrentUser()?.profileImage || '';
    },

    renderProfilePhoto(target) {
        if (!target) return;

        const image = this.getProfileImage();
        if (image) {
            target.innerHTML = `<img src="${image}" alt="Profile picture" class="profile-photo-image">`;
        } else {
            target.innerHTML = '<i class="fas fa-user"></i>';
        }
    },

    getCurrencySymbol(currencyCode = this.getBudget().currency || 'INR') {
        const currency = currencyCode || this.getBudget().currency || 'INR';
        try {
            const parts = new Intl.NumberFormat('en', {
                style: 'currency',
                currency,
                currencyDisplay: 'symbol'
            }).formatToParts(1);
            return parts.find(part => part.type === 'currency')?.value || currency;
        } catch {
            return currency;
        }
    },

    formatCurrency(amount, currencyCode = this.getBudget().currency || 'INR') {
        const value = Number(amount) || 0;
        try {
            return new Intl.NumberFormat('en', {
                style: 'currency',
                currency: currencyCode,
                maximumFractionDigits: 2
            }).format(value);
        } catch {
            return `${currencyCode} ${value.toLocaleString('en', {
                maximumFractionDigits: 2
            })}`;
        }
    },

    formatCurrencyCompact(amount, currencyCode = this.getBudget().currency || 'INR') {
        const formatted = this.formatCurrency(amount, currencyCode);
        return formatted.replace(/\s/g, '');
    },

    roundAmount(amount) {
        return Math.round((Number(amount) || 0) * 100) / 100;
    },

    getCurrencyDisplayName(code) {
        try {
            return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) || code;
        } catch {
            return code;
        }
    },

    getFallbackCurrencies() {
        const codes = typeof Intl.supportedValuesOf === 'function'
            ? Intl.supportedValuesOf('currency')
            : ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SGD', 'AED'];

        return codes.map(code => ({
            code,
            name: this.getCurrencyDisplayName(code)
        }));
    },

    async getSupportedCurrencies() {
        const cached = this.safeParse(localStorage.getItem(FINCAST_CURRENCY_CACHE_KEY), null);
        const cacheAge = Date.now() - Number(cached?.timestamp || 0);
        const cachedLooksValid = cached?.currencies?.every(item => (
            item
            && typeof item.code === 'string'
            && /^[A-Z]{3}$/.test(item.code)
            && typeof item.name === 'string'
        ));

        if (cachedLooksValid && cacheAge < 1000 * 60 * 60 * 24 * 7) {
            return cached.currencies;
        }

        try {
            const response = await fetch(`${FINCAST_EXCHANGE_API_BASE}/currencies`);
            if (!response.ok) throw new Error('Currency list request failed.');
            const payload = await response.json();
            const currencies = Array.isArray(payload)
                ? payload
                    .map(item => ({
                        code: String(item?.iso_code || '').toUpperCase(),
                        name: item?.name || this.getCurrencyDisplayName(String(item?.iso_code || '').toUpperCase())
                    }))
                    .filter(item => /^[A-Z]{3}$/.test(item.code) && item.name)
                : Object.entries(payload || {})
                    .map(([code, details]) => ({
                        code: String(code || '').toUpperCase(),
                        name: typeof details === 'string'
                            ? details
                            : details?.name || this.getCurrencyDisplayName(String(code || '').toUpperCase())
                    }))
                    .filter(item => /^[A-Z]{3}$/.test(item.code) && item.name);

            const normalizedCurrencies = currencies
                .sort((left, right) => left.name.localeCompare(right.name));

            if (normalizedCurrencies.length) {
                localStorage.setItem(FINCAST_CURRENCY_CACHE_KEY, JSON.stringify({
                    timestamp: Date.now(),
                    currencies: normalizedCurrencies
                }));
                return normalizedCurrencies;
            }
        } catch (error) {
            console.warn('Unable to load live currency list:', error);
        }

        return this.getFallbackCurrencies().sort((left, right) => left.name.localeCompare(right.name));
    },

    async getExchangeRate(fromCurrency, toCurrency) {
        const from = (fromCurrency || '').toUpperCase();
        const to = (toCurrency || '').toUpperCase();
        if (!from || !to) {
            throw new Error('Both currencies are required for conversion.');
        }
        if (from === to) {
            return {
                from,
                to,
                rate: 1,
                date: new Date().toISOString().split('T')[0]
            };
        }

        const response = await fetch(`${FINCAST_EXCHANGE_API_BASE}/rate/${from}/${to}`);
        if (!response.ok) {
            throw new Error(`Unable to fetch live exchange rate for ${from} to ${to}.`);
        }

        const payload = await response.json();
        const rate = Number(payload?.rate);
        if (!rate || Number.isNaN(rate)) {
            throw new Error(`No valid exchange rate returned for ${from} to ${to}.`);
        }

        return {
            from,
            to,
            rate,
            date: payload?.date || new Date().toISOString().split('T')[0]
        };
    },

    async convertCurrencyData(targetCurrency, options = {}) {
        const nextCurrency = (targetCurrency || '').toUpperCase();
        const username = this.getCurrentUsername();
        const state = this.getState();
        const currentBudget = this.getBudget();
        const currentCurrency = (currentBudget.currency || DEFAULT_BUDGET.currency).toUpperCase();
        if (!nextCurrency || currentCurrency === nextCurrency) {
            return {
                currency: currentCurrency,
                rate: 1,
                date: new Date().toISOString().split('T')[0]
            };
        }

        const exchange = await this.getExchangeRate(currentCurrency, nextCurrency);
        const convertAmount = amount => this.roundAmount((Number(amount) || 0) * exchange.rate);

        state.expensesByUser[username] = (state.expensesByUser[username] || []).map(item => ({
            ...item,
            amount: convertAmount(item.amount)
        }));

        state.recurringByUser[username] = (state.recurringByUser[username] || []).map(item => ({
            ...item,
            amount: convertAmount(item.amount)
        }));

        state.budgetsByUser[username] = {
            ...currentBudget,
            currency: nextCurrency,
            monthly: typeof options.budgetOverride === 'number'
                ? this.roundAmount(options.budgetOverride)
                : convertAmount(currentBudget.monthly),
            alertThreshold: Number(options.alertThreshold ?? currentBudget.alertThreshold) || DEFAULT_BUDGET.alertThreshold,
            autoRenew: Boolean(options.autoRenew ?? currentBudget.autoRenew),
            renewalDay: Math.min(
                Math.max(Number(options.renewalDay ?? currentBudget.renewalDay) || 1, 1),
                31
            )
        };

        this.setState(state);
        this.syncLegacyStorage();
        this.notifyDataChange('currency_converted', {
            from: currentCurrency,
            to: nextCurrency,
            rate: exchange.rate,
            date: exchange.date
        });
        this.notifyDataChange('budget_updated', state.budgetsByUser[username]);

        return {
            ...exchange,
            currency: nextCurrency
        };
    },

    clampRenewalDay(day, year, month) {
        const safeDay = Math.min(Math.max(Number(day) || 1, 1), 31);
        const maxDay = new Date(year, month + 1, 0).getDate();
        return Math.min(safeDay, maxDay);
    },

    getBudgetCycleInfo(referenceDate = new Date()) {
        const budget = this.getBudget();
        const current = new Date(referenceDate);
        let start;
        let nextStart;

        if (budget.autoRenew) {
            const currentRenewalDay = this.clampRenewalDay(budget.renewalDay, current.getFullYear(), current.getMonth());
            if (current.getDate() >= currentRenewalDay) {
                start = new Date(current.getFullYear(), current.getMonth(), currentRenewalDay);
            } else {
                const previousMonth = new Date(current.getFullYear(), current.getMonth() - 1, 1);
                const previousRenewalDay = this.clampRenewalDay(budget.renewalDay, previousMonth.getFullYear(), previousMonth.getMonth());
                start = new Date(previousMonth.getFullYear(), previousMonth.getMonth(), previousRenewalDay);
            }

            const nextMonth = new Date(start.getFullYear(), start.getMonth() + 1, 1);
            const nextRenewalDay = this.clampRenewalDay(budget.renewalDay, nextMonth.getFullYear(), nextMonth.getMonth());
            nextStart = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), nextRenewalDay);
        } else {
            start = new Date(current.getFullYear(), current.getMonth(), 1);
            nextStart = new Date(current.getFullYear(), current.getMonth() + 1, 1);
        }

        const end = new Date(nextStart);
        end.setDate(end.getDate() - 1);

        return {
            start,
            end,
            nextStart,
            label: `${this.formatDate(start)} - ${this.formatDate(end)}`
        };
    },

    normalizeDateKey(dateLike) {
        const date = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
        if (Number.isNaN(date.getTime())) {
            const fallback = new Date();
            fallback.setHours(0, 0, 0, 0);
            return fallback.toISOString().split('T')[0];
        }

        date.setHours(0, 0, 0, 0);
        return date.toISOString().split('T')[0];
    },

    parseSafeDate(dateLike, fallback = new Date()) {
        const date = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
        if (Number.isNaN(date.getTime())) {
            const safeFallback = new Date(fallback);
            safeFallback.setHours(0, 0, 0, 0);
            return safeFallback;
        }

        date.setHours(0, 0, 0, 0);
        return date;
    },

    normalizeRecurringItem(item) {
        const todayKey = this.normalizeDateKey(new Date());
        const startDate = item.startDate || item.createdAt || item.next_due || todayKey;

        return {
            id: item.id || this.makeId('rec'),
            title: item.title || 'Recurring expense',
            amount: Number(item.amount) || 0,
            category: item.category || 'Bills',
            frequency: item.frequency === 'weekly' ? 'weekly' : 'monthly',
            startDate: this.normalizeDateKey(startDate),
            createdAt: item.createdAt || new Date().toISOString()
        };
    },

    buildRecurringExpenseSchedule(item, currentDate = new Date()) {
        const schedule = [];
        const recurring = this.normalizeRecurringItem(item);
        const today = this.parseSafeDate(currentDate);
        const startDate = this.parseSafeDate(recurring.startDate, today);

        if (recurring.frequency === 'weekly') {
            let occurrence = new Date(startDate);
            while (occurrence <= today) {
                schedule.push(new Date(occurrence));
                occurrence.setDate(occurrence.getDate() + 7);
            }
            return schedule;
        }

        const startCycle = this.getBudgetCycleInfo(startDate);
        let occurrence = startDate <= startCycle.start
            ? new Date(startCycle.start)
            : new Date(startCycle.nextStart);

        while (occurrence <= today) {
            schedule.push(new Date(occurrence));
            occurrence = new Date(this.getBudgetCycleInfo(occurrence).nextStart);
        }

        return schedule;
    },

    getNextRecurringOccurrence(item, referenceDate = new Date()) {
        const recurring = this.normalizeRecurringItem(item);
        const current = this.parseSafeDate(referenceDate);

        if (recurring.frequency === 'weekly') {
            let occurrence = this.parseSafeDate(recurring.startDate, current);
            while (occurrence < current) {
                occurrence.setDate(occurrence.getDate() + 7);
            }
            return occurrence;
        }

        const cycle = this.getBudgetCycleInfo(current);
        if (current.getTime() === cycle.start.getTime()) {
            return new Date(cycle.nextStart);
        }
        return new Date(cycle.nextStart);
    },

    ensureRecurringExpenseHistory() {
        if (this._applyingRecurring) return false;

        const state = this.getState();
        const username = this.getCurrentUsername();
        const recurringItems = (state.recurringByUser[username] || []).map(item => this.normalizeRecurringItem(item));
        const expenses = [...(state.expensesByUser[username] || [])];
        if (!recurringItems.length) return false;

        const existingScheduleKeys = new Set(
            expenses
                .filter(item => item?.sourceType === 'recurring' && item?.scheduleKey)
                .map(item => item.scheduleKey)
        );

        const generatedExpenses = [];
        recurringItems.forEach(item => {
            this.buildRecurringExpenseSchedule(item).forEach(date => {
                const dateKey = this.normalizeDateKey(date);
                const scheduleKey = `${item.id}:${item.frequency}:${dateKey}`;
                if (existingScheduleKeys.has(scheduleKey)) return;

                existingScheduleKeys.add(scheduleKey);
                generatedExpenses.push({
                    id: this.makeId('exp'),
                    name: `${item.title} (Recurring)`,
                    amount: Number(item.amount) || 0,
                    category: item.category || 'Bills',
                    date: dateKey,
                    recurringId: item.id,
                    sourceType: 'recurring',
                    scheduleKey
                });
            });
        });

        if (!generatedExpenses.length) return false;

        state.recurringByUser[username] = recurringItems;
        state.expensesByUser[username] = [...generatedExpenses, ...expenses].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        this._applyingRecurring = true;
        this.setState(state);
        this.syncLegacyStorage();
        this._applyingRecurring = false;
        return true;
    },

    async registerUser(profile) {
        if (this.isRemoteApiAvailable()) {
            const payload = await this.requestApi('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify(profile)
            });
            const user = this.applyRemoteBootstrap(payload, { eventName: 'user_registered' });
            return user;
        }

        const state = this.getState();
        const username = (profile.username || '').trim();
        const email = (profile.email || '').trim().toLowerCase();

        if (!username || !profile.password) {
            throw new Error('Username and password are required.');
        }

        if (state.users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
            throw new Error('That username is already in use.');
        }

        if (email && state.users.some(user => (user.email || '').toLowerCase() === email)) {
            throw new Error('That email is already in use.');
        }

        const passwordHash = await this.hashPassword(profile.password);
        const user = {
            id: this.makeId('user'),
            username,
            fullName: profile.fullName || username,
            email,
            phone: profile.phone || '',
            role: 'Premium Member',
            profileImage: profile.profileImage || '',
            passwordHash,
            legacyAccount: false,
            createdAt: new Date().toISOString()
        };

        state.users.push(user);
        state.expensesByUser[username] = [];
        state.budgetsByUser[username] = { ...DEFAULT_BUDGET };
        state.settingsByUser[username] = { ...DEFAULT_SETTINGS };
        state.recurringByUser[username] = [];
        state.reportsByUser[username] = [];
        state.notificationsByUser[username] = [];
        this.setState(state);
        this.setSession({ username, loggedInAt: new Date().toISOString() });
        this.syncLegacyStorage();
        this.notifyDataChange('user_registered', user);
        return user;
    },

    async loginUser(username, password) {
        if (this.isRemoteApiAvailable()) {
            const payload = await this.requestApi('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            const user = this.applyRemoteBootstrap(payload, { eventName: 'user_logged_in' });
            return user;
        }

        const normalizedUsername = (username || '').trim();
        const user = this.getUserByUsername(normalizedUsername);

        if (!user) {
            throw new Error('Account not found.');
        }

        if (!password) {
            throw new Error('Password is required.');
        }

        if (user.passwordHash) {
            const inputHash = await this.hashPassword(password);
            if (inputHash !== user.passwordHash) {
                throw new Error('Incorrect password.');
            }
        } else if (!user.legacyAccount) {
            throw new Error('This account is not available for passwordless login.');
        }

        this.setSession({ username: user.username, loggedInAt: new Date().toISOString() });
        this.syncLegacyStorage();
        this.notifyDataChange('user_logged_in', user);
        return user;
    },

    logout() {
        this.clearSession();
        window.location.href = '/index.html';
    },

    async updatePassword(currentPassword, nextPassword) {
        const currentUser = this.getCurrentUser();
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            await this.requestApi('/api/users/password', {
                method: 'PUT',
                body: JSON.stringify({
                    userId: currentUser.id,
                    currentPassword,
                    nextPassword
                })
            });
        }

        const state = this.getState();
        const username = this.getCurrentUsername();
        const userIndex = state.users.findIndex(user => user.username === username);

        if (userIndex === -1) {
            throw new Error('No active account found.');
        }

        const user = state.users[userIndex];
        if (user.passwordHash) {
            const currentHash = await this.hashPassword(currentPassword || '');
            if (currentHash !== user.passwordHash) {
                throw new Error('Current password is incorrect.');
            }
        }

        state.users[userIndex] = {
            ...user,
            passwordHash: await this.hashPassword(nextPassword),
            legacyAccount: false
        };
        this.setState(state);
        this.notifyDataChange('password_updated', { username });
        return true;
    },

    getExpenses() {
        this.ensureRecurringExpenseHistory();
        const username = this.getCurrentUsername();
        return [...(this.getState().expensesByUser[username] || [])].sort((a, b) => {
            return new Date(b.date || 0) - new Date(a.date || 0);
        });
    },

    setExpenses(expenses) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        state.expensesByUser[username] = this.dedupeExpenses(expenses).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        this.setState(state);
        this.syncLegacyStorage();
        this.notifyDataChange('expenses_replaced', state.expensesByUser[username]);
        return state.expensesByUser[username];
    },

    addExpense(expense) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        const nextExpense = {
            id: expense.id || this.makeId('exp'),
            name: expense.name || expense.title || 'Untitled expense',
            amount: Number(expense.amount) || 0,
            category: expense.category || 'Other',
            date: expense.date || new Date().toISOString().split('T')[0],
            recurringId: expense.recurringId || null,
            sourceType: expense.sourceType || 'manual',
            scheduleKey: expense.scheduleKey || null
        };

        state.expensesByUser[username] = [nextExpense, ...(state.expensesByUser[username] || [])];
        this.setState(state);
        this.syncLegacyStorage();
        this.notifyDataChange('expense_added', nextExpense);
        const currentUser = this.getCurrentUser();
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            this.requestApi('/add_expense', {
                method: 'POST',
                body: JSON.stringify({
                    user_id: currentUser.id,
                    title: nextExpense.name,
                    amount: nextExpense.amount,
                    category: nextExpense.category,
                    date: nextExpense.date,
                    recurring_id: nextExpense.recurringId,
                    source_type: nextExpense.sourceType,
                    schedule_key: nextExpense.scheduleKey
                })
            }).catch(() => null);
        }
        return nextExpense;
    },

    updateExpense(id, updates) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        const expenses = state.expensesByUser[username] || [];
        const index = expenses.findIndex(item => String(item.id) === String(id));

        if (index === -1) return null;

        expenses[index] = {
            ...expenses[index],
            ...updates,
            amount: Number(updates.amount ?? expenses[index].amount) || 0
        };
        this.setState(state);
        this.syncLegacyStorage();
        this.notifyDataChange('expense_updated', expenses[index]);
        if (this.isRemoteApiAvailable()) {
            this.requestApi(`/update_expense/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify({
                    title: expenses[index].name,
                    amount: expenses[index].amount,
                    category: expenses[index].category,
                    date: expenses[index].date,
                    source_type: expenses[index].sourceType,
                    schedule_key: expenses[index].scheduleKey
                })
            }).catch(() => null);
        }
        return expenses[index];
    },

    deleteExpense(id) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        const expenses = state.expensesByUser[username] || [];
        const index = expenses.findIndex(item => String(item.id) === String(id));
        if (index === -1) return null;

        const [deletedExpense] = expenses.splice(index, 1);
        this.setState(state);
        this.syncLegacyStorage();
        this.notifyDataChange('expense_deleted', { id, expense: deletedExpense, index });
        if (this.isRemoteApiAvailable()) {
            this.requestApi(`/delete_expense/${encodeURIComponent(id)}`, {
                method: 'DELETE'
            }).catch(() => null);
        }
        return {
            ...deletedExpense,
            _restoreIndex: index
        };
    },

    restoreExpense(expense) {
        if (!expense || !expense.id) return null;

        const state = this.getState();
        const username = this.getCurrentUsername();
        const expenses = state.expensesByUser[username] || [];
        if (expenses.some(item => String(item.id) === String(expense.id))) {
            return expense;
        }

        const restoreIndex = Math.min(
            Math.max(Number(expense._restoreIndex ?? expenses.length), 0),
            expenses.length
        );
        const restoredExpense = {
            id: expense.id,
            name: expense.name || expense.title || 'Untitled expense',
            amount: Number(expense.amount) || 0,
            category: expense.category || 'Other',
            date: expense.date || new Date().toISOString().split('T')[0],
            recurringId: expense.recurringId || null,
            sourceType: expense.sourceType || 'manual',
            scheduleKey: expense.scheduleKey || null
        };

        expenses.splice(restoreIndex, 0, restoredExpense);
        this.setState(state);
        this.syncLegacyStorage();
        this.notifyDataChange('expense_restored', { expense: restoredExpense, index: restoreIndex });
        const currentUser = this.getCurrentUser();
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            this.requestApi('/add_expense', {
                method: 'POST',
                body: JSON.stringify({
                    user_id: currentUser.id,
                    title: restoredExpense.name,
                    amount: restoredExpense.amount,
                    category: restoredExpense.category,
                    date: restoredExpense.date,
                    recurring_id: restoredExpense.recurringId,
                    source_type: restoredExpense.sourceType,
                    schedule_key: restoredExpense.scheduleKey
                })
            }).catch(() => null);
        }
        return restoredExpense;
    },

    getRecurringExpenses() {
        const username = this.getCurrentUsername();
        return [...(this.getState().recurringByUser[username] || [])]
            .map(item => this.normalizeRecurringItem(item))
            .sort((a, b) => a.title.localeCompare(b.title));
    },

    setRecurringExpenses(items) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        state.recurringByUser[username] = Array.isArray(items)
            ? items.map(item => this.normalizeRecurringItem(item))
            : [];
        this.setState(state);
        this.notifyDataChange('recurring_replaced', state.recurringByUser[username]);
        return state.recurringByUser[username];
    },

    addRecurringExpense(item) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        const recurring = this.normalizeRecurringItem(item);
        state.recurringByUser[username] = [recurring, ...(state.recurringByUser[username] || [])];
        this.setState(state);
        this.ensureRecurringExpenseHistory();
        this.notifyDataChange('recurring_added', recurring);
        const currentUser = this.getCurrentUser();
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            this.requestApi('/add_recurring', {
                method: 'POST',
                body: JSON.stringify({
                    user_id: currentUser.id,
                    title: recurring.title,
                    amount: recurring.amount,
                    category: recurring.category,
                    frequency: recurring.frequency,
                    start_date: recurring.startDate
                })
            }).catch(() => null);
        }
        return recurring;
    },

    deleteRecurringExpense(id) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        const recurring = state.recurringByUser[username] || [];
        const index = recurring.findIndex(item => String(item.id) === String(id));
        if (index === -1) return null;

        const [deletedRecurring] = recurring.splice(index, 1);
        this.setState(state);
        this.notifyDataChange('recurring_deleted', { id, recurring: deletedRecurring, index });
        if (this.isRemoteApiAvailable()) {
            this.requestApi(`/delete_recurring/${encodeURIComponent(id)}`, {
                method: 'DELETE'
            }).catch(() => null);
        }
        return {
            ...deletedRecurring,
            _restoreIndex: index
        };
    },

    restoreRecurringExpense(item) {
        if (!item || !item.id) return null;

        const state = this.getState();
        const username = this.getCurrentUsername();
        const recurring = state.recurringByUser[username] || [];
        if (recurring.some(existing => String(existing.id) === String(item.id))) {
            return item;
        }

        const restoreIndex = Math.min(
            Math.max(Number(item._restoreIndex ?? recurring.length), 0),
            recurring.length
        );
        const restoredRecurring = this.normalizeRecurringItem(item);
        recurring.splice(restoreIndex, 0, restoredRecurring);
        this.setState(state);
        this.ensureRecurringExpenseHistory();
        this.notifyDataChange('recurring_restored', { recurring: restoredRecurring, index: restoreIndex });
        const currentUser = this.getCurrentUser();
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            this.requestApi('/add_recurring', {
                method: 'POST',
                body: JSON.stringify({
                    user_id: currentUser.id,
                    title: restoredRecurring.title,
                    amount: restoredRecurring.amount,
                    category: restoredRecurring.category,
                    frequency: restoredRecurring.frequency,
                    start_date: restoredRecurring.startDate
                })
            }).catch(() => null);
        }
        return restoredRecurring;
    },

    getUserData() {
        const user = this.getCurrentUser();
        if (!user) return { ...DEFAULT_PROFILE };

        return {
            fullName: user.fullName || user.username,
            username: user.username,
            email: user.email || '',
            phone: user.phone || '',
            role: user.role || DEFAULT_PROFILE.role,
            profileImage: user.profileImage || ''
        };
    },

    updateUserData(data) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        const index = state.users.findIndex(user => user.username === username);
        if (index === -1) return null;

        state.users[index] = {
            ...state.users[index],
            fullName: data.fullName ?? state.users[index].fullName,
            email: data.email ?? state.users[index].email,
            phone: data.phone ?? state.users[index].phone,
            profileImage: data.profileImage ?? state.users[index].profileImage
        };

        this.setState(state);
        this.syncLegacyStorage();
        this.notifyDataChange('user_updated', this.getUserData());
        if (this.isRemoteApiAvailable() && state.users[index]?.id) {
            this.requestApi('/api/users/profile', {
                method: 'PUT',
                body: JSON.stringify({
                    userId: state.users[index].id,
                    username: state.users[index].username,
                    fullName: state.users[index].fullName,
                    email: state.users[index].email,
                    phone: state.users[index].phone,
                    profileImage: state.users[index].profileImage
                })
            }).catch(() => null);
        }
        return this.getUserData();
    },

    getBudget() {
        const username = this.getCurrentUsername();
        return {
            ...DEFAULT_BUDGET,
            ...(this.getState().budgetsByUser[username] || {})
        };
    },

    updateBudget(budget) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        state.budgetsByUser[username] = {
            ...this.getBudget(),
            ...budget,
            monthly: Number(budget.monthly ?? this.getBudget().monthly) || DEFAULT_BUDGET.monthly,
            alertThreshold: Number(budget.alertThreshold ?? this.getBudget().alertThreshold) || DEFAULT_BUDGET.alertThreshold,
            autoRenew: Boolean(budget.autoRenew ?? this.getBudget().autoRenew),
            renewalDay: Math.min(Math.max(Number(budget.renewalDay ?? this.getBudget().renewalDay) || 1, 1), 31)
        };
        this.setState(state);
        this.syncLegacyStorage();
        this.notifyDataChange('budget_updated', state.budgetsByUser[username]);
        const currentUser = this.getCurrentUser();
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            this.requestApi('/update_budget', {
                method: 'POST',
                body: JSON.stringify({
                    user_id: currentUser.id,
                    monthly: state.budgetsByUser[username].monthly,
                    alert_threshold: state.budgetsByUser[username].alertThreshold,
                    currency: state.budgetsByUser[username].currency,
                    auto_renew: state.budgetsByUser[username].autoRenew,
                    renewal_day: state.budgetsByUser[username].renewalDay
                })
            }).catch(() => null);
        }
        return state.budgetsByUser[username];
    },

    getSettings() {
        const username = this.getCurrentUsername();
        return {
            ...DEFAULT_SETTINGS,
            ...(this.getState().settingsByUser[username] || {})
        };
    },

    updateSettings(settings) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        state.settingsByUser[username] = {
            ...this.getSettings(),
            ...settings
        };
        this.setState(state);
        this.syncLegacyStorage();
        if (Object.prototype.hasOwnProperty.call(settings, 'theme')) {
            this.applyTheme(state.settingsByUser[username].theme);
        }
        this.notifyDataChange('settings_updated', state.settingsByUser[username]);
        const currentUser = this.getCurrentUser();
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            this.requestApi('/api/settings', {
                method: 'PUT',
                body: JSON.stringify({
                    userId: currentUser.id,
                    ...state.settingsByUser[username]
                })
            }).catch(() => null);
        }
        return state.settingsByUser[username];
    },

    getTheme() {
        return this.getSettings().theme === 'dark' ? 'dark' : 'light';
    },

    getChartPalette() {
        if (this.getTheme() === 'dark') {
            return {
                indigo: '#f3f4f6',
                lavender: '#94a3b8',
                red: '#ff5d73',
                crimson: '#ff3355',
                redSoft: 'rgba(255, 93, 115, 0.22)',
                crimsonSoft: 'rgba(255, 51, 85, 0.18)',
                lavenderSoft: 'rgba(148, 163, 184, 0.18)',
                indigoSoft: 'rgba(148, 163, 184, 0.18)',
                neutral: '#111827'
            };
        }

        return {
            indigo: '#2b2d42',
            lavender: '#8d99ae',
            red: '#ef233c',
            crimson: '#d80032',
            redSoft: 'rgba(239, 35, 60, 0.15)',
            crimsonSoft: 'rgba(216, 0, 50, 0.12)',
            lavenderSoft: 'rgba(141, 153, 174, 0.14)',
            indigoSoft: 'rgba(43, 45, 66, 0.14)',
            neutral: '#edf2f4'
        };
    },

    applyTheme(theme = this.getTheme()) {
        const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
        if (document.documentElement) {
            document.documentElement.dataset.theme = normalizedTheme;
            document.documentElement.style.colorScheme = normalizedTheme;
        }
        if (document.body) {
            document.body.dataset.theme = normalizedTheme;
        }
        this.refreshThemeToggleUI(normalizedTheme);
        window.dispatchEvent(new CustomEvent('flow_theme_change', {
            detail: { theme: normalizedTheme }
        }));
        return normalizedTheme;
    },

    toggleTheme() {
        const nextTheme = this.getTheme() === 'dark' ? 'light' : 'dark';
        this.updateSettings({ theme: nextTheme });
        return nextTheme;
    },

    refreshThemeToggleUI(theme = this.getTheme()) {
        const isDark = theme === 'dark';

        document.querySelectorAll('[data-theme-toggle]').forEach(button => {
            button.setAttribute('aria-pressed', String(isDark));
            button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
            button.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
            button.classList.toggle('is-dark', isDark);

            const icon = button.querySelector('i');
            if (icon) {
                icon.className = `fas ${isDark ? 'fa-sun' : 'fa-moon'}`;
            }

            const label = button.querySelector('.theme-toggle-label');
            if (label) {
                label.textContent = isDark ? 'Light mode' : 'Dark mode';
            }
        });

        document.querySelectorAll('[data-theme-setting]').forEach(control => {
            if (control.type === 'checkbox') {
                control.checked = isDark;
            } else {
                control.value = theme;
            }
        });
    },

    injectThemeToggle() {
        const actionBar = document.querySelector('.topbar-shell .header-shell > div');
        if (!actionBar || actionBar.querySelector('[data-theme-toggle]')) return;

        const profileDropdown = actionBar.querySelector('.dropdown');
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'theme-toggle-btn';
        toggleButton.setAttribute('data-theme-toggle', 'true');
        toggleButton.innerHTML = `
            <i class="fas fa-moon" aria-hidden="true"></i>
            <span class="theme-toggle-label">Dark mode</span>
        `;

        if (profileDropdown?.parentNode) {
            profileDropdown.parentNode.insertBefore(toggleButton, profileDropdown);
        } else {
            actionBar.appendChild(toggleButton);
        }
    },

    bindThemeControls() {
        const attachControls = () => {
            this.injectThemeToggle();
            this.refreshThemeToggleUI(this.getTheme());
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attachControls, { once: true });
        } else {
            attachControls();
        }

        if (document.body?.dataset?.themeBound === 'true') return;
        if (!document.body) return;

        document.body.dataset.themeBound = 'true';

        document.addEventListener('click', event => {
            const toggle = event.target.closest('[data-theme-toggle]');
            if (!toggle) return;
            event.preventDefault();
            this.toggleTheme();
        });

        document.addEventListener('change', event => {
            const control = event.target.closest('[data-theme-setting]');
            if (!control) return;

            const nextTheme = control.type === 'checkbox'
                ? (control.checked ? 'dark' : 'light')
                : control.value;

            this.updateSettings({ theme: nextTheme });
        });
    },

    getAnalytics() {
        const expenses = this.getExpenses();
        const budget = this.getBudget();
        const cycle = this.getBudgetCycleInfo();
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const previousYear = currentYear - 1;

        const totalSpent = expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        const budgetLeft = budget.monthly - totalSpent;
        const categoryTotals = {};
        const monthlyTotals = new Array(12).fill(0);
        const previousYearMonthlyTotals = new Array(12).fill(0);
        const expensesByDay = {};
        const expensesThisCycle = [];

        expenses.forEach(expense => {
            const amount = Number(expense.amount) || 0;
            const category = expense.category || 'Other';
            const date = new Date(expense.date);

            categoryTotals[category] = (categoryTotals[category] || 0) + amount;

            if (!Number.isNaN(date.getTime())) {
                const month = date.getMonth();
                const year = date.getFullYear();
                const dayKey = date.toISOString().split('T')[0];
                expensesByDay[dayKey] = (expensesByDay[dayKey] || 0) + amount;

                if (year === currentYear && month >= 0 && month < 12) {
                    monthlyTotals[month] += amount;
                }

                if (year === previousYear && month >= 0 && month < 12) {
                    previousYearMonthlyTotals[month] += amount;
                }

                if (date >= cycle.start && date < cycle.nextStart) {
                    expensesThisCycle.push({ ...expense, amount });
                }
            }
        });

        const activeDays = Math.max(Object.keys(expensesByDay).length, 1);
        const averageDailySpend = totalSpent > 0 ? totalSpent / activeDays : 0;
        const averageTransaction = expenses.length > 0 ? totalSpent / expenses.length : 0;
        const topEntry = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0] || ['-', 0];
        const monthSpent = monthlyTotals[currentMonth] || 0;
        const cycleSpent = expensesThisCycle.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const currentDay = Math.max(now.getDate(), 1);
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const predictedMonthly = currentDay > 0 ? Math.round((monthSpent / currentDay) * daysInMonth) : monthSpent;

        const recentSixMonths = this.buildRecentSixMonths(monthlyTotals, currentMonth);

        return {
            totalSpent,
            budgetLeft,
            transactionCount: expenses.length,
            averageTransaction,
            averageDailySpend,
            predictedMonthly,
            categoryTotals,
            monthlyTotals,
            previousYearMonthlyTotals,
            expensesByDay,
            currentMonthSpent: monthSpent,
            currentCycleSpent: cycleSpent,
            currentCycleSaved: Math.max(0, budget.monthly - cycleSpent),
            cycleBudgetLeft: budget.monthly - cycleSpent,
            cycleLabel: cycle.label,
            cycleStart: cycle.start,
            cycleEnd: cycle.end,
            topCategory: topEntry[0],
            topCategoryShare: totalSpent > 0 ? Math.round((topEntry[1] / totalSpent) * 100) : 0,
            savingsRate: budget.monthly > 0 ? Math.round((Math.max(0, budget.monthly - cycleSpent) / budget.monthly) * 100) : 0,
            recentSixMonths,
            thisMonthTransactions: expensesThisCycle
        };
    },

    buildRecentSixMonths(monthlyTotals, currentMonth) {
        const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const labels = [];
        const data = [];

        for (let index = 5; index >= 0; index -= 1) {
            const month = (currentMonth - index + 12) % 12;
            labels.push(monthLabels[month]);
            data.push(monthlyTotals[month] || 0);
        }

        return { labels, data };
    },

    getMonthlyReport(year = new Date().getFullYear(), month = new Date().getMonth()) {
        const expenses = this.getExpenses();
        const filtered = expenses.filter(expense => {
            const date = new Date(expense.date);
            return date.getFullYear() === year && date.getMonth() === month;
        });

        const total = filtered.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const byCategory = {};
        filtered.forEach(item => {
            byCategory[item.category] = (byCategory[item.category] || 0) + Number(item.amount || 0);
        });

        return {
            month: month + 1,
            year,
            total,
            count: filtered.length,
            byCategory,
            transactions: filtered
        };
    },

    getSavingsHistory(year = new Date().getFullYear()) {
        const budget = this.getBudget();
        const expenses = this.getExpenses();
        const currentUser = this.getCurrentUser();
        const createdDate = currentUser?.createdAt ? new Date(currentUser.createdAt) : new Date();
        const safeCreatedDate = Number.isNaN(createdDate.getTime()) ? new Date() : createdDate;
        const currentDate = new Date();
        const monthlySpent = new Array(12).fill(0);

        expenses.forEach(expense => {
            const date = new Date(expense.date);
            if (Number.isNaN(date.getTime())) return;
            if (date.getFullYear() !== year) return;
            monthlySpent[date.getMonth()] += Number(expense.amount || 0);
        });

        const months = monthlySpent.map((spent, monthIndex) => {
            const beforeAccountStart = year < safeCreatedDate.getFullYear()
                || (year === safeCreatedDate.getFullYear() && monthIndex < safeCreatedDate.getMonth());
            const afterCurrentMonth = year > currentDate.getFullYear()
                || (year === currentDate.getFullYear() && monthIndex > currentDate.getMonth());
            const enabled = !beforeAccountStart && !afterCurrentMonth;
            const saved = enabled ? Math.max(0, (budget.monthly || 0) - spent) : null;

            return {
                month: monthIndex,
                label: this.monthName(monthIndex),
                spent,
                saved,
                enabled
            };
        });

        return {
            year,
            budget: budget.monthly || 0,
            accountStartYear: safeCreatedDate.getFullYear(),
            months
        };
    },

    createReport(type) {
        const reportType = type || 'monthly';
        const analytics = this.getAnalytics();
        const budget = this.getBudget();
        const reportDate = new Date();
        const reportId = this.makeId('rpt');
        const reportContent = this.buildReportContent(reportType, analytics, budget, reportDate, reportId);
        const pdfBytes = this.buildPdfReport(this.getReportName(reportType, reportDate), reportContent);
        const report = {
            id: reportId,
            type: reportType,
            name: this.getReportName(reportType, reportDate),
            period: this.getReportPeriod(reportType, reportDate),
            generatedOn: reportDate.toISOString(),
            size: `${Math.max(1, Math.round(pdfBytes.length / 1024))} KB`,
            content: reportContent
        };

        const state = this.getState();
        const username = this.getCurrentUsername();
        state.reportsByUser[username] = [report, ...(state.reportsByUser[username] || [])];
        this.setState(state);
        this.notifyDataChange('report_created', report);
        const currentUser = this.getCurrentUser();
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            this.requestApi('/api/reports', {
                method: 'POST',
                body: JSON.stringify({
                    userId: currentUser.id,
                    type: report.type,
                    name: report.name,
                    period: report.period,
                    periodObject: {
                        label: report.period
                    },
                    size: report.size,
                    content: report.content
                })
            }).then(payload => {
                if (!payload?.report?.id) return;
                const remoteState = this.getState();
                const reports = remoteState.reportsByUser[username] || [];
                const reportIndex = reports.findIndex(item => item.id === report.id);
                if (reportIndex >= 0) {
                    reports[reportIndex] = {
                        ...reports[reportIndex],
                        id: payload.report.id,
                        generatedOn: payload.report.generatedOn || reports[reportIndex].generatedOn
                    };
                    this.setState(remoteState);
                    this.notifyDataChange('report_created', reports[reportIndex]);
                }
            }).catch(() => null);
        }
        return report;
    },

    getReports() {
        const username = this.getCurrentUsername();
        return [...(this.getState().reportsByUser[username] || [])].sort((a, b) => new Date(b.generatedOn) - new Date(a.generatedOn));
    },

    deleteReport(id) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        const reports = state.reportsByUser[username] || [];
        const index = reports.findIndex(report => String(report.id) === String(id));
        if (index === -1) return null;

        const [deletedReport] = reports.splice(index, 1);
        this.setState(state);
        this.notifyDataChange('report_deleted', { id, report: deletedReport, index });
        if (this.isRemoteApiAvailable()) {
            this.requestApi(`/api/reports/${encodeURIComponent(id)}`, {
                method: 'DELETE'
            }).catch(() => null);
        }
        return {
            ...deletedReport,
            _restoreIndex: index
        };
    },

    restoreReport(report) {
        if (!report || !report.id) return null;

        const state = this.getState();
        const username = this.getCurrentUsername();
        const reports = state.reportsByUser[username] || [];
        if (reports.some(item => String(item.id) === String(report.id))) {
            return report;
        }

        const restoreIndex = Math.min(
            Math.max(Number(report._restoreIndex ?? reports.length), 0),
            reports.length
        );
        const restoredReport = {
            ...report
        };
        delete restoredReport._restoreIndex;
        reports.splice(restoreIndex, 0, restoredReport);
        this.setState(state);
        this.notifyDataChange('report_restored', { report: restoredReport, index: restoreIndex });
        const currentUser = this.getCurrentUser();
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            this.requestApi('/api/reports', {
                method: 'POST',
                body: JSON.stringify({
                    userId: currentUser.id,
                    type: restoredReport.type,
                    name: restoredReport.name,
                    period: restoredReport.period,
                    periodObject: {
                        label: restoredReport.period
                    },
                    size: restoredReport.size,
                    content: restoredReport.content
                })
            }).catch(() => null);
        }
        return restoredReport;
    },

    downloadReport(id) {
        const report = this.getReports().find(item => String(item.id) === String(id));
        if (!report) return false;

        const pdfBytes = this.buildPdfReport(report.name, report.content);
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.download = `${report.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
        return true;
    },

    buildPdfReport(title, content) {
        if (!content || typeof content !== 'object' || Array.isArray(content)) {
            return this.buildLegacyPdfReport(title, content);
        }

        const encoder = new TextEncoder();
        const pageWidth = 612;
        const pageHeight = 792;
        const marginX = 48;
        const footerHeight = 34;
        const pages = [];
        const fonts = {
            regular: 'F1',
            bold: 'F2',
            italic: 'F3'
        };
        const palette = {
            navy: '#18253f',
            ink: '#24324a',
            slate: '#65758b',
            line: '#d8dfeb',
            cloud: '#f4f7fb',
            white: '#ffffff',
            accent: '#d1495b',
            accentSoft: '#fdecef',
            success: '#1f7a5c'
        };

        const addPage = (variant = 'inner') => {
            const page = {
                commands: [],
                y: variant === 'cover' ? pageHeight - 188 : pageHeight - 72,
                variant
            };
            pages.push(page);

            if (variant === 'cover') {
                this.drawPdfRect(page.commands, 0, pageHeight - 164, pageWidth, 164, palette.navy);
                this.drawPdfRect(page.commands, 0, pageHeight - 170, pageWidth, 6, palette.accent);
                this.drawPdfText(page.commands, 'FLOW', marginX, pageHeight - 40, {
                    size: 16,
                    font: fonts.bold,
                    color: '#dbe4f3'
                });
                this.drawPdfText(page.commands, 'Financial Report', marginX, pageHeight - 62, {
                    size: 11,
                    font: fonts.bold,
                    color: palette.white
                });
                this.drawPdfText(page.commands, content.title || title, marginX, pageHeight - 94, {
                    size: 24,
                    font: fonts.bold,
                    color: palette.white
                });
                this.drawPdfWrappedText(page.commands, content.subtitle || 'Performance summary generated by Flow.', marginX, pageHeight - 118, pageWidth - (marginX * 2), {
                    size: 11,
                    lineHeight: 14,
                    font: fonts.regular,
                    color: '#dbe4f3'
                });
            } else {
                this.drawPdfRect(page.commands, 0, pageHeight - 42, pageWidth, 42, palette.navy);
                this.drawPdfText(page.commands, 'FLOW', marginX, pageHeight - 16, {
                    size: 9,
                    font: fonts.bold,
                    color: '#dbe4f3'
                });
                this.drawPdfText(page.commands, content.title || title, marginX, pageHeight - 26, {
                    size: 13,
                    font: fonts.bold,
                    color: palette.white
                });
                this.drawPdfText(page.commands, 'Flow Finance', pageWidth - 124, pageHeight - 26, {
                    size: 9,
                    font: fonts.regular,
                    color: '#dbe4f3'
                });
            }

            return page;
        };

        const ensureSpace = (page, heightNeeded) => {
            if (page.y - heightNeeded >= footerHeight + 28) return page;
            return addPage('inner');
        };

        const drawMetaGrid = page => {
            const items = Array.isArray(content.meta) ? content.meta.slice(0, 4) : [];
            const gutter = 12;
            const cardWidth = (pageWidth - (marginX * 2) - gutter) / 2;
            const cardHeight = 62;
            let startY = pageHeight - 206;

            items.forEach((item, index) => {
                const column = index % 2;
                const row = Math.floor(index / 2);
                const x = marginX + (column * (cardWidth + gutter));
                const y = startY - (row * (cardHeight + 10));
                this.drawPdfRect(page.commands, x, y, cardWidth, cardHeight, palette.white, palette.line, 1);
                this.drawPdfText(page.commands, item.label, x + 14, y + cardHeight - 18, {
                    size: 8,
                    font: fonts.bold,
                    color: palette.slate
                });
                this.drawPdfWrappedText(page.commands, item.value, x + 14, y + cardHeight - 33, cardWidth - 28, {
                    size: 11,
                    lineHeight: 14,
                    font: fonts.regular,
                    color: palette.ink
                });
            });

            page.y = startY - (Math.ceil(items.length / 2) * (cardHeight + 12)) - 18;
        };

        const drawMetricCards = page => {
            const metrics = Array.isArray(content.metrics) ? content.metrics.slice(0, 4) : [];
            if (!metrics.length) return;

            const gutter = 12;
            const cardWidth = (pageWidth - (marginX * 2) - gutter) / 2;
            const cardHeight = 86;
            const startY = page.y;

            metrics.forEach((metric, index) => {
                const column = index % 2;
                const row = Math.floor(index / 2);
                const x = marginX + (column * (cardWidth + gutter));
                const y = startY - (row * (cardHeight + 12)) - cardHeight;
                this.drawPdfRect(page.commands, x, y, cardWidth, cardHeight, palette.cloud, palette.line, 1);
                this.drawPdfRect(page.commands, x, y + cardHeight - 4, cardWidth, 4, metric.tone === 'accent' ? palette.accent : palette.success);
                this.drawPdfText(page.commands, metric.label, x + 14, y + cardHeight - 18, {
                    size: 9,
                    font: fonts.bold,
                    color: palette.slate
                });
                this.drawPdfWrappedText(page.commands, metric.value, x + 14, y + cardHeight - 40, cardWidth - 28, {
                    size: 17,
                    lineHeight: 20,
                    font: fonts.bold,
                    color: palette.ink
                });
                if (metric.note) {
                    this.drawPdfWrappedText(page.commands, metric.note, x + 14, y + 14, cardWidth - 28, {
                        size: 8,
                        lineHeight: 11,
                        font: fonts.regular,
                        color: palette.slate
                    });
                }
            });

            page.y = startY - (Math.ceil(metrics.length / 2) * (cardHeight + 14)) - 20;
        };

        const drawSectionHeading = (page, heading, kicker = '') => {
            this.drawPdfText(page.commands, heading, marginX, page.y, {
                size: 14,
                font: fonts.bold,
                color: palette.ink
            });
            if (kicker) {
                this.drawPdfText(page.commands, kicker, pageWidth - marginX - 160, page.y, {
                    size: 8,
                    font: fonts.bold,
                    color: palette.slate
                });
            }
            this.drawPdfLine(page.commands, marginX, page.y - 8, pageWidth - marginX, page.y - 8, palette.line, 1);
            page.y -= 26;
        };

        const drawParagraphSection = (page, section) => {
            page = ensureSpace(page, 90);
            drawSectionHeading(page, section.title, section.kicker || '');
            const height = this.drawPdfWrappedText(page.commands, section.body, marginX, page.y, pageWidth - (marginX * 2), {
                size: 11,
                lineHeight: 17,
                font: fonts.regular,
                color: palette.ink
            });
            page.y -= height + 24 + (section.afterGap || 0);
            return page;
        };

        const drawKeyValueSection = (page, section) => {
            page = ensureSpace(page, 110);
            drawSectionHeading(page, section.title, section.kicker || '');
            const rowHeight = 30;
            (section.items || []).forEach((item, index) => {
                page = ensureSpace(page, rowHeight + 8);
                const y = page.y - rowHeight;
                const isHighlighted = Boolean(item.highlight);
                this.drawPdfRect(
                    page.commands,
                    marginX,
                    y,
                    pageWidth - (marginX * 2),
                    rowHeight,
                    isHighlighted ? palette.accentSoft : (index % 2 === 0 ? palette.white : palette.cloud),
                    isHighlighted ? palette.accent : palette.line,
                    1
                );
                this.drawPdfText(page.commands, item.label, marginX + 14, y + 16, {
                    size: 9,
                    font: fonts.bold,
                    color: isHighlighted ? palette.accent : palette.slate
                });
                this.drawPdfText(page.commands, item.value, pageWidth - marginX - 180, y + 16, {
                    size: 10,
                    font: isHighlighted ? fonts.bold : fonts.regular,
                    color: palette.ink
                });
                page.y = y - 8;
            });
            page.y -= 16 + (section.afterGap || 0);
            return page;
        };

        const drawTableSection = (page, section) => {
            const tableWidth = pageWidth - (marginX * 2);
            const columnWidths = (section.columns || []).map(column => Math.max(60, tableWidth * (column.width || (1 / Math.max((section.columns || []).length, 1)))));
            const totalWidth = columnWidths.reduce((sum, value) => sum + value, 0);
            const adjustedWidths = columnWidths.map(width => (width / totalWidth) * tableWidth);
            const lineHeight = 12;

            const drawHeader = () => {
                this.drawPdfRect(page.commands, marginX, page.y - 26, tableWidth, 26, palette.navy);
                let cursorX = marginX;
                (section.columns || []).forEach((column, index) => {
                    this.drawPdfText(page.commands, column.label, cursorX + 10, page.y - 10, {
                        size: 8,
                        font: fonts.bold,
                        color: palette.white
                    });
                    cursorX += adjustedWidths[index];
                });
                page.y -= 34;
            };

            page = ensureSpace(page, 120);
            drawSectionHeading(page, section.title, section.kicker || '');
            drawHeader();

            (section.rows || []).forEach((row, rowIndex) => {
                const rowData = Array.isArray(row) ? { cells: row } : row;
                const cells = rowData.cells || [];
                const isHighlighted = Boolean(rowData.highlight);
                const cellLines = cells.map((cell, index) => this.wrapPdfText(cell, adjustedWidths[index] - 18, 9));
                const maxLines = Math.max(...cellLines.map(lines => lines.length), 1);
                const rowHeight = Math.max(26, (maxLines * lineHeight) + 10);

                page = ensureSpace(page, rowHeight + 8);
                if (page.y > pageHeight - 100 && pages.length > 1) {
                    drawHeader();
                }

                const y = page.y - rowHeight;
                this.drawPdfRect(
                    page.commands,
                    marginX,
                    y,
                    tableWidth,
                    rowHeight,
                    isHighlighted ? palette.accentSoft : (rowIndex % 2 === 0 ? palette.white : palette.cloud),
                    isHighlighted ? palette.accent : palette.line,
                    1
                );

                let cursorX = marginX;
                cells.forEach((cell, index) => {
                    this.drawPdfWrappedText(page.commands, cell, cursorX + 9, y + rowHeight - 14, adjustedWidths[index] - 18, {
                        size: 9,
                        lineHeight,
                        font: isHighlighted || index === 0 ? fonts.bold : fonts.regular,
                        color: isHighlighted ? palette.accent : palette.ink
                    });
                    cursorX += adjustedWidths[index];
                });

                page.y = y - 8;
            });

            page.y -= 16 + (section.afterGap || 0);
            return page;
        };

        let page = addPage('cover');
        drawMetaGrid(page);
        if (content.summary) {
            page = drawParagraphSection(page, {
                title: 'Executive Summary',
                body: content.summary,
                kicker: content.typeLabel || 'Flow overview'
            });
        }
        drawMetricCards(page);

        (content.sections || []).forEach(section => {
            if (section.forceNewPageBefore) {
                page = addPage('inner');
            }
            if (section.type === 'paragraph') {
                page = drawParagraphSection(page, section);
                return;
            }
            if (section.type === 'keyValue') {
                page = drawKeyValueSection(page, section);
                return;
            }
            page = drawTableSection(page, section);
        });

        const footerText = content.footerNote || 'Prepared by Flow Finance';
        pages.forEach((pdfPage, index) => {
            this.drawPdfLine(pdfPage.commands, marginX, footerHeight, pageWidth - marginX, footerHeight, palette.line, 1);
            this.drawPdfText(pdfPage.commands, footerText, marginX, 20, {
                size: 8,
                font: fonts.italic,
                color: palette.slate
            });
            this.drawPdfText(pdfPage.commands, `Page ${index + 1} of ${pages.length}`, pageWidth - marginX - 54, 20, {
                size: 8,
                font: fonts.regular,
                color: palette.slate
            });
        });

        const objects = [];
        objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objects[2] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${5 + (index * 2)} 0 R`).join(' ')}] /Count ${pages.length} >>`;
        objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
        objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
        const italicId = (5 + (pages.length * 2));
        objects[italicId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>';

        pages.forEach((pdfPage, index) => {
            const pageId = 5 + (index * 2);
            const contentId = pageId + 1;
            const stream = pdfPage.commands.join('\n');
            objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 ${italicId} 0 R >> >> /Contents ${contentId} 0 R >>`;
            objects[contentId] = `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`;
        });

        let pdf = '%PDF-1.4\n';
        const offsets = [0];
        for (let index = 1; index < objects.length; index += 1) {
            if (!objects[index]) continue;
            offsets[index] = encoder.encode(pdf).length;
            pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
        }

        const xrefOffset = encoder.encode(pdf).length;
        pdf += `xref\n0 ${objects.length}\n`;
        pdf += '0000000000 65535 f \n';
        for (let index = 1; index < objects.length; index += 1) {
            pdf += `${String(offsets[index] || 0).padStart(10, '0')} ${objects[index] ? '00000 n' : '65535 f'} \n`;
        }
        pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
        return encoder.encode(pdf);
    },

    buildLegacyPdfReport(title, content) {
        const encoder = new TextEncoder();
        const pageWidth = 612;
        const pageHeight = 792;
        const marginX = 56;
        const startY = 736;
        const lineHeight = 16;
        const maxCharsPerLine = 78;
        const lines = [
            title,
            '',
            ...String(content || '').split('\n')
        ].flatMap(line => this.wrapPdfLine(line, maxCharsPerLine));

        const linesPerPage = Math.max(1, Math.floor((startY - 56) / lineHeight));
        const pages = [];
        for (let index = 0; index < lines.length; index += linesPerPage) {
            pages.push(lines.slice(index, index + linesPerPage));
        }

        const objects = [];
        objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objects[2] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + (index * 2)} 0 R`).join(' ')}] /Count ${pages.length} >>`;
        objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

        pages.forEach((pageLines, index) => {
            const pageId = 4 + (index * 2);
            const contentId = pageId + 1;
            const stream = [
                'BT',
                '/F1 12 Tf',
                `${marginX} ${startY} Td`,
                `${lineHeight} TL`,
                ...pageLines.map((line, lineIndex) => `${lineIndex === 0 ? '' : 'T* ' }(${this.escapePdfText(line)}) Tj`.trim()),
                'ET'
            ].join('\n');

            objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
            objects[contentId] = `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`;
        });

        let pdf = '%PDF-1.4\n';
        const offsets = [0];
        for (let index = 1; index < objects.length; index += 1) {
            offsets[index] = encoder.encode(pdf).length;
            pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
        }

        const xrefOffset = encoder.encode(pdf).length;
        pdf += `xref\n0 ${objects.length}\n`;
        pdf += '0000000000 65535 f \n';
        for (let index = 1; index < objects.length; index += 1) {
            pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
        }
        pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
        return encoder.encode(pdf);
    },

    drawPdfText(commands, text, x, y, options = {}) {
        const { size = 12, font = 'F1', color = '#24324a' } = options;
        commands.push('BT');
        commands.push(`/${font} ${size} Tf`);
        commands.push(`${this.pdfColorCommand(color)} rg`);
        commands.push(`1 0 0 1 ${this.pdfNumber(x)} ${this.pdfNumber(y)} Tm`);
        commands.push(`(${this.escapePdfText(text)}) Tj`);
        commands.push('ET');
    },

    drawPdfWrappedText(commands, text, x, y, maxWidth, options = {}) {
        const { size = 12, lineHeight = size + 3, font = 'F1', color = '#24324a' } = options;
        const lines = this.wrapPdfText(text, maxWidth, size);
        lines.forEach((line, index) => {
            this.drawPdfText(commands, line, x, y - (index * lineHeight), { size, font, color });
        });
        return Math.max(lines.length, 1) * lineHeight;
    },

    drawPdfRect(commands, x, y, width, height, fillColor = null, strokeColor = null, lineWidth = 1) {
        commands.push('q');
        if (fillColor) {
            commands.push(`${this.pdfColorCommand(fillColor)} rg`);
        }
        if (strokeColor) {
            commands.push(`${this.pdfColorCommand(strokeColor)} RG`);
            commands.push(`${this.pdfNumber(lineWidth)} w`);
        }
        commands.push(`${this.pdfNumber(x)} ${this.pdfNumber(y)} ${this.pdfNumber(width)} ${this.pdfNumber(height)} re`);
        commands.push(fillColor && strokeColor ? 'B' : fillColor ? 'f' : 'S');
        commands.push('Q');
    },

    drawPdfLine(commands, x1, y1, x2, y2, color = '#d8dfeb', lineWidth = 1) {
        commands.push('q');
        commands.push(`${this.pdfColorCommand(color)} RG`);
        commands.push(`${this.pdfNumber(lineWidth)} w`);
        commands.push(`${this.pdfNumber(x1)} ${this.pdfNumber(y1)} m`);
        commands.push(`${this.pdfNumber(x2)} ${this.pdfNumber(y2)} l`);
        commands.push('S');
        commands.push('Q');
    },

    pdfColorCommand(color) {
        const normalized = String(color || '#000000').trim();
        const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
        const safeHex = hex.length === 3
            ? hex.split('').map(char => `${char}${char}`).join('')
            : hex.padEnd(6, '0').slice(0, 6);
        const channels = [0, 2, 4].map(index => {
            const value = parseInt(safeHex.slice(index, index + 2), 16);
            const safeValue = Number.isNaN(value) ? 0 : value / 255;
            return this.pdfNumber(safeValue);
        });
        return channels.join(' ');
    },

    pdfNumber(value) {
        return Number(value || 0).toFixed(3).replace(/\.?0+$/, '');
    },

    wrapPdfText(text, maxWidth, fontSize = 12) {
        const maxCharsPerLine = Math.max(12, Math.floor((maxWidth || 120) / Math.max(fontSize * 0.52, 1)));
        return String(text ?? '')
            .split('\n')
            .flatMap(line => this.wrapPdfLine(line, maxCharsPerLine));
    },

    wrapPdfLine(line, maxCharsPerLine) {
        const value = String(line ?? '');
        if (!value) return [' '];

        const wrapped = [];
        let remaining = value;
        while (remaining.length > maxCharsPerLine) {
            const slice = remaining.slice(0, maxCharsPerLine + 1);
            const breakAt = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('-'));
            const splitIndex = breakAt > 12 ? breakAt : maxCharsPerLine;
            wrapped.push(remaining.slice(0, splitIndex).trimEnd());
            remaining = remaining.slice(splitIndex).trimStart();
        }
        wrapped.push(remaining);
        return wrapped;
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    escapePdfText(value) {
        return this.normalizePdfText(value)
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
    },

    normalizePdfText(value) {
        return String(value || '')
            .replace(/₹/g, 'INR ')
            .replace(/\$/g, 'USD ')
            .replace(/€/g, 'EUR ')
            .replace(/£/g, 'GBP ')
            .replace(/¥/g, 'JPY ')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, '\'')
            .replace(/…/g, '...')
            .replace(/[–—]/g, '-')
            .replace(/\u00a0/g, ' ')
            .replace(/[^\x20-\x7E]/g, '?');
    },

    getWeekKey(date = new Date()) {
        const current = new Date(date);
        const day = current.getDay();
        const diff = current.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(current.setDate(diff));
        monday.setHours(0, 0, 0, 0);
        return monday.toISOString().split('T')[0];
    },

    buildNotificationKey(type, ...parts) {
        return [type, ...parts]
            .map(part => String(part ?? '')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, ''))
            .filter(Boolean)
            .join(':');
    },

    getNotificationStore() {
        const username = this.getCurrentUsername();
        const store = this.getState().notificationsByUser[username];
        return store && typeof store === 'object' && !Array.isArray(store) ? store : {};
    },

    saveNotificationStore(store) {
        const state = this.getState();
        const username = this.getCurrentUsername();
        state.notificationsByUser[username] = store;
        this.setState(state);
        return store;
    },

    pruneNotificationStore(activeKeys = []) {
        const currentStore = this.getNotificationStore();
        const now = Date.now();
        const activeKeySet = new Set(activeKeys);
        const nextStore = Object.fromEntries(
            Object.entries(currentStore).filter(([key, item]) => {
                const expiresAt = Number(item?.expiresAt || 0);
                if (expiresAt && expiresAt <= now) return false;
                if (!expiresAt && activeKeySet.size > 0 && !activeKeySet.has(key)) return false;
                return true;
            })
        );

        const changed = JSON.stringify(currentStore) !== JSON.stringify(nextStore);
        if (changed) {
            this.saveNotificationStore(nextStore);
        }
        return nextStore;
    },

    getRawNotifications() {
        const budget = this.getBudget();
        const settings = this.getSettings();
        const analytics = this.getAnalytics();
        const recurring = this.getRecurringExpenses();
        const notifications = [];
        const thresholdAmount = (budget.monthly || DEFAULT_BUDGET.monthly) * ((budget.alertThreshold || DEFAULT_BUDGET.alertThreshold) / 100);

        if (settings.budgetAlerts && analytics.currentCycleSpent >= thresholdAmount && budget.monthly > 0) {
            notifications.push({
                key: this.buildNotificationKey('budget-watch', analytics.cycleLabel, budget.alertThreshold),
                icon: 'fa-exclamation-triangle',
                title: 'Budget watch',
                body: `You have spent ${this.formatCurrency(analytics.currentCycleSpent)} in the current budget cycle against ${this.formatCurrency(budget.monthly)}.`,
                meta: `Budget cycle: ${analytics.cycleLabel}`,
                tone: 'warning'
            });
        }

        if (settings.billReminders) {
            if (recurring.length > 0) {
                const recurringTotal = recurring.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
                const nextRecurringOverall = recurring
                    .map(item => ({
                        ...item,
                        nextOccurrence: this.getNextRecurringOccurrence(item)
                    }))
                    .sort((a, b) => a.nextOccurrence - b.nextOccurrence)[0];

                notifications.push({
                    key: this.buildNotificationKey('recurring-active', recurring.length, this.normalizeDateKey(nextRecurringOverall?.nextOccurrence)),
                    icon: 'fa-bell',
                    title: 'Recurring expenses alert',
                    body: `${recurring.length} recurring expense${recurring.length === 1 ? '' : 's'} active in your account.`,
                    meta: nextRecurringOverall
                        ? `Next scheduled: ${nextRecurringOverall.title} on ${this.formatDate(nextRecurringOverall.nextOccurrence)} • Total planned ${this.formatCurrency(recurringTotal)}`
                        : `Total planned ${this.formatCurrency(recurringTotal)}`,
                    tone: 'info'
                });
            }

            const nextRecurring = recurring
                .map(item => ({
                    ...item,
                    nextOccurrence: this.getNextRecurringOccurrence(item)
                }))
                .filter(item => {
                    const today = this.parseSafeDate(new Date());
                    const diffDays = Math.ceil((item.nextOccurrence - today) / (1000 * 60 * 60 * 24));
                    return diffDays >= 0 && diffDays <= 7;
                })
                .sort((a, b) => a.nextOccurrence - b.nextOccurrence)[0];

            if (nextRecurring) {
                notifications.push({
                    key: this.buildNotificationKey('recurring', nextRecurring.id, this.normalizeDateKey(nextRecurring.nextOccurrence)),
                    icon: 'fa-sync-alt',
                    title: 'Recurring charge coming up',
                    body: `${nextRecurring.title} will be added automatically on ${this.formatDate(nextRecurring.nextOccurrence)}.`,
                    meta: `${this.formatCurrency(nextRecurring.amount)} - ${nextRecurring.frequency === 'weekly' ? 'Weekly schedule' : 'Budget renewal schedule'}`,
                    tone: 'info'
                });
            }
        }

        if (settings.weeklySummary && analytics.transactionCount > 0) {
            notifications.push({
                key: this.buildNotificationKey('weekly-summary', this.getWeekKey(), analytics.transactionCount),
                icon: 'fa-chart-line',
                title: 'Weekly summary',
                body: `${analytics.transactionCount} transactions tracked so far with ${analytics.topCategory} leading your spend.`,
                meta: `Average daily spend: ${this.formatCurrency(analytics.averageDailySpend)}`,
                tone: 'neutral'
            });
        }

        if (notifications.length === 0) {
            notifications.push({
                key: this.buildNotificationKey('all-quiet', this.getWeekKey()),
                icon: 'fa-check-circle',
                title: 'All quiet',
                body: 'No urgent alerts right now.',
                meta: 'Your dashboard will surface new budget or recurring updates here.',
                tone: 'success'
            });
        }

        return notifications;
    },

    getNotifications() {
        const notifications = this.getRawNotifications();
        const store = this.pruneNotificationStore(notifications.map(item => item.key));
        const now = Date.now();

        return notifications
            .map(item => {
                const state = store[item.key] || null;
                const expiresAt = Number(state?.expiresAt || 0);
                if (expiresAt && expiresAt <= now) {
                    return null;
                }

                return {
                    ...item,
                    id: item.key,
                    read: Boolean(state?.readAt),
                    readAt: state?.readAt || null,
                    expiresAt: expiresAt || null
                };
            })
            .filter(Boolean);
    },

    hasUnreadAttentionNotifications(notifications = this.getNotifications()) {
        return notifications.some(item => !item.read && (item.tone === 'warning' || item.tone === 'info'));
    },

    markNotificationRead(key) {
        if (!key) return false;
        const store = this.pruneNotificationStore(this.getRawNotifications().map(item => item.key));
        store[key] = {
            readAt: new Date().toISOString(),
            expiresAt: Date.now() + (6 * 60 * 60 * 1000)
        };
        this.saveNotificationStore(store);
        this.notifyDataChange('notifications_updated', { key, action: 'read' });
        return true;
    },

    clearNotifications(keys = []) {
        const activeNotifications = this.getNotifications();
        const targetKeys = (Array.isArray(keys) && keys.length)
            ? keys
            : activeNotifications.map(item => item.key);
        const store = this.pruneNotificationStore(activeNotifications.map(item => item.key));
        const nowIso = new Date().toISOString();
        const expiresAt = Date.now() + (6 * 60 * 60 * 1000);

        targetKeys.forEach(key => {
            if (!key) return;
            store[key] = {
                readAt: nowIso,
                expiresAt
            };
        });

        this.saveNotificationStore(store);
        this.notifyDataChange('notifications_updated', { action: 'clear_all', keys: targetKeys });
        return true;
    },

    renderNotificationsMarkup(notifications = this.getNotifications()) {
        if (!notifications.length) {
            return `
                <div class="empty-state notification-empty-state">
                    <div class="empty-state-icon"><i class="fas fa-bell-slash"></i></div>
                    <p class="mb-0">No active notifications</p>
                </div>
            `;
        }

        const hasUnread = notifications.some(item => !item.read);
        const actionBar = `
            <div class="notification-actions-bar">
                <button
                    type="button"
                    class="notification-action-btn"
                    data-notification-clear="all"
                    ${hasUnread ? '' : 'disabled'}
                >
                    Clear all
                </button>
            </div>
        `;

        const items = notifications.map(item => `
            <div class="notification-popup-item ${item.read ? 'is-read' : ''}">
                <div class="notification-popup-icon"><i class="fas ${this.escapeHtml(item.icon)}"></i></div>
                <div class="notification-popup-text">
                    <h6>${this.escapeHtml(item.title)}</h6>
                    <p>${this.escapeHtml(item.body)}</p>
                    <small>${this.escapeHtml(item.meta)}</small>
                </div>
                <div class="notification-item-actions">
                    ${item.read
                        ? `<span class="notification-read-status">Read</span>
                           <small class="notification-read-meta">Removes in 6h</small>`
                        : `<button type="button" class="notification-action-btn" data-notification-read="${this.escapeHtml(item.key)}">Mark as read</button>`
                    }
                </div>
            </div>
        `).join('');

        return `${actionBar}${items}`;
    },

    bindNotificationControls() {
        if (document.body?.dataset?.notificationsBound === 'true') return;
        if (!document.body) return;

        document.body.dataset.notificationsBound = 'true';
        document.addEventListener('click', event => {
            const readButton = event.target.closest('[data-notification-read]');
            if (readButton) {
                event.preventDefault();
                this.markNotificationRead(readButton.getAttribute('data-notification-read'));
                return;
            }

            const clearButton = event.target.closest('[data-notification-clear]');
            if (clearButton) {
                event.preventDefault();
                this.clearNotifications();

                const popupBody = document.querySelector('#notificationPopup .notification-popup-body');
                if (popupBody) {
                    const notifications = this.getNotifications();
                    popupBody.innerHTML = this.renderNotificationsMarkup(notifications);
                    const dot = document.getElementById('notificationDot');
                    if (dot) {
                        dot.style.display = this.hasUnreadAttentionNotifications(notifications) ? 'block' : 'none';
                    }
                }
                return;
            }
        });
    },

    clearAllUserData() {
        const state = this.getState();
        const username = this.getCurrentUsername();
        const currentUser = this.getCurrentUser();
        state.expensesByUser[username] = [];
        state.recurringByUser[username] = [];
        state.reportsByUser[username] = [];
        state.budgetsByUser[username] = { ...DEFAULT_BUDGET };
        state.settingsByUser[username] = { ...DEFAULT_SETTINGS };
        this.setState(state);
        localStorage.setItem(FINCAST_REMOTE_SYNC_BLOCKED, 'true');
        this.syncLegacyStorage();
        this.notifyDataChange('all_data_cleared', { username });
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            this.requestApi('/reset_user_data', {
                method: 'POST',
                body: JSON.stringify({ user_id: currentUser.id })
            }).catch(() => null);
        }
        return true;
    },

    deleteCurrentAccount() {
        const state = this.getState();
        const username = this.getCurrentUsername();
        const currentUser = this.getCurrentUser();
        state.users = state.users.filter(user => user.username !== username);
        delete state.expensesByUser[username];
        delete state.recurringByUser[username];
        delete state.reportsByUser[username];
        delete state.budgetsByUser[username];
        delete state.settingsByUser[username];
        delete state.notificationsByUser[username];
        this.setState(state);
        this.clearSession();
        this.clearLegacyKeys();
        if (this.isRemoteApiAvailable() && currentUser?.id) {
            this.requestApi('/api/users/account', {
                method: 'DELETE',
                body: JSON.stringify({ userId: currentUser.id })
            }).catch(() => null);
        }
        return true;
    },

    syncLegacyStorage() {
        const username = this.getCurrentUsername();
        const user = this.getUserByUsername(username);
        if (!user) return;

        const budget = this.getBudget();
        const settings = this.getSettings();
        const expenses = this.getExpenses();

        localStorage.setItem('fincastUser', user.username);
        localStorage.setItem('fincastFullName', user.fullName || user.username);
        localStorage.setItem('fincastEmail', user.email || '');
        localStorage.setItem('fincastPhone', user.phone || '');
        localStorage.setItem('fincastProfileImage', user.profileImage || '');
        localStorage.setItem('fincastMonthlyBudget', String(budget.monthly || DEFAULT_BUDGET.monthly));
        localStorage.setItem('fincast_cached_expenses', JSON.stringify(expenses));
        localStorage.setItem(FINCAST_LEGACY_STORAGE_KEY, JSON.stringify(expenses));
        localStorage.setItem(FINCAST_LEGACY_USER_KEY, JSON.stringify({
            username: user.username,
            email: user.email,
            phone: user.phone,
            role: user.role
        }));
        localStorage.setItem(FINCAST_LEGACY_BUDGET_KEY, JSON.stringify(budget));
        localStorage.setItem(FINCAST_LEGACY_SETTINGS_KEY, JSON.stringify(settings));
    },

    clearLegacyKeys() {
        [
            'fincastLoggedIn',
            'fincastUser',
            'fincastFullName',
            'fincastEmail',
            'fincastPhone',
            'fincastProfileImage',
            'fincastMonthlyBudget',
            'fincast_cached_expenses',
            FINCAST_LEGACY_STORAGE_KEY,
            FINCAST_LEGACY_USER_KEY,
            FINCAST_LEGACY_BUDGET_KEY,
            FINCAST_LEGACY_SETTINGS_KEY,
            FINCAST_REMOTE_SYNC_BLOCKED
        ].forEach(key => localStorage.removeItem(key));
    },

    allowRemoteSync() {
        localStorage.removeItem(FINCAST_REMOTE_SYNC_BLOCKED);
    },

    isRemoteSyncBlocked() {
        return localStorage.getItem(FINCAST_REMOTE_SYNC_BLOCKED) === 'true';
    },

    buildReportContent(type, analytics, budget, reportDate, reportId = '') {
        const displayName = this.getDisplayName();
        const annualPlanningBudget = 8000;
        const annualBudgetTotal = annualPlanningBudget * 12;
        const yearlySpent = (analytics.monthlyTotals || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
        const yearlySaved = annualBudgetTotal - yearlySpent;
        const yearlySpendPercentage = annualBudgetTotal > 0 ? Math.round((yearlySpent / annualBudgetTotal) * 100) : 0;
        const generatedOn = reportDate.toLocaleString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        const sortedCategories = Object.entries(analytics.categoryTotals || {})
            .sort(([, valueA], [, valueB]) => valueB - valueA);
        const recentTransactions = this.getExpenses()
            .slice()
            .filter(expense => {
                const expenseDate = new Date(expense.date);
                return !Number.isNaN(expenseDate.getTime())
                    && expenseDate.getFullYear() === reportDate.getFullYear()
                    && expenseDate.getMonth() === reportDate.getMonth();
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 8);
        const activeCategoryCount = sortedCategories.length;
        const currentMonthName = this.monthName(reportDate.getMonth());
        const currency = budget.currency || 'INR';

        const config = {
            monthly: {
                typeLabel: 'Monthly Performance Summary',
                subtitle: `A polished monthly overview for ${currentMonthName} ${reportDate.getFullYear()}, covering spend performance, budget coverage, and transaction activity.`,
                summary: `This monthly report highlights ${this.formatCurrency(analytics.currentMonthSpent)} in tracked spend against a budget of ${this.formatCurrency(budget.monthly)}. ${analytics.cycleBudgetLeft >= 0 ? `The account remains ${this.formatCurrency(analytics.cycleBudgetLeft)} within the current cycle budget.` : `Current spending is ${this.formatCurrency(Math.abs(analytics.cycleBudgetLeft))} above the active cycle budget.`} ${analytics.topCategory !== '-' ? `${analytics.topCategory} continues to lead spending at ${analytics.topCategoryShare}% of all recorded expenses.` : 'Spending is still too limited to identify a leading category.'}`,
                metrics: [
                    { label: 'Total Spent', value: this.formatCurrency(analytics.currentMonthSpent), note: `Recorded in ${currentMonthName}`, tone: 'accent' },
                    { label: 'Monthly Budget', value: this.formatCurrency(budget.monthly), note: `Budget currency: ${currency}` },
                    { label: 'Budget Remaining', value: this.formatCurrency(analytics.cycleBudgetLeft), note: `Cycle window: ${analytics.cycleLabel}` },
                    { label: 'Transactions', value: `${analytics.thisMonthTransactions.length}`, note: `Average value ${this.formatCurrency(analytics.averageTransaction)}` }
                ],
                sections: [
                    {
                        type: 'table',
                        title: 'Monthly Spend Overview',
                        kicker: '12-month rollup',
                        columns: [
                            { label: 'Month', width: 0.32 },
                            { label: 'Amount', width: 0.34 },
                            { label: 'Total Saved', width: 0.34 }
                        ],
                        rows: [
                            ...analytics.monthlyTotals.map((value, index) => ({
                                cells: [
                                    `${this.monthName(index)} ${reportDate.getFullYear()}`,
                                    this.formatCurrency(value),
                                    this.formatCurrency(annualPlanningBudget - value)
                                ],
                                highlight: index === reportDate.getMonth()
                            })),
                            {
                                cells: [
                                    'Total',
                                    this.formatCurrency(yearlySpent),
                                    this.formatCurrency(yearlySaved)
                                ],
                                highlight: true
                            }
                        ]
                    },
                    {
                        type: 'keyValue',
                        title: 'Performance Signals',
                        kicker: 'Current cycle',
                        forceNewPageBefore: true,
                        items: [
                            { label: 'Average Daily Spend', value: this.formatCurrency(analytics.averageDailySpend) },
                            { label: 'Average Transaction', value: this.formatCurrency(analytics.averageTransaction) },
                            { label: 'Projected Monthly Spend', value: this.formatCurrency(analytics.predictedMonthly) },
                            { label: 'Top Category', value: `${analytics.topCategory} (${analytics.topCategoryShare}%)`, highlight: true }
                        ]
                    },
                    {
                        type: 'keyValue',
                        title: 'Annual Budget Position',
                        kicker: '8000 x 12 benchmark',
                        items: [
                            { label: 'Annual Budget Baseline', value: this.formatCurrency(annualBudgetTotal) },
                            { label: 'Yearly Spending', value: this.formatCurrency(yearlySpent) },
                            { label: 'Yearly Savings', value: this.formatCurrency(yearlySaved) },
                            { label: 'Budget Utilized', value: `${yearlySpendPercentage}%` }
                        ]
                    }
                ]
            },
            category: {
                typeLabel: 'Category Spend Analysis',
                subtitle: `A category-first report for ${currentMonthName} ${reportDate.getFullYear()}, designed to surface the strongest expense drivers and concentration patterns.`,
                summary: `The category report reviews ${activeCategoryCount} active spending categories with ${analytics.topCategory !== '-' ? analytics.topCategory : 'no single category'} as the leading driver. ${analytics.topCategory !== '-' ? `${analytics.topCategory} represents ${analytics.topCategoryShare}% of total spend and indicates where budget controls can have the highest impact.` : 'More transaction data will improve category insights and pattern detection.'}`,
                metrics: [
                    { label: 'Total Spend', value: this.formatCurrency(analytics.totalSpent), note: 'Across all tracked categories', tone: 'accent' },
                    { label: 'Top Category', value: analytics.topCategory, note: `${analytics.topCategoryShare}% share of spend` },
                    { label: 'Active Categories', value: `${activeCategoryCount}`, note: 'Categories with recorded activity' },
                    { label: 'Average Transaction', value: this.formatCurrency(analytics.averageTransaction), note: 'Helps gauge typical purchase size' }
                ],
                sections: [
                    {
                        type: 'table',
                        title: 'Category Breakdown',
                        kicker: 'Ranked by spend',
                        afterGap: 18,
                        columns: [
                            { label: 'Category', width: 0.34 },
                            { label: 'Amount', width: 0.33 },
                            { label: 'Share', width: 0.33 }
                        ],
                        rows: (sortedCategories.length ? sortedCategories : [['No category data', 0]]).map(([category, value]) => [
                            category,
                            this.formatCurrency(value),
                            analytics.totalSpent > 0 ? `${Math.round((value / analytics.totalSpent) * 100)}%` : '0%'
                        ])
                    },
                    {
                        type: 'keyValue',
                        title: 'Category Insights',
                        kicker: 'Decision support',
                        items: [
                            { label: 'Largest Spend Driver', value: analytics.topCategory === '-' ? 'Not available' : analytics.topCategory },
                            { label: 'Projected Month-End Spend', value: this.formatCurrency(analytics.predictedMonthly) },
                            { label: 'Savings Rate', value: `${analytics.savingsRate}%` }
                        ]
                    }
                ]
            },
            budget: {
                typeLabel: 'Budget Performance Summary',
                subtitle: `A planning-focused budget report for ${currentMonthName} ${reportDate.getFullYear()}, with current-cycle pacing, savings rate, and forecast visibility.`,
                summary: `The active budget is set at ${this.formatCurrency(budget.monthly)} with an alert threshold of ${budget.alertThreshold}%. ${analytics.cycleBudgetLeft >= 0 ? `Current cycle spending remains under budget by ${this.formatCurrency(analytics.cycleBudgetLeft)}.` : `Current cycle spending is over budget by ${this.formatCurrency(Math.abs(analytics.cycleBudgetLeft))}.`} The current savings rate stands at ${analytics.savingsRate}% with a projected month-end spend of ${this.formatCurrency(analytics.predictedMonthly)}.`,
                metrics: [
                    { label: 'Approved Budget', value: this.formatCurrency(budget.monthly), note: `Alert threshold ${budget.alertThreshold}%`, tone: 'accent' },
                    { label: 'Cycle Spend', value: this.formatCurrency(analytics.currentCycleSpent), note: analytics.cycleLabel },
                    { label: 'Budget Remaining', value: this.formatCurrency(analytics.cycleBudgetLeft), note: `${analytics.currentCycleSaved >= 0 ? 'Available to save' : 'Requires correction'}` },
                    { label: 'Savings Rate', value: `${analytics.savingsRate}%`, note: `Projected spend ${this.formatCurrency(analytics.predictedMonthly)}` }
                ],
                sections: [
                    {
                        type: 'keyValue',
                        title: 'Budget Performance',
                        kicker: 'Planning snapshot',
                        items: [
                            { label: 'Reporting Window', value: analytics.cycleLabel },
                            { label: 'Current Cycle Spend', value: this.formatCurrency(analytics.currentCycleSpent) },
                            { label: 'Current Cycle Savings', value: this.formatCurrency(analytics.currentCycleSaved) },
                            { label: 'Predicted Monthly Spend', value: this.formatCurrency(analytics.predictedMonthly) },
                            { label: 'Auto Renew', value: budget.autoRenew ? `Enabled on day ${budget.renewalDay || 1}` : 'Disabled' }
                        ]
                    },
                    {
                        type: 'table',
                        title: 'Recent Transactions',
                        kicker: 'Latest transactions',
                        forceNewPageBefore: true,
                        columns: [
                            { label: 'Date', width: 0.2 },
                            { label: 'Description', width: 0.34 },
                            { label: 'Category', width: 0.22 },
                            { label: 'Amount', width: 0.24 }
                        ],
                        rows: (recentTransactions.length ? recentTransactions : [{
                            date: reportDate,
                            name: 'No recent transactions',
                            category: 'N/A',
                            amount: 0
                        }]).map(expense => [
                            this.formatDate(expense.date),
                            expense.name,
                            expense.category,
                            this.formatCurrency(expense.amount)
                        ])
                    }
                ]
            }
        };

        const selected = config[type] || config.monthly;
        const sections = [...selected.sections];
        if (type !== 'budget') {
            sections.push({
                type: 'table',
                title: 'Recent Transactions',
                kicker: 'Latest activity',
                forceNewPageBefore: true,
                columns: [
                    { label: 'Date', width: 0.2 },
                    { label: 'Description', width: 0.34 },
                    { label: 'Category', width: 0.22 },
                    { label: 'Amount', width: 0.24 }
                ],
                rows: (recentTransactions.length ? recentTransactions : [{
                    date: reportDate,
                    name: 'No recent transactions',
                    category: 'N/A',
                    amount: 0
                }]).map(expense => [
                    this.formatDate(expense.date),
                    expense.name,
                    expense.category,
                    this.formatCurrency(expense.amount)
                ])
            });
        }

        return {
            version: 2,
            type,
            typeLabel: selected.typeLabel,
            title: this.getReportName(type, reportDate),
            subtitle: selected.subtitle,
            summary: selected.summary,
            meta: [
                { label: 'Reporting Period', value: this.getReportPeriod(type, reportDate) },
                { label: 'Prepared For', value: displayName },
                { label: 'Generated On', value: generatedOn },
                { label: 'Report ID', value: reportId || this.makeId('rpt') }
            ],
            metrics: selected.metrics,
            sections,
            footerNote: 'Prepared by Flow Finance'
        };
    },

    getReportName(type, reportDate) {
        const month = this.monthName(reportDate.getMonth());
        const year = reportDate.getFullYear();
        const label = {
            monthly: `${month} ${year} Report`,
            category: `${month} ${year} Category Analysis`,
            budget: `${month} ${year} Budget Report`
        };
        return label[type] || `${month} ${year} Report`;
    },

    getReportPeriod(type, reportDate) {
        const month = this.monthName(reportDate.getMonth());
        const year = reportDate.getFullYear();
        if (type === 'budget') return `${month} ${year} Budget Window`;
        if (type === 'category') return `${month} ${year} Category Snapshot`;
        return `${month} ${year}`;
    },

    bindSignOutLinks() {
        if (document.body?.dataset?.signoutBound === 'true') return;
        if (!document.body) return;

        document.body.dataset.signoutBound = 'true';
        document.addEventListener('click', event => {
            const signoutLink = event.target.closest('.signout-btn');
            if (!signoutLink) return;
            event.preventDefault();
            this.logout();
        });
    },

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    },

    notifyDataChange(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
        window.dispatchEvent(new CustomEvent('fincast_data_change', {
            detail: { event, data }
        }));
    },

    monthName(index) {
        return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][index] || '-';
    },

    formatDate(dateValue) {
        const date = new Date(dateValue);
        if (Number.isNaN(date.getTime())) return dateValue || '-';
        return date.toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    dedupeExpenses(expenses) {
        const seen = new Set();
        return (expenses || []).map(item => ({
            id: item.id || this.makeId('exp'),
            name: item.name || item.title || 'Untitled expense',
            amount: Number(item.amount) || 0,
            category: item.category || 'Other',
            date: item.date || new Date().toISOString().split('T')[0],
            recurringId: item.recurringId || null,
            sourceType: item.sourceType || 'manual',
            scheduleKey: item.scheduleKey || null
        })).filter(item => {
            const key = item.scheduleKey || `${item.name}|${item.amount}|${item.category}|${item.date}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    },

    makeId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    },

    async hashPassword(value) {
        const content = String(value || '');
        if (window.crypto?.subtle && window.TextEncoder) {
            const encoded = new TextEncoder().encode(content);
            const digest = await crypto.subtle.digest('SHA-256', encoded);
            return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
        }

        let hash = 0;
        for (let index = 0; index < content.length; index += 1) {
            hash = ((hash << 5) - hash) + content.charCodeAt(index);
            hash |= 0;
        }
        return `fallback_${Math.abs(hash)}`;
    },

    sync() {
        return {
            user: this.getUserData(),
            budget: this.getBudget(),
            settings: this.getSettings(),
            expenses: this.getExpenses(),
            recurring: this.getRecurringExpenses(),
            reports: this.getReports(),
            analytics: this.getAnalytics(),
            notifications: this.getNotifications()
        };
    }
};

FinCastData.init();
window.FinCastData = FinCastData;

const FlowUndo = {
    container: null,
    messageNode: null,
    detailNode: null,
    actionButton: null,
    dismissButton: null,
    timer: null,
    currentAction: null,

    ensureMounted() {
        if (this.container) return this.container;
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', () => this.ensureMounted(), { once: true });
            return null;
        }

        const toast = document.createElement('div');
        toast.className = 'undo-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.innerHTML = `
            <div class="undo-toast__icon"><i class="fas fa-rotate-left"></i></div>
            <div class="undo-toast__copy">
                <strong class="undo-toast__title"></strong>
                <small class="undo-toast__detail">Undo is available for a few seconds.</small>
            </div>
            <div class="undo-toast__actions">
                <button class="undo-toast__button" type="button">Undo</button>
                <button class="undo-toast__dismiss" type="button" aria-label="Dismiss undo message">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        document.body.appendChild(toast);
        this.container = toast;
        this.messageNode = toast.querySelector('.undo-toast__title');
        this.detailNode = toast.querySelector('.undo-toast__detail');
        this.actionButton = toast.querySelector('.undo-toast__button');
        this.dismissButton = toast.querySelector('.undo-toast__dismiss');

        this.actionButton?.addEventListener('click', async () => {
            if (!this.currentAction?.onUndo) return;

            const pendingUndo = this.currentAction.onUndo;
            this.hide();
            try {
                await pendingUndo();
            } catch (error) {
                console.warn('Undo action failed:', error);
            }
        });

        this.dismissButton?.addEventListener('click', () => this.hide());
        return this.container;
    },

    show({ message, detail, actionLabel = 'Undo', timeout = 6000, onUndo } = {}) {
        const toast = this.ensureMounted();
        if (!toast) return;

        window.clearTimeout(this.timer);
        this.currentAction = { onUndo };

        if (this.messageNode) {
            this.messageNode.textContent = message || 'Recent action removed.';
        }
        if (this.detailNode) {
            this.detailNode.textContent = detail || 'Undo is available for a few seconds.';
        }
        if (this.actionButton) {
            this.actionButton.textContent = actionLabel;
            this.actionButton.disabled = typeof onUndo !== 'function';
        }

        toast.classList.add('active');
        this.timer = window.setTimeout(() => this.hide(), timeout);
    },

    hide() {
        window.clearTimeout(this.timer);
        this.timer = null;
        this.currentAction = null;
        this.container?.classList.remove('active');
    }
};

window.FlowUndo = FlowUndo;
