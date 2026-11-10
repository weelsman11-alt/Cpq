# Waimea Australia CPQ (Netlify)

Configure, price and quote app for the Waimea Australia range (Linelift 105AU, Linelift 105X, Versalift VST40, Versalift VST5000).
This is the same app as the claude.ai version, with the claude.ai-only parts swapped for Netlify equivalents:

| claude.ai version | This Netlify version |
|---|---|
| Shared price book and saved quotes | Netlify Blobs, through `netlify/functions/store.mjs` (`/api/store`) |
| PDF download | Normal browser download |
| Pipedrive (not yet connected) | `netlify/functions/pipedrive.mjs` (`/api/pipedrive`): Load client from a deal ID, and Push to Pipedrive (attaches the PDF, adds a note, sets the deal value) |
| Price book editing limited to editors | Price book saves need the `ADMIN_KEY` (asked for once, then remembered in that browser) |

## Files

- `public/index.html`: the whole app (layout, styles, fonts, logos, PDF builder). Don't edit by hand unless you mean to change the app.
- `netlify/functions/store.mjs`: storage for the price book and quotes.
- `netlify/functions/pipedrive.mjs`: Pipedrive bridge. The API token never reaches the browser.
- `data/pricebook.json`: starting price book, loaded automatically the first time the site runs.
- `netlify.toml`, `package.json`: Netlify settings.

## Environment variables (Site configuration > Environment variables)

| Name | Required | What it is |
|---|---|---|
| `PIPEDRIVE_API_TOKEN` | Yes, for Pipedrive | Pipedrive > profile menu > Personal preferences > API. Use a token from a user who can see the Australian deals. |
| `PIPEDRIVE_PUSH_API_TOKEN` | Recommended | Albert Field's own Pipedrive API token. Push to Pipedrive uses it so the PDF, note and deal update show as Albert Field. |
| `PIPEDRIVE_AUTHOR_EMAIL` | No | Pipedrive user the pushed note is credited to. Defaults to `albert.field@waimea.co.nz`. |
| `ADMIN_KEY` | Recommended | Any long password. Needed to save price book changes. |
| `UPDATE_DEAL_VALUE` | No | Set to `false` to stop Push to Pipedrive changing the deal value. |

## Deploying

Netlify Drop (drag and drop) does not run functions, so use one of these:

1. **GitHub (recommended):** put this folder in a new private GitHub repo, then in Netlify choose Add new project > Import an existing project and pick the repo. Leave the build command empty; the publish directory comes from `netlify.toml`.
2. **Netlify CLI:** in this folder run `npm install`, `npx netlify login`, `npx netlify init`, then `npx netlify deploy --prod`.

Then add the environment variables and redeploy.

## Who can see it

Anyone with the site URL can open it, see saved quotes and create quotes. Before sharing customer data, turn on Netlify's site password protection (Site configuration > Access & security > Visitor access), or put the site behind your company login.
