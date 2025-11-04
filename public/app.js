'use strict';

const form = document.getElementById('payment-form');
const messageEl = document.getElementById('form-message');
const tableBody = document.getElementById('payments-table-body');
const downloadButton = document.getElementById('download-button');
const footerYear = document.getElementById('year');

let payments = [];

footerYear.textContent = new Date().getFullYear();

async function loadPayments() {
  try {
    const response = await fetch('/api/payments');
    if (!response.ok) {
      throw new Error('No se pudo obtener el historial');
    }
    const data = await response.json();
    payments = data.payments || [];
    renderPayments();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function renderPayments() {
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
  messageEl.textContent = message;
  messageEl.className = 'form__message';
  if (type === 'success') {
    messageEl.classList.add('form__message--success');
  }
  if (type === 'error') {
    messageEl.classList.add('form__message--error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

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

downloadButton.addEventListener('click', () => {
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

loadPayments();
