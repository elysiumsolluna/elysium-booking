// Contact Form JS
const contactForm = document.getElementById('contactForm');
const contactConfirmation = document.getElementById('contactConfirmation');

contactForm.addEventListener('submit', function(e) {
  e.preventDefault();

  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const message = document.getElementById('message').value;

  // Simulate sending email (ready for backend integration)
  contactConfirmation.style.color = 'green';
  contactConfirmation.textContent = `Thank you ${name}, your message has been received!`;

  contactForm.reset();

  // Optional: you can later integrate with EmailJS or SMTP server for real emails
});