import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────
// SUPABASE CREDENTIALS
// Replace the two values below with your project credentials.
// Find them in: Supabase Dashboard → Your Project → Settings → API
//
// SUPABASE_URL  : looks like https://xxxxxxxxxxxx.supabase.co
// SUPABASE_ANON : starts with "eyJh..." — this is your anon/public key
// ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL  = "https://reqauyfmnjkjzhyhvfzd.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJlcWF1eWZtbmpranpoeWh2ZnpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjEzMTAsImV4cCI6MjA5Mjc5NzMxMH0._WErn2x6panJm2dsKOhKtxiiUjg6mIaFDso36WT19Dw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
