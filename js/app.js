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

document.addEventListener('DOMContentLoaded', function() {
    const savedBudget = localStorage.getItem('fincastMonthlyBudget');
    if (savedBudget) {
        monthlyBudget = parseInt(savedBudget, 10);
    }

    createCharts();
    bindExpenseForm();
    loadRecurringExpenses();
    loadExpensesFirst();
});

function createCharts() {
    const categoryCanvas = document.getElementById('categoryChart');
    const budgetCanvas = document.getElementById('budgetChart');
    const monthlyCanvas = document.getElementById('monthlyChart');

    if (categoryCanvas) {
        window.categoryChart = new Chart(categoryCanvas, {
            type: 'pie',
            data: {
                labels: ['Food', 'Transport', 'Shopping', 'Bills'],
                datasets: [{
                    data: [0, 0, 0, 0],
                    backgroundColor: [
                        appPalette.red,
                        appPalette.crimson,
                        appPalette.lavender,
                        appPalette.indigo
                    ],
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
                        ticks: { color: appPalette.indigo }
                    }
                }
            }
        });
    }
}

function bindExpenseForm() {
    const expenseForm = document.getElementById('expense-form');
    if (!expenseForm) return;

    expenseForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const expense = {
            name: document.getElementById('expense-name').value,
            amount: Number(document.getElementById('expense-amount').value),
            category: document.getElementById('expense-category').value,
            date: normalizeDate(document.getElementById('expense-date').value)
        };

        fetch('/add_expense', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: expense.name,
                amount: expense.amount,
                category: expense.category,
                date: expense.date,
                user_id: 1
            })
        })
            .then(res => res.json())
            .then(() => {
                expenses.push(expense);
                addExpenseToTable(expense);
                syncCachedExpenses();
                updateCharts();
                updateBudgetStatus();
                setTimeout(loadExpensesFirst, 250);
            })
            .catch(err => {
                console.error('Error adding expense to backend:', err);
                if (window.FinCastData) {
                    FinCastData.addExpense(expense);
                    expenses = FinCastData.getExpenses();
                } else {
                    expenses.push(expense);
                }
                addExpenseToTable(expense);
                updateCharts();
                updateBudgetStatus();
            });

        expenseForm.reset();
    });
}

function normalizeDate(date) {
    if (!date) return '';
    if (!date.includes('/')) return date;
    const parts = date.split('/');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function syncCachedExpenses() {
    localStorage.setItem('fincast_cached_expenses', JSON.stringify(expenses));
}

function loadExpensesFirst() {
    const cachedExpenses = localStorage.getItem('fincast_cached_expenses');
    if (cachedExpenses) {
        expenses = JSON.parse(cachedExpenses);
        renderExpenseTable();
        updateCharts();
        updateBudgetStatus();
    }

    fetch('/get_expenses/1')
        .then(res => res.json())
        .then(data => {
            expenses = data.map(expense => ({
                name: expense.title,
                amount: Number(expense.amount),
                category: expense.category,
                date: expense.date
            }));

            renderExpenseTable();
            syncCachedExpenses();
            return fetch('/get_budget/1');
        })
        .then(res => res.json())
        .then(budgetData => {
            monthlyBudget = budgetData.monthly || 5000;
            localStorage.setItem('fincastMonthlyBudget', monthlyBudget);
            updateCharts();
            updateBudgetStatus();
        })
        .catch(err => {
            console.error('Error loading data:', err);
            updateCharts();
            updateBudgetStatus();
        });
}

function loadExpenses() {
    loadExpensesFirst();
}

function renderExpenseTable() {
    const table = document.getElementById('expense-list');
    if (!table) return;

    table.innerHTML = '';
    expenses.forEach(expense => addExpenseToTable(expense));
}

function addExpenseToTable(expense) {
    const table = document.getElementById('expense-list');
    if (!table) return;

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${expense.name}</td>
        <td>${expense.category}</td>
        <td>${expense.date}</td>
        <td>₹${expense.amount}</td>
    `;
    table.appendChild(row);
}

function updateCharts() {
    const categoryTotals = { Food: 0, Transport: 0, Shopping: 0, Bills: 0 };
    expenses.forEach(expense => {
        if (Object.prototype.hasOwnProperty.call(categoryTotals, expense.category)) {
            categoryTotals[expense.category] += Number(expense.amount);
        }
    });

    if (window.categoryChart) {
        window.categoryChart.data.datasets[0].data = Object.values(categoryTotals);
        window.categoryChart.update();
    }

    if (window.monthlyChart) {
        updateMonthlyChart();
    }

    const total = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const remaining = Math.max(0, monthlyBudget - total);
    const totalExpenseEl = document.getElementById('total-expense');
    const budgetBalanceEl = document.getElementById('budget-balance');

    if (totalExpenseEl) totalExpenseEl.innerText = '₹' + total;
    if (budgetBalanceEl) {
        budgetBalanceEl.innerText = '₹' + remaining;
        budgetBalanceEl.classList.toggle('budget-balance-negative', monthlyBudget - total < 0);
        budgetBalanceEl.classList.toggle('budget-balance-positive', monthlyBudget - total >= 0);
    }

    if (window.budgetChart) {
        window.budgetChart.data.datasets[0].data = [total, remaining];
        window.budgetChart.update();
    }
}

function updateBudgetStatus() {
    const savedBudget = localStorage.getItem('fincastMonthlyBudget');
    if (savedBudget) {
        monthlyBudget = parseInt(savedBudget, 10);
    }

    if (window.FinCastData && FinCastData.getBudget) {
        const budgetData = FinCastData.getBudget();
        monthlyBudget = budgetData.monthly || monthlyBudget;
    }

    const spent = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const remaining = monthlyBudget - spent;
    const totalExpenseEl = document.getElementById('total-expense');
    const budgetBalanceEl = document.getElementById('budget-balance');
    const budgetMsg = document.getElementById('budget-message');

    if (totalExpenseEl) totalExpenseEl.innerText = '₹' + spent;
    if (budgetBalanceEl) {
        budgetBalanceEl.innerText = '₹' + Math.max(0, remaining);
        budgetBalanceEl.classList.toggle('budget-balance-negative', remaining < 0);
        budgetBalanceEl.classList.toggle('budget-balance-positive', remaining >= 0);
    }

    if (window.budgetChart) {
        window.budgetChart.data.datasets[0].data = [spent, Math.max(0, remaining)];
        window.budgetChart.update();
    }

    if (!budgetMsg) return;

    if (spent < monthlyBudget * 0.6) {
        budgetMsg.innerText = 'You are doing great this month. Keep saving.';
        budgetMsg.style.color = appPalette.red;
    } else if (spent < monthlyBudget) {
        budgetMsg.innerText = 'You are getting close to your monthly budget.';
        budgetMsg.style.color = appPalette.lavender;
    } else {
        budgetMsg.innerText = 'Warning: you have exceeded your monthly budget.';
        budgetMsg.style.color = appPalette.crimson;
    }
}

function updateMonthlyChart() {
    if (!window.monthlyChart) return;
    const monthlyTotals = new Array(12).fill(0);

    expenses.forEach(expense => {
        const date = new Date(expense.date);
        const month = date.getMonth();
        if (month >= 0 && month < 12) {
            monthlyTotals[month] += Number(expense.amount);
        }
    });

    window.monthlyChart.data.datasets[0].data = monthlyTotals;
    window.monthlyChart.update();
}

function loadRecurringExpenses() {
    fetch('/get_recurring/1')
        .then(res => res.json())
        .then(data => {
            const recurringList = document.getElementById('recurring-list');
            if (!recurringList) return;

            if (!data.length) {
                recurringList.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon"><i class="fas fa-sync-alt"></i></div>
                        <p class="mb-0">No recurring expenses yet</p>
                    </div>
                `;
                return;
            }

            recurringList.innerHTML = data.map(item => `
                <div class="soft-panel mb-2">
                    <div class="d-flex justify-content-between align-items-start gap-3">
                        <div>
                            <h6 class="mb-1">${item.title}</h6>
                            <p class="mb-1 muted-copy">₹${item.amount} • ${item.category}</p>
                            <small class="muted-copy"><i class="fas fa-clock"></i> ${item.frequency} • Due: ${item.next_due}</small>
                        </div>
                        <button class="btn btn-danger-soft btn-sm" onclick="deleteRecurring(${item.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        })
        .catch(err => {
            console.error('Error loading recurring expenses:', err);
            const recurringList = document.getElementById('recurring-list');
            if (recurringList) {
                recurringList.innerHTML = '<p class="danger-text small mb-0">Error loading recurring expenses.</p>';
            }
        });
}

function deleteRecurring(id) {
    if (!confirm('Are you sure you want to delete this recurring expense?')) return;

    fetch(`/delete_recurring/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(() => {
            loadRecurringExpenses();
            alert('Recurring expense deleted successfully');
        })
        .catch(err => {
            console.error('Error deleting recurring expense:', err);
            alert('Error deleting recurring expense');
        });
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

function addRecurring() {
    const title = document.getElementById('r_title').value;
    const amount = document.getElementById('r_amount').value;
    const category = document.getElementById('r_category').value;
    const frequency = document.getElementById('r_frequency').value;
    const next_due = document.getElementById('r_due').value;

    if (!title || !amount || !next_due) {
        alert('Please fill in all required fields');
        return;
    }

    fetch('/add_recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, amount, category, frequency, next_due, user_id: 1 })
    })
        .then(res => res.json())
        .then(() => {
            document.getElementById('r_title').value = '';
            document.getElementById('r_amount').value = '';
            document.getElementById('r_category').value = 'Bills';
            document.getElementById('r_frequency').value = 'monthly';
            document.getElementById('r_due').value = '';
            toggleRecurringForm();
            loadRecurringExpenses();
        })
        .catch(err => {
            console.error('Error adding recurring expense:', err);
            alert('Error adding recurring expense');
        });
}
