# MyReader — install guide for iPad (6th generation, iOS 17.7)

MyReader is a Home Screen web app. You put it on a free GitHub Pages website once, open that page in Safari on the iPad, and add it to the Home Screen. After the first open it works fully offline, and there is **no Sideloadly and no 7-day re-signing**.

Your books never go to GitHub. Only the app itself does; books are stored inside the app on the iPad.

---

## Part 1 — Put the app on GitHub Pages (on your Windows laptop)

1. Unzip **MyReader.zip**. You get a folder called `myreader` containing `index.html`, `style.css`, `sw.js`, `manifest.webmanifest`, `README.md` and the folders `js`, `vendor` and `icons`.
2. Go to **github.com**, sign in, and click **+ → New repository**.
   - Repository name: `myreader`
   - Choose **Public** (GitHub Pages is free only for public repositories).
   - Click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Open the `myreader` folder in File Explorer, select **everything inside it** (5 files and 3 folders), and drag them onto the GitHub upload page. Wait until all files are listed, then click **Commit changes**.
   - Check that `index.html` sits at the top level of the repository, not inside another `myreader` folder.
5. Go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, then click **Save**.
6. Wait 1–2 minutes and refresh the Pages settings page. It shows your address, which looks like
   `https://YOUR-GITHUB-USERNAME.github.io/myreader/`

## Part 2 — Add it to the iPad Home Screen

1. On the iPad, open **Safari** (it must be Safari) and go to the address from Part 1, step 6.
2. Tap the **Share** button (square with an arrow) → **Add to Home Screen**.
3. Type any name you like for the icon, then tap **Add**.
4. Open MyReader **from the Home Screen icon** once while connected to Wi-Fi. That saves the app on the iPad so it works offline from then on.

Always use the Home Screen icon, not the Safari tab: the Home Screen app keeps its own storage, and iPadOS doesn't clear it the way it can clear website data in a Safari tab.

## Part 3 — Add books

1. Get the files onto the iPad. The easiest way from Windows is **iCloud Drive**: copy the books into the iCloud Drive folder in File Explorer (iCloud for Windows), and they appear in the iPad's Files app. AirDrop from an iPhone, or saving an email attachment to Files, also works.
2. In MyReader tap **Add books**, then **Browse** → **iCloud Drive** (or *On My iPad*), and select one or more files.

Supported: **EPUB**, **PDF**, **TXT** and **CBZ** (comic archives).

Books bought in the Kindle store, Google Play Books or Apple Books are copy-protected (DRM) and cannot be opened by any other app. DRM-free sources include Project Gutenberg, Standard Ebooks, publishers that sell DRM-free EPUBs, and your own documents.

---

## Using it

| To do this | Do this |
|---|---|
| Turn the page | Tap the right edge or swipe left. Tap the left edge or swipe right to go back. |
| Show the menus | Tap the middle of the page. |
| Fonts, size, spacing, margins, themes (White, Sepia, Green, Black), dimming | Middle tap → **Aa** |
| Contents, Notebook (highlights and notes), Bookmarks | Middle tap → list icon |
| Highlight | Press and hold a word, drag the handles, then tap a colour in the bar at the bottom. |
| Add a note | Select text → **Note**. In PDFs and comics you can also add a note to the whole page from the Notebook. |
| Change or delete a highlight | Tap the highlight. |
| Look up a word | Select it → **Define** (online dictionary), or use **Look Up** in the iPad's own menu (works offline). |
| Read aloud | Middle tap → speaker icon. It turns pages by itself; choose speed and voice in the bar. Tap a page edge to jump and it carries on from there. |
| Bookmark a page | Middle tap → bookmark icon (a red ribbon shows on bookmarked pages). |
| Search inside a book | Middle tap → magnifying glass (EPUB, TXT and PDF). |
| Time left / location | Tap the bottom-left corner to switch between time left in chapter, time left in book, location, and nothing. Time left learns your reading speed as you read. |
| Export notes | Notebook → **Export** (opens the iPad share sheet). |
| Collections, mark finished, edit title, remove | In the Library, tap **•••** under a book. |
| PDF options | **Aa** → *Fit width* for small print; dark pages in the Black theme. |
| Comics and manga | **Aa** → reading direction (Manga = right to left), two pages in landscape, fit width. |

## Good to know

- **Read aloud and screen lock:** iPadOS stops web apps when the screen locks. Keep MyReader open and on screen while it reads aloud (it asks the iPad to stay awake, but Auto-Lock can still win; set *Settings → Display & Brightness → Auto-Lock* to a longer time if needed). Extra voices: *Settings → Accessibility → Spoken Content → Voices → English* (download an *Enhanced* voice).
- **Your data lives only on this iPad.** Deleting the Home Screen icon, or *Settings → Safari → Clear History and Website Data*, removes your books, highlights and notes. Keep the original book files in iCloud Drive and export notes you care about.
- **Storage:** the Library's gear icon shows how much space MyReader is using.
- **Large files:** very large PDFs or comics (several hundred MB) may open slowly on a 6th-generation iPad.

## Updating the app later

1. Upload the changed files to the same GitHub repository (Add file → Upload files, Commit changes).
2. Open `sw.js` on GitHub, click the pencil, change the version line (for example `myreader-v1.0.0` → `myreader-v1.0.1`) and commit.
3. On the iPad, open MyReader while online, close it fully (swipe it away in the app switcher), and open it again. Your books and notes stay.

If something doesn't work, tell me what you tapped and what you saw, and I'll fix it.
