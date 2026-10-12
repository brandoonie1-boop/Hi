// Shows progress on submit buttons and blocks accidental double submits.

const SPINNER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4 animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>';

for (const form of document.querySelectorAll("form[data-busy-form]")) {
  form.addEventListener("submit", (event) => {
    if (form.dataset.submitting) {
      event.preventDefault();
      return;
    }
    form.dataset.submitting = "true";
    const button = event.submitter || form.querySelector('button[type="submit"]');
    if (!button) return;
    button.dataset.idleHtml = button.innerHTML;
    if (button.dataset.busyLabel) {
      button.innerHTML = SPINNER;
      button.append(document.createTextNode(button.dataset.busyLabel));
    }
    // Disable after the browser has captured the form data.
    setTimeout(() => {
      button.disabled = true;
    }, 0);
  });
}

// Pages restored with the Back button keep their old state; reset the buttons.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  for (const form of document.querySelectorAll("form[data-busy-form]")) {
    delete form.dataset.submitting;
    for (const button of form.querySelectorAll('button[type="submit"]')) {
      if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
      button.disabled = false;
    }
  }
});
