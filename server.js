/**
 * Basel Furniture Installation — Backend
 * Stack: Node.js + Express + JSON file + Nodemailer
 */

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Email setup ────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'iserena054@gmail.com',
    pass: 'lpwhqyfqkexdjdiu'
  }
});

// ── JSON database ──────────────────────────────────────────
const DB_FILE = path.join(__dirname, 'basel-db.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const empty = { bookings: [], reviews: [], nextBookingId: 1, nextReviewId: 1 };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function now() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// ── Admin Auth ─────────────────────────────────────────────
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'basel-admin-2026';

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ══════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ══════════════════════════════════════════════════════════

app.get('/reviews', (req, res) => {
  const db = loadDB();
  res.json(db.reviews.filter(r => r.approved === 1).reverse());
});

app.post('/reviews', (req, res) => {
  const { name, text } = req.body;
  if (!name || !text) return res.status(400).json({ error: 'name and text required' });
  const db = loadDB();
  const review = {
    id: db.nextReviewId++,
    name: name.trim(),
    text: text.trim(),
    approved: 0,
    created_at: now()
  };
  db.reviews.push(review);
  saveDB(db);
  res.status(201).json({ id: review.id, message: 'Review submitted for approval' });
});

app.post('/book', (req, res) => {
  const { name, countryCode, phone, contactMethod, email, service, date, address, details } = req.body;
  if (!name || !phone || !service) return res.status(400).json({ error: 'name, phone and service required' });
  const db = loadDB();
  const booking = {
    id: db.nextBookingId++,
    name:          name.trim(),
    countryCode:   (countryCode || '+41').trim(),
    phone:         phone.trim(),
    contactMethod: contactMethod || 'whatsapp',
    email:         (email || '').trim(),
    service:       service.trim(),
    date:          (date || '').trim(),
    address:       (address || '').trim(),
    details:       (details || '').trim(),
    status:        'pending',
    created_at:    now()
  };
  db.bookings.push(booking);
  saveDB(db);
  res.status(201).json({ id: booking.id, message: 'Booking received' });
});

// ══════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════════════════════

app.get('/admin/bookings', requireAdmin, (req, res) => {
  const db = loadDB();
  const { status } = req.query;
  const result = status ? db.bookings.filter(b => b.status === status) : db.bookings;
  res.json([...result].reverse());
});

app.patch('/admin/bookings/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'confirmed', 'done', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const db = loadDB();
  const booking = db.bookings.find(b => b.id === Number(req.params.id));
  if (!booking) return res.status(404).json({ error: 'Not found' });

  booking.status = status;
  saveDB(db);

  let emailSent = false;
  let whatsappLink = null;

  if (status === 'confirmed') {
    const fullPhone = (booking.countryCode + booking.phone).replace(/\s+/g, '');

    const msgLines = [
      `Dear ${booking.name},`,
      ``,
      `Your furniture installation appointment has been confirmed.`,
      ``,
      `📋 Service: ${booking.service}`,
      booking.date    ? `📅 Date: ${booking.date}`       : null,
      booking.address ? `📍 Address: ${booking.address}` : null,
      booking.details ? `📝 Details: ${booking.details}` : null,
      ``,
      `If you have any questions, feel free to contact us.`,
      ``,
      `Basel Furniture Installation`,
      `+41 XX XXX XX XX`
    ].filter(l => l !== null).join('\n');

    if (booking.email) {
      try {
        await transporter.sendMail({
          from:    '"Basel Furniture Installation" <iserena054@gmail.com>',
          to:      booking.email,
          subject: `Booking Confirmed — ${booking.service}`,
          text:    msgLines,
          html:    msgLines.replace(/\n/g, '<br>')
        });
        emailSent = true;
      } catch (err) {
        console.error('Email error:', err.message);
      }
    }

    whatsappLink = `https://wa.me/${fullPhone.replace('+', '')}?text=${encodeURIComponent(msgLines)}`;
  }

  res.json({ message: 'Updated', emailSent, whatsappLink });
});

app.delete('/admin/bookings/:id', requireAdmin, (req, res) => {
  const db = loadDB();
  const idx = db.bookings.findIndex(b => b.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.bookings.splice(idx, 1);
  saveDB(db);
  res.json({ message: 'Deleted' });
});

app.get('/admin/reviews', requireAdmin, (req, res) => {
  const db = loadDB();
  const { approved } = req.query;
  const result = approved !== undefined
    ? db.reviews.filter(r => r.approved === Number(approved))
    : db.reviews;
  res.json([...result].reverse());
});

app.patch('/admin/reviews/:id', requireAdmin, (req, res) => {
  const db = loadDB();
  const review = db.reviews.find(r => r.id === Number(req.params.id));
  if (!review) return res.status(404).json({ error: 'Not found' });
  review.approved = Number(req.body.approved);
  saveDB(db);
  res.json({ message: review.approved ? 'Approved' : 'Hidden' });
});

app.delete('/admin/reviews/:id', requireAdmin, (req, res) => {
  const db = loadDB();
  const idx = db.reviews.findIndex(r => r.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.reviews.splice(idx, 1);
  saveDB(db);
  res.json({ message: 'Deleted' });
});

app.get('/admin/stats', requireAdmin, (req, res) => {
  const db = loadDB();
  res.json({
    totalBookings:   db.bookings.length,
    pendingBookings: db.bookings.filter(b => b.status === 'pending').length,
    totalReviews:    db.reviews.length,
    pendingReviews:  db.reviews.filter(r => r.approved === 0).length,
  });
});

app.listen(PORT, () => {
  console.log(`\n✅  Basel backend running!`);
  console.log(`🌐  Website:  http://localhost:${PORT}/index.html`);
  console.log(`🔧  Admin:    http://localhost:${PORT}/admin.html`);
  console.log(`🔑  Token:    ${ADMIN_TOKEN}\n`);
});
