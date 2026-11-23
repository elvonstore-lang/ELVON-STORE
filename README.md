# ELVON STORE

Smartphone-accessories store (Tangier, Morocco). Arabic RTL, cash on delivery, WhatsApp ordering.
The whole storefront and admin panel live in a single static file, `index.html`
(Tailwind CDN + vanilla JS + Firebase Firestore/Auth loaded from CDN).

## Project files

| File | Purpose |
|---|---|
| `index.html` | The complete store (frontend, admin panel, ELVON AI). |
| `api/ai.js` | Optional Vercel serverless function that hides the Gemini key. |
| `firestore.rules` | Firestore security rules (publish them in the Firebase console). |
| `vercel.json` | Vercel config: security headers, function timeout. |
| `.env.example` | Names of the environment variables (no values). |
| `.gitignore` | Keeps secrets and junk out of Git. |

## 1. Upload to GitHub
1. github.com > **New repository** > name `elvon-store` > Private > do not add a README.
2. On the empty repo page click **uploading an existing file**.
3. Unzip the archive, open the `elvon-store` folder, select **everything inside it** (including the `api` folder and the hidden `.gitignore` / `.env.example`) and drag it into the page.
4. Click **Commit changes**. `index.html` must be at the repo root.

Or with Git:
```
cd elvon-store
git init && git add . && git commit -m "ELVON STORE"
git branch -M main
git remote add origin https://github.com/YOUR-USER/elvon-store.git
git push -u origin main
```

## 2. Deploy on Vercel
1. vercel.com > **Add New > Project** > import the repo.
2. Framework Preset: **Other**. Build command: empty. Output directory: empty (root).
3. Deploy. The store works immediately in local mode (products saved in the browser only).

## 3. Turn on the cloud (products visible to everyone, order tracking, admin)
You must create this yourself; no credentials are included in this repo.
1. console.firebase.google.com > create a project (free Spark plan is enough).
2. **Build > Firestore Database** > create database.
3. **Build > Authentication** > Sign-in method > enable **Email/Password**, then add your own admin user (your email + a strong password).
4. **Project settings > Your apps > Web (`</>`)** > copy the config object.
5. In `index.html`, find `ELVON_FIREBASE_CONFIG` (near line 51) and fill `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`. Set `ELVON_ADMIN_EMAIL` to your admin email. (Web config values are public by design; security comes from the rules.)
6. In `firestore.rules`, replace `ضع-بريدك-هنا@gmail.com` with the same admin email, then paste the file into **Firestore > Rules > Publish**.
7. Firebase **Authentication > Settings > Authorized domains**: add your Vercel domain (e.g. `elvon-store.vercel.app`) and your custom domain if any.
8. Commit the edited `index.html`; Vercel redeploys automatically.

## 4. Admin panel
Hidden from customers. Open it with the small lock icon in the footer, the `#admin` URL hash, `Ctrl+Shift+A`, or 7 taps on the logo area. In cloud mode it signs in with your Firebase admin email and password.

## 5. Smart ELVON AI (Gemini) — answers any question
Without a key, ELVON AI uses its local engine (order tracking, comparison, store info, accessory tips).
With a key it becomes a full smart assistant: general knowledge, tech, math, translation, writing, advice,
fresh info via Google Search grounding, plus everything about your store (products, prices, delivery).
1. Create a free key at https://aistudio.google.com/apikey.
2. Vercel > Settings > Environment Variables: add `GEMINI_API_KEY`, then redeploy.
   Optional: `ALLOWED_ORIGIN` (your site URL), `GEMINI_MODEL` (default `gemini-2.5-flash`), `AI_WEB_SEARCH=false` to turn off Google Search.
3. That's it: the site calls `/api/ai` on its own domain automatically. (The admin panel > ELVON AI tab > AI server URL is only needed for a server on another domain.)

Order tracking by phone number and repair booking always stay local; every other message goes to the AI with the full catalog and store info.

## Notes
- `AI_FOCUS` in `index.html` is now `false` (all features on). Set it to `true` to limit the local engine to tracking and comparison.
- Never put the Gemini key or any password in `index.html` or commit a `.env` file.
