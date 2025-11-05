'use strict';

const footerYear = document.getElementById('year');
if (footerYear) {
  footerYear.textContent = new Date().getFullYear();
}

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginMessageEl = document.getElementById('login-message');
const registerMessageEl = document.getElementById('register-message');
const loginSubmit = document.getElementById('login-submit');
const registerSubmit = document.getElementById('register-submit');
const authCard = document.getElementById('auth-card');
const authTabs = document.querySelectorAll('[data-auth-tab]');
const authPanels = document.querySelectorAll('[data-auth-panel]');
const paymentSections = document.querySelectorAll('[data-section="payments"]');
const userPanel = document.getElementById('user-panel');
const userEmailEl = document.getElementById('user-email');
const userLastLoginEl = document.getElementById('user-last-login');
const userAvatarEl = document.getElementById('user-avatar');
const logoutButton = document.getElementById('logout-button');
const paymentForm = document.getElementById('payment-form');
const paymentMessageEl = document.getElementById('form-message');
const tableBody = document.getElementById('payments-table-body');
const downloadButton = document.getElementById('download-button');

let activeAuthMode = 'login';
let payments = [];
let authToken = localStorage.getItem('authToken') || '';
let currentUser = null;

function buildAuthHeaders(extra = {}) {
  return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : { ...extra };
}

function setFormMessage(element, message = '', type = 'info') {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.className = 'form__message';

  if (!message) {
    return;
  }

  if (type === 'success') {
    element.classList.add('form__message--success');
  }

  if (type === 'error') {
    element.classList.add('form__message--error');
  }
}

function switchAuthMode(mode) {
  activeAuthMode = mode;

  authTabs.forEach((tab) => {
    const isActive = tab.dataset.authTab === mode;
    tab.classList.toggle('card__tab--active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  authPanels.forEach((panel) => {
    const target = panel.dataset.authPanel;
    if (target) {
      panel.hidden = target !== mode;
    }
  });

  if (mode === 'login') {
    setFormMessage(registerMessageEl, '');
  } else {
    setFormMessage(loginMessageEl, '');
  }

  const targetForm = mode === 'login' ? loginForm : registerForm;
  const emailInput = targetForm?.querySelector('input[name="email"]');
  emailInput?.focus();
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

  if (authCard) {
    authCard.hidden = isAuthenticated;
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

  setFormMessage(loginMessageEl, '');
  setFormMessage(registerMessageEl, '');
  updateSections();
}

function clearAuth(message, type = 'info') {
  authToken = '';
  currentUser = null;
  localStorage.removeItem('authToken');

  if (loginForm) {
    loginForm.reset();
  }

  if (registerForm) {
    registerForm.reset();
  }

  setFormMessage(registerMessageEl, '');
  payments = [];
  renderPayments();
  updateSections();
  switchAuthMode('login');

  if (typeof message === 'string' && message) {
    setFormMessage(loginMessageEl, message, type);
  } else {
    setFormMessage(loginMessageEl, '');
  }
}

async function validateSession() {
  if (!authToken) {
    updateSections();
    switchAuthMode('login');
    setFormMessage(loginMessageEl, 'Inicia sesión para gestionar tus cobros.', 'info');
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
    setFormMessage(loginMessageEl, 'Sesión restaurada correctamente.', 'success');
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
    setPaymentMessage('');
  } catch (error) {
    setPaymentMessage(error.message, 'error');
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

function resetPaymentForm() {
  paymentForm.reset();
  paymentForm.accountNumber?.focus();
}

function setPaymentMessage(message, type = 'info') {
  if (!paymentMessageEl) {
    return;
  }

  paymentMessageEl.textContent = message;
  paymentMessageEl.className = 'form__message';

  if (!message) {
    return;
  }

  if (type === 'success') {
    paymentMessageEl.classList.add('form__message--success');
  }

  if (type === 'error') {
    paymentMessageEl.classList.add('form__message--error');
  }
}

function handleUnauthorized() {
  clearAuth('Tu sesión expiró, vuelve a ingresar.', 'error');
}

authTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    switchAuthMode(tab.dataset.authTab || 'login');
  });
});

if (paymentForm) {
  paymentForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!authToken) {
      handleUnauthorized();
      return;
    }

    const formData = new FormData(paymentForm);
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
      setPaymentMessage('Pago registrado correctamente', 'success');
      resetPaymentForm();
    } catch (error) {
      setPaymentMessage(error.message, 'error');
    }
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const payload = Object.fromEntries(formData.entries());
    payload.email = String(payload.email || '').trim();

    const defaultText = loginSubmit ? loginSubmit.textContent : '';
    if (loginSubmit) {
      loginSubmit.disabled = true;
      loginSubmit.textContent = 'Validando...';
    }
    setFormMessage(loginMessageEl, 'Comprobando credenciales...', 'info');

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
      setFormMessage(loginMessageEl, 'Ingreso exitoso. Cargando panel...', 'success');
      payments = [];
      renderPayments();
      loginForm.reset();
      await loadPayments();
    } catch (error) {
      authToken = '';
      currentUser = null;
      localStorage.removeItem('authToken');
      updateSections();
      setFormMessage(loginMessageEl, error.message, 'error');
      const passwordInput = loginForm.querySelector('input[name="password"]');
      if (passwordInput) {
        passwordInput.value = '';
        passwordInput.focus();
      }
    } finally {
      if (loginSubmit) {
        loginSubmit.disabled = false;
        loginSubmit.textContent = defaultText;
      }
    }
  });
}

if (registerForm) {
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(registerForm);
    const payload = Object.fromEntries(formData.entries());
    payload.email = String(payload.email || '').trim();

    if (payload.password !== payload.passwordConfirm) {
      setFormMessage(registerMessageEl, 'Las contraseñas no coinciden', 'error');
      const confirmInput = registerForm.querySelector('input[name="passwordConfirm"]');
      confirmInput?.focus();
      return;
    }

    const requestPayload = {
      email: payload.email,
      password: payload.password
    };

    const defaultText = registerSubmit ? registerSubmit.textContent : '';
    if (registerSubmit) {
      registerSubmit.disabled = true;
      registerSubmit.textContent = 'Creando...';
    }
    setFormMessage(registerMessageEl, 'Creando cuenta...', 'info');

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'No se pudo crear la cuenta' }));
        throw new Error(errorData.message || 'No se pudo crear la cuenta');
      }

      const data = await response.json();
      registerForm.reset();
      setFormMessage(registerMessageEl, '');
      switchAuthMode('login');
      if (loginForm) {
        const loginEmail = loginForm.querySelector('input[name="email"]');
        if (loginEmail) {
          loginEmail.value = data.user?.email || requestPayload.email;
        }
        const loginPassword = loginForm.querySelector('input[name="password"]');
        loginPassword?.focus();
      }

      setFormMessage(loginMessageEl, 'Cuenta creada. Ahora inicia sesión.', 'success');
    } catch (error) {
      setFormMessage(registerMessageEl, error.message, 'error');
    } finally {
      if (registerSubmit) {
        registerSubmit.disabled = false;
        registerSubmit.textContent = defaultText;
      }
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
      setPaymentMessage('No hay datos para exportar', 'error');
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

switchAuthMode('login');
renderPayments();
updateSections();
validateSession();
