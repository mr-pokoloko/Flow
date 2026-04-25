import { Client } from 'pg';

const jsonHeaders = {
    'content-type': 'application/json; charset=utf-8'
};

export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);

            if (url.pathname === '/api/chat' && request.method === 'POST') {
                return handleChat(request, env);
            }

            if (url.pathname === '/api/auth/register' && request.method === 'POST') {
                return handleRegister(request, env);
            }

            if (url.pathname === '/api/auth/login' && request.method === 'POST') {
                return handleLogin(request, env);
            }

            if (url.pathname.startsWith('/api/bootstrap/') && request.method === 'GET') {
                const username = decodeURIComponent(url.pathname.split('/').pop() || '');
                return handleBootstrap(username, env);
            }

            if (url.pathname === '/add_expense' && request.method === 'POST') {
                return handleCreateExpense(request, env);
            }

            if (url.pathname.startsWith('/update_expense/') && request.method === 'PUT') {
                const expenseId = url.pathname.split('/').pop();
                return handleUpdateExpense(expenseId, request, env);
            }

            if (url.pathname.startsWith('/delete_expense/') && request.method === 'DELETE') {
                const expenseId = url.pathname.split('/').pop();
                return handleDeleteExpense(expenseId, env);
            }

            if (url.pathname.startsWith('/get_expenses/') && request.method === 'GET') {
                const userId = url.pathname.split('/').pop();
                return handleGetExpenses(userId, env);
            }

            if (url.pathname.startsWith('/get_budget/') && request.method === 'GET') {
                const userId = url.pathname.split('/').pop();
                return handleGetBudget(userId, env);
            }

            if (url.pathname === '/update_budget' && request.method === 'POST') {
                return handleUpdateBudget(request, env);
            }

            if (url.pathname.startsWith('/get_recurring/') && request.method === 'GET') {
                const userId = url.pathname.split('/').pop();
                return handleGetRecurring(userId, env);
            }

            if (url.pathname === '/add_recurring' && request.method === 'POST') {
                return handleCreateRecurring(request, env);
            }

            if (url.pathname.startsWith('/delete_recurring/') && request.method === 'DELETE') {
                const recurringId = url.pathname.split('/').pop();
                return handleDeleteRecurring(recurringId, env);
            }

            if (url.pathname === '/reset_user_data' && request.method === 'POST') {
                return handleResetUserData(request, env);
            }

            if (url.pathname === '/api/users/profile' && request.method === 'PUT') {
                return handleUpdateProfile(request, env);
            }

            if (url.pathname === '/api/users/password' && request.method === 'PUT') {
                return handleUpdatePassword(request, env);
            }

            if (url.pathname === '/api/settings' && request.method === 'PUT') {
                return handleUpdateSettings(request, env);
            }

            if (url.pathname === '/api/reports' && request.method === 'POST') {
                return handleCreateReport(request, env);
            }

            if (url.pathname.startsWith('/api/reports/') && request.method === 'DELETE') {
                const reportId = url.pathname.split('/').pop();
                return handleDeleteReport(reportId, env);
            }

            if (url.pathname === '/api/users/account' && request.method === 'DELETE') {
                return handleDeleteAccount(request, env);
            }

            return env.ASSETS.fetch(request);
        } catch (error) {
            return jsonResponse(
                {
                    error: error instanceof Error ? error.message : 'Unexpected server error.'
                },
                500
            );
        }
    }
};

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: jsonHeaders
    });
}

async function parseJson(request) {
    try {
        return await request.json();
    } catch {
        return {};
    }
}

async function withDb(env, callback) {
    const connectionString = env.HYPERDRIVE?.connectionString;
    if (!connectionString) {
        throw new Error('Missing Hyperdrive binding. Configure HYPERDRIVE in wrangler.');
    }

    const client = new Client({
        connectionString
    });

    await client.connect();
    try {
        return await callback(client);
    } finally {
        await client.end();
    }
}

function mapUser(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        username: row.username,
        fullName: row.full_name,
        email: row.email || '',
        phone: row.phone || '',
        role: row.role || 'Premium Member',
        profileImage: row.profile_image || '',
        passwordHash: row.password_hash || null,
        legacyAccount: Boolean(row.legacy_account),
        createdAt: row.created_at
    };
}

function mapBudget(row) {
    if (!row) {
        return {
            monthly: 5000,
            alertThreshold: 80,
            currency: 'INR',
            autoRenew: false,
            renewalDay: 1
        };
    }

    return {
        monthly: Number(row.monthly),
        alertThreshold: Number(row.alert_threshold),
        currency: row.currency,
        autoRenew: Boolean(row.auto_renew),
        renewalDay: Number(row.renewal_day)
    };
}

function mapSettings(row) {
    if (!row) {
        return {
            budgetAlerts: true,
            weeklySummary: true,
            largeExpenseAlerts: false,
            billReminders: true,
            twoFactor: true,
            theme: 'light'
        };
    }

    return {
        budgetAlerts: Boolean(row.budget_alerts),
        weeklySummary: Boolean(row.weekly_summary),
        largeExpenseAlerts: Boolean(row.large_expense_alerts),
        billReminders: Boolean(row.bill_reminders),
        twoFactor: Boolean(row.two_factor),
        theme: row.theme || 'light'
    };
}

function mapExpense(row) {
    return {
        id: String(row.id),
        name: row.title,
        title: row.title,
        amount: Number(row.amount),
        category: row.category,
        date: row.date,
        recurringId: row.recurring_id ? String(row.recurring_id) : null,
        sourceType: row.source_type || 'manual',
        scheduleKey: row.schedule_key || null
    };
}

function mapRecurring(row) {
    return {
        id: String(row.id),
        title: row.title,
        amount: Number(row.amount),
        category: row.category,
        frequency: row.frequency,
        startDate: row.start_date,
        createdAt: row.created_at
    };
}

function mapReport(row) {
    return {
        id: String(row.id),
        type: row.report_type,
        name: row.name,
        period: typeof row.period === 'string' ? row.period : JSON.stringify(row.period || {}),
        generatedOn: row.generated_on,
        size: row.size || '0 KB',
        content: row.content || {}
    };
}

async function sha256Hex(value) {
    const content = new TextEncoder().encode(String(value || ''));
    const digest = await crypto.subtle.digest('SHA-256', content);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getUserByUsername(client, username) {
    const result = await client.query(
        `SELECT id, username, full_name, email, phone, role, profile_image, password_hash, legacy_account, created_at
         FROM users
         WHERE LOWER(username) = LOWER($1)
         LIMIT 1`,
        [username]
    );
    return result.rows[0] || null;
}

async function getBootstrapPayload(client, userRow) {
    const userId = userRow.id;
    const budgetResult = await client.query(
        `SELECT monthly, alert_threshold, currency, auto_renew, renewal_day
         FROM budgets
         WHERE user_id = $1
         LIMIT 1`,
        [userId]
    );
    const settingsResult = await client.query(
        `SELECT budget_alerts, weekly_summary, large_expense_alerts, bill_reminders, two_factor, theme
         FROM settings
         WHERE user_id = $1
         LIMIT 1`,
        [userId]
    );
    const expensesResult = await client.query(
        `SELECT id, title, amount, category, date::text AS date, recurring_id, source_type, schedule_key
         FROM expenses
         WHERE user_id = $1
         ORDER BY date DESC, created_at DESC`,
        [userId]
    );
    const recurringResult = await client.query(
        `SELECT id, title, amount, category, frequency, start_date::text AS start_date, created_at
         FROM recurring_expenses
         WHERE user_id = $1
         ORDER BY title ASC, created_at DESC`,
        [userId]
    );
    const reportsResult = await client.query(
        `SELECT id, report_type, name, period, generated_on, size, content
         FROM reports
         WHERE user_id = $1
         ORDER BY generated_on DESC`,
        [userId]
    );

    return {
        user: mapUser(userRow),
        budget: mapBudget(budgetResult.rows[0]),
        settings: mapSettings(settingsResult.rows[0]),
        expenses: expensesResult.rows.map(mapExpense),
        recurring: recurringResult.rows.map(mapRecurring),
        reports: reportsResult.rows.map(mapReport)
    };
}

async function handleBootstrap(username, env) {
    if (!username) {
        return jsonResponse({ error: 'Username is required.' }, 400);
    }

    return withDb(env, async client => {
        const user = await getUserByUsername(client, username);
        if (!user) {
            return jsonResponse({ error: 'Account not found.' }, 404);
        }

        return jsonResponse(await getBootstrapPayload(client, user));
    });
}

async function handleRegister(request, env) {
    const payload = await parseJson(request);
    const username = String(payload.username || '').trim();
    const fullName = String(payload.fullName || username).trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '');

    if (!username || !password || !fullName) {
        return jsonResponse({ error: 'Full name, username, and password are required.' }, 400);
    }

    return withDb(env, async client => {
        const existingUser = await getUserByUsername(client, username);
        if (existingUser) {
            return jsonResponse({ error: 'That username is already in use.' }, 409);
        }

        if (email) {
            const existingEmail = await client.query(
                `SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
                [email]
            );
            if (existingEmail.rowCount) {
                return jsonResponse({ error: 'That email is already in use.' }, 409);
            }
        }

        const passwordHash = await sha256Hex(password);
        const insertedUser = await client.query(
            `INSERT INTO users (username, full_name, email, phone, role, profile_image, password_hash, legacy_account)
             VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
             RETURNING id, username, full_name, email, phone, role, profile_image, password_hash, legacy_account, created_at`,
            [
                username,
                fullName,
                email || null,
                String(payload.phone || '').trim() || null,
                'Premium Member',
                String(payload.profileImage || '').trim() || null,
                passwordHash
            ]
        );

        const user = insertedUser.rows[0];
        await client.query(
            `INSERT INTO budgets (user_id) VALUES ($1)
             ON CONFLICT (user_id) DO NOTHING`,
            [user.id]
        );
        await client.query(
            `INSERT INTO settings (user_id) VALUES ($1)
             ON CONFLICT (user_id) DO NOTHING`,
            [user.id]
        );

        return jsonResponse(await getBootstrapPayload(client, user), 201);
    });
}

async function handleLogin(request, env) {
    const payload = await parseJson(request);
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');

    if (!username || !password) {
        return jsonResponse({ error: 'Username and password are required.' }, 400);
    }

    return withDb(env, async client => {
        const user = await getUserByUsername(client, username);
        if (!user) {
            return jsonResponse({ error: 'Account not found.' }, 404);
        }

        if (user.password_hash) {
            const passwordHash = await sha256Hex(password);
            if (passwordHash !== user.password_hash) {
                return jsonResponse({ error: 'Incorrect password.' }, 401);
            }
        } else if (!user.legacy_account) {
            return jsonResponse({ error: 'This account is not available for passwordless login.' }, 401);
        }

        return jsonResponse(await getBootstrapPayload(client, user));
    });
}

async function handleUpdateProfile(request, env) {
    const payload = await parseJson(request);
    const userId = Number(payload.userId);
    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400);
    }

    return withDb(env, async client => {
        const result = await client.query(
            `UPDATE users
             SET full_name = $2,
                 email = $3,
                 phone = $4,
                 profile_image = $5
             WHERE id = $1
             RETURNING id, username, full_name, email, phone, role, profile_image, password_hash, legacy_account, created_at`,
            [
                userId,
                String(payload.fullName || '').trim() || String(payload.username || '').trim(),
                String(payload.email || '').trim() || null,
                String(payload.phone || '').trim() || null,
                String(payload.profileImage || '').trim() || null
            ]
        );

        if (!result.rowCount) {
            return jsonResponse({ error: 'Account not found.' }, 404);
        }

        return jsonResponse({ user: mapUser(result.rows[0]) });
    });
}

async function handleUpdatePassword(request, env) {
    const payload = await parseJson(request);
    const userId = Number(payload.userId);
    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400);
    }

    return withDb(env, async client => {
        const userResult = await client.query(
            `SELECT id, password_hash, legacy_account FROM users WHERE id = $1 LIMIT 1`,
            [userId]
        );
        const user = userResult.rows[0];
        if (!user) {
            return jsonResponse({ error: 'Account not found.' }, 404);
        }

        if (user.password_hash) {
            const currentHash = await sha256Hex(String(payload.currentPassword || ''));
            if (currentHash !== user.password_hash) {
                return jsonResponse({ error: 'Current password is incorrect.' }, 401);
            }
        }

        const nextPassword = String(payload.nextPassword || '');
        if (nextPassword.length < 6) {
            return jsonResponse({ error: 'Please enter a new password with at least 6 characters.' }, 400);
        }

        const nextHash = await sha256Hex(nextPassword);
        await client.query(
            `UPDATE users
             SET password_hash = $2, legacy_account = FALSE
             WHERE id = $1`,
            [userId, nextHash]
        );

        return jsonResponse({ updated: true });
    });
}

async function handleGetExpenses(userId, env) {
    return withDb(env, async client => {
        const result = await client.query(
            `SELECT id, title, amount, category, date::text AS date, recurring_id, source_type, schedule_key
             FROM expenses
             WHERE user_id = $1
             ORDER BY date DESC, created_at DESC`,
            [userId]
        );
        return jsonResponse(result.rows.map(row => ({
            id: row.id,
            title: row.title,
            amount: Number(row.amount),
            category: row.category,
            date: row.date,
            recurring_id: row.recurring_id,
            source_type: row.source_type,
            schedule_key: row.schedule_key
        })));
    });
}

async function handleCreateExpense(request, env) {
    const payload = await parseJson(request);
    const userId = Number(payload.user_id);
    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400);
    }

    return withDb(env, async client => {
        const result = await client.query(
            `INSERT INTO expenses (user_id, title, amount, category, date, recurring_id, source_type, schedule_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, title, amount, category, date::text AS date, recurring_id, source_type, schedule_key`,
            [
                userId,
                String(payload.title || payload.name || 'Untitled expense').trim(),
                Number(payload.amount || 0),
                String(payload.category || 'Other').trim() || 'Other',
                String(payload.date || new Date().toISOString().slice(0, 10)),
                payload.recurring_id ? Number(payload.recurring_id) : null,
                String(payload.source_type || 'manual'),
                payload.schedule_key || null
            ]
        );
        return jsonResponse(result.rows[0], 201);
    });
}

async function handleUpdateExpense(expenseId, request, env) {
    const payload = await parseJson(request);
    return withDb(env, async client => {
        const result = await client.query(
            `UPDATE expenses
             SET title = $2,
                 amount = $3,
                 category = $4,
                 date = $5,
                 source_type = COALESCE($6, source_type),
                 schedule_key = COALESCE($7, schedule_key),
                 updated_at = now()
             WHERE id = $1
             RETURNING id, title, amount, category, date::text AS date, recurring_id, source_type, schedule_key`,
            [
                Number(expenseId),
                String(payload.title || payload.name || 'Untitled expense').trim(),
                Number(payload.amount || 0),
                String(payload.category || 'Other').trim() || 'Other',
                String(payload.date || new Date().toISOString().slice(0, 10)),
                payload.source_type || null,
                payload.schedule_key || null
            ]
        );
        if (!result.rowCount) {
            return jsonResponse({ error: 'Expense not found.' }, 404);
        }
        return jsonResponse(result.rows[0]);
    });
}

async function handleDeleteExpense(expenseId, env) {
    return withDb(env, async client => {
        const result = await client.query(`DELETE FROM expenses WHERE id = $1 RETURNING id`, [Number(expenseId)]);
        if (!result.rowCount) {
            return jsonResponse({ error: 'Expense not found.' }, 404);
        }
        return jsonResponse({ deleted: true, id: expenseId });
    });
}

async function handleGetBudget(userId, env) {
    return withDb(env, async client => {
        const result = await client.query(
            `SELECT monthly, alert_threshold, currency, auto_renew, renewal_day
             FROM budgets
             WHERE user_id = $1
             LIMIT 1`,
            [userId]
        );
        return jsonResponse(result.rows[0] || { monthly: 5000, alert_threshold: 80, currency: 'INR', auto_renew: false, renewal_day: 1 });
    });
}

async function handleUpdateBudget(request, env) {
    const payload = await parseJson(request);
    const userId = Number(payload.user_id || payload.userId);
    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400);
    }

    return withDb(env, async client => {
        const result = await client.query(
            `INSERT INTO budgets (user_id, monthly, alert_threshold, currency, auto_renew, renewal_day, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (user_id) DO UPDATE SET
                 monthly = EXCLUDED.monthly,
                 alert_threshold = EXCLUDED.alert_threshold,
                 currency = EXCLUDED.currency,
                 auto_renew = EXCLUDED.auto_renew,
                 renewal_day = EXCLUDED.renewal_day,
                 updated_at = now()
             RETURNING monthly, alert_threshold, currency, auto_renew, renewal_day`,
            [
                userId,
                Number(payload.monthly || 5000),
                Number(payload.alert_threshold ?? payload.alertThreshold ?? 80),
                String(payload.currency || 'INR'),
                Boolean(payload.auto_renew ?? payload.autoRenew ?? false),
                Number(payload.renewal_day ?? payload.renewalDay ?? 1)
            ]
        );
        return jsonResponse(result.rows[0]);
    });
}

async function handleUpdateSettings(request, env) {
    const payload = await parseJson(request);
    const userId = Number(payload.userId);
    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400);
    }

    return withDb(env, async client => {
        const result = await client.query(
            `INSERT INTO settings (user_id, budget_alerts, weekly_summary, large_expense_alerts, bill_reminders, two_factor, theme, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now())
             ON CONFLICT (user_id) DO UPDATE SET
                 budget_alerts = EXCLUDED.budget_alerts,
                 weekly_summary = EXCLUDED.weekly_summary,
                 large_expense_alerts = EXCLUDED.large_expense_alerts,
                 bill_reminders = EXCLUDED.bill_reminders,
                 two_factor = EXCLUDED.two_factor,
                 theme = EXCLUDED.theme,
                 updated_at = now()
             RETURNING budget_alerts, weekly_summary, large_expense_alerts, bill_reminders, two_factor, theme`,
            [
                userId,
                Boolean(payload.budgetAlerts),
                Boolean(payload.weeklySummary),
                Boolean(payload.largeExpenseAlerts),
                Boolean(payload.billReminders),
                Boolean(payload.twoFactor),
                String(payload.theme || 'light')
            ]
        );
        return jsonResponse({ settings: mapSettings(result.rows[0]) });
    });
}

async function handleGetRecurring(userId, env) {
    return withDb(env, async client => {
        const result = await client.query(
            `SELECT id, title, amount, category, frequency, start_date::text AS start_date, created_at
             FROM recurring_expenses
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );
        return jsonResponse(result.rows.map(row => ({
            id: row.id,
            title: row.title,
            amount: Number(row.amount),
            category: row.category,
            frequency: row.frequency,
            startDate: row.start_date,
            createdAt: row.created_at
        })));
    });
}

async function handleCreateRecurring(request, env) {
    const payload = await parseJson(request);
    const userId = Number(payload.user_id || payload.userId);
    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400);
    }

    return withDb(env, async client => {
        const result = await client.query(
            `INSERT INTO recurring_expenses (user_id, title, amount, category, frequency, start_date, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             RETURNING id, title, amount, category, frequency, start_date::text AS start_date, created_at`,
            [
                userId,
                String(payload.title || 'Recurring expense').trim(),
                Number(payload.amount || 0),
                String(payload.category || 'Bills').trim() || 'Bills',
                String(payload.frequency || 'monthly'),
                String(payload.start_date || payload.startDate || new Date().toISOString().slice(0, 10))
            ]
        );
        return jsonResponse(result.rows[0], 201);
    });
}

async function handleDeleteRecurring(recurringId, env) {
    return withDb(env, async client => {
        const result = await client.query(`DELETE FROM recurring_expenses WHERE id = $1 RETURNING id`, [Number(recurringId)]);
        if (!result.rowCount) {
            return jsonResponse({ error: 'Recurring expense not found.' }, 404);
        }
        return jsonResponse({ deleted: true, id: recurringId });
    });
}

async function handleCreateReport(request, env) {
    const payload = await parseJson(request);
    const userId = Number(payload.userId);
    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400);
    }

    return withDb(env, async client => {
        const result = await client.query(
            `INSERT INTO reports (user_id, report_type, name, period, size, content)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
             RETURNING id, report_type, name, period, generated_on, size, content`,
            [
                userId,
                String(payload.type || 'monthly'),
                String(payload.name || 'Flow Report'),
                JSON.stringify(payload.periodObject || { label: payload.period || null }),
                String(payload.size || '0 KB'),
                JSON.stringify(payload.content || {})
            ]
        );
        return jsonResponse({ report: mapReport(result.rows[0]) }, 201);
    });
}

async function handleDeleteReport(reportId, env) {
    return withDb(env, async client => {
        const result = await client.query(`DELETE FROM reports WHERE id = $1 RETURNING id`, [Number(reportId)]);
        if (!result.rowCount) {
            return jsonResponse({ error: 'Report not found.' }, 404);
        }
        return jsonResponse({ deleted: true, id: reportId });
    });
}

async function handleResetUserData(request, env) {
    const payload = await parseJson(request);
    const userId = Number(payload.user_id || payload.userId);
    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400);
    }

    return withDb(env, async client => {
        await client.query('BEGIN');
        try {
            await client.query(`DELETE FROM user_report_categories WHERE report_download_id IN (SELECT id FROM user_report_downloads WHERE user_id = $1)`, [userId]);
            await client.query(`DELETE FROM user_report_downloads WHERE user_id = $1`, [userId]);
            await client.query(`DELETE FROM reports WHERE user_id = $1`, [userId]);
            await client.query(`DELETE FROM expenses WHERE user_id = $1`, [userId]);
            await client.query(`DELETE FROM recurring_expenses WHERE user_id = $1`, [userId]);
            await client.query(`DELETE FROM notification_states WHERE user_id = $1`, [userId]);
            await client.query(
                `INSERT INTO budgets (user_id, monthly, alert_threshold, currency, auto_renew, renewal_day, updated_at)
                 VALUES ($1, 5000, 80, 'INR', FALSE, 1, now())
                 ON CONFLICT (user_id) DO UPDATE SET
                     monthly = 5000,
                     alert_threshold = 80,
                     currency = 'INR',
                     auto_renew = FALSE,
                     renewal_day = 1,
                     updated_at = now()`,
                [userId]
            );
            await client.query(
                `INSERT INTO settings (user_id, budget_alerts, weekly_summary, large_expense_alerts, bill_reminders, two_factor, theme, updated_at)
                 VALUES ($1, TRUE, TRUE, FALSE, TRUE, TRUE, 'light', now())
                 ON CONFLICT (user_id) DO UPDATE SET
                     budget_alerts = TRUE,
                     weekly_summary = TRUE,
                     large_expense_alerts = FALSE,
                     bill_reminders = TRUE,
                     two_factor = TRUE,
                     theme = 'light',
                     updated_at = now()`,
                [userId]
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }

        return jsonResponse({ reset: true, user_id: userId });
    });
}

async function handleDeleteAccount(request, env) {
    const payload = await parseJson(request);
    const userId = Number(payload.userId);
    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400);
    }

    return withDb(env, async client => {
        const result = await client.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [userId]);
        if (!result.rowCount) {
            return jsonResponse({ error: 'Account not found.' }, 404);
        }
        return jsonResponse({ deleted: true, userId });
    });
}

function buildChatContext(payload) {
    const history = Array.isArray(payload.history) ? payload.history : [];
    const context = payload.context || {};
    const page = String(context.page || 'Flow').trim();
    const user = context.user || {};
    const budget = context.budget || {};
    const analytics = context.analytics || {};

    const transcript = history.slice(-8).map(item => {
        const role = item.role === 'assistant' ? 'Assistant' : 'User';
        return `${role}: ${String(item.text || '').trim()}`;
    }).filter(Boolean).join('\n') || 'No prior messages';

    const userSummary = [
        user.fullName ? `Name: ${user.fullName}` : '',
        user.username ? `Username: ${user.username}` : ''
    ].filter(Boolean).join('\n') || 'Not available';

    const budgetSummary = [
        budget.currency ? `Currency: ${budget.currency}` : '',
        budget.monthly !== undefined ? `Monthly budget: ${budget.monthly}` : '',
        analytics.budgetLeft !== undefined ? `Budget left: ${analytics.budgetLeft}` : '',
        analytics.topCategory ? `Top category: ${analytics.topCategory}` : '',
        analytics.predictedMonthly !== undefined ? `Predicted monthly spending: ${analytics.predictedMonthly}` : ''
    ].filter(Boolean).join('\n') || 'Not available';

    return [
        `Page: ${page}`,
        `User profile:\n${userSummary}`,
        `Budget snapshot:\n${budgetSummary}`,
        `Recent conversation:\n${transcript}`,
        `Latest user question:\n${String(payload.message || '').trim()}`
    ].join('\n');
}

async function handleChat(request, env) {
    const payload = await parseJson(request);
    const message = String(payload.message || '').trim();
    if (!message) {
        return jsonResponse({ error: 'Please enter a message before sending.' }, 400);
    }

    if (!env.GEMINI_API_KEY) {
        return jsonResponse({ error: 'Missing GEMINI_API_KEY secret in Cloudflare.' }, 500);
    }

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                text: buildChatContext(payload)
                            }
                        ]
                    }
                ],
                systemInstruction: {
                    parts: [
                        {
                            text:
                                'You are Flow AI, a helpful finance assistant inside a student expense-tracking app. Answer clearly, keep replies concise, use simple language, and focus on budgeting, expense tracking, reports, savings habits, recurring bills, and financial organization. Be practical and specific to the current page context when possible. If budget or analytics data is present, reference it naturally. Prefer short action-oriented answers with 2 to 4 helpful points when the user asks for advice. Flow cannot connect to bank accounts, bank APIs, or live banking systems, so never say you can see, sync, import, verify, or analyze a user bank account directly unless the user has manually entered that information into Flow. Only refer to data that is available in the app context provided to you. If a user wants to undo an expense mistake, tell them to open the Transactions page and delete the incorrect transaction there, because deleting that transaction is how they undo the mistake in Flow. Do not claim to be a licensed financial advisor. If the user asks for investment, tax, or legal advice, provide a general informational answer and suggest verifying with a qualified professional.'
                        }
                    ]
                },
                generationConfig: {
                    temperature: 0.5,
                    maxOutputTokens: 350
                }
            })
        }
    );

    const body = await response.json();
    if (!response.ok) {
        return jsonResponse({ error: 'The chatbot could not reach Gemini right now. Please try again.' }, 502);
    }

    const reply = body?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    return jsonResponse({
        reply: reply || 'I could not generate a reply just now. Please try again.'
    });
}
