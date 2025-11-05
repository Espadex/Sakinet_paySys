const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PAYMENTS_FILE = path.join(__dirname, 'data', 'payments.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const SESSIONS_FILE = path.join(__dirname, 'data', 'sessions.json');
const LOGIN_AUDIT_FILE = path.join(__dirname, 'data', 'login-audit.json');
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function cloneDefault(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

async function readJson(filePath, defaultValue) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const fallback = cloneDefault(defaultValue);
      await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), 'utf8');
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');
}

const readPayments = () => readJson(PAYMENTS_FILE, []);
const writePayments = (payments) => writeJson(PAYMENTS_FILE, payments);
const readUsers = () => readJson(USERS_FILE, []);
const writeUsers = (users) => writeJson(USERS_FILE, users);
const readSessions = () => readJson(SESSIONS_FILE, []);
const writeSessions = (sessions) => writeJson(SESSIONS_FILE, sessions);
const readLoginAudit = () => readJson(LOGIN_AUDIT_FILE, []);
const writeLoginAudit = (entries) => writeJson(LOGIN_AUDIT_FILE, entries);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, { salt, passwordHash }) {
  if (!salt || !passwordHash) {
    return false;
  }

  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  const provided = Buffer.from(hash, 'hex');
  const stored = Buffer.from(passwordHash, 'hex');

  if (provided.length !== stored.length) {
    return false;
  }

  return crypto.timingSafeEqual(provided, stored);
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    loginCount: user.loginCount || 0
  };
}

async function logLoginAttempt(entry) {
  const records = await readLoginAudit();
  records.unshift({
    id: crypto.randomUUID(),
    email: entry.email,
    userId: entry.userId || null,
    status: entry.status,
    createdAt: new Date().toISOString()
  });
  const capped = records.slice(0, 1000);
  await writeLoginAudit(capped);
}

async function createSession(userId) {
  const sessions = await readSessions();
  const now = new Date();
  const session = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    userId,
    createdAt: now.toISOString(),
    lastAccessAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  };
  sessions.push(session);
  await writeSessions(sessions);
  return session;
}

async function clearExpiredSessions(existingSessions) {
  const now = Date.now();
  const active = existingSessions.filter((session) => Date.parse(session.expiresAt) > now);
  if (active.length !== existingSessions.length) {
    await writeSessions(active);
  }
  return active;
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No autorizado' });
  }

  const token = header.slice(7).trim();

  try {
    const sessions = await clearExpiredSessions(await readSessions());
    const activeSession = sessions.find((session) => session.token === token);

    if (!activeSession) {
      return res.status(401).json({ message: 'Sesión inválida o expirada' });
    }

    const users = await readUsers();
    const user = users.find((candidate) => candidate.id === activeSession.userId);

    if (!user) {
      const filtered = sessions.filter((session) => session.token !== token);
      await writeSessions(filtered);
      return res.status(401).json({ message: 'Usuario no encontrado' });
    }

    activeSession.lastAccessAt = new Date().toISOString();
    await writeSessions(sessions);

    req.user = toPublicUser(user);
    req.sessionToken = token;

    return next();
  } catch (error) {
    console.error('Error en autenticación', error);
    return res.status(500).json({ message: 'Error de autenticación' });
  }
}

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Correo y contraseña son obligatorios' });
  }

  const normalizedEmail = normalizeEmail(email);
  const passwordValue = String(password);

  if (!normalizedEmail.includes('@')) {
    return res.status(400).json({ message: 'El correo no es válido' });
  }

  if (passwordValue.length < 6) {
    return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
  }

  try {
    const users = await readUsers();
    const user = users.find((candidate) => candidate.email === normalizedEmail);

    if (!user) {
      await logLoginAttempt({ email: normalizedEmail, userId: null, status: 'user-not-found' });
      return res.status(401).json({ message: 'Credenciales incorrectas' });
    }

    const isValid = verifyPassword(passwordValue, user);
    if (!isValid) {
      await logLoginAttempt({ email: normalizedEmail, userId: user.id, status: 'invalid-password' });
      return res.status(401).json({ message: 'Credenciales incorrectas' });
    }

    const now = new Date().toISOString();
    user.lastLoginAt = now;
    user.loginCount = (user.loginCount || 0) + 1;
    await writeUsers(users);
    await logLoginAttempt({ email: normalizedEmail, userId: user.id, status: 'login' });

    const session = await createSession(user.id);

    return res.json({
      token: session.token,
      user: toPublicUser(user)
    });
  } catch (error) {
    console.error('Error en inicio de sesión', error);
    return res.status(500).json({ message: 'No se pudo iniciar sesión' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Correo y contraseña son obligatorios' });
  }

  const normalizedEmail = normalizeEmail(email);
  const passwordValue = String(password);

  if (!normalizedEmail.includes('@')) {
    return res.status(400).json({ message: 'El correo no es válido' });
  }

  if (passwordValue.length < 6) {
    return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
  }

  try {
    const users = await readUsers();
    const exists = users.some((candidate) => candidate.email === normalizedEmail);

    if (exists) {
      return res.status(409).json({ message: 'Ya existe una cuenta con este correo' });
    }

    const now = new Date().toISOString();
    const credentials = hashPassword(passwordValue);
    const user = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      salt: credentials.salt,
      passwordHash: credentials.hash,
      createdAt: now,
      lastLoginAt: null,
      loginCount: 0
    };

    users.push(user);
    await writeUsers(users);
    await logLoginAttempt({ email: normalizedEmail, userId: user.id, status: 'register' });

    return res.status(201).json({ user: toPublicUser(user) });
  } catch (error) {
    console.error('Error registrando usuario', error);
    return res.status(500).json({ message: 'No se pudo crear la cuenta' });
  }
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
  try {
    const sessions = await readSessions();
    const filtered = sessions.filter((session) => session.token !== req.sessionToken);
    await writeSessions(filtered);
    return res.json({ message: 'Sesión cerrada' });
  } catch (error) {
    console.error('Error cerrando sesión', error);
    return res.status(500).json({ message: 'No se pudo cerrar sesión' });
  }
});

app.get('/api/auth/profile', authenticate, (req, res) => {
  return res.json({ user: req.user });
});

app.get('/api/payments', authenticate, async (req, res) => {
  try {
    const payments = await readPayments();
    const userPayments = payments.filter((payment) => payment?.createdBy?.id === req.user.id);
    res.json({ payments: userPayments });
  } catch (error) {
    console.error('Error reading payments', error);
    res.status(500).json({ message: 'Error al obtener los pagos' });
  }
});

app.post('/api/payments', authenticate, async (req, res) => {
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
    createdAt: new Date().toISOString(),
    createdBy: {
      id: req.user.id,
      email: req.user.email
    }
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
