// Admin Dashboard JS
const bookingsTableBody = document.querySelector('#bookingsTable tbody');

// Load bookings from localStorage
let bookings = JSON.parse(localStorage.getItem('elysiumBookings')) || [];

// Function to render bookings
function renderBookings() {
  bookingsTableBody.innerHTML = ''; // Clear table
  bookings.forEach((b, index) => {
    const row = document.createElement('tr');

    row.innerHTML = `
      <td>${b.name}</td>
      <td>${b.email}</td>
      <td>${b.service}</td>
      <td>${b.barber}</td>
      <td>${b.date}</td>
      <td>${b.time}</td>
      <td>
        <button class="edit" data-index="${index}">Edit</button>
        <button class="delete" data-index="${index}">Delete</button>
      </td>
    `;

    bookingsTableBody.appendChild(row);
  });
}

renderBookings();

// Delete booking
bookingsTableBody.addEventListener('click', function(e) {
  if(e.target.classList.contains('delete')) {
    const index = e.target.dataset.index;
    bookings.splice(index, 1);
    localStorage.setItem('elysiumBookings', JSON.stringify(bookings));
    renderBookings();
  }

  if(e.target.classList.contains('edit')) {
    const index = e.target.dataset.index;
    const b = bookings[index];
    const newDate = prompt("Enter new date (YYYY-MM-DD):", b.date);
    const newTime = prompt("Enter new time (HH:MM):", b.time);

    if(newDate && newTime){
      b.date = newDate;
      b.time = newTime;
      bookings[index] = b;
      localStorage.setItem('elysiumBookings', JSON.stringify(bookings));
      renderBookings();
    }
  }
});