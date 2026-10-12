// Icons from Lucide (https://lucide.dev), ISC License, Copyright (c) Lucide Contributors.
// Stored as plain SVG so the site needs no icon package.

import { raw } from "../html.js";

const PATHS = {
  accessibility: "<circle cx=\"16\" cy=\"4\" r=\"1\"></circle><path d=\"m18 19 1-7-6 1\"></path><path d=\"m5 8 3-3 5.5 3-2.36 3.5\"></path><path d=\"M4.24 14.5a5 5 0 0 0 6.88 6\"></path><path d=\"M13.76 17.5a5 5 0 0 0-6.88-6\"></path>",
  arrowLeft: "<path d=\"m12 19-7-7 7-7\"></path><path d=\"M19 12H5\"></path>",
  arrowRight: "<path d=\"M5 12h14\"></path><path d=\"m12 5 7 7-7 7\"></path>",
  ban: "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"m4.9 4.9 14.2 14.2\"></path>",
  banknote: "<rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\"></rect><circle cx=\"12\" cy=\"12\" r=\"2\"></circle><path d=\"M6 12h.01M18 12h.01\"></path>",
  calendarCheck: "<path d=\"M8 2v4\"></path><path d=\"M16 2v4\"></path><rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\"></rect><path d=\"M3 10h18\"></path><path d=\"m9 16 2 2 4-4\"></path>",
  calendarDays: "<path d=\"M8 2v4\"></path><path d=\"M16 2v4\"></path><rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\"></rect><path d=\"M3 10h18\"></path><path d=\"M8 14h.01\"></path><path d=\"M12 14h.01\"></path><path d=\"M16 14h.01\"></path><path d=\"M8 18h.01\"></path><path d=\"M12 18h.01\"></path><path d=\"M16 18h.01\"></path>",
  check: "<path d=\"M20 6 9 17l-5-5\"></path>",
  circleAlert: "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\"></line><line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\"></line>",
  circleCheck: "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"m9 12 2 2 4-4\"></path>",
  clipboardCheck: "<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\"></rect><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"></path><path d=\"m9 14 2 2 4-4\"></path>",
  clock: "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><polyline points=\"12 6 12 12 16 14\"></polyline>",
  creditCard: "<rect width=\"20\" height=\"14\" x=\"2\" y=\"5\" rx=\"2\"></rect><line x1=\"2\" x2=\"22\" y1=\"10\" y2=\"10\"></line>",
  droplets: "<path d=\"M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z\"></path><path d=\"M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97\"></path>",
  hardHat: "<path d=\"M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5\"></path><path d=\"M14 6a6 6 0 0 1 6 6v3\"></path><path d=\"M4 15v-3a6 6 0 0 1 6-6\"></path><rect x=\"2\" y=\"15\" width=\"20\" height=\"4\" rx=\"1\"></rect>",
  info: "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"M12 16v-4\"></path><path d=\"M12 8h.01\"></path>",
  loaderCircle: "<path d=\"M21 12a9 9 0 1 1-6.219-8.56\"></path>",
  lock: "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"></rect><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"></path>",
  mail: "<rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"></rect><path d=\"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7\"></path>",
  mailCheck: "<path d=\"M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8\"></path><path d=\"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7\"></path><path d=\"m16 19 2 2 4-4\"></path>",
  mapPin: "<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\"></path><circle cx=\"12\" cy=\"10\" r=\"3\"></circle>",
  minus: "<path d=\"M5 12h14\"></path>",
  phone: "<path d=\"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z\"></path>",
  plus: "<path d=\"M5 12h14\"></path><path d=\"M12 5v14\"></path>",
  receiptText: "<path d=\"M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z\"></path><path d=\"M14 8H8\"></path><path d=\"M16 12H8\"></path><path d=\"M13 16H8\"></path>",
  search: "<circle cx=\"11\" cy=\"11\" r=\"8\"></circle><path d=\"m21 21-4.3-4.3\"></path>",
  shieldCheck: "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"></path><path d=\"m9 12 2 2 4-4\"></path>",
  sparkles: "<path d=\"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\"></path><path d=\"M20 3v4\"></path><path d=\"M22 5h-4\"></path><path d=\"M4 17v2\"></path><path d=\"M5 18H3\"></path>",
  triangleAlert: "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"></path><path d=\"M12 9v4\"></path><path d=\"M12 17h.01\"></path>",
  truck: "<path d=\"M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2\"></path><path d=\"M15 18H9\"></path><path d=\"M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14\"></path><circle cx=\"17\" cy=\"18\" r=\"2\"></circle><circle cx=\"7\" cy=\"18\" r=\"2\"></circle>",
  undo2: "<path d=\"M9 14 4 9l5-5\"></path><path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\"></path>",
  logOut: "<path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\"></path><polyline points=\"16 17 21 12 16 7\"></polyline><line x1=\"21\" x2=\"9\" y1=\"12\" y2=\"12\"></line>",
};

/** Inline SVG icon, e.g. icon("truck", "size-4 text-brand-700"). Decorative by default. */
export function icon(name, className = "size-4") {
  const paths = PATHS[name];
  if (!paths) throw new Error(`Unknown icon "${name}"`);
  return raw(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true" focusable="false">${paths}</svg>`,
  );
}
