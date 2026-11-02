# Bible Memory

A free web app for memorizing Scripture with spaced review. Live example: https://biblememoryapp.pages.dev

- Recite a verse from its reference, with help when you need it: a picture, first letters, or listening.
- Spaced review (FSRS) schedules each verse for the day you are about to forget it.
- Make your own cards, with words and pictures on the front and back, or import cards from a CSV or an Anki text export.
- Choose exact Berean Standard Bible (BSB) or King James Version (KJV) passages for memorization. KJV chapter verse counts are checked against the selected chapter before saving.
- Listen to any chapter of the Berean Standard Bible, read by Barry Hays, with study notes and cross-references. KJV audio is not included.
- Download a backup file and restore it in another browser.

Everything a person saves stays in their own browser. There is no account, no server and no database, and nothing is sent anywhere except requests for Bible text and audio.

## Host your own copy (free)

The `site` folder is the whole app: plain HTML, CSS, JavaScript and data. There is no build step.

**Cloudflare Pages (tested):**

1. Fork this repository, or use it as a template, on GitHub.
2. In Cloudflare, go to Workers & Pages, then Create, then Pages, then Connect to Git, and choose your copy.
3. Set Framework preset to None, leave Build command empty, and set Build output directory to `site`.
4. Save and deploy. Each push to your copy publishes again.

The site has about 6,200 files, under the free plan's 20,000-file limit. The dashboard's drag-and-drop upload takes at most 1,000 files, so use the Git route above (or Wrangler: `wrangler pages deploy site`).

`site/_headers` sets the security headers Cloudflare Pages applies, including the list of hosts allowed to serve Bible text and audio. Other static hosts work too, but may ignore that file.

## Want sign-in, online saving or AI help?

This version saves everything in the browser on the device you use, with no accounts. If you'd like more, you can extend your own copy, and an AI assistant such as Claude or ChatGPT can help you build and set it up:

- **Sign-in and online saving:** keep your progress in a free Cloudflare D1 database, and protect your copy with Cloudflare Access. Access is free for up to 50 people, and you sign in with a one-time code sent by email. Your progress then shows on every device where you sign in.
- **AI help:** add a small inbox your AI can leave requests in, like "add Psalm 46:10," "record today's review" or "change my playlist." Your app checks each request before making the change, so your AI can keep the app up to date for you.

These features aren't included here. They're ideas for your own copy. If you put your copy online, keep it behind a sign-in so your progress stays private.

## Make changes

Edit the files in `site` directly. The main pieces:

| File | What it does |
| --- | --- |
| `index.html`, `app.js`, `app.css` | The app's screens |
| `public-memory-api.js` | Saving and loading in the browser (IndexedDB) |
| `scheduling.js`, `vendor/fsrs.js` | Spaced review |
| `recall-panel.js` | Recite, first letters and reveal |
| `user-cards.js`, `card-import.js`, `card-model.js` | Your own cards and imports |
| `audio/` | The listening player |
| `study-data/` | Study notes, dictionary and cross-references |

## Licenses and credits

The app's code is under the MIT License (see `LICENSE`). Bible text, audio, study notes and cross-references keep their own licenses, listed in `CREDITS.md`. If you share a changed copy of the study notes, keep their attribution and share-alike license.
