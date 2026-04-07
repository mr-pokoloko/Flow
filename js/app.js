let expenses = [];
let monthlyBudget = 5000;

const appPalette = {
    indigo: '#2b2d42',
    lavender: '#8d99ae',
    red: '#ef233c',
    crimson: '#d80032',
    redSoft: 'rgba(239, 35, 60, 0.15)',
    lavenderSoft: 'rgba(141, 153, 174, 0.18)',
    indigoSoft: 'rgba(43, 45, 66, 0.14)'
};

const chartCategoryColors = [
    '#e63946',
    '#1d3557',
    '#2a9d8f',
    '#f4a261',
    '#6a4c93',
    '#ffb703',
    '#118ab2',
    '#8ac926',
    '#ff006e',
    '#3a86ff'
];

let savingsHistoryYear = new Date().getFullYear();

document.addEventListener('DOMContentLoaded', async function() {
    if (!window.FinCastData?.requireAuth()) return;

    initializeDashboard();
    await loadDashboardData();
});

function initializeDashboard() {
    const budget = window.FinCastData ? FinCastData.getBudget() : { monthly: 5000 };
    monthlyBudget = Number(budget.monthly) || 5000;
    createCharts();
    bindExpenseForm();
    bindSavingsHistory();
    bindSpendingHistory();
    bindBudgetHistory();
    renderProfileName();
    updateNotifications();
}

function renderProfileName() {
    const profileName = document.getElementById('profileName');
    if (profileName && window.FinCastData) {
        profileName.textContent = FinCastData.getDisplayName();
    }
    const profilePhoto = document.querySelector('.profile-photo');
    if (profilePhoto && window.FinCastData) {
        FinCastData.renderProfilePhoto(profilePhoto);
    }
}

function bindSavingsHistory() {
    const savedPane = document.getElementById('saved-this-month');
    const prevButton = document.getElementById('prevSavingsYearBtn');
    const nextButton = document.getElementById('nextSavingsYearBtn');
    if (!savedPane || !window.FinCastData) return;

    savingsHistoryYear = new Date().getFullYear();
    savedPane.style.cursor = 'pointer';
    savedPane.addEventListener('click', function() {
        savingsHistoryYear = Math.min(
            Math.max(savingsHistoryYear, FinCastData.getAccountStartYear()),
            new Date().getFullYear()
        );
        renderSavingsHistoryPopup();
        toggleSavingsPopup(true);
    });

    prevButton?.addEventListener('click', function() {
        const minYear = FinCastData.getAccountStartYear();
        if (savingsHistoryYear <= minYear) return;
        savingsHistoryYear -= 1;
        renderSavingsHistoryPopup();
    });

    nextButton?.addEventListener('click', function() {
        const maxYear = new Date().getFullYear();
        if (savingsHistoryYear >= maxYear) return;
        savingsHistoryYear += 1;
        renderSavingsHistoryPopup();
    });
}

function bindSpendingHistory() {
    const totalSpentPane = document.getElementById('total-spent');
    if (!totalSpentPane || !window.FinCastData) return;

    totalSpentPane.style.cursor = 'pointer';
    totalSpentPane.addEventListener('click', function() {
        renderSpendingPopup();
        toggleSpendingPopup(true);
    });
}

function bindBudgetHistory() {
    const budgetPane = document.getElementById('budget-left');
    if (!budgetPane || !window.FinCastData) return;

    budgetPane.style.cursor = 'pointer';
    budgetPane.addEventListener('click', function() {
        renderBudgetPopup();
        toggleBudgetPopup(true);
    });
}

function createCharts() {
    const categoryHistoryCanvas = document.getElementById('categoryHistoryChart');
    const categoryMonthCanvas = document.getElementById('categoryMonthChart');
    const budgetCanvas = document.getElementById('budgetChart');
    const monthlyCanvas = document.getElementById('monthlyChart');

    if (categoryHistoryCanvas) {
        window.categoryHistoryChart = new Chart(categoryHistoryCanvas, {
            type: 'pie',
            data: {
                labels: ['No expenses yet'],
                datasets: [{
                    data: [1],
                    backgroundColor: [appPalette.lavender],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: appPalette.indigo }
                    }
                }
            }
        });
    }

    if (categoryMonthCanvas) {
        window.categoryMonthChart = new Chart(categoryMonthCanvas, {
            type: 'pie',
            data: {
                labels: ['No expenses yet'],
                datasets: [{
                    data: [1],
                    backgroundColor: [appPalette.lavender],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: appPalette.indigo }
                    }
                }
            }
        });
    }

    if (budgetCanvas) {
        window.budgetChart = new Chart(budgetCanvas, {
            type: 'doughnut',
            data: {
                labels: ['Spent', 'Remaining'],
                datasets: [{
                    data: [0, monthlyBudget],
                    backgroundColor: [appPalette.red, appPalette.lavender],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: {
                    legend: {
                        labels: { color: appPalette.indigo }
                    }
                }
            }
        });
    }

    if (monthlyCanvas) {
        window.monthlyChart = new Chart(monthlyCanvas, {
            type: 'line',
            data: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                datasets: [{
                    label: 'Monthly Spending',
                    data: new Array(12).fill(0),
                    borderColor: appPalette.red,
                    backgroundColor: appPalette.redSoft,
                    fill: true,
                    tension: 0.38,
                    pointBackgroundColor: appPalette.crimson,
                    pointBorderColor: appPalette.crimson,
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: appPalette.indigo }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: appPalette.indigoSoft },
                        ticks: {
                            color: appPalette.indigo,
                            callback(value) {
                                return formatCurrency(value);
                            }
                        }
                    }
                }
            }
        });
    }
}

function bindExpenseForm() {
    const expenseForm = document.getElementById('expense-form');
    if (!expenseForm) return;

    expenseForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const expense = {
            name: document.getElementById('expense-name').value.trim(),
            amount: Number(document.getElementById('expense-amount').value),
            category: document.getElementById('expense-category').value,
            date: normalizeDate(document.getElementById('expense-date').value) || new Date().toISOString().split('T')[0]
        };

        if (!expense.name || !expense.amount) {
            alert('Please complete the expense form before saving.');
            return;
        }

        let savedExpense = expense;
        const backendExpense = await postJson('/add_expense', {
            title: expense.name,
            amount: expense.amount,
            category: expense.category,
            date: expense.date,
            user_id: 1
        });

        if (backendExpense && typeof backendExpense === 'object') {
            savedExpense = {
                id: backendExpense.id || undefined,
                ...expense
            };
            FinCastData.allowRemoteSync();
        }

        FinCastData.addExpense(savedExpense);
        expenses = FinCastData.getExpenses();
        renderExpenseTable();
        updateCharts();
        updateBudgetStatus();
        updateNotifications();
        expenseForm.reset();
        toggleAddExpensePopup(false);
    });
}

function normalizeDate(date) {
    if (!date) return '';
    if (!date.includes('/')) return date;
    const parts = date.split('/');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

async function loadDashboardData() {
    expenses = window.FinCastData ? FinCastData.getExpenses() : [];
    monthlyBudget = window.FinCastData ? Number(FinCastData.getBudget().monthly) || 5000 : 5000;
    renderExpenseTable();
    updateCharts();
    updateBudgetStatus();
    await loadRecurringExpenses();

    if (window.FinCastData?.isRemoteSyncBlocked()) {
        return;
    }

    const remoteExpenses = await getJson('/get_expenses/1');
    if (Array.isArray(remoteExpenses)) {
        const mappedExpenses = remoteExpenses
            .filter(item => item && typeof item === 'object' && item.title && item.amount !== undefined)
            .map(item => ({
                id: item.id || undefined,
                name: item.title,
                amount: Number(item.amount) || 0,
                category: item.category || 'Other',
                date: item.date || new Date().toISOString().split('T')[0]
            }));

        if (mappedExpenses.length || remoteExpenses.length === 0) {
            FinCastData.setExpenses(mappedExpenses);
            expenses = FinCastData.getExpenses();
            renderExpenseTable();
            updateCharts();
            updateBudgetStatus();
        }
    }

    const remoteBudget = await getJson('/get_budget/1');
    if (remoteBudget && typeof remoteBudget.monthly !== 'undefined') {
        FinCastData.updateBudget({
            monthly: Number(remoteBudget.monthly) || monthlyBudget
        });
        monthlyBudget = Number(FinCastData.getBudget().monthly) || 5000;
        updateCharts();
        updateBudgetStatus();
    }

    const remoteRecurring = await getJson('/get_recurring/1');
    if (Array.isArray(remoteRecurring)) {
        const recurring = remoteRecurring
            .filter(item => item && typeof item === 'object')
            .map(item => ({
                id: item.id || undefined,
                title: item.title || 'Recurring expense',
                amount: Number(item.amount) || 0,
                category: item.category || 'Bills',
                frequency: item.frequency || 'monthly',
                startDate: item.startDate || item.next_due || new Date().toISOString().split('T')[0],
                createdAt: item.createdAt || new Date().toISOString()
            }));
        FinCastData.setRecurringExpenses(recurring);
        expenses = FinCastData.getExpenses();
        renderExpenseTable();
        updateCharts();
        updateBudgetStatus();
        await loadRecurringExpenses();
    }
}

async function getJson(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.warn(`Flow backend request failed for ${url}:`, error);
        return null;
    }
}

async function postJson(url, payload, method = 'POST') {
    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.warn(`Flow backend request failed for ${url}:`, error);
        return null;
    }
}

function renderExpenseTable() {
    const table = document.getElementById('expense-list');
    if (!table) return;

    table.innerHTML = '';

    if (!expenses.length) {
        table.innerHTML = `
            <tr>
                <td colspan="4">
                    <div class="empty-state">
                        <div class="empty-state-icon"><i class="fas fa-receipt"></i></div>
                        <p class="mb-0">No expenses added yet</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    expenses.slice(0, 10).forEach(expense => addExpenseToTable(expense));
}

function addExpenseToTable(expense) {
    const table = document.getElementById('expense-list');
    if (!table) return;

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${escapeHtml(expense.name)}</td>
        <td>${escapeHtml(expense.category)}</td>
        <td>${formatDate(expense.date)}</td>
        <td>${formatCurrency(expense.amount)}</td>
    `;
    table.appendChild(row);
}

function updateCharts() {
    const categoryTotals = {};
    const currentMonthTotals = {};
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    expenses.forEach(expense => {
        const category = expense.category || 'Other';
        const amount = Number(expense.amount || 0);
        categoryTotals[category] = (categoryTotals[category] || 0) + amount;

        const expenseDate = new Date(expense.date);
        if (
            !Number.isNaN(expenseDate.getTime()) &&
            expenseDate.getMonth() === currentMonth &&
            expenseDate.getFullYear() === currentYear
        ) {
            currentMonthTotals[category] = (currentMonthTotals[category] || 0) + amount;
        }
    });

    updateCategoryPieChart(window.categoryHistoryChart, categoryTotals);
    updateCategoryPieChart(window.categoryMonthChart, currentMonthTotals);

    updateMonthlyChart();

    const total = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const analytics = window.FinCastData ? FinCastData.getAnalytics() : null;
    const cycleSpent = analytics ? analytics.currentCycleSpent : total;
    const remaining = monthlyBudget - cycleSpent;
    const totalExpenseEl = document.getElementById('total-expense');
    const budgetBalanceEl = document.getElementById('budget-balance');
    const savedThisMonthEl = document.getElementById('saved-this-month-value');

    if (totalExpenseEl) totalExpenseEl.innerText = formatCurrency(total);
    if (budgetBalanceEl) {
        budgetBalanceEl.innerText = formatCurrency(remaining);
        budgetBalanceEl.classList.toggle('budget-balance-negative', remaining < 0);
        budgetBalanceEl.classList.toggle('budget-balance-positive', remaining >= 0);
    }
    if (savedThisMonthEl) {
        savedThisMonthEl.innerText = formatCurrency(Math.max(0, analytics ? analytics.currentCycleSaved : remaining));
    }

    if (window.budgetChart) {
        window.budgetChart.data.datasets[0].data = [Math.max(cycleSpent, 0), Math.max(remaining, 0)];
        window.budgetChart.update();
    }

    renderSpendingPopup();
    renderBudgetPopup();
}

function updateCategoryPieChart(chart, totals) {
    if (!chart) return;

    const labels = Object.keys(totals);
    const values = Object.values(totals);
    chart.data.labels = labels.length ? labels : ['No expenses yet'];
    chart.data.datasets[0].data = values.length ? values : [1];
    chart.data.datasets[0].backgroundColor = labels.length ? chartCategoryColors.slice(0, labels.length) : [appPalette.lavender];
    chart.update();
}

function updateBudgetStatus() {
    const budgetData = window.FinCastData ? FinCastData.getBudget() : { monthly: monthlyBudget };
    const analytics = window.FinCastData ? FinCastData.getAnalytics() : null;
    monthlyBudget = Number(budgetData.monthly) || monthlyBudget;

    const spent = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const cycleSpent = analytics ? analytics.currentCycleSpent : spent;
    const remaining = monthlyBudget - cycleSpent;
    const totalExpenseEl = document.getElementById('total-expense');
    const budgetBalanceEl = document.getElementById('budget-balance');
    const budgetMsg = document.getElementById('budget-message');
    const savedThisMonthEl = document.getElementById('saved-this-month-value');

    if (totalExpenseEl) totalExpenseEl.innerText = formatCurrency(spent);
    if (budgetBalanceEl) {
        budgetBalanceEl.innerText = formatCurrency(remaining);
        budgetBalanceEl.classList.toggle('budget-balance-negative', remaining < 0);
        budgetBalanceEl.classList.toggle('budget-balance-positive', remaining >= 0);
    }
    if (savedThisMonthEl) {
        savedThisMonthEl.innerText = formatCurrency(Math.max(0, analytics ? analytics.currentCycleSaved : remaining));
    }

    if (window.budgetChart) {
        window.budgetChart.data.datasets[0].data = [Math.max(cycleSpent, 0), Math.max(remaining, 0)];
        window.budgetChart.update();
    }

    renderBudgetPopup();

    if (!budgetMsg) return;

    if (cycleSpent < monthlyBudget * 0.6) {
        budgetMsg.innerText = analytics?.cycleLabel
            ? `You are doing great this cycle. Budget window: ${analytics.cycleLabel}.`
            : 'You are doing great this month. Keep saving.';
        budgetMsg.style.color = appPalette.red;
    } else if (cycleSpent < monthlyBudget) {
        budgetMsg.innerText = analytics?.cycleLabel
            ? `You are getting close to your budget. Active cycle: ${analytics.cycleLabel}.`
            : 'You are getting close to your monthly budget.';
        budgetMsg.style.color = appPalette.lavender;
    } else {
        budgetMsg.innerText = analytics?.cycleLabel
            ? `Warning: you are over budget by ${formatCurrency(Math.abs(remaining))}. Active cycle: ${analytics.cycleLabel}.`
            : `Warning: you are over budget by ${formatCurrency(Math.abs(remaining))}.`;
        budgetMsg.style.color = appPalette.crimson;
    }
}

function updateMonthlyChart() {
    if (!window.monthlyChart) return;
    const monthlyTotals = new Array(12).fill(0);

    expenses.forEach(expense => {
        const date = new Date(expense.date);
        const month = date.getMonth();
        if (!Number.isNaN(date.getTime()) && month >= 0 && month < 12) {
            monthlyTotals[month] += Number(expense.amount || 0);
        }
    });

    window.monthlyChart.data.datasets[0].data = monthlyTotals;
    window.monthlyChart.update();
}

async function loadRecurringExpenses() {
    const recurringList = document.getElementById('recurring-list');
    if (!recurringList) return;

    const recurringItems = window.FinCastData ? FinCastData.getRecurringExpenses() : [];
    if (!recurringItems.length) {
        recurringList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-sync-alt"></i></div>
                <p class="mb-0">No recurring expenses yet</p>
            </div>
        `;
        return;
    }

    recurringList.innerHTML = recurringItems.map(item => `
        <div class="soft-panel mb-2">
            <div class="d-flex justify-content-between align-items-start gap-3">
                <div>
                    <h6 class="mb-1">${escapeHtml(item.title)}</h6>
                    <p class="mb-1 muted-copy">${formatCurrency(item.amount)} - ${escapeHtml(item.category)}</p>
                    <small class="muted-copy"><i class="fas fa-clock"></i> ${item.frequency === 'weekly' ? 'Auto-applies every 7 days' : 'Auto-applies on each budget renewal'}</small>
                </div>
                <button class="btn btn-danger-soft btn-sm" onclick="deleteRecurring('${item.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

async function deleteRecurring(id) {
    if (!confirm('Are you sure you want to delete this recurring expense?')) return;

    const deletedRemotely = await postJson(`/delete_recurring/${id}`, {}, 'DELETE');
    if (deletedRemotely || !window.FinCastData?.isRemoteSyncBlocked()) {
        FinCastData.deleteRecurringExpense(id);
    }
    await loadRecurringExpenses();
    updateNotifications();
}

function toggleRecurringForm() {
    const wrapper = document.getElementById('recurring-form-wrapper');
    const button = document.getElementById('addRecurringBtn');
    if (!wrapper || !button) return;

    const isOpen = wrapper.style.display === 'block';
    if (isOpen) {
        wrapper.style.display = 'none';
        button.innerHTML = '<i class="fas fa-plus"></i> Add New';
        button.classList.remove('btn-outline-secondary');
        button.classList.add('btn-primary');
    } else {
        wrapper.style.display = 'block';
        button.innerHTML = '<i class="fas fa-times"></i> Cancel';
        button.classList.remove('btn-primary');
        button.classList.add('btn-outline-secondary');
    }
}

async function addRecurring() {
    const title = document.getElementById('r_title').value.trim();
    const amount = Number(document.getElementById('r_amount').value);
    const category = document.getElementById('r_category').value;
    const frequency = document.getElementById('r_frequency').value;

    if (!title || !amount) {
        alert('Please fill in all required fields.');
        return;
    }

    const startDate = new Date().toISOString().split('T')[0];
    const payload = { title, amount, category, frequency, start_date: startDate, next_due: startDate, user_id: 1 };
    const backendRecurring = await postJson('/add_recurring', payload);
    FinCastData.addRecurringExpense({
        id: backendRecurring?.id,
        title,
        amount,
        category,
        frequency,
        startDate,
        createdAt: new Date().toISOString()
    });
    FinCastData.allowRemoteSync();

    document.getElementById('r_title').value = '';
    document.getElementById('r_amount').value = '';
    document.getElementById('r_category').value = 'Bills';
    document.getElementById('r_frequency').value = 'monthly';
    toggleRecurringForm();
    expenses = FinCastData.getExpenses();
    renderExpenseTable();
    updateCharts();
    updateBudgetStatus();
    await loadRecurringExpenses();
    updateNotifications();
}

function updateNotifications() {
    const popupBody = document.querySelector('#notificationPopup .notification-popup-body');
    const dot = document.getElementById('notificationDot');
    if (!popupBody || !window.FinCastData) return;

    const notifications = FinCastData.getNotifications();
    popupBody.innerHTML = notifications.map(item => `
        <div class="notification-popup-item">
            <div class="notification-popup-icon"><i class="fas ${item.icon}"></i></div>
            <div class="notification-popup-text">
                <h6>${escapeHtml(item.title)}</h6>
                <p>${escapeHtml(item.body)}</p>
                <small>${escapeHtml(item.meta)}</small>
            </div>
        </div>
    `).join('');

    if (dot) {
        const hasAttention = notifications.some(item => item.tone === 'warning' || item.tone === 'info');
        dot.style.display = hasAttention ? 'block' : 'none';
    }
}

function toggleSpendingPopup(forceState) {
    const popup = document.getElementById('spendingPopup');
    if (!popup) return;

    if (typeof forceState === 'boolean') {
        popup.classList.toggle('active', forceState);
    } else {
        popup.classList.toggle('active');
    }

    if (popup.classList.contains('active')) {
        window.requestAnimationFrame(function() {
            if (window.categoryHistoryChart) {
                window.categoryHistoryChart.resize();
                window.categoryHistoryChart.update();
            }
            if (window.categoryMonthChart) {
                window.categoryMonthChart.resize();
                window.categoryMonthChart.update();
            }
        });
    }
}

function renderSpendingPopup() {
    if (!window.FinCastData) return;

    const historyTotalEl = document.getElementById('spendingHistoryTotal');
    const currentMonthEl = document.getElementById('spendingCurrentMonthTotal');
    if (!historyTotalEl || !currentMonthEl) return;

    const analytics = FinCastData.getAnalytics();
    historyTotalEl.textContent = formatCurrency(analytics.totalSpent || 0);
    currentMonthEl.textContent = formatCurrency(analytics.currentMonthSpent || 0);
}

function toggleBudgetPopup(forceState) {
    const popup = document.getElementById('budgetPopup');
    if (!popup) return;

    if (typeof forceState === 'boolean') {
        popup.classList.toggle('active', forceState);
    } else {
        popup.classList.toggle('active');
    }
}

function renderBudgetPopup() {
    if (!window.FinCastData) return;

    const totalEl = document.getElementById('budgetPopupTotal');
    const remainingEl = document.getElementById('budgetPopupRemaining');
    if (!totalEl || !remainingEl) return;

    const budget = FinCastData.getBudget();
    const analytics = FinCastData.getAnalytics();
    totalEl.textContent = formatCurrency(budget.monthly || 0);
    remainingEl.textContent = formatCurrency(analytics.cycleBudgetLeft || 0);
    remainingEl.classList.toggle('budget-balance-negative', (analytics.cycleBudgetLeft || 0) < 0);
    remainingEl.classList.toggle('budget-balance-positive', (analytics.cycleBudgetLeft || 0) >= 0);
}

function toggleAddExpensePopup(forceState) {
    const popup = document.getElementById('addExpensePopup');
    if (!popup) return;

    if (typeof forceState === 'boolean') {
        popup.classList.toggle('active', forceState);
    } else {
        popup.classList.toggle('active');
    }
}

function toggleSavingsPopup(forceState) {
    const popup = document.getElementById('savingsPopup');
    if (!popup) return;

    if (typeof forceState === 'boolean') {
        popup.classList.toggle('active', forceState);
    } else {
        popup.classList.toggle('active');
    }
}

function renderSavingsHistoryPopup() {
    if (!window.FinCastData) return;

    const body = document.getElementById('savingsPopupBody');
    const yearLabel = document.getElementById('savingsYearLabel');
    const prevButton = document.getElementById('prevSavingsYearBtn');
    const nextButton = document.getElementById('nextSavingsYearBtn');
    if (!body || !yearLabel) return;

    const minYear = FinCastData.getAccountStartYear();
    const maxYear = new Date().getFullYear();
    const history = FinCastData.getSavingsHistory(savingsHistoryYear);

    yearLabel.textContent = String(history.year);
    if (prevButton) prevButton.disabled = history.year <= minYear;
    if (nextButton) nextButton.disabled = history.year >= maxYear;

    body.innerHTML = history.months.map(item => {
        if (!item.enabled) {
            return `
                <div class="notification-popup-item">
                    <div class="notification-popup-icon"><i class="fas fa-calendar-minus"></i></div>
                    <div class="notification-popup-text">
                        <h6>${item.label}</h6>
                        <p>No savings record for this month.</p>
                        <small>Outside your account activity range.</small>
                    </div>
                </div>
            `;
        }

        return `
            <div class="notification-popup-item">
                <div class="notification-popup-icon"><i class="fas fa-piggy-bank"></i></div>
                <div class="notification-popup-text">
                    <h6>${item.label}</h6>
                    <p>Saved ${formatCurrency(item.saved || 0)}</p>
                    <small>Spent ${formatCurrency(item.spent)} against a monthly budget of ${formatCurrency(history.budget)}</small>
                </div>
            </div>
        `;
    }).join('');
}

function formatCurrency(amount) {
    return window.FinCastData ? FinCastData.formatCurrency(amount) : `₹${Number(amount || 0)}`;
}

function formatDate(value) {
    return window.FinCastData ? FinCastData.formatDate(value) : value;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

window.addEventListener('fincast_data_change', function() {
    expenses = window.FinCastData ? FinCastData.getExpenses() : expenses;
    monthlyBudget = window.FinCastData ? Number(FinCastData.getBudget().monthly) || monthlyBudget : monthlyBudget;
    renderExpenseTable();
    updateCharts();
    updateBudgetStatus();
    loadRecurringExpenses();
    updateNotifications();
    renderProfileName();
});
