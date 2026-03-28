/**
 * Basel Furniture Installation — Backend
 * Stack: Node.js + Express + MongoDB Atlas (on Railway) / JSON file (local) + Nodemailer
 */

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
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

// ── Admin Auth ─────────────────────────────────────────────
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'basel-admin-2026';

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function now() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// ── DB: MongoDB or JSON fallback ───────────────────────────
const MONGO_URL = process.env.MONGO_URL;
let usesMongo = false;
let db;

async function initDB() {
  if (MONGO_URL) {
    const { MongoClient, ServerApiVersion } = require('mongodb');
    const client = new MongoClient(MONGO_URL, {
      serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
    });
    await client.connect();
    db = client.db('basel');
    usesMongo = true;
    console.log('✅  MongoDB connected!');
  } else {
    console.log('📁  Using local JSON database');
  }
}

// ── JSON fallback helpers ──────────────────────────────────
const fs = require('fs');
const DB_FILE = path.join(__dirname, 'basel-db.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ bookings: [], reviews: [], nextBookingId: 1, nextReviewId: 1 }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── Confirmation message builder ───────────────────────────
function buildMessage(booking) {
  return [
    'Sehr geehrte/r ' + booking.name + ',',
    '',
    'Ihr Möbelmontage-Termin wurde bestätigt.',
    '',
    '📋 Leistung: ' + booking.service,
    booking.date    ? '📅 Datum: ' + booking.date       : null,
    booking.address ? '📍 Adresse: ' + booking.address  : null,
    booking.details ? '📝 Details: ' + booking.details  : null,
    '',
    'Bei Fragen stehen wir Ihnen gerne zur Verfügung.',
    '',
    'Basel Möbelmontage',
    '+41 XX XXX XX XX'
  ].filter(l => l !== null).join('\n');
}

// ══════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ══════════════════════════════════════════════════════════

app.get('/reviews', async (req, res) => {
  try {
    if (usesMongo) {
      const reviews = await db.collection('reviews').find({ approved: 1 }).sort({ created_at: -1 }).toArray();
      return res.json(reviews.map(r => ({ ...r, id: r._id.toString() })));
    }
    const data = loadDB();
    res.json(data.reviews.filter(r => r.approved === 1).reverse());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/reviews', async (req, res) => {
  const { name, text } = req.body;
  if (!name || !text) return res.status(400).json({ error: 'name and text required' });
  try {
    if (usesMongo) {
      const result = await db.collection('reviews').insertOne({ name: name.trim(), text: text.trim(), approved: 0, created_at: now() });
      return res.status(201).json({ id: result.insertedId, message: 'Bewertung eingereicht' });
    }
    const data = loadDB();
    const review = { id: data.nextReviewId++, name: name.trim(), text: text.trim(), approved: 0, created_at: now() };
    data.reviews.push(review);
    saveDB(data);
    res.status(201).json({ id: review.id, message: 'Bewertung eingereicht' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/book', async (req, res) => {
  const { name, countryCode, phone, contactMethod, email, service, date, address, details } = req.body;
  if (!name || !phone || !service) return res.status(400).json({ error: 'name, phone and service required' });
  const booking = {
    name: name.trim(),
    countryCode: (countryCode || '+41').trim(),
    phone: phone.trim(),
    contactMethod: contactMethod || 'whatsapp',
    email: (email || '').trim(),
    service: service.trim(),
    date: (date || '').trim(),
    address: (address || '').trim(),
    details: (details || '').trim(),
    status: 'pending',
    created_at: now()
  };
  try {
    if (usesMongo) {
      const result = await db.collection('bookings').insertOne(booking);
      return res.status(201).json({ id: result.insertedId, message: 'Anfrage erhalten' });
    }
    const data = loadDB();
    booking.id = data.nextBookingId++;
    data.bookings.push(booking);
    saveDB(data);
    res.status(201).json({ id: booking.id, message: 'Anfrage erhalten' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════════════════════

app.get('/admin/bookings', requireAdmin, async (req, res) => {
  try {
    if (usesMongo) {
      const { ObjectId } = require('mongodb');
      const filter = req.query.status ? { status: req.query.status } : {};
      const bookings = await db.collection('bookings').find(filter).sort({ created_at: -1 }).toArray();
      return res.json(bookings.map(b => ({ ...b, id: b._id.toString() })));
    }
    const data = loadDB();
    const result = req.query.status ? data.bookings.filter(b => b.status === req.query.status) : data.bookings;
    res.json([...result].reverse());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/admin/bookings/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'confirmed', 'done', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  try {
    let booking;
    if (usesMongo) {
      const { ObjectId } = require('mongodb');
      booking = await db.collection('bookings').findOneAndUpdate(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } },
        { returnDocument: 'after' }
      );
      if (!booking) return res.status(404).json({ error: 'Not found' });
    } else {
      const data = loadDB();
      booking = data.bookings.find(b => b.id === Number(req.params.id));
      if (!booking) return res.status(404).json({ error: 'Not found' });
      booking.status = status;
      saveDB(data);
    }

    let emailSent = false;
    let whatsappLink = null;

    if (status === 'confirmed') {
      const fullPhone = (booking.countryCode + booking.phone).replace(/\s+/g, '');
      const msgLines = buildMessage(booking);

      if (booking.email) {
        try {
          await transporter.sendMail({
            from:    '"Basel Möbelmontage" <iserena054@gmail.com>',
            to:      booking.email,
            subject: 'Terminbestätigung — ' + booking.service,
            text:    msgLines,
            html:    msgLines.replace(/\n/g, '<br>')
          });
          emailSent = true;
        } catch (err) { console.error('Email error:', err.message); }
      }
      whatsappLink = 'https://wa.me/' + fullPhone.replace('+', '') + '?text=' + encodeURIComponent(msgLines);
    }

    res.json({ message: 'Aktualisiert', emailSent, whatsappLink });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/admin/bookings/:id', requireAdmin, async (req, res) => {
  try {
    if (usesMongo) {
      const { ObjectId } = require('mongodb');
      await db.collection('bookings').deleteOne({ _id: new ObjectId(req.params.id) });
      return res.json({ message: 'Gelöscht' });
    }
    const data = loadDB();
    const idx = data.bookings.findIndex(b => b.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data.bookings.splice(idx, 1);
    saveDB(data);
    res.json({ message: 'Gelöscht' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/reviews', requireAdmin, async (req, res) => {
  try {
    if (usesMongo) {
      const filter = req.query.approved !== undefined ? { approved: Number(req.query.approved) } : {};
      const reviews = await db.collection('reviews').find(filter).sort({ created_at: -1 }).toArray();
      return res.json(reviews.map(r => ({ ...r, id: r._id.toString() })));
    }
    const data = loadDB();
    const result = req.query.approved !== undefined ? data.reviews.filter(r => r.approved === Number(req.query.approved)) : data.reviews;
    res.json([...result].reverse());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/admin/reviews/:id', requireAdmin, async (req, res) => {
  try {
    if (usesMongo) {
      const { ObjectId } = require('mongodb');
      await db.collection('reviews').findOneAndUpdate(
        { _id: new ObjectId(req.params.id) },
        { $set: { approved: Number(req.body.approved) } }
      );
      return res.json({ message: req.body.approved ? 'Freigegeben' : 'Versteckt' });
    }
    const data = loadDB();
    const review = data.reviews.find(r => r.id === Number(req.params.id));
    if (!review) return res.status(404).json({ error: 'Not found' });
    review.approved = Number(req.body.approved);
    saveDB(data);
    res.json({ message: review.approved ? 'Freigegeben' : 'Versteckt' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/admin/reviews/:id', requireAdmin, async (req, res) => {
  try {
    if (usesMongo) {
      const { ObjectId } = require('mongodb');
      await db.collection('reviews').deleteOne({ _id: new ObjectId(req.params.id) });
      return res.json({ message: 'Gelöscht' });
    }
    const data = loadDB();
    const idx = data.reviews.findIndex(r => r.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data.reviews.splice(idx, 1);
    saveDB(data);
    res.json({ message: 'Gelöscht' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    if (usesMongo) {
      const [totalBookings, pendingBookings, totalReviews, pendingReviews] = await Promise.all([
        db.collection('bookings').countDocuments(),
        db.collection('bookings').countDocuments({ status: 'pending' }),
        db.collection('reviews').countDocuments(),
        db.collection('reviews').countDocuments({ approved: 0 })
      ]);
      return res.json({ totalBookings, pendingBookings, totalReviews, pendingReviews });
    }
    const data = loadDB();
    res.json({
      totalBookings:   data.bookings.length,
      pendingBookings: data.bookings.filter(b => b.status === 'pending').length,
      totalReviews:    data.reviews.length,
      pendingReviews:  data.reviews.filter(r => r.approved === 0).length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Start ──────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('\n✅  Basel backend running!');
    console.log('🌐  Website:  http://localhost:' + PORT + '/index.html');
    console.log('🔧  Admin:    http://localhost:' + PORT + '/admin.html');
    console.log('🔑  Token:    ' + ADMIN_TOKEN + '\n');
  });
}).catch(err => {
  console.error('❌  Startup failed:', err.message);
  process.exit(1);
});
