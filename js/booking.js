s const bookingForm = document.getElementById('bookingForm');
  const dateInput = document.getElementById('date');
  const timeInput = document.getElementById('time');

  // Set minimum date to today
  const today = new Date().toISOString().split('T')[0];
  dateInput.setAttribute('min', today);

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

    document.getElementById('confirmationMessage').innerHTML = `
      <p style="color:green; font-weight:bold; margin-top:20px;">Thank you, ${bookingForm.name.value}! Your appointment for ${bookingForm.service.value} with ${bookingForm.barber.value} on ${bookingForm.date.value} at ${bookingForm.time.value} is confirmed.</p>
    `;

    bookingForm.reset();
  });
</script>
</body>
</html>