# 🏠 Family Hub

A family kitchen dashboard for iPad — auto-syncs Emma's homework, school announcements, Steps 4 aftercare updates, and family calendar.

## Setup

### 1. Google Apps Script
- Go to [script.google.com](https://script.google.com)
- Paste `FamilyHub_GmailScript.gs`
- Run `setupGoogleSheet()` → copy the Sheet ID from the log
- Paste Sheet ID into `CONFIG.SHEET_ID`
- Run `setupDailyTrigger()` to schedule daily 2 PM check

### 2. Dashboard
- Hosted at your GitHub Pages URL
- Tap ⚙️ → paste your Google Sheet ID → Save & Sync

## Email Sources
- **Seesaw** — homework and school announcements
- **lminkoff@stjhill.org** — Emma's teacher (St. John's Hill, 1st grade)
- **Steps 4** — aftercare updates

## Auto-sync
Runs daily at 2:00 PM (when Emma leaves school) via Google Apps Script time trigger.
