/**
 * Flow Data Management System
 * Handles data sharing across pages using localStorage
 */

const FINCAST_STORAGE_KEY = 'fincast_expenses';
const FINCAST_USER_KEY = 'fincast_user_data';
const FINCAST_BUDGET_KEY = 'fincast_budget';
const FINCAST_SETTINGS_KEY = 'fincast_settings';

// Data Management Object
const FinCastData = {
    // Initialize storage
    init() {
        if (!localStorage.getItem(FINCAST_STORAGE_KEY)) {
            localStorage.setItem(FINCAST_STORAGE_KEY, JSON.stringify([]));
        }
        if (!localStorage.getItem(FINCAST_USER_KEY)) {
            localStorage.setItem(FINCAST_USER_KEY, JSON.stringify({
                username: 'John Doe',
                email: 'john.doe@example.com',
                phone: '+91 98765 43210',
                role: 'Premium Member'
            }));
        }
        if (!localStorage.getItem(FINCAST_BUDGET_KEY)) {
            localStorage.setItem(FINCAST_BUDGET_KEY, JSON.stringify({
                monthly: 5000,
                alertThreshold: 80,
                currency: '₹'
            }));
        }
        if (!localStorage.getItem(FINCAST_SETTINGS_KEY)) {
            localStorage.setItem(FINCAST_SETTINGS_KEY, JSON.stringify({
                budgetAlerts: true,
                weeklySummary: true,
                largeExpenseAlerts: false,
                billReminders: true
            }));
        }
    },

    // Get all expenses
    getExpenses() {
        return JSON.parse(localStorage.getItem(FINCAST_STORAGE_KEY) || '[]');
    },

    // Add new expense
    addExpense(expense) {
        const expenses = this.getExpenses();
        expense.id = Date.now();
        expense.date = expense.date || new Date().toISOString().split('T')[0];
        expenses.unshift(expense);
        localStorage.setItem(FINCAST_STORAGE_KEY, JSON.stringify(expenses));
        this.notifyDataChange('expense_added', expense);
        return expense;
    },

    // Update expense
    updateExpense(id, updates) {
        const expenses = this.getExpenses();
        const index = expenses.findIndex(e => e.id === id);
        if (index !== -1) {
            expenses[index] = { ...expenses[index], ...updates };
            localStorage.setItem(FINCAST_STORAGE_KEY, JSON.stringify(expenses));
            this.notifyDataChange('expense_updated', expenses[index]);
            return expenses[index];
        }
        return null;
    },

    // Delete expense
    deleteExpense(id) {
        const expenses = this.getExpenses();
        const filtered = expenses.filter(e => e.id !== id);
        localStorage.setItem(FINCAST_STORAGE_KEY, JSON.stringify(filtered));
        this.notifyDataChange('expense_deleted', { id });
        return true;
    },

    // Get user data
    getUserData() {
        return JSON.parse(localStorage.getItem(FINCAST_USER_KEY) || '{}');
    },

    // Update user data
    updateUserData(data) {
        const current = this.getUserData();
        const updated = { ...current, ...data };
        localStorage.setItem(FINCAST_USER_KEY, JSON.stringify(updated));
        this.notifyDataChange('user_updated', updated);
        return updated;
    },

    // Get budget
    getBudget() {
        return JSON.parse(localStorage.getItem(FINCAST_BUDGET_KEY) || '{}');
    },

    // Update budget
    updateBudget(budget) {
        const current = this.getBudget();
        const updated = { ...current, ...budget };
        localStorage.setItem(FINCAST_BUDGET_KEY, JSON.stringify(updated));
        this.notifyDataChange('budget_updated', updated);
        return updated;
    },

    // Get settings
    getSettings() {
        return JSON.parse(localStorage.getItem(FINCAST_SETTINGS_KEY) || '{}');
    },

    // Update settings
    updateSettings(settings) {
        const current = this.getSettings();
        const updated = { ...current, ...settings };
        localStorage.setItem(FINCAST_SETTINGS_KEY, JSON.stringify(updated));
        this.notifyDataChange('settings_updated', updated);
        return updated;
    },

    // Calculate analytics
    getAnalytics() {
        const expenses = this.getExpenses();
        const budget = this.getBudget();
        
        const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
        const budgetLeft = (budget.monthly || 5000) - totalSpent;
        
        // Category breakdown
        const categoryTotals = {};
        expenses.forEach(e => {
            categoryTotals[e.category] = (categoryTotals[e.category] || 0) + Number(e.amount);
        });
        
        // Monthly totals
        const monthlyTotals = new Array(12).fill(0);
        expenses.forEach(e => {
            const date = new Date(e.date);
            const month = date.getMonth();
            if (month >= 0 && month < 12) {
                monthlyTotals[month] += Number(e.amount);
            }
        });
        
        return {
            totalSpent,
            budgetLeft,
            transactionCount: expenses.length,
            averageTransaction: expenses.length > 0 ? totalSpent / expenses.length : 0,
            categoryTotals,
            monthlyTotals,
            topCategory: Object.entries(categoryTotals)
                .sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
        };
    },

    // Get monthly report data
    getMonthlyReport(year = new Date().getFullYear(), month = new Date().getMonth()) {
        const expenses = this.getExpenses();
        const filtered = expenses.filter(e => {
            const date = new Date(e.date);
            return date.getFullYear() === year && date.getMonth() === month;
        });
        
        const total = filtered.reduce((sum, e) => sum + Number(e.amount), 0);
        const byCategory = {};
        filtered.forEach(e => {
            byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
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

    // Data change event system
    listeners: {},
    
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    },
    
    notifyDataChange(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
        // Also dispatch custom event for cross-page communication
        window.dispatchEvent(new CustomEvent('fincast_data_change', { 
            detail: { event, data } 
        }));
    },

    // Sync data from other pages
    sync() {
        return {
            expenses: this.getExpenses(),
            user: this.getUserData(),
            budget: this.getBudget(),
            settings: this.getSettings(),
            analytics: this.getAnalytics()
        };
    }
};

// Auto-initialize
FinCastData.init();

// Make available globally
window.FinCastData = FinCastData;
