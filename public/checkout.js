// Checkout page: Stripe's Payment Element (card details never touch our
// server), then a server-side check that the payment really went through.

const appearance = {
  theme: "stripe",
  variables: {
    colorPrimary: "#623e28",
    colorText: "#1c1917",
    colorDanger: "#b91c1c",
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    borderRadius: "8px",
  },
};

function setUp(root, { invoiceId, clientSecret, publishableKey, returnUrl }) {
  const form = root.querySelector("form");
  const button = form.querySelector('button[type="submit"]');
  const skeleton = root.querySelector("[data-skeleton]");
  const mountPoint = root.querySelector("#payment-element");
  const messageBox = root.querySelector("[data-message]");
  let phase = "loading";

  function setButton(label) {
    button.querySelectorAll("[data-label]").forEach((span) => {
      span.hidden = span.dataset.label !== label;
    });
  }

  function showMessage(text) {
    messageBox.replaceChildren();
    const box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.className = "animate-fade-in rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900";
    box.textContent = text;
    messageBox.append(box);
    messageBox.hidden = false;
  }

  function hideMessage() {
    messageBox.hidden = true;
    messageBox.replaceChildren();
  }

  function setReady() {
    phase = "ready";
    setButton("idle");
    button.disabled = false;
  }

  if (typeof window.Stripe !== "function") {
    skeleton.hidden = true;
    showMessage("The payment form couldn't load. Check your connection and refresh the page.");
    return;
  }

  const stripe = window.Stripe(publishableKey);
  const elements = stripe.elements({ clientSecret, appearance });
  const paymentElement = elements.create("payment", { layout: "tabs" });
  paymentElement.on("ready", () => {
    skeleton.hidden = true;
    mountPoint.classList.remove("opacity-0");
    setReady();
  });
  paymentElement.on("loaderror", () => {
    skeleton.hidden = true;
    showMessage("The payment form couldn't load. Check your connection and refresh the page.");
  });
  paymentElement.mount(mountPoint);

  async function verify(paymentIntentId) {
    phase = "verifying";
    setButton("verifying");
    try {
      const response = await fetch("/api/checkout/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, paymentIntentId }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.status === "paid") {
        form.hidden = true;
        root.querySelector("[data-success]").hidden = false;
        // Let the success animation play, then load the server-rendered receipt.
        setTimeout(() => window.location.reload(), 1400);
        return;
      }
      if (response.ok && body.status === "processing") {
        form.hidden = true;
        root.querySelector("[data-processing]").hidden = false;
        return;
      }
      showMessage(
        body.error ||
          "We couldn't confirm your payment yet. If your card was charged you'll get a receipt by email, and your booking will update shortly.",
      );
    } catch {
      showMessage("The connection dropped while confirming your payment. Refresh this page in a moment to see its status.");
    }
    setReady();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (phase !== "ready") return;
    phase = "submitting";
    button.disabled = true;
    setButton("processing");
    hideMessage();

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: returnUrl },
    });

    if (error) {
      showMessage(
        error.type === "card_error" || error.type === "validation_error"
          ? error.message || "Your card was declined."
          : "Something went wrong with the payment. Please try again.",
      );
      setReady();
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      await verify(paymentIntent.id);
      return;
    }
    showMessage("The payment wasn't completed. Please try again or use a different card.");
    setReady();
  });
}

const root = document.querySelector("[data-checkout]");
const dataTag = document.getElementById("checkout-data");
if (root && dataTag) setUp(root, JSON.parse(dataTag.textContent));
