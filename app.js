// === FIREBASE CONFIG ===
// HIER deine Firebase-Konfiguration einsetzen (siehe Anleitung in README.md)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getDatabase,
    ref,
    onValue,
    push,
    set,
    update,
    remove,
    off
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBJxwo7GKgdHFVIM67FCEUxwC76qCSLhx8",
  authDomain: "hofladen-9783a.firebaseapp.com",
  databaseURL: "https://hofladen-9783a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "hofladen-9783a",
  storageBucket: "hofladen-9783a.firebasestorage.app",
  messagingSenderId: "148532523053",
  appId: "1:148532523053:web:9adf12982d6310702688a4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// === PASSWORD CONFIGURATION ===
// SHA-256 Hash des Passworts. Standard-Passwort: "verkauf2025"
// Um zu ändern: Passwort in der Browser-Konsole hashen mit:
// const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('NEUES_PASSWORT'));
// console.log(Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join(''));
const PASSWORD_HASH = "ca00b5919d1cd8047f33ca20505a441d8757faa7edcaa580e82836e41b8ad2fc"; // = "verkauf2025"
const SESSION_KEY = "verkauf_session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 Tage

// === STATE ===
let products = {};
let sales = {};
let currentEditingProductId = null;
let currentDebtCustomer = null;

// === HELPERS ===
async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fmtMoney(value) {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR'
    }).format(value || 0);
}

function fmtWeight(value) {
    if (!value && value !== 0) return '-';
    if (value >= 1000) return (value / 1000).toFixed(2).replace('.', ',') + ' kg';
    return value.toFixed(1).replace('.', ',') + ' g';
}

function fmtDate(timestamp) {
    const d = new Date(timestamp);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dDate = new Date(d);
    dDate.setHours(0, 0, 0, 0);

    if (dDate.getTime() === today.getTime()) {
        return 'Heute, ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (dDate.getTime() === yesterday.getTime()) {
        return 'Gestern, ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast toast-' + type;
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 2500);
}

// === AUTH ===
async function checkSession() {
    const session = localStorage.getItem(SESSION_KEY);
    if (!session) return false;
    try {
        const { hash, expires } = JSON.parse(session);
        if (Date.now() > expires) {
            localStorage.removeItem(SESSION_KEY);
            return false;
        }
        return hash === PASSWORD_HASH;
    } catch {
        return false;
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const password = document.getElementById('passwordInput').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';

    const hash = await sha256(password);
    if (hash === PASSWORD_HASH) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            hash,
            expires: Date.now() + SESSION_DURATION
        }));
        showApp();
    } else {
        errorEl.textContent = 'Falsches Passwort';
        document.getElementById('passwordInput').value = '';
    }
}

function logout() {
    localStorage.removeItem(SESSION_KEY);
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('passwordInput').value = '';
}

function showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    initApp();
}

// === FIREBASE LISTENERS ===
function initApp() {
    // Listen für Produkte
    onValue(ref(db, 'products'), (snapshot) => {
        products = snapshot.val() || {};
        renderProducts();
        renderProductSelect();
    });

    // Listen für Verkäufe
    onValue(ref(db, 'sales'), (snapshot) => {
        sales = snapshot.val() || {};
        renderDashboard();
        renderAllSales();
        renderDebts();
        renderCustomersList();
    });
}

// === DASHBOARD ===
function renderDashboard() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - (now.getDay() === 0 ? 6 : now.getDay() - 1) * 86400000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    let todayRev = 0, todayCount = 0;
    let weekRev = 0, weekCount = 0;
    let monthRev = 0, monthCount = 0;

    Object.values(sales).forEach(sale => {
        const t = sale.timestamp;
        if (t >= todayStart) { todayRev += sale.price; todayCount++; }
        if (t >= weekStart) { weekRev += sale.price; weekCount++; }
        if (t >= monthStart) { monthRev += sale.price; monthCount++; }
    });

    document.getElementById('todayRevenue').textContent = fmtMoney(todayRev);
    document.getElementById('todayCount').textContent = todayCount + ' Verkäufe';
    document.getElementById('weekRevenue').textContent = fmtMoney(weekRev);
    document.getElementById('weekCount').textContent = weekCount + ' Verkäufe';
    document.getElementById('monthRevenue').textContent = fmtMoney(monthRev);
    document.getElementById('monthCount').textContent = monthCount + ' Verkäufe';

    // Debt
    const debtSales = Object.values(sales).filter(s => s.onDebt && !s.paid);
    const debtTotal = debtSales.reduce((sum, s) => sum + s.price, 0);
    const uniqueCustomers = new Set(debtSales.map(s => s.customer.toLowerCase().trim())).size;
    document.getElementById('openDebt').textContent = fmtMoney(debtTotal);
    document.getElementById('debtCount').textContent = uniqueCustomers + ' ' + (uniqueCustomers === 1 ? 'Person' : 'Personen');

    // Letzte Verkäufe (5 neueste)
    const recent = Object.entries(sales)
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(0, 5);

    const list = document.getElementById('recentSalesList');
    if (recent.length === 0) {
        list.innerHTML = '<div class="empty-state">Noch keine Verkäufe</div>';
    } else {
        list.innerHTML = recent.map(([id, s]) => renderSaleItem(id, s)).join('');
    }
}

// === SALE ITEM RENDER ===
function renderSaleItem(id, sale) {
    const debtBadge = sale.onDebt && !sale.paid ? '<span class="sale-debt-badge">Pump</span>' : '';
    const debtClass = sale.onDebt && !sale.paid ? 'is-debt' : '';
    const note = sale.note ? ' · ' + escapeHtml(sale.note) : '';
    return `
        <div class="sale-item ${debtClass}">
            <div class="sale-info">
                <div class="sale-customer">${escapeHtml(sale.customer)} ${debtBadge}</div>
                <div class="sale-meta">${escapeHtml(sale.productName || '?')} · ${fmtDate(sale.timestamp)}${note}</div>
            </div>
            <div class="sale-amounts">
                <div class="sale-price">${fmtMoney(sale.price)}</div>
                <div class="sale-weight">${fmtWeight(sale.amount)}</div>
            </div>
            <button class="sale-delete" onclick="deleteSale('${id}')" aria-label="Löschen">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M3 6H5H21M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
        </div>
    `;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

// === SALES VIEW ===
function renderAllSales() {
    const search = (document.getElementById('salesSearch')?.value || '').toLowerCase().trim();
    const list = document.getElementById('allSalesList');

    let entries = Object.entries(sales)
        .sort((a, b) => b[1].timestamp - a[1].timestamp);

    if (search) {
        entries = entries.filter(([_, s]) =>
            (s.customer || '').toLowerCase().includes(search) ||
            (s.productName || '').toLowerCase().includes(search) ||
            (s.note || '').toLowerCase().includes(search)
        );
    }

    if (entries.length === 0) {
        list.innerHTML = '<div class="empty-state">' + (search ? 'Keine Treffer' : 'Noch keine Verkäufe') + '</div>';
    } else {
        list.innerHTML = entries.map(([id, s]) => renderSaleItem(id, s)).join('');
    }
}

// === PRODUCTS ===
function renderProducts() {
    const list = document.getElementById('productsList');
    const entries = Object.entries(products).sort((a, b) =>
        (a[1].name || '').localeCompare(b[1].name || '')
    );

    if (entries.length === 0) {
        list.innerHTML = '<div class="empty-state">Noch keine Produkte angelegt</div>';
        return;
    }

    list.innerHTML = entries.map(([id, p]) => `
        <div class="product-item" onclick="editProduct('${id}')">
            <div class="product-info">
                <div class="product-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M20 7L12 3L4 7M20 7L12 11M20 7V17L12 21M12 11L4 7M12 11V21M4 7V17L12 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>
                <div class="product-details">
                    <div class="product-name">${escapeHtml(p.name)}</div>
                    <div class="product-stock">Bestand: ${fmtWeight(p.weight)}</div>
                </div>
            </div>
            ${p.pricePerGram ? `<div class="product-price">${fmtMoney(p.pricePerGram)}/g</div>` : ''}
        </div>
    `).join('');
}

function renderProductSelect() {
    const select = document.getElementById('saleProduct');
    const current = select.value;
    const entries = Object.entries(products).sort((a, b) =>
        (a[1].name || '').localeCompare(b[1].name || '')
    );

    select.innerHTML = '<option value="">Produkt wählen...</option>' +
        entries.map(([id, p]) =>
            `<option value="${id}" data-price="${p.pricePerGram || 0}">${escapeHtml(p.name)} (${fmtWeight(p.weight)})</option>`
        ).join('');

    if (current) select.value = current;
}

function renderCustomersList() {
    const datalist = document.getElementById('customersList');
    const customers = [...new Set(Object.values(sales).map(s => s.customer).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    datalist.innerHTML = customers.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

// === DEBTS ===
function renderDebts() {
    const debtSales = Object.entries(sales).filter(([_, s]) => s.onDebt && !s.paid);

    // Group by customer (case-insensitive)
    const byCustomer = {};
    debtSales.forEach(([id, sale]) => {
        const key = sale.customer.toLowerCase().trim();
        if (!byCustomer[key]) {
            byCustomer[key] = { name: sale.customer, total: 0, sales: [] };
        }
        byCustomer[key].total += sale.price;
        byCustomer[key].sales.push({ id, ...sale });
    });

    const customers = Object.entries(byCustomer)
        .sort((a, b) => b[1].total - a[1].total);

    const total = debtSales.reduce((sum, [_, s]) => sum + s.price, 0);
    document.getElementById('debtTotalHeader').textContent = fmtMoney(total);

    const list = document.getElementById('debtList');
    if (customers.length === 0) {
        list.innerHTML = '<div class="empty-state">Keine offenen Schulden</div>';
        return;
    }

    list.innerHTML = customers.map(([key, c]) => `
        <div class="debt-item" onclick="openDebtModal('${key}')">
            <div class="debt-customer">
                <div class="debt-name">${escapeHtml(c.name)}</div>
                <div class="debt-count">${c.sales.length} ${c.sales.length === 1 ? 'Eintrag' : 'Einträge'}</div>
            </div>
            <div class="debt-amount">${fmtMoney(c.total)}</div>
        </div>
    `).join('');
}

// === SALE MODAL ===
window.openSaleModal = function() {
    document.getElementById('saleForm').reset();
    document.getElementById('saleModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('saleProduct').focus(), 100);
};

window.closeSaleModal = function() {
    document.getElementById('saleModal').classList.add('hidden');
};

async function handleSaleSubmit(e) {
    e.preventDefault();
    const productId = document.getElementById('saleProduct').value;
    const product = products[productId];
    const amount = parseFloat(document.getElementById('saleAmount').value);
    const price = parseFloat(document.getElementById('salePrice').value);
    const customer = document.getElementById('saleCustomer').value.trim();
    const onDebt = document.getElementById('saleOnDebt').checked;
    const note = document.getElementById('saleNote').value.trim();

    if (!product || !customer || amount <= 0 || price < 0) {
        showToast('Bitte alle Felder ausfüllen', 'error');
        return;
    }

    const sale = {
        productId,
        productName: product.name,
        amount,
        price,
        customer,
        onDebt,
        paid: false,
        note: note || null,
        timestamp: Date.now()
    };

    try {
        // Verkauf speichern
        const newSaleRef = push(ref(db, 'sales'));
        await set(newSaleRef, sale);

        // Bestand reduzieren
        const newWeight = Math.max(0, (product.weight || 0) - amount);
        await update(ref(db, 'products/' + productId), { weight: newWeight });

        showToast(onDebt ? 'Auf Pump notiert' : 'Verkauf gespeichert');
        closeSaleModal();
    } catch (err) {
        console.error(err);
        showToast('Fehler beim Speichern', 'error');
    }
}

// Auto-Berechnung des Preises wenn Menge eingegeben wird
function setupPriceAutoCalc() {
    const productSelect = document.getElementById('saleProduct');
    const amountInput = document.getElementById('saleAmount');
    const priceInput = document.getElementById('salePrice');

    function calc() {
        const opt = productSelect.options[productSelect.selectedIndex];
        const pricePerGram = parseFloat(opt?.dataset.price || 0);
        const amount = parseFloat(amountInput.value || 0);
        if (pricePerGram > 0 && amount > 0 && !priceInput.dataset.manual) {
            priceInput.value = (pricePerGram * amount).toFixed(2);
        }
    }

    productSelect.addEventListener('change', () => {
        priceInput.dataset.manual = '';
        calc();
    });
    amountInput.addEventListener('input', calc);
    priceInput.addEventListener('input', () => {
        priceInput.dataset.manual = '1';
    });
}

// === DELETE SALE ===
window.deleteSale = async function(id) {
    if (!confirm('Diesen Verkauf wirklich löschen?')) return;
    try {
        const sale = sales[id];
        if (sale && sale.productId && products[sale.productId]) {
            // Bestand wieder hinzufügen
            const product = products[sale.productId];
            await update(ref(db, 'products/' + sale.productId), {
                weight: (product.weight || 0) + (sale.amount || 0)
            });
        }
        await remove(ref(db, 'sales/' + id));
        showToast('Verkauf gelöscht');
    } catch (err) {
        showToast('Fehler beim Löschen', 'error');
    }
};

// === PRODUCT MODAL ===
window.openProductModal = function() {
    currentEditingProductId = null;
    document.getElementById('productModalTitle').textContent = 'Neues Produkt';
    document.getElementById('productForm').reset();
    document.getElementById('deleteProductBtn').classList.add('hidden');
    document.getElementById('productModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('productName').focus(), 100);
};

window.editProduct = function(id) {
    const p = products[id];
    if (!p) return;
    currentEditingProductId = id;
    document.getElementById('productModalTitle').textContent = 'Produkt bearbeiten';
    document.getElementById('productName').value = p.name || '';
    document.getElementById('productWeight').value = p.weight || 0;
    document.getElementById('productPrice').value = p.pricePerGram || '';
    document.getElementById('deleteProductBtn').classList.remove('hidden');
    document.getElementById('productModal').classList.remove('hidden');
};

window.closeProductModal = function() {
    document.getElementById('productModal').classList.add('hidden');
};

async function handleProductSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('productName').value.trim();
    const weight = parseFloat(document.getElementById('productWeight').value);
    const pricePerGram = parseFloat(document.getElementById('productPrice').value) || null;

    if (!name || isNaN(weight) || weight < 0) {
        showToast('Bitte alle Felder ausfüllen', 'error');
        return;
    }

    const data = { name, weight, pricePerGram };

    try {
        if (currentEditingProductId) {
            await update(ref(db, 'products/' + currentEditingProductId), data);
            showToast('Produkt aktualisiert');
        } else {
            const newRef = push(ref(db, 'products'));
            await set(newRef, data);
            showToast('Produkt hinzugefügt');
        }
        closeProductModal();
    } catch (err) {
        showToast('Fehler beim Speichern', 'error');
    }
}

async function handleDeleteProduct() {
    if (!currentEditingProductId) return;
    if (!confirm('Produkt wirklich löschen? Verkäufe bleiben erhalten.')) return;
    try {
        await remove(ref(db, 'products/' + currentEditingProductId));
        showToast('Produkt gelöscht');
        closeProductModal();
    } catch (err) {
        showToast('Fehler beim Löschen', 'error');
    }
}

// === DEBT MODAL ===
window.openDebtModal = function(customerKey) {
    const debtSales = Object.entries(sales)
        .filter(([_, s]) => s.onDebt && !s.paid && s.customer.toLowerCase().trim() === customerKey)
        .sort((a, b) => b[1].timestamp - a[1].timestamp);

    if (debtSales.length === 0) return;

    currentDebtCustomer = customerKey;
    const total = debtSales.reduce((sum, [_, s]) => sum + s.price, 0);
    const customerName = debtSales[0][1].customer;

    document.getElementById('debtCustomerName').textContent = customerName;
    document.getElementById('debtCustomerTotal').textContent = fmtMoney(total);

    document.getElementById('debtCustomerSales').innerHTML = debtSales.map(([id, s]) => `
        <div class="debt-sale-row">
            <div class="debt-sale-info">
                <div class="debt-sale-product">${escapeHtml(s.productName || '?')} · ${fmtWeight(s.amount)}</div>
                <div class="debt-sale-date">${fmtDate(s.timestamp)}</div>
            </div>
            <div class="debt-sale-actions">
                <div class="debt-sale-amount">${fmtMoney(s.price)}</div>
                <button class="btn-pay" onclick="markSinglePaid('${id}')">Bezahlt</button>
            </div>
        </div>
    `).join('');

    document.getElementById('debtModal').classList.remove('hidden');
};

window.closeDebtModal = function() {
    document.getElementById('debtModal').classList.add('hidden');
    currentDebtCustomer = null;
};

window.markSinglePaid = async function(id) {
    try {
        await update(ref(db, 'sales/' + id), { paid: true, paidAt: Date.now() });
        showToast('Als bezahlt markiert');

        // Modal aktualisieren oder schließen wenn leer
        const remaining = Object.entries(sales).filter(([sid, s]) =>
            sid !== id &&
            s.onDebt && !s.paid &&
            s.customer.toLowerCase().trim() === currentDebtCustomer
        );
        if (remaining.length === 0) {
            closeDebtModal();
        } else {
            openDebtModal(currentDebtCustomer);
        }
    } catch (err) {
        showToast('Fehler', 'error');
    }
};

window.markAllPaid = async function() {
    if (!currentDebtCustomer) return;
    if (!confirm('Wirklich alle Schulden als bezahlt markieren?')) return;

    const debtIds = Object.entries(sales)
        .filter(([_, s]) => s.onDebt && !s.paid && s.customer.toLowerCase().trim() === currentDebtCustomer)
        .map(([id]) => id);

    try {
        const updates = {};
        debtIds.forEach(id => {
            updates['sales/' + id + '/paid'] = true;
            updates['sales/' + id + '/paidAt'] = Date.now();
        });
        await update(ref(db), updates);
        showToast('Alles als bezahlt markiert');
        closeDebtModal();
    } catch (err) {
        showToast('Fehler', 'error');
    }
};

// === NAVIGATION ===
function setupNavigation() {
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // FAB nicht aktivieren als Tab
            if (btn.classList.contains('nav-item-fab')) return;

            const targetView = btn.dataset.view;
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(targetView).classList.add('active');

            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

// === INIT ===
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('saleForm').addEventListener('submit', handleSaleSubmit);
    document.getElementById('productForm').addEventListener('submit', handleProductSubmit);
    document.getElementById('deleteProductBtn').addEventListener('click', handleDeleteProduct);
    document.getElementById('salesSearch').addEventListener('input', renderAllSales);

    setupNavigation();
    setupPriceAutoCalc();

    if (await checkSession()) {
        showApp();
    }
});

// === SERVICE WORKER (PWA) ===
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW failed:', err));
    });
}
