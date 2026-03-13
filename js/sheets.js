const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./credentials.json');

async function saveBooking(booking, isVIP = false) {
    const doc = new GoogleSpreadsheet('1Od160ft9-Q6X0bPmn-WScFZH1dZ5JzlI75k8PUhMDTk');
    
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo(); // loads document properties and worksheets

    const sheetTitle = isVIP ? 'VIP Bookings' : 'Regular Bookings';
    const sheet = doc.sheetsByTitle[sheetTitle];

    if (!sheet) {
        console.log(`Sheet "${sheetTitle}" not found!`);
        return;
    }

    await sheet.addRow(booking);
    console.log(`Booking saved to ${sheetTitle}`);
}

// Example test
(async () => {
    await saveBooking({
        name: 'John Doe',
        email: 'john@example.com',
        service: 'Kids Haircut',
        barber: 'Marco',
        date: '2026-03-14',
        time: '10:00'
    });

    await saveBooking({
        name: 'VIP Jane',
        email: 'jane@example.com',
        date: '2026-03-14',
        time: '11:00'
    }, true);
})();