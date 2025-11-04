const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'payments.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function readPayments() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, '[]', 'utf8');
      return [];
    }
    throw error;
  }
}

async function writePayments(payments) {
  const json = JSON.stringify(payments, null, 2);
  await fs.writeFile(DATA_FILE, json, 'utf8');
}

app.get('/api/payments', async (req, res) => {
  try {
    const payments = await readPayments();
    res.json({ payments });
  } catch (error) {
    console.error('Error reading payments', error);
    res.status(500).json({ message: 'Error al obtener los pagos' });
  }
});

app.post('/api/payments', async (req, res) => {
  const { accountNumber, customerName, amount, paymentMethod, notes } = req.body;

  if (!accountNumber || !customerName || !amount || !paymentMethod) {
    return res.status(400).json({ message: 'Faltan campos obligatorios' });
  }

  const parsedAmount = Number(amount);
  if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ message: 'El monto debe ser un número positivo' });
  }

  const newPayment = {
    id: crypto.randomUUID(),
    accountNumber,
    customerName,
    amount: parsedAmount,
    paymentMethod,
    notes: notes || '',
    createdAt: new Date().toISOString()
  };

  try {
    const payments = await readPayments();
    payments.unshift(newPayment);
    await writePayments(payments);
    res.status(201).json({ payment: newPayment });
  } catch (error) {
    console.error('Error saving payment', error);
    res.status(500).json({ message: 'Error al registrar el pago' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
