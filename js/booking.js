<script>
const bookingForm = document.getElementById('bookingForm');
const dateInput = document.getElementById('date');
const timeInput = document.getElementById('time');

// Set minimum date to today
const today = new Date().toISOString().split('T')[0];
dateInput.setAttribute('min', today);

const API_URL = "https://elysiumsolluna.onrender.com"; // <-- your backend URL

bookingForm.addEventListener('submit', function(e) {
  e.preventDefault();

  // Validate date/time not in the past
  const selectedDate = new Date(dateInput.value);
  const now = new Date();
  const selectedTimeParts = timeInput.value.split(':');
  const selectedDateTime = new Date(selectedDate);
  selectedDateTime.setHours(selectedTimeParts[0], selectedTimeParts[1]);

  if (selectedDateTime < now) {
    alert("You cannot book for past date or time.");
    return;
  }

  // Validate all fields
  if (!bookingForm.service.value || !bookingForm.barber.value || !bookingForm.name.value || !bookingForm.email.value) {
    alert("Please fill all fields to book your appointment.");
    return;
  }

  // Prepare booking data
  const bookingData = {
    name: bookingForm.name.value,
    email: bookingForm.email.value,
    service: bookingForm.service.value,
    barber: bookingForm.barber.value,
    date: bookingForm.date.value,
    time: bookingForm.time.value
  };

  // Send to backend
  fetch(`${API_URL}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookingData)
  })
  .then(res => res.json())
  .then(data => {
    if (data.message) {
      document.getElementById('confirmationMessage').innerHTML = `
        <p style="color:green; font-weight:bold; margin-top:20px;">
          ${data.message}
        </p>
      `;
      bookingForm.reset();
    } else {
      alert("Booking failed. Please try again.");
    }
  })
  .catch(err => {
    console.error(err);
    alert("Error sending booking. Check console for details.");
  });
});
</script>