'use strict';

const loginForm = document.getElementById('login-form');
const loginMessageEl = document.getElementById('login-message');
const loginSubmit = document.getElementById('login-submit');
const loginCard = document.getElementById('login-card');
const paymentSections = document.querySelectorAll('[data-section="payments"]');
const userPanel = document.getElementById('user-panel');
const userEmailEl = document.getElementById('user-email');
const userLastLoginEl = document.getElementById('user-last-login');
const userAvatarEl = document.getElementById('user-avatar');
const logoutButton = document.getElementById('logout-button');
const form = document.getElementById('payment-form');
const messageEl = document.getElementById('form-message');
const tableBody = document.getElementById('payments-table-body');
const downloadButton = document.getElementById('download-button');
const footerYear = document.getElementById('year');

let payments = [];
let authToken = localStorage.getItem('authToken') || '';
let currentUser = null;

footerYear.textContent = new Date().getFullYear();

function buildAuthHeaders(extra = {}) {
  return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : { ...extra };
}

function showLoginMessage(message, type = 'info') {
  if (!loginMessageEl) {
    return;
  }

  loginMessageEl.textContent = message;
  loginMessageEl.className = 'form__message';

  if (type === 'success') {
    loginMessageEl.classList.add('form__message--success');
  }

  if (type === 'error') {
    loginMessageEl.classList.add('form__message--error');
  }
}

function computeAvatarInitials(email) {
  const identifier = String(email || '')
    .split('@')[0]
    .replace(/[^a-zA-Z0-9._-]/g, '');

  if (!identifier) {
    return 'TB';
  }

  const parts = identifier.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  }

  return identifier.slice(0, 2).toUpperCase();
}

function formatLastLogin(isoDate) {
  if (!isoDate) {
    return 'Primer acceso registrado';
  }

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `Último acceso: ${date.toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })}`;
}

function updateSections() {
  const isAuthenticated = Boolean(authToken && currentUser);

  if (loginCard) {
    loginCard.hidden = isAuthenticated;
  }

  paymentSections.forEach((section) => {
    section.hidden = !isAuthenticated;
  });

  if (isAuthenticated && currentUser) {
    userPanel.hidden = false;
    userEmailEl.textContent = currentUser.email;
    userLastLoginEl.textContent = formatLastLogin(currentUser.lastLoginAt);
    userAvatarEl.textContent = computeAvatarInitials(currentUser.email);
  } else {
    userPanel.hidden = true;
    userEmailEl.textContent = '';
    userLastLoginEl.textContent = '';
    userAvatarEl.textContent = 'TB';
  }
}

function setAuth(token, user, persist = true) {
  authToken = token;
  currentUser = user;
  if (persist && token) {
    localStorage.setItem('authToken', token);
  }
  updateSections();
}

function clearAuth(message, type = 'info') {
  authToken = '';
  currentUser = null;
  localStorage.removeItem('authToken');
  updateSections();
  payments = [];
  renderPayments();
  if (loginForm) {
    loginForm.reset();
    loginForm.email?.focus();
  }
  if (typeof message === 'string') {
    showLoginMessage(message, type);
  } else {
    showLoginMessage('', 'info');
  }
}

async function validateSession() {
  if (!authToken) {
    updateSections();
    showLoginMessage('Inicia sesión para gestionar tus cobros.', 'info');
    return;
  }

  try {
    const response = await fetch('/api/auth/profile', {
      headers: buildAuthHeaders()
    });

    if (!response.ok) {
      throw new Error('Sesión expirada');
    }

    const data = await response.json();
    setAuth(authToken, data.user, false);
    showLoginMessage('Sesión restaurada correctamente.', 'success');
    await loadPayments();
  } catch (error) {
    console.warn('No se pudo validar la sesión', error);
    clearAuth('Tu sesión expiró, vuelve a iniciar sesión.', 'error');
  }
}

async function loadPayments() {
  if (!authToken) {
    return;
  }

  try {
    const response = await fetch('/api/payments', {
      headers: buildAuthHeaders()
    });

    if (response.status === 401) {
      handleUnauthorized();
      return;
    }

    if (!response.ok) {
      throw new Error('No se pudo obtener el historial');
    }

    const data = await response.json();
    payments = data.payments || [];
    renderPayments();
    showMessage('', 'info');
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function renderPayments() {
  if (!tableBody) {
    return;
  }

  if (!payments.length) {
    tableBody.innerHTML = '<tr><td colspan="6" class="table__empty">No hay pagos registrados todavía.</td></tr>';
    return;
  }

  tableBody.innerHTML = payments
    .map((payment) => {
      const date = new Date(payment.createdAt);
      const formattedDate = date.toLocaleString('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
      const formattedAmount = new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
      }).format(payment.amount);

      return `
        <tr>
          <td>${formattedDate}</td>
          <td>${escapeHtml(payment.accountNumber)}</td>
          <td>${escapeHtml(payment.customerName)}</td>
          <td>${escapeHtml(payment.paymentMethod)}</td>
          <td class="table__align-right">${formattedAmount}</td>
          <td>${escapeHtml(payment.notes || '')}</td>
        </tr>
      `;
    })
    .join('');
}

function escapeHtml(value) {
  const text = String(value ?? '');
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function resetForm() {
  form.reset();
  form.accountNumber.focus();
}

function showMessage(message, type) {
  if (!messageEl) {
    return;
  }

  messageEl.textContent = message;
  messageEl.className = 'form__message';
  if (type === 'success') {
    messageEl.classList.add('form__message--success');
  }
  if (type === 'error') {
    messageEl.classList.add('form__message--error');
  }
}

function handleUnauthorized() {
  clearAuth('Tu sesión expiró, vuelve a ingresar.', 'error');
}

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!authToken) {
      handleUnauthorized();
      return;
    }

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify(payload)
      });

      if (response.status === 401) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Error al registrar el pago' }));
        throw new Error(errorData.message || 'Error al registrar el pago');
      }

      const { payment } = await response.json();
      payments = [payment, ...payments];
      renderPayments();
      showMessage('Pago registrado correctamente', 'success');
      resetForm();
    } catch (error) {
      showMessage(error.message, 'error');
    }
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const payload = Object.fromEntries(formData.entries());
    payload.email = String(payload.email || '').trim();

    const defaultText = loginSubmit.textContent;
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Validando...';
    showLoginMessage('Comprobando credenciales...', 'info');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'No se pudo iniciar sesión' }));
        throw new Error(errorData.message || 'No se pudo iniciar sesión');
      }

      const data = await response.json();
      setAuth(data.token, data.user);
      showLoginMessage('Ingreso exitoso. Cargando panel...', 'success');
      payments = [];
      renderPayments();
      loginForm.reset();
      await loadPayments();
    } catch (error) {
      authToken = '';
      currentUser = null;
      localStorage.removeItem('authToken');
      updateSections();
      showLoginMessage(error.message, 'error');
      const passwordInput = loginForm.querySelector('input[name="password"]');
      if (passwordInput) {
        passwordInput.value = '';
        passwordInput.focus();
      }
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = defaultText;
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener('click', async () => {
    if (!authToken) {
      clearAuth('Sesión cerrada.', 'success');
      return;
    }

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: buildAuthHeaders()
      });
    } catch (error) {
      console.warn('No se pudo cerrar sesión en el servidor', error);
    } finally {
      clearAuth('Sesión cerrada correctamente.', 'success');
    }
  });
}

if (downloadButton) {
  downloadButton.addEventListener('click', () => {
    if (!authToken) {
      handleUnauthorized();
      return;
    }

    if (!payments.length) {
      showMessage('No hay datos para exportar', 'error');
      return;
    }

    const csvHeader = ['Fecha', 'Cuenta', 'Cliente', 'Método', 'Monto', 'Notas'];
    const rows = payments.map((payment) => [
      new Date(payment.createdAt).toISOString(),
      payment.accountNumber,
      payment.customerName,
      payment.paymentMethod,
      payment.amount,
      payment.notes || ''
    ]);

    const csvContent = [csvHeader, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pagos-telecom-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
}

renderPayments();
updateSections();
validateSession();
