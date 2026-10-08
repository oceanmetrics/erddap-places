# Feedback endpoint (Google Sheet + mail + GitHub issue)

**Status: not yet deployed.** The code is in place (`scripts/feedback/Code.gs`, `app/src/lib/feedback/`),
but Ben must create the Sheet and deploy the Apps Script (steps below) and set the repo variable. Until
`VITE_FEEDBACK_URL` is set, the dialog has no Send button and falls back to the prefilled GitHub issue,
Copy report and Download PNG.

One Apps Script serves all the Ocean Metrics apps. Each app's payload carries `app`, and the script's
`APPS` map turns that into a repository and branch:

| `app` | repository | branch |
|---|---|---|
| `erddap-places` | `oceanmetrics/erddap-places` | `main` |
| `obis-hex` | `oceanmetrics/obis-hex` | `main` |
| `marinebon-org` | `marinebon/marinebon.github.io` | `main` |

An unknown `app` is refused. To add an app, add a row to `APPS`, give the token that repo, and re-paste.

## What one submission does

The dialog (`app/src/lib/feedback/FeedbackDialog.svelte`) POSTs `payload.ts`'s `buildFeedbackPayload()`:

```
{ app: "erddap-places", kind, title?, text, email?, url?, release, version, sha, lens, viewport, theme,
  user_agent, sentence?, image?, website }
```

- `kind` is `feedback` or `product` here (the script also takes `bug`, `idea`, `question`, `data` for the
  other apps). It becomes the GitHub issue label.
- `email` is optional and present only when the person typed one. `url` is present only when
  "include a link to this view" is ticked (on by default here; every view is a permalink).
- `website` is a honeypot; the script drops a submission that fills it.

The script then:

1. saves the screenshot to a Drive folder per app (`<app> feedback`, beside the Sheet or under `DRIVE_FOLDER_ID`);
2. opens an issue in the app's repo labelled with the kind, with the screenshot committed as
   `feedback/<id>.png` on the app's branch (needs `GITHUB_TOKEN`). **The issue never carries the email.**
3. appends a row to the `feedback` tab (the one place the email is stored, with the mail);
4. mails everyone in the `recipients` tab (screenshot inline; `Reply-To` is the submitter's email when given)
   and sends the submitter their own copy when they gave an email.

Limits: 20 submissions per hour per app, text 4000 and title 200 characters, screenshot 6 MB decoded.
Each step reports into the row's `status` column, so a missing token or a mail failure never loses the row.

## Setup (once, by Ben)

1. **Create the Sheet** as `ben@oceanmetrics.io` (for example "Ocean Metrics feedback") with two tabs:
   - `feedback`: row 1 exactly the header in `Code.gs`'s `FEEDBACK_HEADER`:
     `ts, id, app, kind, title, text, email, url, release, version, sha, lens, viewport, theme, user_agent, website, image_url, issue_url, status`.
   - `recipients`: `A1 = email`, then `ben@oceanmetrics.io` in `A2`. Add or delete rows later to change
     who is mailed; no redeploy.
2. **Extensions > Apps Script**, delete the stub, paste all of `scripts/feedback/Code.gs`.
3. **Project Settings > Script properties**:
   - `GITHUB_TOKEN`: a fine-grained personal access token with **Contents: Read and write** and
     **Issues: Read and write** on the repos above. A fine-grained token has one resource owner, so make
     one for `oceanmetrics` (erddap-places, obis-hex) and store it as `GITHUB_TOKEN_OCEANMETRICS`, and one
     for `marinebon` (marinebon.github.io) stored as `GITHUB_TOKEN_MARINEBON`. The script uses
     `GITHUB_TOKEN_<OWNER>` for a repo's owner first and the plain `GITHUB_TOKEN` otherwise, so a single
     `GITHUB_TOKEN` works if one token can reach all three. Without a token the Sheet and mail still work
     and `status` says `issue skipped: no GITHUB_TOKEN`.
   - `DRIVE_FOLDER_ID` (optional): a Drive folder for the per-app screenshot folders.
4. **Deploy > New deployment > Web app**, execute as **Me**, who has access **Anyone**. Authorize when
   asked (Sheets, Drive, Mail, external requests). Copy the `/exec` URL. Opening it in a browser should
   answer `{"ok":true,"endpoint":"oceanmetrics-feedback","apps":[...],...}`.
5. **Give each app the URL**: in each repo (`oceanmetrics/erddap-places`, `oceanmetrics/obis-hex`,
   `marinebon/marinebon.github.io`) add the Actions variable `VITE_FEEDBACK_URL` under
   Settings > Secrets and variables > Actions > Variables (a variable, not a secret: it ships in the
   public bundle). In erddap-places `.github/workflows/pages.yml` already passes it to the build:

   ```yaml
   - run: npm run build
     env:
       VITE_BASE: /erddap-places/
       VITE_FEEDBACK_URL: ${{ vars.VITE_FEEDBACK_URL }}
   ```

   Re-run the Pages workflow (or push to `app/`) so the build picks it up. An unset variable is the empty
   string, which the app treats as "no endpoint".
6. **Re-paste `Code.gs` after any change** to it, then Deploy > Manage deployments > edit > New version
   (the `/exec` URL stays the same). There is no build step for Apps Script.

Screenshot commits (`feedback/<id>.png`) land on `main` outside the Pages workflow's `paths`, so they
do not redeploy the site.

## Testing without the real deployment

Point a running build (`npm run dev`) at any endpoint you can inspect, with no rebuild:

```js
localStorage.setItem("erddap-places.feedback_url", "https://script.google.com/macros/s/.../exec");
```

The build-time `VITE_FEEDBACK_URL` wins over this key when both are set; remove the key with
`localStorage.removeItem(...)`. Unit tests for the payload, endpoint order, POST and mark colours are in
`app/src/lib/feedback/feedback.test.ts` (`cd app && npm run test`).

## Privacy statement (what the dialog tells the person)

> Send files your note and the picture with the team and as a public issue on GitHub. Your email, if you
> give one, goes to the team only; it is never put in the issue.

What is sent: the note, the screenshot (unless turned off), the data release line, the lens, the window
size, the theme and the browser's user agent, and the view's link only if the box is ticked. The email is
optional; it is stored in the team's Sheet and mails, a copy goes back to the sender, and it is not
published. Without an endpoint nothing is sent from the page: the person opens a GitHub issue themselves.
