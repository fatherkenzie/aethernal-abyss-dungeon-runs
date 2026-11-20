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
   your own script.) This creates the **Signups** and **Nights** tabs.
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

## Running it

**Fix or remove anyone's sign-up.** Edit or delete their row in the **Signups** tab.
The board picks it up on the next refresh (within 45 seconds, or right away with the refresh button).

**Lock in a dungeon or post a note.** Add a row to the **Nights** tab:

| date       | dungeon     | message                      |
|------------|-------------|------------------------------|
| 2026-11-26 |             | Guild raid first, run after. |
| 2026-11-27 | Scholomance | Bring your keys              |

- `date` can be `2026-11-27` or `27.11.2026`.
- `dungeon` overrides the preferences. Use the name as it appears on the board.
- `message` appears at the top of that night's details.
- Nothing here closes a night: every upcoming night stays open for sign-ups.

**Add someone by hand.** Type a row into **Signups** with at least `date`, `name`, `class` and `spec`
(and `role`: tank, healer, melee or ranged). `dungeons` takes names separated by commas, such as
`Scholomance, BRD`, or stays empty for "any". Leave `id` and `owner` empty. Nobody can edit that row
from the board, only from the Sheet.

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
| Dungeon list | `config.js` → `dungeons`. Keep existing `id`s, the Sheet stores them. |
| Classes, specs, colours | `config.js` → `classes` |
| Party size | `config.js` → `party` |
| Start time, run days, time zone | `apps-script/Code.gs` → `SETTINGS` (and the same values in `config.js`) |

**After editing `Code.gs` in Apps Script**, publish it again or nothing changes:
**Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**.
The URL stays the same.

## If something's wrong

- **"Can't reach the guild sheet."** Check that `apiUrl` ends in `/exec`, that the deployment is a
  **Web app** with access set to **Anyone**, and that the `?action=list` check above works.
- **A change to `Code.gs` doesn't show up.** Make a new version (see above).
- **Anyone with the link can sign up**, the same as with a Discord post. If someone spams it,
  delete the rows in the Sheet. To start over with a fresh link, make a new deployment and
  update `config.js`.

The fonts are Marcellus and Alegreya Sans, both under the SIL Open Font License (see `fonts/`).
They're served from your own site, so the board makes no calls to Google Fonts.
