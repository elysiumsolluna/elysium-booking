// Newsletter form
const newsletterForm = document.getElementById('newsletterForm');
const newsletterConfirmation = document.getElementById('newsletterConfirmation');

newsletterForm.addEventListener('submit', function(e){
  e.preventDefault();
  const email = document.getElementById('newsletterEmail').value;

  newsletterConfirmation.textContent = `Thank you! ${email} is now subscribed.`;
  newsletterForm.reset();
});