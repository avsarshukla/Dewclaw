import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from './db.js';

const SECRET = 'dev-secret-change-me';
const app = express();
app.use(cors());
app.use(express.json());
fs.mkdirSync('uploads', { recursive: true });
app.use('/uploads', express.static('uploads'));

const upload = multer({ dest: 'uploads/' });

// ---------- helpers ----------
function sign(u) { return jwt.sign({ id: u.id, role: u.role }, SECRET); }

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'login required' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'invalid token' }); }
}

function admin(req, res, next) {
  if (req.user.role !== 'shelter_admin') return res.status(403).json({ error: 'admin only' });
  next();
}

function logActivity(dogId, text) {
  db.prepare('INSERT INTO activity (dog_id, text) VALUES (?, ?)').run(dogId, text);
}

// Auto-expire reservations on read (no background job needed)
function effectiveDog(row) {
  if (row.status === 'reserved' && row.reserved_until && new Date(row.reserved_until) < new Date()) {
    return { ...row, status: 'available', reserved_until: null };
  }
  return row;
}

// ---------- auth ----------
app.post('/api/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'all fields required' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    return res.status(400).json({ error: 'email already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const id = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run(name, email, hash, role || 'adopter').lastInsertRowid;
  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(id);
  res.json({ token: sign(user), user });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'invalid credentials' });
  const { password: _, ...safe } = user;
  res.json({ token: sign(safe), user: safe });
});

// ---------- dogs ----------
app.get('/api/dogs', (_req, res) => {
  const dogs = db.prepare('SELECT * FROM dogs ORDER BY id DESC').all().map(effectiveDog);
  res.json({ dogs });
});

app.get('/api/dogs/:id', (req, res) => {
  const dog = db.prepare('SELECT * FROM dogs WHERE id = ?').get(req.params.id);
  if (!dog) return res.status(404).json({ error: 'not found' });
  const activity = db.prepare('SELECT * FROM activity WHERE dog_id = ? ORDER BY id DESC').all(dog.id);
  res.json({ dog: effectiveDog(dog), activity });
});

app.post('/api/dogs', auth, admin, upload.single('photo'), (req, res) => {
  const { name, breed, age_months, size, temperament } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const photo = req.file ? `/uploads/${req.file.filename}` : null;
  const id = db.prepare(`INSERT INTO dogs (name, breed, age_months, size, temperament, photo, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(name, breed || null, age_months ? Number(age_months) : null,
         size || null, temperament || null, photo, req.user.id).lastInsertRowid;
  logActivity(id, 'Added to shelter');
  res.json({ dog: db.prepare('SELECT * FROM dogs WHERE id = ?').get(id) });
});

app.post('/api/dogs/:id/status', auth, admin, (req, res) => {
  const { status } = req.body;
  const dog = db.prepare('SELECT * FROM dogs WHERE id = ?').get(req.params.id);
  if (!dog) return res.status(404).json({ error: 'not found' });

  if (status === 'reserved') {
    const until = new Date(Date.now() + 14 * 86400000).toISOString();
    db.prepare('UPDATE dogs SET status = ?, reserved_until = ? WHERE id = ?').run('reserved', until, dog.id);
    logActivity(dog.id, `Reserved until ${until.slice(0, 10)}`);
  } else if (status === 'available') {
    db.prepare('UPDATE dogs SET status = ?, reserved_until = NULL WHERE id = ?').run('available', dog.id);
    logActivity(dog.id, 'Available again');
  } else if (status === 'adopted') {
    db.prepare('UPDATE dogs SET status = ?, reserved_until = NULL WHERE id = ?').run('adopted', dog.id);
    logActivity(dog.id, 'Adopted 🎉');
  } else {
    return res.status(400).json({ error: 'invalid status' });
  }
  res.json({ dog: db.prepare('SELECT * FROM dogs WHERE id = ?').get(dog.id) });
});

// ---------- applications ----------
app.post('/api/dogs/:id/apply', auth, (req, res) => {
  const dog = effectiveDog(db.prepare('SELECT * FROM dogs WHERE id = ?').get(req.params.id));
  if (!dog) return res.status(404).json({ error: 'not found' });
  if (dog.status !== 'available') return res.status(400).json({ error: 'dog is not available' });

  try {
    db.prepare('INSERT INTO applications (dog_id, user_id, message) VALUES (?, ?, ?)')
      .run(dog.id, req.user.id, req.body.message || '');
    logActivity(dog.id, 'New application received');
    res.json({ ok: true });
  } catch { res.status(400).json({ error: 'already applied' }); }
});

app.get('/api/applications/mine', auth, (req, res) => {
  const apps = db.prepare(`
    SELECT a.*, d.name as dog_name, d.status as dog_status
    FROM applications a JOIN dogs d ON d.id = a.dog_id
    WHERE a.user_id = ? ORDER BY a.id DESC
  `).all(req.user.id);
  res.json({ applications: apps });
});

app.get('/api/applications', auth, admin, (_req, res) => {
  const apps = db.prepare(`
    SELECT a.*, u.name as user_name, d.name as dog_name
    FROM applications a
    JOIN users u ON u.id = a.user_id
    JOIN dogs d ON d.id = a.dog_id
    ORDER BY a.id DESC
  `).all();
  res.json({ applications: apps });
});

// ---------- seed + boot ----------
if (db.prepare('SELECT COUNT(*) as c FROM users').get().c === 0) {
  const hash = bcrypt.hashSync('demo1234', 10);
  db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Admin', 'admin@demo.test', hash, 'shelter_admin');
  db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Adopter', 'adopter@demo.test', hash, 'adopter');
  for (const n of ['Bruno', 'Luna', 'Max']) {
    const id = db.prepare('INSERT INTO dogs (name, breed, owner_id) VALUES (?, ?, 1)').run(n, 'Indie').lastInsertRowid;
    logActivity(id, 'Added to shelter');
  }
  console.log('Seeded users: admin@demo.test, adopter@demo.test (password: demo1234)');
}

app.listen(4000, () => console.log('API → http://localhost:4000'));
