const regularForm = document.getElementById('bookingForm');
const vipForm = document.getElementById('vipForm'); // Make sure your VIP form has id="vipForm"
const dateInputs = document.querySelectorAll('input[type="date"]');
const timeInputs = document.querySelectorAll('input[type="time"]');

// Set minimum date to today for all date inputs
const today = new Date().toISOString().split('T')[0];
dateInputs.forEach(input => input.setAttribute('min', today));

function handleBookingSubmit(form, endpoint) {
  form.addEventListener('submit', function(e) {
    e.preventDefault();

    const dateInput = form.querySelector('input[type="date"]');
    const timeInput = form.querySelector('input[type="time"]');
    const selectedDate = new Date(dateInput.value);
    const now = new Date();
    const [hours, minutes] = timeInput.value.split(':');
    const selectedDateTime = new Date(selectedDate);
    selectedDateTime.setHours(hours, minutes);

    if (selectedDateTime < now) {
      alert("You cannot book for past date or time.");
      return;
    }

    // Validate all required fields
    const requiredFields = Array.from(form.querySelectorAll('[name]')).filter(f => f.type !== 'submit');
    for (let field of requiredFields) {
      if (!field.value) {
        alert("Please fill all fields to book your appointment.");
        return;
      }
    }

    // Collect form data
    const data = {};
    requiredFields.forEach(f => data[f.name] = f.value);

    // Send to backend
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(response => {
      const messageDiv = form.querySelector('.confirmationMessage') || form.querySelector('#confirmationMessage');
      if (messageDiv) {
        messageDiv.innerHTML = `<p style="color:green; font-weight:bold; margin-top:20px;">${response.message}</p>`;
      } else {
        alert(response.message);
      }
      form.reset();
    })
    .catch(err => {
      console.error(err);
      alert("Failed to book appointment. Please try again.");
    });
  });
}

// Attach handlers
if (regularForm) handleBookingSubmit(regularForm, '/book');
if (vipForm) handleBookingSubmit(vipForm, '/vip');