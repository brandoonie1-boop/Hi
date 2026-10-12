// Tiny HTML templating: html`...` escapes every ${value} unless it is itself
// html`...` (or raw(...)), so customer-entered text can never inject markup.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** Mark a trusted string (written by us, never user input) as HTML. */
export function raw(value) {
  return new SafeHtml(String(value));
}

function render(value) {
  if (value === null || value === undefined || value === false || value === true) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Join class names, skipping empty ones. */
export function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

/** JSON that is safe to place inside a <script type="application/json"> tag. */
export function jsonScript(id, value) {
  const json = JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return raw(`<script type="application/json" id="${escapeHtml(id)}">${json}</script>`);
}
