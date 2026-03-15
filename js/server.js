// js/server.js

// ---------- IMPORTS ----------
const fs = require('fs');
const path = require('path');

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadLocalEnvFile();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const cron = require('node-cron');

// ---------- CONFIG ----------
const PORT = process.env.PORT || 3000;

// Gmail for sending confirmation emails
const EMAIL_USER = process.env.GMAIL_USER;
const EMAIL_PASS = process.env.GMAIL_PASS;

// Google Sheet
const SHEET_ID = process.env.SHEET_ID;

// Google Service Account
const GOOGLE_CREDS = {
  type: process.env.GOOGLE_TYPE,
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLIENT_ID,
  auth_uri: process.env.GOOGLE_AUTH_URI,
  token_uri: process.env.GOOGLE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_CERT_URL,
  client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
};

// ---------- EXPRESS APP ----------
const app = express();

// CORS for your frontend live URL
app.use(cors({
  origin: 'https://elysiumsolluna.onrender.com'
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..')));

// ---------- EMAIL TRANSPORT ----------
// FIXED for Render
const emailConfigured = Boolean(EMAIL_USER && EMAIL_PASS);

const transporter = emailConfigured
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,        // use STARTTLS
      secure: false,    // false = STARTTLS
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
      family: 4         // force IPv4
    })
  : null;

if (!emailConfigured) {
  console.warn('[Email] GMAIL_USER or GMAIL_PASS is missing. Booking confirmations are disabled.');
} else {
  transporter.verify()
    .then(() => console.log('[Email] SMTP connection is ready.'))
    .catch((err) => console.error('[Email] SMTP verification failed:', err.message));
}

async function sendEmail(mailOptions) {
  if (!transporter) return { sent: false, reason: 'Email credentials are missing' };

  try {
    await transporter.sendMail(mailOptions);
    return { sent: true };
  } catch (err) {
    console.error('[Email] send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

// ---------- JSON BACKUP FILES ----------
const bookingsFile = path.join(__dirname, 'bookings.json');
const vipFile = path.join(__dirname, 'vipBookings.json');

if (!fs.existsSync(bookingsFile)) fs.writeFileSync(bookingsFile, JSON.stringify([]));
if (!fs.existsSync(vipFile)) fs.writeFileSync(vipFile, JSON.stringify([]));

// ---------- HELPER: GOOGLE SHEET ----------
async function saveToSheet(booking, isVIP = false) {
  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(GOOGLE_CREDS);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[isVIP ? 'VIP Bookings' : 'Regular Bookings'];
    if (!sheet) throw new Error(`Sheet "${isVIP ? 'VIP Bookings' : 'Regular Bookings'}" not found`);
    await sheet.addRow(booking);
  } catch (err) {
    console.error("Google Sheet save failed:", err.message);
  }
}

// ---------- TEST EMAIL ----------
app.get('/test-email', async (req, res) => {
  const result = await sendEmail({
    from: EMAIL_USER,
    to: EMAIL_USER,
    subject: 'Test Email from ELYSIUM',
    text: 'This is a test email to confirm SMTP is working!'
  });

  if (result.sent) return res.send('Test email sent! Check your inbox.');
  return res.status(500).send(`Test email failed: ${result.reason}`);
});

// ---------- API: GET BOOKINGS ----------
app.get('/bookings', (req, res) => {
  res.json(JSON.parse(fs.readFileSync(bookingsFile)));
});
app.get('/vipBookings', (req, res) => {
  res.json(JSON.parse(fs.readFileSync(vipFile)));
});

// ---------- API: POST BOOKING ----------
app.post('/book', async (req, res) => {
  try {
    const bookings = JSON.parse(fs.readFileSync(bookingsFile));
    const conflict = bookings.find(b => b.barber === req.body.barber && b.date === req.body.date && b.time === req.body.time);
    if (conflict) return res.status(400).json({ message: "Barber already booked." });

    bookings.push(req.body);
    fs.writeFileSync(bookingsFile, JSON.stringify(bookings, null, 2));

    await saveToSheet({
      Name: req.body.name,
      Email: req.body.email,
      Service: req.body.service,
      Barber: req.body.barber,
      Date: req.body.date,
      Time: req.body.time
    });

    const emailResult = await sendEmail({
      from: EMAIL_USER,
      to: req.body.email,
      subject: 'Booking Confirmation – ELYSIUM',
      html: `<h2>Dear ${req.body.name}</h2>
             <p>Your appointment is confirmed:</p>
             <ul>
               <li><b>Service:</b> ${req.body.service}</li>
               <li><b>Barber:</b> ${req.body.barber}</li>
               <li><b>Date:</b> ${req.body.date}</li>
               <li><b>Time:</b> ${req.body.time}</li>
             </ul>`
    });

    if (!emailResult.sent) {
      return res.status(202).json({
        message: `Booking saved, but confirmation email could not be sent (${emailResult.reason}).`
      });
    }

    res.json({ message: 'Booking saved and email sent!' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Booking failed." });
  }
});

// ---------- API: POST VIP BOOKING ----------
app.post('/vip', async (req, res) => {
  try {
    const vipBookings = JSON.parse(fs.readFileSync(vipFile));
    const conflict = vipBookings.find(b => b.barber === req.body.barber && b.date === req.body.date && b.time === req.body.time);
    if (conflict) return res.status(400).json({ message: "VIP slot already booked." });

    vipBookings.push(req.body);
    fs.writeFileSync(vipFile, JSON.stringify(vipBookings, null, 2));

    await saveToSheet({
      Name: req.body.name,
      Email: req.body.email,
      Date: req.body.date,
      Time: req.body.time
    }, true);

    const emailResult = await sendEmail({
      from: EMAIL_USER,
      to: req.body.email,
      subject: 'VIP Booking Confirmation – ELYSIUM',
      html: `<h2>Dear ${req.body.name}</h2>
             <p>Your VIP appointment is confirmed:</p>
             <ul>
               <li><b>Date:</b> ${req.body.date}</li>
               <li><b>Time:</b> ${req.body.time}</li>
             </ul>`
    });

    if (!emailResult.sent) {
      return res.status(202).json({
        message: `VIP booking saved, but confirmation email could not be sent (${emailResult.reason}).`
      });
    }

    res.json({ message: 'VIP booking saved and email sent!' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "VIP booking failed." });
  }
});

// ---------- ADMIN DASHBOARD ----------
app.get('/admin', (req, res) => {
  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  const vipBookings = JSON.parse(fs.readFileSync(vipFile));
  res.send(`<h1>Admin Dashboard</h1>
            <h2>Bookings</h2><pre>${JSON.stringify(bookings, null, 2)}</pre>
            <h2>VIP Bookings</h2><pre>${JSON.stringify(vipBookings, null, 2)}</pre>`);
});

// ---------- REMINDERS ----------
function checkReminders() {
  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  const now = new Date();
  bookings.forEach(b => {
    const appointment = new Date(`${b.date}T${b.time}`);
    const diff = (appointment - now) / (1000 * 60 * 60);
    if (diff > 2.9 && diff < 3.1) {
      sendEmail({
        from: EMAIL_USER,
        to: b.email,
        subject: 'Reminder – Your ELYSIUM Appointment',
        html: `<h2>Hello ${b.name}</h2><p>Your appointment is in ~3 hours.</p>`
      }).then((result) => {
        if (result.sent) console.log('Reminder sent');
      });
    }
  });
}
cron.schedule('*/10 * * * *', checkReminders);

// ---------- ERROR HANDLING ----------
process.on('unhandledRejection', (reason, p) => console.error('Unhandled Rejection:', reason, p));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

// ---------- START SERVER ----------
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));