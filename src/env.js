// Settings come from environment variables (see .env.example). A .env file
// next to server.js is loaded automatically for local use; on a host such as
// Render or Railway, set the variables in its dashboard instead.

import { existsSync, readFileSync } from "node:fs";

export class ConfigError extends Error {
  constructor(name) {
    super(`Missing setting ${name}. Add it to .env (local) or your host's environment variables.`);
    this.name = "ConfigError";
    this.setting = name;
  }
}

export function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Real environment variables win over the file.
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new ConfigError(name);
  return value;
}

/**
 * The site's public address. SITE_URL wins; without it, Render's and
 * Railway's own address for the service is used, so SITE_URL is only needed
 * once the site has its own domain.
 */
export function siteUrl() {
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "";
  const url = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || railway || `http://localhost:${process.env.PORT || 3000}`;
  return url.replace(/\/$/, "");
}

export const SITE = {
  companyName: "Brown Line IL LLC",
  baseLocation: "Chicago, Illinois",
  serviceArea: "All of Chicagoland, year-round, for job sites and events of every size",
  description:
    "Portable toilet rentals, delivery, placement, servicing and restocking for construction sites and events across Chicagoland, year-round.",
  get phone() {
    return process.env.BUSINESS_PHONE || "";
  },
  get email() {
    return process.env.BUSINESS_EMAIL || "";
  },
};

/** The settings the site needs, for the startup check. */
export const REQUIRED_SETTINGS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

/** Required settings that aren't set yet (SITE_URL counts as set on Render and Railway). */
export function missingSettings() {
  const missing = REQUIRED_SETTINGS.filter((name) => !process.env[name]);
  if (!process.env.SITE_URL && !process.env.RENDER_EXTERNAL_URL && !process.env.RAILWAY_PUBLIC_DOMAIN) missing.unshift("SITE_URL");
  return missing;
}
