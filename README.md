# Explore the Abyss: dungeon sign-up board

A sign-up board for the guild's daily endgame runs: Monday to Friday, 21:00 server time.
Each night shows how many people are going and the dungeon most of them prefer. Tap a night to see
its groups (tank, healer, 3 DPS each) and sign up.

- **The site** (`index.html`, `styles.css`, `app.js`, `config.js`, `fonts/`) runs on GitHub Pages.
- **The sign-ups** live in a Google Sheet you own. A small script (`apps-script/Code.gs`) inside the
  Sheet saves and reads them, so nobody needs an account or a login.

Until you paste the Sheet's URL into `config.js`, the board runs in **demo mode** with sample
sign-ups that are saved only in your own browser.

---

## Setup (about 10 minutes, once)

### 1. Make the Google Sheet

1. Create a new Google Sheet, e.g. "Abyss sign-ups". Use a personal Google account. Work or school
   accounts often aren't allowed to publish to "Anyone".
2. Open **Extensions → Apps Script**.
3. Delete the sample code, paste in everything from `apps-script/Code.gs`, and save.
4. In the toolbar, pick the function **setup** and press **Run**.
   Google asks for permission the first time: **Review permissions** → choose your account →
   **Advanced** → **Go to … (unsafe)** → **Allow**. ("Unsafe" only means Google hasn't reviewed
   your own script.) This creates the **Overview**, **Signups**, **Nights** and **Archive** tabs.
5. Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.

To check it works, open that URL with `?action=list` added to the end. You should see text that
starts with `{"ok":true`.

### 2. Put the site on GitHub Pages

1. Create a new **public** repository on GitHub, e.g. `abyss-board`. Free Pages needs a public repo.
2. **Add file → Upload files**, then drag in everything from this folder (including the `fonts`
   and `apps-script` folders). Commit.
3. Open `config.js` in the repo, click the pencil to edit, paste your Web app URL between the quotes
   of `apiUrl`, and commit.
4. **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** →
   **Save**.
5. After a minute or two the board is live at `https://YOUR-NAME.github.io/abyss-board/`.
   Share that link in Discord.

---

## The Sheet

| Tab | What it's for |
|---|---|
| **Overview** | Reading. Upcoming nights, this week and next, laid out like the board: a band per week, a heading per night (time, headcount, top pick, your note), then each group with its tank, healer and DPS. Don't edit it: it's redrawn after every sign-up, after every change you make in Signups or Nights, and whenever the Sheet is opened. |
| **Signups** | The data, one row per character per night. Fix, edit or delete rows here. Technical columns (ID, timestamps, device) are hidden, Class and Role have dropdowns, and the header has a filter. |
| **Nights** | Your notes per night (see below). |
| **Archive** | Past weeks. Every Monday, last week's sign-ups move here on their own, so Signups stays short. |

The **Sign-up board** menu (next to Help) has **Refresh overview**, in case it ever looks out of
date, and **Tidy up the tabs**, which reapplies the layout if something got messed up.

**Fix or remove anyone's sign-up.** Edit or delete their row in **Signups**. The board picks it up
on its next refresh (within 45 seconds, or right away with the refresh button).

**Lock in a dungeon or post a note.** Add a row to **Nights**:

| Night      | Dungeon     | Message                      |
|------------|-------------|------------------------------|
| 2026-11-26 |             | Guild raid first, run after. |
| 2026-11-27 | Scholomance | Bring your keys              |

- `Night` can be `2026-11-27` or `27.11.2026`.
- `Dungeon` overrides the preferences. Use the name as it appears on the board.
- `Message` appears at the top of that night, on the board and in the Overview.
- Nothing here closes a night: every upcoming night stays open for sign-ups.

**Add someone by hand.** Type a row into **Signups** with Night, Character, Class, Spec and Role.
Dungeons takes names separated by commas, such as `Scholomance, Blackrock Depths`, or stays empty
for "any". Nobody can edit that row from the board, only from the Sheet.

### How the board behaves

- Every upcoming night is open, this week and next, and people can sign up for several at once.
  A night closes at 21:00 server time (Europe/Berlin), when the run starts. The Sheet enforces this
  too, so a wrong phone clock can't get around it.
- There's no cap. Groups fill by role in sign-up order: 1 tank, 1 healer, 3 DPS. When a role is full,
  the next person in that role starts the next group, so 3, 4 or more groups form on their own.
  If someone un-signs, everyone behind them moves up.
- Tapping an open slot (say, "Open healer slot") opens the sign-up with only that role's specs.
- The same character can't be on one night twice. The same name with another class is fine, for alts.
- Only the browser that made a sign-up can edit or un-sign it. If someone switches phones or clears
  their browser, fix their row in the Sheet.
- Each sign-up can list several preferred dungeons, or none for "any". Every pick counts once, the
  night shows the dungeon with the most picks, and ties are shown as ties.
- Links like `…/abyss-board/#2026-11-27` open that night directly. Handy for Discord.
- People in other time zones also see the start time in their own time.

---

## Changing things

| What | Where |
|---|---|
| Title and tagline | `config.js` |
| Dungeon list | `config.js` → `dungeons`. The Sheet stores the names, so rename a dungeon only when nobody has an upcoming sign-up for it. |
| Classes, specs, colours | `config.js` → `classes` |
| Party size | `config.js` → `party` (and `SETTINGS.party` in `Code.gs`, for the Overview) |
| Start time, run days, time zone, Overview title | `apps-script/Code.gs` → `SETTINGS` (and the same values in `config.js`) |

**Updating the script.** When `Code.gs` changes, in Apps Script:
1. Replace the code with the new `Code.gs` and save.
2. Run **setup** once. It restyles the tabs and builds the Overview; your sign-ups stay as they are.
3. **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**.
   The URL stays the same. Without a new version, the board keeps using the old script.

## If something's wrong

- **"Can't reach the guild sheet."** Check that `apiUrl` ends in `/exec`, that the deployment is a
  **Web app** with access set to **Anyone**, and that the `?action=list` check above works.
- **A change to `Code.gs` doesn't show up.** Make a new version (see above).
- **The Overview looks out of date.** Use **Sign-up board → Refresh overview**. If the menu is
  missing, reload the Sheet: it's added when the Sheet opens.
- **Anyone with the link can sign up**, the same as with a Discord post. If someone spams it,
  delete the rows in the Sheet. To start over with a fresh link, make a new deployment and
  update `config.js`.

The fonts are Marcellus and Alegreya Sans, both under the SIL Open Font License (see `fonts/`).
They're served from your own site, so the board makes no calls to Google Fonts.
