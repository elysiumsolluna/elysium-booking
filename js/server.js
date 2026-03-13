// js/server.js

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const cron = require('node-cron');

// ---------- CONFIG ----------
const PORT = process.env.PORT || 3000;
const EMAIL_USER = process.env.GMAIL_USER;
const EMAIL_PASS = process.env.GMAIL_PASS;
const SHEET_ID = process.env.SHEET_ID;

// GOOGLE CREDS reconstruction
const GOOGLE_CREDS = {
  type: process.env.GOOGLE_TYPE,
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : null,
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLIENT_ID,
  auth_uri: process.env.GOOGLE_AUTH_URI,
  token_uri: process.env.GOOGLE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_CERT_URL,
  client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
};

// ---------- DEBUG LOG ----------
console.log("===== STARTUP ENV CHECK =====");
console.log("PORT:", PORT);
console.log("GMAIL_USER:", EMAIL_USER ? "SET" : "MISSING");
console.log("GMAIL_PASS:", EMAIL_PASS ? "SET" : "MISSING");
console.log("SHEET_ID:", SHEET_ID ? "SET" : "MISSING");
console.log("GOOGLE_PRIVATE_KEY:", GOOGLE_CREDS.private_key ? "SET" : "MISSING");
console.log("GOOGLE_CLIENT_EMAIL:", GOOGLE_CREDS.client_email ? "SET" : "MISSING");
console.log("=============================");

// ---------- VALIDATE ----------
let missingVars = [];
if (!EMAIL_USER) missingVars.push("GMAIL_USER");
if (!EMAIL_PASS) missingVars.push("GMAIL_PASS");
if (!SHEET_ID) missingVars.push("SHEET_ID");
if (!GOOGLE_CREDS.private_key) missingVars.push("GOOGLE_PRIVATE_KEY");
if (!GOOGLE_CREDS.client_email) missingVars.push("GOOGLE_CLIENT_EMAIL");

if (missingVars.length > 0) {
  console.error("Missing required environment variables:", missingVars.join(", "));
  console.error("Deployment will not start until these are set.");
  process.exit(1);
}

const creds = GOOGLE_CREDS;

// ---------- EXPRESS APP ----------
const app = express();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

// Serve static files
app.use(express.static(path.join(__dirname, '..')));
app.use(cors());
app.use(bodyParser.json());

// JSON backup files
const bookingsFile = path.join(__dirname, 'bookings.json');
const vipFile = path.join(__dirname, 'vipBookings.json');

if (!fs.existsSync(bookingsFile)) fs.writeFileSync(bookingsFile, JSON.stringify([]));
if (!fs.existsSync(vipFile)) fs.writeFileSync(vipFile, JSON.stringify([]));

// ---------- HELPER: Google Sheet ----------
async function saveToSheet(booking, isVIP = false) {
  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    const sheetTitle = isVIP ? 'VIP Bookings' : 'Regular Bookings';
    const sheet = doc.sheetsByTitle[sheetTitle];
    if (!sheet) throw new Error(`Sheet "${sheetTitle}" not found`);
    await sheet.addRow(booking);
  } catch (err) {
    console.error("Google Sheet save failed:", err.message);
  }
}

// ---------- API ----------
// GET bookings
app.get('/bookings', (req, res) => {
  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  res.json(bookings);
});
app.get('/vipBookings', (req, res) => {
  const vipBookings = JSON.parse(fs.readFileSync(vipFile));
  res.json(vipBookings);
});

// POST regular booking
app.post('/book', async (req, res) => {
  try {
    const bookings = JSON.parse(fs.readFileSync(bookingsFile));
    const conflict = bookings.find(b =>
      b.barber === req.body.barber && b.date === req.body.date && b.time === req.body.time
    );
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

    try {
      await transporter.sendMail({
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
    } catch (err) {
      console.error("Email send failed:", err.message);
    }

    res.json({ message: "Booking saved and email sent!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Booking failed." });
  }
});

// POST VIP booking
app.post('/vip', async (req, res) => {
  try {
    const vipBookings = JSON.parse(fs.readFileSync(vipFile));
    const conflict = vipBookings.find(b =>
      b.barber === req.body.barber && b.date === req.body.date && b.time === req.body.time
    );
    if (conflict) return res.status(400).json({ message: "Barber already booked." });

    vipBookings.push(req.body);
    fs.writeFileSync(vipFile, JSON.stringify(vipBookings, null, 2));

    await saveToSheet({
      Name: req.body.name,
      Email: req.body.email,
      Date: req.body.date,
      Time: req.body.time
    }, true);

    try {
      await transporter.sendMail({
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
    } catch (err) {
      console.error("VIP email send failed:", err.message);
    }

    res.json({ message: "VIP booking saved and email sent!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "VIP booking failed." });
  }
});

// ---------- Admin Dashboard ----------
app.get('/admin', (req, res) => {
  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  const vipBookings = JSON.parse(fs.readFileSync(vipFile));
  res.send(`<h1>Admin Dashboard</h1>
            <h2>Bookings</h2><pre>${JSON.stringify(bookings, null, 2)}</pre>
            <h2>VIP Bookings</h2><pre>${JSON.stringify(vipBookings, null, 2)}</pre>`);
});

// ---------- Reminders ----------
function checkReminders() {
  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  const now = new Date();
  bookings.forEach(b => {
    const appointment = new Date(`${b.date}T${b.time}`);
    const diff = (appointment - now) / (1000 * 60 * 60);
    if (diff > 2.9 && diff < 3.1) {
      transporter.sendMail({
        from: EMAIL_USER,
        to: b.email,
        subject: 'Reminder – Your ELYSIUM Appointment',
        html: `<h2>Hello ${b.name}</h2>
               <p>Your appointment at ELYSIUM is in ~3 hours.</p>`
      }).then(() => console.log("Reminder sent")).catch(err => console.log(err.message));
    }
  });
}
cron.schedule('*/10 * * * *', checkReminders);

// ---------- Global error handling ----------
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at Promise:', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// ---------- Start Server ----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});