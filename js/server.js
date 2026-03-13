const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const cron = require('node-cron');
const creds = JSON.parse(process.env.GOOGLE_CREDS);

const app = express();
const PORT = 3000;

// Google Sheet ID
const SHEET_ID = '1Od160ft9-Q6X0bPmn-WScFZH1dZ5JzlI75k8PUhMDTk';

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'elysiumsolluna@gmail.com',
    pass: 'lkxydcfxdiwxpaax' // use Gmail App password
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, '../')));
app.use(cors());
app.use(bodyParser.json());

// File paths for local JSON backup
const bookingsFile = path.join(__dirname, 'bookings.json');
const vipFile = path.join(__dirname, 'vipBookings.json');

// Initialize JSON files if they don't exist
if (!fs.existsSync(bookingsFile)) fs.writeFileSync(bookingsFile, JSON.stringify([]));
if (!fs.existsSync(vipFile)) fs.writeFileSync(vipFile, JSON.stringify([]));

// --- Helper: Save booking to Google Sheet ---
async function saveToSheet(booking, isVIP = false) {
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();

  const sheetTitle = isVIP ? 'VIP Bookings' : 'Regular Bookings';
  const sheet = doc.sheetsByTitle[sheetTitle];
  if (!sheet) throw new Error(`Sheet "${sheetTitle}" not found!`);

  await sheet.addRow(booking);
}

// --- API: Get all bookings ---
app.get('/bookings', (req, res) => {
  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  res.json(bookings);
});

app.get('/vipBookings', (req, res) => {
  const vipBookings = JSON.parse(fs.readFileSync(vipFile));
  res.json(vipBookings);
});

// --- API: Add regular booking ---
app.post('/book', async (req, res) => {
  try {
    const bookings = JSON.parse(fs.readFileSync(bookingsFile));

    // Check for time conflict
    const conflict = bookings.find(b =>
      b.barber === req.body.barber &&
      b.date === req.body.date &&
      b.time === req.body.time
    );

    if (conflict) return res.status(400).json({
      message: `Sorry, ${req.body.barber} is already booked on ${req.body.date} at ${req.body.time}.`
    });

    bookings.push(req.body);
    fs.writeFileSync(bookingsFile, JSON.stringify(bookings, null, 2));

    // Save to Google Sheet
    await saveToSheet({
      Name: req.body.name,
      Email: req.body.email,
      Service: req.body.service,
      Barber: req.body.barber,
      Date: req.body.date,
      Time: req.body.time
    });

    // Send confirmation email
    const mailOptions = {
      from: 'elysiumsolluna@gmail.com',
      to: req.body.email,
      subject: 'Booking Confirmation – ELYSIUM',
      html: `
        <h2>Dear ${req.body.name},</h2>
        <p>Your appointment is confirmed:</p>
        <ul>
          <li><strong>Service:</strong> ${req.body.service}</li>
          <li><strong>Barber:</strong> ${req.body.barber}</li>
          <li><strong>Date:</strong> ${req.body.date}</li>
          <li><strong>Time:</strong> ${req.body.time}</li>
        </ul>
        <p>Contact us at <a href="mailto:elysiumsolluna@gmail.com">elysiumsolluna@gmail.com</a> for changes.</p>
      `
    };
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) console.error('Email failed:', err);
    });

    res.json({ message: 'Booking saved, email sent!' });

  } catch (err) {
    console.error('Booking failed:', err);
    res.status(500).json({ message: 'Booking failed.' });
  }
});

// --- API: Add VIP booking ---
app.post('/vip', async (req, res) => {
  try {
    const vipBookings = JSON.parse(fs.readFileSync(vipFile));

    // Optional conflict check
    const conflict = vipBookings.find(b =>
      b.barber === req.body.barber &&
      b.date === req.body.date &&
      b.time === req.body.time
    );

    if (conflict) return res.status(400).json({
      message: `Sorry, ${req.body.barber} is already booked on ${req.body.date} at ${req.body.time}.`
    });

    vipBookings.push(req.body);
    fs.writeFileSync(vipFile, JSON.stringify(vipBookings, null, 2));

    // Save to Google Sheet
    await saveToSheet({
      Name: req.body.name,
      Email: req.body.email,
      Date: req.body.date,
      Time: req.body.time
    }, true);

    // Send VIP confirmation email
    const mailOptions = {
      from: 'elysiumsolluna@gmail.com',
      to: req.body.email,
      subject: 'VIP Booking Confirmation – ELYSIUM',
      html: `
        <h2>Dear ${req.body.name},</h2>
        <p>Your VIP appointment is confirmed:</p>
        <ul>
          <li><strong>Date:</strong> ${req.body.date}</li>
          <li><strong>Time:</strong> ${req.body.time}</li>
        </ul>
        <p>Contact us at <a href="mailto:elysiumsolluna@gmail.com">elysiumsolluna@gmail.com</a> for changes.</p>
      `
    };
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) console.error('VIP Email failed:', err);
    });

    res.json({ message: 'VIP booking saved, email sent!' });

  } catch (err) {
    console.error('VIP booking failed:', err);
    res.status(500).json({ message: 'VIP booking failed.' });
  }
});

// --- Admin dashboard ---
app.get('/admin', (req, res) => {
  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  const vipBookings = JSON.parse(fs.readFileSync(vipFile));

  let html = `<h1>ELYSIUM Admin Dashboard</h1>`;
  html += `<h2>Regular Bookings</h2><pre>${JSON.stringify(bookings, null, 2)}</pre>`;
  html += `<h2>VIP Bookings</h2><pre>${JSON.stringify(vipBookings, null, 2)}</pre>`;
  res.send(html);
});

// --- Delete bookings ---
app.post('/deleteBooking', (req, res) => {
  const { name, date, time, barber } = req.body;
  let bookings = JSON.parse(fs.readFileSync(bookingsFile));
  bookings = bookings.filter(b => !(b.name === name && b.date === date && b.time === time && b.barber === barber));
  fs.writeFileSync(bookingsFile, JSON.stringify(bookings, null, 2));
  res.json({ message: 'Regular booking deleted.' });
});

app.post('/deleteVIP', (req, res) => {
  const { name, date, time } = req.body;
  let vipBookings = JSON.parse(fs.readFileSync(vipFile));
  vipBookings = vipBookings.filter(b => !(b.name === name && b.date === date && b.time === time));
  fs.writeFileSync(vipFile, JSON.stringify(vipBookings, null, 2));
  res.json({ message: 'VIP booking deleted.' });
});

// ---------------- REMINDER SYSTEM ----------------

function checkReminders() {

  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  const now = new Date();

  bookings.forEach(b => {

    const appointment = new Date(`${b.date}T${b.time}`);
    const diff = (appointment - now) / (1000 * 60 * 60);

    if (diff > 2.9 && diff < 3.1) {

      const mailOptions = {

        from: 'elysiumsolluna@gmail.com',
        to: b.email,
        subject: 'Reminder – Your ELYSIUM Appointment',

        html: `
          <h2>Hello ${b.name}</h2>

          <p>This is a reminder that your appointment at
          <b>ELYSIUM – Sol & Luna</b> is in about 3 hours.</p>

          <ul>
            <li><b>Service:</b> ${b.service}</li>
            <li><b>Barber:</b> ${b.barber}</li>
            <li><b>Date:</b> ${b.date}</li>
            <li><b>Time:</b> ${b.time}</li>
          </ul>

          <p>We look forward to welcoming you.</p>
        `
      };

      transporter.sendMail(mailOptions)
        .then(info => console.log("Reminder sent:", info.response))
        .catch(err => console.log("Reminder error:", err));

    }

  });

}


// Run reminder check every 10 minutes
cron.schedule('*/10 * * * *', () => {

  console.log("Checking upcoming appointments...");
  checkReminders();

});


// ---------------- START SERVER ----------------

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});