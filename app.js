// === FIREBASE CONFIG ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getDatabase,
    ref,
    onValue,
    push,
    set,
    update,
    remove
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// >>> HIER deine Firebase-Konfiguration eintragen (nicht löschen!) <<<
const firebaseConfig = {
    apiKey: "DEIN_API_KEY",
    authDomain: "DEIN_PROJEKT.firebaseapp.com",
    databaseURL: "https://DEIN_PROJEKT-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "DEIN_PROJEKT",
    storageBucket: "DEIN_PROJEKT.appspot.com",
    messagingSenderId: "DEINE_NUMMER",
    appId: "DEINE_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// === PASSWORD ===
// Standard: "verkauf2025" – siehe README zum Ändern
const PASSWORD_HASH = "ca00b5919d1cd8047f33ca20505a441d8757faa7edcaa580e82836e41b8ad2fc";
const SESSION_KEY = "verkauf_session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

// === STATE ===
let products = {};
let sales = {};
let currentEditingProductId = null;
let currentEditingSaleId = null;
let currentDebtCustomer = null;
let currentStatsPeriod = 'today';
let currentSubTab = 'all';
// Aktuell im Modal bearbeitete Positionen: [{productId, amount, price, selectedTierIdx}, ...]
let currentPositions = [];

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
    setTimeout(() => toast.classList.add('hidden'), 2500);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
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
    onValue(ref(db, 'products'), (snapshot) => {
        products = snapshot.val() || {};
        renderProducts();
        // Falls Sale-Modal offen: Positionen neu rendern, damit neue Produkte erscheinen
        if (!document.getElementById('saleModal').classList.contains('hidden')) {
            renderPositions();
        }
    });

    onValue(ref(db, 'sales'), (snapshot) => {
        sales = snapshot.val() || {};
        renderDashboard();
        renderAllSales();
        renderDebts();
        renderCustomersList();
        renderStats();
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

    const debtSales = Object.values(sales).filter(s => s.onDebt && !s.paid);
    const debtTotal = debtSales.reduce((sum, s) => sum + s.price, 0);
    const uniqueCustomers = new Set(debtSales.map(s => (s.customer || '').toLowerCase().trim())).size;
    document.getElementById('openDebt').textContent = fmtMoney(debtTotal);
    document.getElementById('debtCount').textContent = uniqueCustomers + ' ' + (uniqueCustomers === 1 ? 'Person' : 'Personen');

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

    // Multi-Position oder Single-Position?
    let productLabel = '';
    let totalAmount = 0;
    if (sale.items && sale.items.length > 0) {
        // Multi-Position
        const firstName = sale.items[0].productName || '?';
        const moreCount = sale.items.length - 1;
        productLabel = escapeHtml(firstName);
        if (moreCount > 0) {
            productLabel += ` <span class="sale-multi-badge">+${moreCount}</span>`;
        }
        totalAmount = sale.items.reduce((sum, it) => sum + (it.amount || 0), 0);
    } else {
        // Single-Position (Legacy)
        productLabel = escapeHtml(sale.productName || '?');
        totalAmount = sale.amount || 0;
    }

    return `
        <div class="sale-item ${debtClass}" onclick="editSale('${id}')">
            <div class="sale-info">
                <div class="sale-customer">${escapeHtml(sale.customer)} ${debtBadge}</div>
                <div class="sale-meta">${productLabel} · ${fmtDate(sale.timestamp)}${note}</div>
            </div>
            <div class="sale-amounts">
                <div class="sale-price">${fmtMoney(sale.price)}</div>
                <div class="sale-weight">${fmtWeight(totalAmount)}</div>
            </div>
            <svg class="sale-edit-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
    `;
}

// === SALES VIEW ===
function renderAllSales() {
    const search = (document.getElementById('salesSearch')?.value || '').toLowerCase().trim();
    const list = document.getElementById('allSalesList');

    let entries = Object.entries(sales)
        .sort((a, b) => b[1].timestamp - a[1].timestamp);

    // Badge updaten: Anzahl aller Verkäufe
    const allBadge = document.getElementById('allSalesBadge');
    if (allBadge) allBadge.textContent = entries.length;

    if (search) {
        entries = entries.filter(([_, s]) => {
            const customerMatch = (s.customer || '').toLowerCase().includes(search);
            const noteMatch = (s.note || '').toLowerCase().includes(search);
            // Single oder Multi
            let productMatch = (s.productName || '').toLowerCase().includes(search);
            if (!productMatch && s.items) {
                productMatch = s.items.some(it => (it.productName || '').toLowerCase().includes(search));
            }
            return customerMatch || noteMatch || productMatch;
        });
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

    list.innerHTML = entries.map(([id, p]) => {
        const tierCount = (p.tiers || []).length;
        const ekLine = p.costPerGram ? `<div class="product-price-line">EK: <strong>${fmtMoney(p.costPerGram)}/g</strong></div>` : '';
        const tierLine = tierCount > 0 ? `<div class="product-price-line">${tierCount} VK-${tierCount === 1 ? 'Stufe' : 'Stufen'}</div>` : '';
        return `
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
                <div class="product-price">
                    ${ekLine}
                    ${tierLine}
                </div>
            </div>
        `;
    }).join('');
}

// === POSITION RENDERING (Multi-Sorten im Sale-Modal) ===
function renderPositions() {
    const list = document.getElementById('positionsList');
    if (currentPositions.length === 0) {
        // Mindestens eine Position immer anzeigen
        currentPositions.push({ productId: '', amount: '', price: '', selectedTierIdx: null });
    }

    list.innerHTML = currentPositions.map((pos, idx) => renderPositionCard(pos, idx)).join('');

    // Event-Listener anbringen
    currentPositions.forEach((_, idx) => {
        const card = document.querySelector(`.position-card[data-idx="${idx}"]`);
        if (!card) return;

        // Produkt-Select
        const select = card.querySelector('.position-product-select');
        select?.addEventListener('change', (e) => {
            currentPositions[idx].productId = e.target.value;
            currentPositions[idx].selectedTierIdx = null;
            renderPositions();
        });

        // Tier-Buttons
        card.querySelectorAll('.position-tier-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const amount = parseFloat(btn.dataset.amount);
                const price = parseFloat(btn.dataset.price);
                const tierIdx = parseInt(btn.dataset.tierIdx);
                currentPositions[idx].amount = amount;
                currentPositions[idx].price = price.toFixed(2);
                currentPositions[idx].selectedTierIdx = tierIdx;
                renderPositions();
            });
        });

        // Manuelle Eingaben
        const amountInput = card.querySelector('.position-amount-input');
        const priceInput = card.querySelector('.position-price-input');
        amountInput?.addEventListener('input', (e) => {
            currentPositions[idx].amount = e.target.value;
            currentPositions[idx].selectedTierIdx = null;
            updateSaleTotal();
            // Tier-Highlighting weg
            card.querySelectorAll('.position-tier-btn').forEach(b => b.classList.remove('selected'));
        });
        priceInput?.addEventListener('input', (e) => {
            currentPositions[idx].price = e.target.value;
            currentPositions[idx].selectedTierIdx = null;
            updateSaleTotal();
            card.querySelectorAll('.position-tier-btn').forEach(b => b.classList.remove('selected'));
        });

        // Entfernen-Button
        const removeBtn = card.querySelector('.position-remove-btn');
        removeBtn?.addEventListener('click', () => {
            currentPositions.splice(idx, 1);
            if (currentPositions.length === 0) {
                currentPositions.push({ productId: '', amount: '', price: '', selectedTierIdx: null });
            }
            renderPositions();
        });
    });

    updateSaleTotal();
}

function renderPositionCard(pos, idx) {
    const product = pos.productId ? products[pos.productId] : null;
    const productOptions = Object.entries(products)
        .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''))
        .map(([pid, p]) =>
            `<option value="${pid}" ${pid === pos.productId ? 'selected' : ''}>${escapeHtml(p.name)} (${fmtWeight(p.weight)})</option>`
        ).join('');

    // Tier-Buttons
    let tierHtml = '';
    if (product && product.tiers && product.tiers.length > 0) {
        const tiers = [...product.tiers].sort((a, b) => (a.amount || 0) - (b.amount || 0));
        tierHtml = `
            <div class="position-tier-buttons">
                ${tiers.map((tier, tIdx) => `
                    <button type="button" class="position-tier-btn ${pos.selectedTierIdx === tIdx ? 'selected' : ''}"
                            data-tier-idx="${tIdx}"
                            data-amount="${tier.amount}"
                            data-price="${tier.price}">
                        <span class="position-tier-btn-amount">${fmtWeight(tier.amount)}</span>
                        <span class="position-tier-btn-price">${fmtMoney(tier.price)}</span>
                    </button>
                `).join('')}
            </div>
        `;
    }

    const showRemove = currentPositions.length > 1;

    return `
        <div class="position-card" data-idx="${idx}">
            <div class="position-card-header">
                <div class="position-card-title">
                    <span class="position-number">${idx + 1}</span>
                    <span>Position</span>
                </div>
                ${showRemove ? `
                    <button type="button" class="position-remove-btn" aria-label="Position entfernen">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                ` : ''}
            </div>
            <select class="position-product-select" required>
                <option value="">Produkt wählen...</option>
                ${productOptions}
            </select>
            ${tierHtml}
            <div class="position-fields">
                <div class="position-field">
                    <span class="position-field-label">Menge (g)</span>
                    <input type="number" class="position-amount-input" step="0.1" min="0" placeholder="0" value="${pos.amount !== '' && pos.amount != null ? pos.amount : ''}">
                </div>
                <div class="position-field">
                    <span class="position-field-label">Preis (€)</span>
                    <input type="number" class="position-price-input" step="0.01" min="0" placeholder="0,00" value="${pos.price !== '' && pos.price != null ? pos.price : ''}">
                </div>
            </div>
        </div>
    `;
}

function updateSaleTotal() {
    const total = currentPositions.reduce((sum, pos) => {
        const p = parseFloat(pos.price);
        return sum + (isNaN(p) ? 0 : p);
    }, 0);
    const el = document.getElementById('saleTotalValue');
    if (el) el.textContent = fmtMoney(total);
}

// === CUSTOMERS LIST ===
function renderCustomersList() {
    const datalist = document.getElementById('customersList');
    const customers = [...new Set(Object.values(sales).map(s => s.customer).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    datalist.innerHTML = customers.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

// === SALE MODAL ===
window.openSaleModal = function() {
    currentEditingSaleId = null;
    currentPositions = [{ productId: '', amount: '', price: '', selectedTierIdx: null }];
    document.getElementById('saleModalTitle').textContent = 'Neuer Verkauf';
    document.getElementById('saleForm').reset();
    document.getElementById('deleteSaleBtn').classList.add('hidden');
    renderPositions();
    document.getElementById('saleModal').classList.remove('hidden');
};

window.editSale = function(id) {
    const sale = sales[id];
    if (!sale) return;

    currentEditingSaleId = id;
    document.getElementById('saleModalTitle').textContent = 'Verkauf bearbeiten';

    // Positionen aus dem Verkauf laden
    if (sale.items && sale.items.length > 0) {
        // Multi-Position-Verkauf
        currentPositions = sale.items.map(it => ({
            productId: it.productId || '',
            amount: it.amount || '',
            price: (it.price || 0).toFixed(2),
            selectedTierIdx: null
        }));
    } else {
        // Single-Position (Legacy)
        currentPositions = [{
            productId: sale.productId || '',
            amount: sale.amount || '',
            price: (sale.price || 0).toFixed(2),
            selectedTierIdx: null
        }];
    }

    document.getElementById('saleCustomer').value = sale.customer || '';
    document.getElementById('saleOnDebt').checked = !!(sale.onDebt && !sale.paid);
    document.getElementById('saleNote').value = sale.note || '';

    renderPositions();
    document.getElementById('deleteSaleBtn').classList.remove('hidden');
    document.getElementById('saleModal').classList.remove('hidden');
};

window.closeSaleModal = function() {
    document.getElementById('saleModal').classList.add('hidden');
    currentEditingSaleId = null;
    currentPositions = [];
};

function addPosition() {
    currentPositions.push({ productId: '', amount: '', price: '', selectedTierIdx: null });
    renderPositions();
    // Smooth-Scroll zur neuen Position
    setTimeout(() => {
        const list = document.getElementById('positionsList');
        const newCard = list?.lastElementChild;
        newCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        newCard?.querySelector('.position-product-select')?.focus();
    }, 50);
}

// Hilfsfunktion: Bestand pro Produkt aus Items berechnen
function aggregateAmountsByProduct(items) {
    const map = {};
    items.forEach(it => {
        if (!it.productId) return;
        if (!map[it.productId]) map[it.productId] = 0;
        map[it.productId] += it.amount || 0;
    });
    return map;
}

async function handleSaleSubmit(e) {
    e.preventDefault();

    const customer = document.getElementById('saleCustomer').value.trim();
    const onDebt = document.getElementById('saleOnDebt').checked;
    const note = document.getElementById('saleNote').value.trim();

    // Validierung der Positionen
    const validItems = [];
    for (const pos of currentPositions) {
        if (!pos.productId) continue;
        const product = products[pos.productId];
        if (!product) continue;
        const amount = parseFloat(pos.amount);
        const price = parseFloat(pos.price);
        if (isNaN(amount) || amount <= 0 || isNaN(price) || price < 0) continue;
        validItems.push({
            productId: pos.productId,
            productName: product.name,
            amount,
            price,
            costPerGram: product.costPerGram || 0
        });
    }

    if (validItems.length === 0) {
        showToast('Bitte mindestens eine Position vollständig ausfüllen', 'error');
        return;
    }
    if (!customer) {
        showToast('Bitte Kundenname eintragen', 'error');
        return;
    }

    const totalPrice = validItems.reduce((sum, it) => sum + it.price, 0);
    const totalAmount = validItems.reduce((sum, it) => sum + it.amount, 0);

    try {
        if (currentEditingSaleId) {
            // BEARBEITEN
            const oldSale = sales[currentEditingSaleId];

            // Alte Mengen pro Produkt zurückrechnen
            const oldByProduct = {};
            if (oldSale.items && oldSale.items.length > 0) {
                oldSale.items.forEach(it => {
                    if (!it.productId) return;
                    oldByProduct[it.productId] = (oldByProduct[it.productId] || 0) + (it.amount || 0);
                });
            } else if (oldSale.productId) {
                oldByProduct[oldSale.productId] = oldSale.amount || 0;
            }

            // Neue Mengen
            const newByProduct = aggregateAmountsByProduct(validItems);

            // Diff berechnen und Bestände updaten
            const allProductIds = new Set([...Object.keys(oldByProduct), ...Object.keys(newByProduct)]);
            const updates = {};
            allProductIds.forEach(pid => {
                if (!products[pid]) return;
                const oldQty = oldByProduct[pid] || 0;
                const newQty = newByProduct[pid] || 0;
                const diff = newQty - oldQty;
                const currentWeight = products[pid].weight || 0;
                const newWeight = Math.max(0, currentWeight - diff);
                updates['products/' + pid + '/weight'] = newWeight;
            });

            // Verkaufs-Objekt aufbauen (Multi-Format)
            const wasPaidNow = oldSale.onDebt && !oldSale.paid && !onDebt;
            const updatedSale = {
                items: validItems,
                price: totalPrice,
                customer,
                onDebt,
                paid: onDebt ? (oldSale.paid || false) : true,
                note: note || null,
                timestamp: oldSale.timestamp
            };
            if (wasPaidNow) updatedSale.paidAt = Date.now();
            else if (oldSale.paidAt) updatedSale.paidAt = oldSale.paidAt;

            // Set + Bestands-Updates
            await set(ref(db, 'sales/' + currentEditingSaleId), updatedSale);
            if (Object.keys(updates).length > 0) {
                await update(ref(db), updates);
            }

            showToast('Verkauf aktualisiert');
        } else {
            // NEU anlegen
            const newSale = {
                items: validItems,
                price: totalPrice,
                customer,
                onDebt,
                paid: !onDebt,
                note: note || null,
                timestamp: Date.now()
            };

            const newSaleRef = push(ref(db, 'sales'));
            await set(newSaleRef, newSale);

            // Bestände reduzieren
            const byProduct = aggregateAmountsByProduct(validItems);
            const updates = {};
            Object.entries(byProduct).forEach(([pid, qty]) => {
                if (!products[pid]) return;
                const newWeight = Math.max(0, (products[pid].weight || 0) - qty);
                updates['products/' + pid + '/weight'] = newWeight;
            });
            if (Object.keys(updates).length > 0) {
                await update(ref(db), updates);
            }

            showToast(onDebt ? 'Auf Pump notiert' : 'Verkauf gespeichert');
        }

        closeSaleModal();
    } catch (err) {
        console.error(err);
        showToast('Fehler beim Speichern', 'error');
    }
}

async function handleDeleteSale() {
    if (!currentEditingSaleId) return;
    if (!confirm('Diesen Verkauf wirklich löschen?')) return;
    try {
        const sale = sales[currentEditingSaleId];

        // Bestände zurückgeben
        const byProduct = {};
        if (sale.items && sale.items.length > 0) {
            sale.items.forEach(it => {
                if (!it.productId) return;
                byProduct[it.productId] = (byProduct[it.productId] || 0) + (it.amount || 0);
            });
        } else if (sale.productId) {
            byProduct[sale.productId] = sale.amount || 0;
        }

        const updates = {};
        Object.entries(byProduct).forEach(([pid, qty]) => {
            if (!products[pid]) return;
            const newWeight = (products[pid].weight || 0) + qty;
            updates['products/' + pid + '/weight'] = newWeight;
        });
        if (Object.keys(updates).length > 0) {
            await update(ref(db), updates);
        }

        await remove(ref(db, 'sales/' + currentEditingSaleId));
        showToast('Verkauf gelöscht');
        closeSaleModal();
    } catch (err) {
        showToast('Fehler beim Löschen', 'error');
    }
}

// === PRODUCT MODAL mit TIERS ===
window.openProductModal = function() {
    currentEditingProductId = null;
    document.getElementById('productModalTitle').textContent = 'Neues Produkt';
    document.getElementById('productForm').reset();
    document.getElementById('deleteProductBtn').classList.add('hidden');
    renderTierEditList([]);
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
    document.getElementById('productCostPrice').value = p.costPerGram || '';
    renderTierEditList(p.tiers || []);
    document.getElementById('deleteProductBtn').classList.remove('hidden');
    document.getElementById('productModal').classList.remove('hidden');
};

window.closeProductModal = function() {
    document.getElementById('productModal').classList.add('hidden');
};

function renderTierEditList(tiers) {
    const list = document.getElementById('tiersList');
    if (!tiers || tiers.length === 0) {
        list.innerHTML = '';
        return;
    }
    list.innerHTML = tiers.map((tier, idx) => `
        <div class="tier-edit-row" data-idx="${idx}">
            <input type="number" step="0.1" min="0" placeholder="Menge in g" value="${tier.amount || ''}" class="tier-amount-input">
            <input type="number" step="0.01" min="0" placeholder="Preis in €" value="${tier.price || ''}" class="tier-price-input">
            <button type="button" class="tier-remove-btn" onclick="removeTierRow(${idx})" aria-label="Entfernen">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
            </button>
        </div>
    `).join('');
}

function readTiersFromForm() {
    const rows = document.querySelectorAll('#tiersList .tier-edit-row');
    const tiers = [];
    rows.forEach(row => {
        const amount = parseFloat(row.querySelector('.tier-amount-input').value);
        const price = parseFloat(row.querySelector('.tier-price-input').value);
        if (!isNaN(amount) && amount > 0 && !isNaN(price) && price >= 0) {
            tiers.push({ amount, price });
        }
    });
    return tiers;
}

window.removeTierRow = function(idx) {
    const tiers = readTiersFromForm();
    tiers.splice(idx, 1);
    renderTierEditList(tiers);
};

function addTierRow() {
    const tiers = readTiersFromForm();
    tiers.push({ amount: '', price: '' });
    renderTierEditList(tiers);

    // Fokus auf neuen Input
    setTimeout(() => {
        const inputs = document.querySelectorAll('#tiersList .tier-amount-input');
        if (inputs.length > 0) inputs[inputs.length - 1].focus();
    }, 50);
}

async function handleProductSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('productName').value.trim();
    const weight = parseFloat(document.getElementById('productWeight').value);
    const costPerGram = parseFloat(document.getElementById('productCostPrice').value) || null;
    const tiers = readTiersFromForm();

    if (!name || isNaN(weight) || weight < 0) {
        showToast('Bitte Sorte und Bestand eintragen', 'error');
        return;
    }

    const data = { name, weight, costPerGram, tiers };

    try {
        if (currentEditingProductId) {
            await set(ref(db, 'products/' + currentEditingProductId), data);
            showToast('Produkt aktualisiert');
        } else {
            const newRef = push(ref(db, 'products'));
            await set(newRef, data);
            showToast('Produkt hinzugefügt');
        }
        closeProductModal();
    } catch (err) {
        console.error(err);
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

// === DEBTS ===
function renderDebts() {
    const debtSales = Object.entries(sales).filter(([_, s]) => s.onDebt && !s.paid);

    const byCustomer = {};
    debtSales.forEach(([id, sale]) => {
        const key = (sale.customer || '').toLowerCase().trim();
        if (!byCustomer[key]) {
            byCustomer[key] = { name: sale.customer, total: 0, sales: [] };
        }
        byCustomer[key].total += sale.price;
        byCustomer[key].sales.push({ id, ...sale });
    });

    const customers = Object.entries(byCustomer)
        .sort((a, b) => b[1].total - a[1].total);

    const total = debtSales.reduce((sum, [_, s]) => sum + s.price, 0);
    const totalEl = document.getElementById('debtTotalHeader');
    if (totalEl) totalEl.textContent = fmtMoney(total);

    // Sub-Tab Badge: Anzahl Personen mit Schulden
    const debtBadge = document.getElementById('debtBadge');
    if (debtBadge) debtBadge.textContent = customers.length;

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

window.openDebtModal = function(customerKey) {
    const debtSales = Object.entries(sales)
        .filter(([_, s]) => s.onDebt && !s.paid && (s.customer || '').toLowerCase().trim() === customerKey)
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

        const remaining = Object.entries(sales).filter(([sid, s]) =>
            sid !== id &&
            s.onDebt && !s.paid &&
            (s.customer || '').toLowerCase().trim() === currentDebtCustomer
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
        .filter(([_, s]) => s.onDebt && !s.paid && (s.customer || '').toLowerCase().trim() === currentDebtCustomer)
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

// === STATS ===
function getPeriodStart(period) {
    const now = new Date();
    if (period === 'today') {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    }
    if (period === 'week') {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        return todayStart - (now.getDay() === 0 ? 6 : now.getDay() - 1) * 86400000;
    }
    if (period === 'month') {
        return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    }
    return 0; // all
}

function renderStats() {
    const periodStart = getPeriodStart(currentStatsPeriod);
    const filteredSales = Object.values(sales).filter(s => s.timestamp >= periodStart);

    const revenue = filteredSales.reduce((sum, s) => sum + (s.price || 0), 0);

    // Wareneinsatz: Items × costPerGram (Multi-Position aware)
    const cost = filteredSales.reduce((sum, s) => {
        if (s.items && s.items.length > 0) {
            // Multi-Position: pro Item
            return sum + s.items.reduce((itSum, it) => {
                const cpg = it.costPerGram != null ? it.costPerGram :
                            (it.productId && products[it.productId] ? products[it.productId].costPerGram : 0);
                return itSum + ((cpg || 0) * (it.amount || 0));
            }, 0);
        } else {
            // Single-Position (Legacy)
            const cpg = s.costPerGram != null ? s.costPerGram :
                        (s.productId && products[s.productId] ? products[s.productId].costPerGram : 0);
            return sum + ((cpg || 0) * (s.amount || 0));
        }
    }, 0);

    const profit = revenue - cost;
    const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
    const count = filteredSales.length;
    const avg = count > 0 ? revenue / count : 0;

    document.getElementById('statRevenue').textContent = fmtMoney(revenue);
    document.getElementById('statCost').textContent = fmtMoney(cost);
    document.getElementById('statProfit').textContent = fmtMoney(profit);
    document.getElementById('statMargin').textContent = 'Marge: ' + margin + '%';
    document.getElementById('statCount').textContent = count;
    document.getElementById('statAvg').textContent = 'Ø ' + fmtMoney(avg);

    // Top Produkte (Multi-Position aware)
    const productRevenue = {};
    filteredSales.forEach(s => {
        if (s.items && s.items.length > 0) {
            // Multi-Position: jedes Item einzeln zählen
            s.items.forEach(it => {
                const key = it.productName || '?';
                if (!productRevenue[key]) productRevenue[key] = { revenue: 0, amount: 0, count: 0 };
                productRevenue[key].revenue += it.price || 0;
                productRevenue[key].amount += it.amount || 0;
                productRevenue[key].count += 1;
            });
        } else {
            const key = s.productName || '?';
            if (!productRevenue[key]) productRevenue[key] = { revenue: 0, amount: 0, count: 0 };
            productRevenue[key].revenue += s.price || 0;
            productRevenue[key].amount += s.amount || 0;
            productRevenue[key].count += 1;
        }
    });

    const topProducts = Object.entries(productRevenue)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 5);

    const productList = document.getElementById('topProductsList');
    if (topProducts.length === 0) {
        productList.innerHTML = '<div class="empty-state">Keine Daten</div>';
    } else {
        productList.innerHTML = topProducts.map(([name, data], idx) => `
            <div class="ranking-item">
                <div class="ranking-rank rank-${idx + 1}">${idx + 1}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${escapeHtml(name)}</div>
                    <div class="ranking-meta">${fmtWeight(data.amount)} · ${data.count} ${data.count === 1 ? 'Verkauf' : 'Verkäufe'}</div>
                </div>
                <div class="ranking-value">${fmtMoney(data.revenue)}</div>
            </div>
        `).join('');
    }

    // Top Kunden
    const customerRevenue = {};
    filteredSales.forEach(s => {
        const key = (s.customer || '?').trim();
        if (!customerRevenue[key]) customerRevenue[key] = { revenue: 0, count: 0 };
        customerRevenue[key].revenue += s.price || 0;
        customerRevenue[key].count += 1;
    });

    const topCustomers = Object.entries(customerRevenue)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 5);

    const customerList = document.getElementById('topCustomersList');
    if (topCustomers.length === 0) {
        customerList.innerHTML = '<div class="empty-state">Keine Daten</div>';
    } else {
        customerList.innerHTML = topCustomers.map(([name, data], idx) => `
            <div class="ranking-item">
                <div class="ranking-rank rank-${idx + 1}">${idx + 1}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${escapeHtml(name)}</div>
                    <div class="ranking-meta">${data.count} ${data.count === 1 ? 'Kauf' : 'Käufe'}</div>
                </div>
                <div class="ranking-value">${fmtMoney(data.revenue)}</div>
            </div>
        `).join('');
    }
}

// === NAVIGATION ===
function setupNavigation() {
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetView = btn.dataset.view;
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(targetView).classList.add('active');

            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Sub-Tabs (Verkäufe / Pumpliste)
    document.querySelectorAll('.sub-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.subtab;
            currentSubTab = target;
            switchSubTab(target);
        });
    });

    // Period Tabs für Stats
    document.querySelectorAll('.period-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentStatsPeriod = tab.dataset.period;
            renderStats();
        });
    });
}

function switchSubTab(target) {
    document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.sub-tab[data-subtab="${target}"]`)?.classList.add('active');

    document.querySelectorAll('.sub-view').forEach(v => v.classList.remove('active'));
    if (target === 'all') {
        document.getElementById('subViewAll').classList.add('active');
    } else if (target === 'debt') {
        document.getElementById('subViewDebt').classList.add('active');
    }
}

// Direkt zu Pumpliste-Tab springen (von Übersicht aus)
window.goToDebtTab = function() {
    // 1. Verkäufe-View aktivieren
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('salesView').classList.add('active');

    // 2. Bottom-Nav aktivieren
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-view="salesView"]')?.classList.add('active');

    // 3. Pumpliste Sub-Tab öffnen
    currentSubTab = 'debt';
    switchSubTab('debt');
};

// === INIT ===
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('saleForm').addEventListener('submit', handleSaleSubmit);
    document.getElementById('productForm').addEventListener('submit', handleProductSubmit);
    document.getElementById('deleteProductBtn').addEventListener('click', handleDeleteProduct);
    document.getElementById('deleteSaleBtn').addEventListener('click', handleDeleteSale);
    document.getElementById('addTierBtn').addEventListener('click', addTierRow);
    document.getElementById('addPositionBtn').addEventListener('click', addPosition);
    document.getElementById('salesSearch').addEventListener('input', renderAllSales);

    setupNavigation();

    if (await checkSession()) {
        showApp();
    }
});

// === SERVICE WORKER ===
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW failed:', err));
    });
}
