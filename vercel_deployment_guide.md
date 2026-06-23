# Deploying the AI Widget to Vercel

This guide outlines how to deploy the standalone, embeddable AI Chat & Voice Widget (`enlightlab-widget`) on Vercel.

---

## 📋 Prerequisites
1. A **Vercel Account** ([vercel.com](https://vercel.com)).
2. A **GitHub** (or GitLab/Bitbucket) account.
3. Access to your client keys (Gemini, Retell AI, and HubSpot).

---

## 🚀 Step 1: Initialize Git and Push to GitHub
Since Vercel deploys directly from your Git provider, first push the project to a private GitHub repository:
1. Open a terminal/command prompt inside `E:\enlightlab-widget`.
2. Initialize Git, add files, and make the first commit:
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit of standalone widget"
   ```
3. Create a private repository on GitHub (e.g. named `enlightlab-widget`).
4. Link the repository and push to the `main` branch:
   ```bash
   git remote add origin <YOUR_GITHUB_REPO_URL>
   git branch -M main
   git push -u origin main
   ```

---

## 🎨 Step 2: Deploy to Vercel
1. Log in to the [Vercel Dashboard](https://vercel.com).
2. Click **Add New** > **Project**.
3. Import the `enlightlab-widget` repository from GitHub.
4. **Configure Project Settings**:
   - **Framework Preset**: Vercel will automatically detect `Next.js`.
   - **Root Directory**: Leave it as `./` (the project root, since it is a standalone repository).
   - **Build & Development Settings**: Leave as default.
5. **Configure Environment Variables**:
   Under the **Environment Variables** section, add the following three key-value pairs (which are defined in your local `.env` file):
   
   | Key | Value | Description |
   | :--- | :--- | :--- |
   | `GEMINI_API_KEY` | `AIzaSy...` | API Key for RAG completions & embeddings |
   | `RETELL_API_KEY` | `key_...` | API Key to request WebRTC tokens from Retell AI |
   | `HUBSPOT_ACCESS_TOKEN` | `pat-na2-...` | Access Token to push qualified leads/transcripts |

6. Click **Deploy**. Vercel will build the application in ~1-2 minutes and provide you with a production URL (e.g., `https://enlightlab-widget.vercel.app`).

---

## 🔗 Step 3: Embed the Widget on Target Client Sites
Once deployed, Vercel will provide a live production URL. You can embed the widget on any website (e.g. landing page or product portal) by adding the following snippet before the closing `</body>` tag:

```html
<script 
  src="https://<YOUR-VERCEL-DEPLOYMENT-URL>/widget.js" 
  data-client="enlightlab"
  async>
</script>
```
*Be sure to replace `<YOUR-VERCEL-DEPLOYMENT-URL>` with the actual deployment domain provided by Vercel.*

---

## ⚠️ Important Production Notes
1. **Allowed CORS Origins**: 
   Ensure the site domain where you are embedding the script is listed under `allowedOrigins` in your [config/client.json](file:///E:/enlightlab-widget/config/client.json) file. By default, it allows `localhost:3000`, `enlightlab.com`, and `lp.enlightlab.com`.
2. **Ephemeral File System**:
   Vercel runs on a serverless, read-only file system. Since this app runs database-free:
   - qualified lead details are successfully stored in **HubSpot** in real-time.
   - usage counters (`data/usage.json` and local backup leads `data/leads.json`) are ephemeral on Vercel and will reset periodically when serverless containers recycle. For enterprise-grade tracking, we recommend extending the usage/leads code to sync with an external database (e.g. Upstash Redis, Supabase, or Neon Postgres).
